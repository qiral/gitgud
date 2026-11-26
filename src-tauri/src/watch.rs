//! Tells the frontend when a repository changes on disk, whoever changed it:
//! an editor saving a file, `git commit` in a terminal, a background fetch.
//!
//! Events are collected until things go quiet, files git ignores are left
//! out (a build writing to `target/` is no news), and then the frontend gets
//! one `repo-changed` event with the repository's path.

use crate::git::{self, GitError, Result};
use notify::event::{CreateKind, ModifyKind};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

/// The event the frontend listens to; its payload is the repository path.
pub const CHANGED: &str = "repo-changed";

/// Waits this long without events before reporting them...
const QUIET: Duration = Duration::from_millis(150);
/// ...but no longer than this while they keep coming, e.g. during a build.
const AT_MOST: Duration = Duration::from_secs(1);

/// What `.git` holds that the app shows. Objects, logs and lock files come
/// and go with every command without changing anything on their own.
const GIT_FILES: &[&str] = &[
    "HEAD",
    "index",
    "packed-refs",
    "refs",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
];

type Shared = Arc<Mutex<RecommendedWatcher>>;

/// One watcher per open repository, with how many asked for it: React
/// mounts twice in development, and the calls can arrive in any order.
/// Dropping a watcher stops its thread.
#[derive(Default)]
pub struct Watchers(Mutex<HashMap<String, (usize, Shared)>>);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn failed(e: notify::Error) -> GitError {
    GitError::Failed(format!("Can't watch the repository for changes: {e}"))
}

impl Watchers {
    /// Starts watching `repo` (its top-level folder), calling `changed`
    /// after each burst of changes. Watching it again does nothing.
    pub fn watch(&self, repo: &str, changed: impl Fn() + Send + 'static) -> Result<()> {
        let mut all = lock(&self.0);
        if let Some((count, _)) = all.get_mut(repo) {
            *count += 1;
            return Ok(());
        }
        let layout = Layout::of(Path::new(repo))?;
        let (tx, rx) = mpsc::channel();
        let watcher: Shared =
            Arc::new(Mutex::new(notify::recommended_watcher(tx).map_err(failed)?));
        {
            let mut w = lock(&watcher);
            for (path, mode) in layout.plan() {
                if let Err(e) = w.watch(&path, mode) {
                    // The repository itself must be watched; past that, e.g.
                    // once Linux runs out of watches, refreshing on focus
                    // still covers the rest.
                    if path == layout.root.given {
                        return Err(failed(e));
                    }
                    eprintln!("gitgud: not watching {}: {e}", path.display());
                    break;
                }
            }
        }
        let weak = Arc::downgrade(&watcher);
        std::thread::spawn(move || listen(&layout, &rx, &weak, changed));
        all.insert(repo.to_string(), (1, watcher));
        Ok(())
    }

    pub fn unwatch(&self, repo: &str) {
        let mut all = lock(&self.0);
        if let Some((count, _)) = all.get_mut(repo) {
            *count -= 1;
            if *count == 0 {
                all.remove(repo);
            }
        }
    }
}

/// A folder as it was given and as the system resolves it: macOS reports
/// `/private/var/...` for `/var/...`.
struct Base {
    given: PathBuf,
    real: PathBuf,
}

impl Base {
    fn new(path: PathBuf) -> Self {
        let real = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        Base { given: path, real }
    }

    fn relative<'a>(&self, path: &'a Path) -> Option<&'a Path> {
        path.strip_prefix(&self.given)
            .or_else(|_| path.strip_prefix(&self.real))
            .ok()
    }

    fn contains(&self, other: &Base) -> bool {
        other.real.starts_with(&self.real)
    }
}

struct Layout {
    /// The working tree.
    root: Base,
    /// `.git`, or where a `.git` file points to (worktrees, submodules).
    git_dir: Base,
    /// Where refs live: the main repository's `.git` for a linked worktree.
    common_dir: Base,
}

enum Seen {
    Git,
    /// A file in the working tree, relative to its root.
    Tree(PathBuf),
    Nothing,
}

impl Layout {
    fn of(repo: &Path) -> Result<Self> {
        let out = git::run(
            repo,
            &["rev-parse", "--absolute-git-dir", "--git-common-dir"],
        )?;
        let mut lines = out.lines();
        let (Some(git_dir), Some(common_dir)) = (lines.next(), lines.next()) else {
            return Err(GitError::Failed("Not a git repository".into()));
        };
        Ok(Layout {
            root: Base::new(repo.to_path_buf()),
            git_dir: Base::new(PathBuf::from(git_dir)),
            // Relative to the repository when it's the usual `.git`.
            common_dir: Base::new(repo.join(common_dir)),
        })
    }

    /// The folders to watch and how.
    fn plan(&self) -> Vec<(PathBuf, RecursiveMode)> {
        let mut plan = Vec::new();
        #[cfg(target_os = "linux")]
        {
            // inotify watches one folder at a time and the number of them is
            // limited, so leave out what git ignores (node_modules, target).
            plan.extend(
                folders(&self.root.given)
                    .into_iter()
                    .map(|p| (p, RecursiveMode::NonRecursive)),
            );
        }
        #[cfg(not(target_os = "linux"))]
        plan.push((self.root.given.clone(), RecursiveMode::Recursive));

        // Elsewhere a `.git` inside the tree is already watched with it.
        let watched = |dir: &Base| cfg!(target_os = "linux") || !self.root.contains(dir);
        for dir in [&self.git_dir, &self.common_dir] {
            if watched(dir) && !plan.iter().any(|(p, _)| *p == dir.given) {
                plan.push((dir.given.clone(), RecursiveMode::NonRecursive));
            }
        }
        let refs = self.common_dir.given.join("refs");
        if watched(&self.common_dir) && refs.is_dir() {
            plan.push((refs, RecursiveMode::Recursive));
        }
        plan
    }

    fn see(&self, path: &Path) -> Seen {
        // The worktree's own git folder first: a linked one sits inside the
        // common one.
        for dir in [&self.git_dir, &self.common_dir] {
            if let Some(rel) = dir.relative(path) {
                return if shown_by_app(rel) {
                    Seen::Git
                } else {
                    Seen::Nothing
                };
            }
        }
        match self.root.relative(path) {
            Some(rel) if rel.as_os_str().is_empty() => Seen::Nothing,
            // A `.git` file, or a submodule's.
            Some(rel) if rel.components().any(|c| c.as_os_str() == ".git") => Seen::Nothing,
            Some(rel) => Seen::Tree(rel.to_path_buf()),
            None => Seen::Nothing,
        }
    }
}

fn shown_by_app(rel: &Path) -> bool {
    let first = rel.components().next().and_then(|c| match c {
        Component::Normal(name) => name.to_str(),
        _ => None,
    });
    let lock = rel.extension().is_some_and(|e| e == "lock");
    first.is_some_and(|f| GIT_FILES.contains(&f)) && !lock
}

/// Folders of the tree that git doesn't ignore, `.git` left out.
#[cfg(target_os = "linux")]
fn folders(dir: &Path) -> Vec<PathBuf> {
    ::ignore::WalkBuilder::new(dir)
        .hidden(false)
        .require_git(false)
        .filter_entry(|e| e.file_name() != ".git")
        .build()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_some_and(|t| t.is_dir()))
        .map(|e| e.into_path())
        .collect()
}

fn listen(
    layout: &Layout,
    events: &Receiver<notify::Result<Event>>,
    watcher: &Weak<Mutex<RecommendedWatcher>>,
    changed: impl Fn(),
) {
    // Ends when the watcher is dropped, which closes the channel.
    while let Ok(first) = events.recv() {
        let mut batch = vec![first];
        let start = Instant::now();
        loop {
            match events.recv_timeout(QUIET.min(AT_MOST.saturating_sub(start.elapsed()))) {
                Ok(e) => batch.push(e),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        if matters(layout, batch, watcher) {
            changed();
        }
    }
}

/// Whether a batch of events changes anything the app shows. On Linux it
/// also starts watching new folders.
fn matters(
    layout: &Layout,
    batch: Vec<notify::Result<Event>>,
    #[cfg_attr(not(target_os = "linux"), allow(unused_variables))] watcher: &Weak<
        Mutex<RecommendedWatcher>,
    >,
) -> bool {
    let mut git = false;
    let mut tree = HashSet::new();
    let mut new_folders = Vec::new();
    for event in batch {
        let event = match event {
            Ok(e) => e,
            // Lost events, most likely: assume the worst.
            Err(_) => {
                git = true;
                continue;
            }
        };
        if event.need_rescan() {
            git = true;
        }
        if matches!(event.kind, EventKind::Access(_)) {
            continue;
        }
        let maybe_folder = matches!(
            event.kind,
            EventKind::Create(CreateKind::Folder | CreateKind::Any)
                | EventKind::Modify(ModifyKind::Name(_))
        );
        for path in event.paths {
            match layout.see(&path) {
                Seen::Git => git = true,
                Seen::Tree(rel) => {
                    if maybe_folder && path.is_dir() {
                        new_folders.push((path, rel.clone()));
                    }
                    tree.insert(rel);
                }
                Seen::Nothing => {}
            }
        }
    }
    if tree.is_empty() {
        return git;
    }
    let ignored = ignored(&layout.root.given, &tree);

    #[cfg(target_os = "linux")]
    if let Some(watcher) = watcher.upgrade() {
        let mut w = lock(&watcher);
        for (path, rel) in &new_folders {
            if ignored.contains(rel) {
                continue;
            }
            for folder in folders(path) {
                if w.watch(&folder, RecursiveMode::NonRecursive).is_err() {
                    break;
                }
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    drop(new_folders);

    // Shown when a test fails: what made a batch count.
    #[cfg(test)]
    eprintln!(
        "watch: git={git} tree={:?}",
        tree.iter()
            .filter(|p| !ignored.contains(*p))
            .collect::<Vec<_>>()
    );
    git || tree.iter().any(|p| !ignored.contains(p))
}

/// Which of `paths` (relative to `root`) git ignores. When git can't tell,
/// none: a needless refresh beats a missed one.
fn ignored(root: &Path, paths: &HashSet<PathBuf>) -> HashSet<PathBuf> {
    let name = |p: &Path| {
        let s = p.to_string_lossy();
        if cfg!(windows) {
            s.replace('\\', "/")
        } else {
            s.into_owned()
        }
    };
    let by_name: HashMap<String, &PathBuf> = paths.iter().map(|p| (name(p), p)).collect();
    let mut input = Vec::new();
    for n in by_name.keys() {
        input.extend_from_slice(n.as_bytes());
        input.push(0);
    }
    // Exits with 1 when nothing is ignored, so look at what it printed.
    let Ok(out) = git::output_with_input(root, &["check-ignore", "-z", "--stdin"], input) else {
        return HashSet::new();
    };
    if !matches!(out.status.code(), Some(0 | 1)) {
        return HashSet::new();
    }
    String::from_utf8_lossy(&out.stdout)
        .split('\0')
        .filter_map(|n| by_name.get(n).map(|p| (*p).clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::Sender;

    fn repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gitgud-watch-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git::run(&dir, &["init", "-q", "-b", "main"]).unwrap();
        for (k, v) in [
            ("user.name", "T"),
            ("user.email", "t@x"),
            ("commit.gpgsign", "false"),
        ] {
            git::run(&dir, &["config", k, v]).unwrap();
        }
        std::fs::write(dir.join(".gitignore"), "build/\n").unwrap();
        std::fs::create_dir_all(dir.join("build")).unwrap();
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/a.txt"), "a").unwrap();
        git::run(&dir, &["add", "-A"]).unwrap();
        git::run(&dir, &["commit", "-q", "-m", "base"]).unwrap();
        dir
    }

    fn watching(dir: &Path) -> (Watchers, Receiver<()>) {
        let (tx, rx): (Sender<()>, _) = mpsc::channel();
        let watchers = Watchers::default();
        let tx = Mutex::new(tx);
        watchers
            .watch(&dir.to_string_lossy(), move || {
                let _ = lock(&tx).send(());
            })
            .unwrap();
        (watchers, rx)
    }

    /// Whether a change was reported, after letting earlier ones settle.
    fn reported(rx: &Receiver<()>, what: impl FnOnce()) -> bool {
        // macOS and Windows deliver one write as several events, sometimes
        // well apart: wait for a whole second without any.
        while rx.recv_timeout(Duration::from_secs(1)).is_ok() {}
        what();
        rx.recv_timeout(Duration::from_secs(3)).is_ok()
    }

    #[test]
    fn reports_edits_and_commits_but_not_ignored_files() {
        let dir = repo("edits");
        let (watchers, rx) = watching(&dir);

        assert!(reported(&rx, || std::fs::write(dir.join("src/a.txt"), "b").unwrap()));
        assert!(reported(&rx, || std::fs::write(dir.join("new.txt"), "n").unwrap()));
        assert!(!reported(&rx, || std::fs::write(
            dir.join("build/out.o"),
            "x"
        )
        .unwrap()));
        assert!(reported(&rx, || {
            git::run(&dir, &["commit", "-q", "-am", "edit"]).unwrap();
        }));
        assert!(reported(&rx, || {
            git::run(&dir, &["branch", "other"]).unwrap();
        }));

        // Folders made after watching started are watched too.
        assert!(reported(&rx, || std::fs::create_dir_all(
            dir.join("src/deep")
        )
        .unwrap()));
        assert!(reported(&rx, || std::fs::write(
            dir.join("src/deep/b.txt"),
            "b"
        )
        .unwrap()));

        // Asked for twice, so it takes two to stop.
        watchers.watch(&dir.to_string_lossy(), || {}).unwrap();
        watchers.unwatch(&dir.to_string_lossy());
        assert!(reported(&rx, || std::fs::write(dir.join("src/a.txt"), "c").unwrap()));
        watchers.unwatch(&dir.to_string_lossy());
        assert!(!reported(&rx, || std::fs::write(
            dir.join("src/a.txt"),
            "d"
        )
        .unwrap()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn asks_git_what_it_ignores() {
        let dir = repo("ignored");
        let paths: HashSet<PathBuf> = ["build/out.o", "build", "src/a.txt", "new.txt"]
            .into_iter()
            .map(PathBuf::from)
            .collect();
        let mut got: Vec<_> = ignored(&dir, &paths).into_iter().collect();
        got.sort();
        assert_eq!(got, [PathBuf::from("build"), PathBuf::from("build/out.o")]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn looks_only_at_what_git_keeps_in_its_folder() {
        let p = Path::new;
        assert!(shown_by_app(p("HEAD")));
        assert!(shown_by_app(p("refs/heads/main")));
        assert!(shown_by_app(p("index")));
        assert!(!shown_by_app(p("index.lock")));
        assert!(!shown_by_app(p("refs/heads/main.lock")));
        assert!(!shown_by_app(p("objects/ab/cdef")));
        assert!(!shown_by_app(p("logs/HEAD")));
        assert!(!shown_by_app(p("FETCH_HEAD")));
    }
}
