//! Taking back the last thing done in the app, and finding lost commits.
//!
//! Before an action runs, whatever it would lose is noted down or saved as
//! git objects. Undoing checks that the repository is still as the action
//! left it, so work done since then is never overwritten. The notes last as
//! long as the app runs; after that the reflog still knows.

use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::git::{
    self, check_hash, file_in_repo, run, run_with_input, GitError, ResetMode, Result,
};
use crate::rebase;

/// Undoable actions remembered per repository.
const LIMIT: usize = 20;

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Commit,
    Amend,
    Merge,
    CherryPick,
    Revert,
    Rebase,
    Reset,
    DeleteBranch,
    DropStash,
    Discard,
}

/// What can be undone right now.
#[derive(Debug, Serialize, PartialEq)]
pub struct Undoable {
    /// Grows with every action, so a new one can be told apart.
    pub id: u64,
    pub kind: Kind,
}

#[derive(Debug, Clone, PartialEq)]
struct Head {
    /// None when detached.
    branch: Option<String>,
    /// None before the first commit.
    oid: Option<String>,
}

#[derive(Debug, Clone)]
enum Way {
    /// Move the branch back and leave the index and the files alone.
    Soft,
    /// Move the branch, index and files back; local changes stay.
    Keep,
    /// Move the branch back and stage again what was staged.
    Index { before: String, after: String },
    /// Like `Keep`, then bring back the changes saved in this stash commit.
    Restore(String),
}

#[derive(Debug, Clone)]
struct SavedFile {
    path: String,
    /// The content's object, and whether it's executable; None if missing.
    before: Option<(String, bool)>,
    after: Option<String>,
}

#[derive(Debug, Clone)]
enum Step {
    Move {
        before: Head,
        after: Head,
        way: Way,
    },
    Branch {
        name: String,
        oid: String,
        config: Vec<(String, String)>,
    },
    Stash {
        oid: String,
        message: String,
    },
    Files(Vec<SavedFile>),
}

#[derive(Debug, Clone)]
struct Entry {
    id: u64,
    kind: Kind,
    step: Step,
}

#[derive(Default)]
struct State {
    last_id: u64,
    entries: HashMap<String, Vec<Entry>>,
}

#[derive(Default)]
pub struct UndoLog(Mutex<State>);

/// Trimmed output, or None when git fails or prints nothing.
fn ask(repo: &Path, args: &[&str]) -> Option<String> {
    let out = run(repo, args).ok()?;
    let out = out.trim();
    (!out.is_empty()).then(|| out.to_string())
}

fn head(repo: &Path) -> Head {
    Head {
        branch: ask(repo, &["symbolic-ref", "-q", "--short", "HEAD"]),
        oid: ask(repo, &["rev-parse", "-q", "--verify", "HEAD"]),
    }
}

fn in_progress(repo: &Path) -> Result<bool> {
    Ok(git::merge_message(repo)?.is_some()
        || git::pick_state(repo)?.is_some()
        || rebase::progress(repo)?.is_some())
}

/// The index as a tree; None while it has conflicts.
fn index_tree(repo: &Path) -> Option<String> {
    ask(repo, &["write-tree"])
}

/// The files' raw contents as objects, without line ending conversion.
/// None for missing files, an error if one isn't a regular file.
fn hash_files(repo: &Path, paths: &[&str], save: bool) -> Result<Vec<Option<String>>> {
    let mut found = vec![None; paths.len()];
    let mut existing = Vec::new();
    for (i, path) in paths.iter().enumerate() {
        match std::fs::symlink_metadata(file_in_repo(repo, path)?) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
            Ok(m) if !m.is_file() => {
                return Err(GitError::Failed(format!("{path} is not a regular file")))
            }
            Ok(_) => existing.push(i),
        }
    }
    let mut args = vec!["hash-object", "--no-filters", "--stdin-paths"];
    if save {
        args.push("-w");
    }
    // One process for many files, but few enough that its output fits in a
    // pipe: nobody reads it until all the paths are written.
    for chunk in existing.chunks(500) {
        let mut input = String::new();
        for &i in chunk {
            input += &quoted(paths[i]);
            input.push('\n');
        }
        let out = run_with_input(repo, &args, &input)?;
        let oids: Vec<&str> = out.lines().collect();
        if oids.len() != chunk.len() {
            return Err(GitError::Failed("git hash-object failed".into()));
        }
        for (&i, oid) in chunk.iter().zip(oids) {
            found[i] = Some(oid.to_string());
        }
    }
    Ok(found)
}

/// `path` as a line of input for git, quoted if it has to be.
fn quoted(path: &str) -> String {
    // A leading quote marks the form `status` makes of a name that isn't
    // valid UTF-8: it is C-quoted already, and git unquotes it, so wrapping
    // it again would name a file that doesn't exist.
    if path.starts_with('"') || !path.contains(['\n', '\r']) {
        return path.to_string();
    }
    let escaped = path
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r");
    format!("\"{escaped}\"")
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(_: &Path) -> bool {
    false
}

#[cfg(unix)]
fn set_executable(path: &Path, on: bool) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut p = std::fs::metadata(path)?.permissions();
    let mode = p.mode();
    p.set_mode(if on { mode | 0o111 } else { mode & !0o111 });
    Ok(std::fs::set_permissions(path, p)?)
}

#[cfg(not(unix))]
fn set_executable(_: &Path, _: bool) -> Result<()> {
    Ok(())
}

fn save_files(repo: &Path, paths: &[String]) -> Result<Vec<SavedFile>> {
    let names: Vec<&str> = paths.iter().map(String::as_str).collect();
    let before = hash_files(repo, &names, true)?;
    paths
        .iter()
        .zip(before)
        .map(|(path, before)| {
            let executable = is_executable(&file_in_repo(repo, path)?);
            Ok(SavedFile {
                path: path.clone(),
                before: before.map(|oid| (oid, executable)),
                after: None,
            })
        })
        .collect()
}

/// The files a patch changes.
fn patched_files(repo: &Path, patch: &str) -> Result<Vec<String>> {
    let raw = run_with_input(repo, &["apply", "--numstat", "-z", "-"], patch)?;
    Ok(raw
        .split('\0')
        .filter_map(|r| r.splitn(3, '\t').nth(2))
        .map(String::from)
        .collect())
}

fn changed_since() -> GitError {
    GitError::Failed("Can't undo: things have changed since then".into())
}

impl UndoLog {
    fn push(&self, repo: &Path, kind: Kind, step: Step) {
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        state.last_id += 1;
        let id = state.last_id;
        let list = state
            .entries
            .entry(repo.to_string_lossy().into_owned())
            .or_default();
        list.push(Entry { id, kind, step });
        if list.len() > LIMIT {
            list.remove(0);
        }
    }

    fn moved(&self, repo: &Path, kind: Kind, before: Head, way: Way) {
        let after = head(repo);
        let usable = after != before && after.branch == before.branch && after.oid.is_some();
        if usable && matches!(in_progress(repo), Ok(false)) {
            self.push(repo, kind, Step::Move { before, after, way });
        }
    }

    /// Runs an action that adds or replaces commits on the current branch.
    pub fn track<T>(
        &self,
        repo: &Path,
        kind: Kind,
        action: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        let before = head(repo);
        let done = action()?;
        let way = match kind {
            // What was committed goes back to being staged.
            Kind::Commit | Kind::Amend => Way::Soft,
            _ => Way::Keep,
        };
        self.moved(repo, kind, before, way);
        Ok(done)
    }

    /// Runs the rest of a stopped rebase. HEAD is detached until it's done,
    /// so where the branch was comes from git's own notes.
    pub fn track_continue<T>(&self, repo: &Path, action: impl FnOnce() -> Result<T>) -> Result<T> {
        let before = rebase::original(repo)?;
        let done = action()?;
        if let Some((branch, oid)) = before {
            let before = Head {
                branch: Some(branch),
                oid: Some(oid),
            };
            self.moved(repo, Kind::Rebase, before, Way::Keep);
        }
        Ok(done)
    }

    pub fn reset(&self, repo: &Path, hash: &str, mode: ResetMode) -> Result<()> {
        let before = head(repo);
        let tree = index_tree(repo);
        // Conflicts can't be saved: such a reset isn't offered for undo.
        let saved = match (mode, &tree) {
            (ResetMode::Hard, Some(_)) => ask(repo, &["stash", "create"]),
            _ => None,
        };
        let dirty = !ask(repo, &["status", "--porcelain", "--untracked-files=no"])
            .unwrap_or_default()
            .is_empty();
        git::reset(repo, hash, mode)?;
        let way = match mode {
            ResetMode::Soft => Some(Way::Soft),
            ResetMode::Mixed => tree
                .zip(index_tree(repo))
                .map(|(before, after)| Way::Index { before, after }),
            ResetMode::Hard => match saved {
                Some(oid) => Some(Way::Restore(oid)),
                None => (!dirty).then_some(Way::Keep),
            },
        };
        if let Some(way) = way {
            let after = head(repo);
            // Resetting to HEAD itself only loses local changes.
            let lost = matches!(way, Way::Restore(_));
            if after != before || lost {
                self.push(repo, Kind::Reset, Step::Move { before, after, way });
            }
        }
        Ok(())
    }

    pub fn delete_branch(
        &self,
        repo: &Path,
        name: &str,
        force: bool,
    ) -> Result<git::DeleteBranchOutcome> {
        let oid = ask(
            repo,
            &["rev-parse", "-q", "--verify", &format!("refs/heads/{name}")],
        );
        let config = ["remote", "merge"]
            .iter()
            .filter_map(|k| {
                let key = format!("branch.{name}.{k}");
                let value = ask(repo, &["config", "--get", &key])?;
                Some((key, value))
            })
            .collect();
        let outcome = git::delete_branch(repo, name, force)?;
        if let (false, Some(oid)) = (outcome.not_merged, oid) {
            let name = name.to_string();
            self.push(repo, Kind::DeleteBranch, Step::Branch { name, oid, config });
        }
        Ok(outcome)
    }

    pub fn drop_stash(&self, repo: &Path, index: u32) -> Result<()> {
        let name = format!("stash@{{{index}}}");
        let oid = ask(repo, &["rev-parse", "-q", "--verify", &name]);
        let message = ask(repo, &["log", "-g", "-1", "--format=%gs", &name, "--"]);
        git::stash_drop(repo, index)?;
        if let (Some(oid), Some(message)) = (oid, message) {
            self.push(repo, Kind::DropStash, Step::Stash { oid, message });
        }
        Ok(())
    }

    pub fn discard(&self, repo: &Path, paths: &[String]) -> Result<()> {
        // Links and submodules can't be saved: not offered for undo.
        let saved = save_files(repo, paths).ok();
        git::discard(repo, paths)?;
        self.discarded(repo, saved);
        Ok(())
    }

    pub fn discard_lines(&self, repo: &Path, diff: &str, lines: &[usize]) -> Result<()> {
        let saved = patched_files(repo, diff)
            .and_then(|paths| save_files(repo, &paths))
            .ok();
        git::apply_lines(repo, diff, lines, git::LineAction::Discard)?;
        self.discarded(repo, saved);
        Ok(())
    }

    /// The files are already discarded, so failing to note it isn't an error.
    fn discarded(&self, repo: &Path, saved: Option<Vec<SavedFile>>) {
        let Some(mut files) = saved.filter(|f| !f.is_empty()) else {
            return;
        };
        let names: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        let Ok(after) = hash_files(repo, &names, false) else {
            return;
        };
        for (f, after) in files.iter_mut().zip(after) {
            f.after = after;
        }
        self.push(repo, Kind::Discard, Step::Files(files));
    }

    /// The newest action that can still be undone.
    pub fn available(&self, repo: &Path) -> Result<Option<Undoable>> {
        Ok(self.newest(repo)?.map(|e| Undoable {
            id: e.id,
            kind: e.kind,
        }))
    }

    fn newest(&self, repo: &Path) -> Result<Option<Entry>> {
        let list = {
            let state = self.0.lock().unwrap_or_else(|e| e.into_inner());
            state.entries.get(repo.to_string_lossy().as_ref()).cloned()
        };
        // Nothing to ask git about in most refreshes.
        let Some(list) = list.filter(|l| !l.is_empty()) else {
            return Ok(None);
        };
        if in_progress(repo)? {
            return Ok(None);
        }
        let now = head(repo);
        let mut moved = false;
        for entry in list.into_iter().rev() {
            // Once the branch's newest move can't be taken back, older ones
            // would jump over it.
            let same_branch = matches!(&entry.step, Step::Move { after, .. }
                if after.branch == now.branch);
            if same_branch && moved {
                continue;
            }
            moved |= same_branch;
            if still_applies(repo, &entry, &now) {
                return Ok(Some(entry));
            }
        }
        Ok(None)
    }

    /// Undoes action `id`, if it's still the one `available` offers.
    pub fn undo(&self, repo: &Path, id: u64) -> Result<()> {
        let entry = self
            .newest(repo)?
            .filter(|e| e.id == id)
            .ok_or_else(changed_since)?;
        apply(repo, &entry.step)?;
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(list) = state.entries.get_mut(repo.to_string_lossy().as_ref()) {
            list.retain(|e| e.id != id);
        }
        Ok(())
    }
}

fn still_applies(repo: &Path, entry: &Entry, now: &Head) -> bool {
    match &entry.step {
        Step::Move { after, way, .. } => {
            if after != now {
                return false;
            }
            if let Way::Index { after, .. } = way {
                return index_tree(repo).as_ref() == Some(after);
            }
            // Others may have it by now; taking it back would need a force push.
            let new_commit = matches!(
                entry.kind,
                Kind::Commit | Kind::Amend | Kind::CherryPick | Kind::Revert
            );
            !new_commit || !is_pushed(repo, after)
        }
        Step::Branch { name, .. } => ask(
            repo,
            &["rev-parse", "-q", "--verify", &format!("refs/heads/{name}")],
        )
        .is_none(),
        Step::Stash { oid, .. } => !is_stashed(repo, oid),
        Step::Files(files) => {
            let names: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
            hash_files(repo, &names, false)
                .is_ok_and(|now| files.iter().map(|f| &f.after).eq(now.iter()))
        }
    }
}

fn is_stashed(repo: &Path, oid: &str) -> bool {
    ask(repo, &["stash", "list", "--format=%H"])
        .unwrap_or_default()
        .lines()
        .any(|l| l == oid)
}

fn is_pushed(repo: &Path, head: &Head) -> bool {
    let Some(oid) = &head.oid else { return false };
    let contains = format!("--contains={oid}");
    ask(
        repo,
        &[
            "for-each-ref",
            "--count=1",
            &contains,
            "--format=%(refname)",
            "refs/remotes",
        ],
    )
    .is_some()
}

fn apply(repo: &Path, step: &Step) -> Result<()> {
    match step {
        Step::Move { before, way, .. } => {
            let Some(oid) = &before.oid else {
                // Back to before the first commit; its files stay staged.
                return run(repo, &["update-ref", "-d", "HEAD"]).map(drop);
            };
            let reset = |flag: &str| run(repo, &["reset", "-q", flag, oid]);
            match way {
                Way::Soft => reset("--soft").map(drop),
                Way::Keep => reset("--keep").map(drop),
                Way::Index { before, .. } => {
                    reset("--soft")?;
                    run(repo, &["read-tree", before]).map(drop)
                }
                Way::Restore(stash) => {
                    reset("--keep")?;
                    if let Err(e) = run(repo, &["stash", "apply", "-q", "--index", stash]) {
                        let message = "Changes from before the reset";
                        // Trying again must not store it twice.
                        if !is_stashed(repo, stash) {
                            run(repo, &["stash", "store", "-m", message, stash])?;
                        }
                        return Err(GitError::Failed(format!(
                            "The reset was undone, but your changes don't fit \
                             anymore and are in a stash now: {e}"
                        )));
                    }
                    Ok(())
                }
            }
        }
        Step::Branch { name, oid, config } => {
            run(repo, &["branch", "--no-track", "--", name, oid])?;
            for (key, value) in config {
                run(repo, &["config", key, value])?;
            }
            Ok(())
        }
        Step::Stash { oid, message } => {
            run(repo, &["stash", "store", "-m", message, oid]).map(drop)
        }
        Step::Files(files) => {
            for f in files {
                let full = git::writable_file_in_repo(repo, &f.path)?;
                match &f.before {
                    None => std::fs::remove_file(&full)?,
                    Some((oid, executable)) => {
                        let content = git::output(repo, &["cat-file", "blob", oid])?;
                        if !content.status.success() {
                            return Err(changed_since());
                        }
                        // Discarding a file's last line can take its folder along.
                        if let Some(dir) = full.parent() {
                            std::fs::create_dir_all(dir)?;
                        }
                        std::fs::write(&full, content.stdout)?;
                        set_executable(&full, *executable)?;
                    }
                }
            }
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// Reflog

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    pub hash: String,
    pub short_hash: String,
    /// When the branch moved there, as a Unix timestamp in seconds.
    pub time: i64,
    /// What moved it, e.g. "reset: moving to HEAD~1".
    pub action: String,
    pub subject: String,
}

/// Where HEAD, or a branch, has pointed lately. Newest first.
pub fn reflog(repo: &Path, branch: Option<&str>) -> Result<Vec<ReflogEntry>> {
    let name = match branch {
        Some(b) => format!("refs/heads/{b}"),
        None => "HEAD".into(),
    };
    if ask(repo, &["rev-parse", "-q", "--verify", &name]).is_none() {
        return Ok(Vec::new());
    }
    let raw = run(
        repo,
        &[
            "reflog",
            "show",
            "-n300",
            "--date=unix",
            "--format=%H%x1f%h%x1f%gd%x1f%gs%x1f%s%x1e",
            &name,
            "--",
        ],
    )?;
    Ok(raw
        .split('\x1e')
        .filter_map(|record| {
            let mut f = record.trim_start_matches('\n').split('\x1f');
            Some(ReflogEntry {
                hash: f.next().filter(|h| !h.is_empty())?.into(),
                short_hash: f.next()?.into(),
                // "HEAD@{1700000000}"
                time: f
                    .next()?
                    .rsplit_once("@{")
                    .and_then(|(_, t)| t.trim_end_matches('}').parse().ok())
                    .unwrap_or(0),
                action: f.next()?.into(),
                subject: f.next()?.into(),
            })
        })
        .collect())
}

/// Stashes that were dropped but that git hasn't cleaned up yet, in the same
/// form as the reflog. Looks through the whole object store, so it's slow.
pub fn lost_stashes(repo: &Path) -> Result<Vec<ReflogEntry>> {
    let out = git::output(
        repo,
        &[
            "fsck",
            "--unreachable",
            "--connectivity-only",
            "--no-progress",
        ],
    )?;
    let hashes: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.strip_prefix("unreachable commit "))
        .map(String::from)
        .collect();
    if hashes.is_empty() {
        return Ok(Vec::new());
    }
    let raw = run_with_input(
        repo,
        &[
            "log",
            "--no-walk",
            "--stdin",
            "--format=%H%x1f%h%x1f%P%x1f%ct%x1f%s%x1e",
        ],
        &(hashes.join("\n") + "\n"),
    )?;
    let mut found: Vec<ReflogEntry> = raw
        .split('\x1e')
        .filter_map(|record| {
            let mut f = record.trim_start_matches('\n').split('\x1f');
            let hash = f.next().filter(|h| !h.is_empty())?.to_string();
            let short_hash = f.next()?.to_string();
            let parents = f.next()?.split(' ').count();
            let time = f.next()?.parse().ok()?;
            let subject = f.next()?.to_string();
            // A stash is a merge of HEAD and the index (and untracked files).
            let is_stash = matches!(parents, 2 | 3)
                && (subject.starts_with("WIP on ") || subject.starts_with("On "));
            is_stash.then(|| ReflogEntry {
                hash,
                short_hash,
                time,
                action: String::new(),
                subject,
            })
        })
        .collect();
    found.sort_by_key(|e| std::cmp::Reverse(e.time));
    Ok(found)
}

/// Puts a lost stash back on the list.
pub fn recover_stash(repo: &Path, hash: &str) -> Result<()> {
    check_hash(hash)?;
    let lost = lost_stashes(repo)?;
    let stash = lost
        .iter()
        .find(|e| e.hash == hash)
        .ok_or_else(|| GitError::Failed(format!("No lost stash {hash}")))?;
    run(repo, &["stash", "store", "-m", &stash.subject, hash]).map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Repo {
        dir: PathBuf,
        log: UndoLog,
    }

    impl Repo {
        fn new(name: &str) -> Repo {
            let dir =
                std::env::temp_dir().join(format!("gitgud-undo-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            run(&dir, &["init", "-q", "-b", "main"]).unwrap();
            for (k, v) in [
                ("user.name", "T"),
                ("user.email", "t@x"),
                ("commit.gpgsign", "false"),
                ("core.autocrlf", "false"),
            ] {
                run(&dir, &["config", k, v]).unwrap();
            }
            Repo {
                dir,
                log: UndoLog::default(),
            }
        }
        fn write(&self, file: &str, content: &str) {
            std::fs::write(self.dir.join(file), content).unwrap();
        }
        fn read(&self, file: &str) -> String {
            std::fs::read_to_string(self.dir.join(file)).unwrap()
        }
        fn stage(&self, file: &str) {
            git::stage(&self.dir, &[file.into()]).unwrap();
        }
        /// Commits `content` through the undo log.
        fn commit(&self, file: &str, content: &str) -> String {
            self.write(file, content);
            self.stage(file);
            self.log
                .track(&self.dir, Kind::Commit, || {
                    git::commit(&self.dir, content.trim())
                })
                .unwrap();
            self.oid()
        }
        fn oid(&self) -> String {
            head(&self.dir).oid.unwrap()
        }
        fn offered(&self) -> Option<Kind> {
            self.log.available(&self.dir).unwrap().map(|u| u.kind)
        }
        fn undo(&self) -> Result<()> {
            let id = self
                .log
                .available(&self.dir)?
                .expect("something to undo")
                .id;
            self.log.undo(&self.dir, id)
        }
        /// `git status` in short form.
        fn status(&self) -> String {
            run(&self.dir, &["status", "--porcelain"]).unwrap()
        }
    }

    impl Drop for Repo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn undoes_commits_back_to_the_first() {
        let r = Repo::new("commit");
        let first = r.commit("a", "one\n");
        r.commit("a", "two\n");
        let r_dir = r.dir.clone();
        r.log
            .track(&r.dir, Kind::Amend, || git::amend(&r_dir, "better"))
            .unwrap();
        assert_eq!(r.offered(), Some(Kind::Amend));
        r.undo().unwrap();
        assert_eq!(git::log(&r.dir, 1).unwrap()[0].subject, "two");
        assert_eq!(r.offered(), Some(Kind::Commit));
        r.undo().unwrap();
        assert_eq!(r.oid(), first);
        assert_eq!(r.status(), "M  a\n");
        // Undoing with other changes around leaves them alone.
        r.write("b", "new\n");
        r.undo().unwrap();
        assert_eq!(head(&r.dir).oid, None);
        assert_eq!(r.status(), "A  a\n?? b\n");
        assert_eq!(r.offered(), None);
    }

    #[test]
    fn commits_that_moved_on_or_were_pushed_stay() {
        let r = Repo::new("stale");
        r.commit("a", "one\n");
        r.commit("a", "two\n");
        let id = r.log.available(&r.dir).unwrap().unwrap().id;
        run(&r.dir, &["update-ref", "refs/remotes/origin/main", "HEAD"]).unwrap();
        assert_eq!(r.offered(), None);
        run(&r.dir, &["update-ref", "-d", "refs/remotes/origin/main"]).unwrap();
        // A commit from the terminal.
        run(&r.dir, &["commit", "-q", "--allow-empty", "-m", "x"]).unwrap();
        assert_eq!(r.offered(), None);
        assert!(r.log.undo(&r.dir, id).is_err());
        assert_eq!(git::log(&r.dir, 1).unwrap()[0].subject, "x");
    }

    #[test]
    fn resets_come_back_with_their_changes() {
        let r = Repo::new("reset");
        let first = r.commit("a", "one\n");
        let second = r.commit("a", "two\n");
        r.write("b", "staged\n");
        r.stage("b");
        r.write("a", "edited\n");
        let before = r.status();
        assert_eq!(before, " M a\nA  b\n");

        for mode in [ResetMode::Soft, ResetMode::Mixed, ResetMode::Hard] {
            r.log.reset(&r.dir, &first, mode).unwrap();
            assert_eq!(r.oid(), first);
            assert_eq!(r.offered(), Some(Kind::Reset));
            r.undo().unwrap();
            assert_eq!((r.oid(), r.status()), (second.clone(), before.clone()));
            assert_eq!(
                (r.read("a"), r.read("b")),
                ("edited\n".into(), "staged\n".into())
            );
        }

        // Only local changes are lost here.
        r.log.reset(&r.dir, &second, ResetMode::Hard).unwrap();
        assert_eq!(r.status(), "");
        r.undo().unwrap();
        assert_eq!(r.status(), before);

        // Work done after the reset isn't overwritten.
        r.log.reset(&r.dir, &first, ResetMode::Hard).unwrap();
        r.write("a", "newer\n");
        assert!(r.undo().is_err());
        assert_eq!(r.read("a"), "newer\n");

        // Neither is what was staged since a mixed reset.
        r.log.reset(&r.dir, &first, ResetMode::Hard).unwrap();
        r.commit("a", "three\n");
        r.log.reset(&r.dir, &first, ResetMode::Mixed).unwrap();
        r.stage("a");
        assert_eq!(r.offered(), None);
    }

    #[test]
    fn merges_and_picks_are_undone() {
        let r = Repo::new("merge");
        let base = r.commit("a", "one\n");
        git::create_branch_at(&r.dir, "side", &base).unwrap();
        let side = r.commit("b", "side\n");
        git::switch_branch(&r.dir, "main").unwrap();
        let tip = r.commit("a", "two\n");
        r.write("a", "local\n");

        r.log
            .track(&r.dir, Kind::CherryPick, || git::cherry_pick(&r.dir, &side))
            .unwrap();
        r.undo().unwrap();
        assert_eq!((r.oid(), r.read("a")), (tip.clone(), "local\n".into()));
        r.log
            .track(&r.dir, Kind::Merge, || git::merge(&r.dir, "side"))
            .unwrap();
        assert_ne!(r.oid(), tip);
        r.undo().unwrap();
        assert_eq!((r.oid(), r.read("a")), (tip, "local\n".into()));
        assert!(!r.dir.join("b").exists());
    }

    #[test]
    fn a_rebase_that_stopped_is_undone_in_one_go() {
        let r = Repo::new("rebase");
        r.commit("a", "one\n");
        let second = r.commit("a", "two\n");
        let tip = r.commit("a", "three\n");
        let items: Vec<rebase::TodoItem> = [
            (&second, rebase::Action::Drop),
            (&tip, rebase::Action::Pick),
        ]
        .into_iter()
        .map(|(hash, action)| rebase::TodoItem {
            hash: hash.clone(),
            action,
            message: None,
        })
        .collect();
        let stopped = r
            .log
            .track(&r.dir, Kind::Rebase, || {
                rebase::start(&r.dir, &second, &items)
            })
            .unwrap()
            .stopped;
        assert!(stopped);
        assert_eq!(r.offered(), None);
        git::resolve_file(&r.dir, "a", git::Side::Theirs).unwrap();
        r.log
            .track_continue(&r.dir, || rebase::continue_(&r.dir))
            .unwrap();
        assert_ne!(r.oid(), tip);
        assert_eq!(r.offered(), Some(Kind::Rebase));
        r.undo().unwrap();
        assert_eq!(r.oid(), tip);
        assert_eq!(head(&r.dir).branch.as_deref(), Some("main"));
    }

    #[test]
    fn branches_stashes_and_files_come_back() {
        let r = Repo::new("rest");
        let base = r.commit("a", "one\r\n");
        run(&r.dir, &["branch", "side"]).unwrap();
        for (k, v) in [("remote", "origin"), ("merge", "refs/heads/side")] {
            run(&r.dir, &["config", &format!("branch.side.{k}"), v]).unwrap();
        }
        r.log.delete_branch(&r.dir, "side", false).unwrap();
        r.undo().unwrap();
        assert_eq!(ask(&r.dir, &["rev-parse", "side"]).unwrap(), base);
        assert_eq!(
            ask(&r.dir, &["config", "branch.side.merge"]).unwrap(),
            "refs/heads/side"
        );

        r.write("a", "stashed\n");
        git::stash_push(&r.dir, "keep me", false).unwrap();
        r.log.drop_stash(&r.dir, 0).unwrap();
        assert!(git::stashes(&r.dir).unwrap().is_empty());
        r.undo().unwrap();
        assert_eq!(git::stashes(&r.dir).unwrap()[0].message, "keep me");

        // Without the log, e.g. after a restart.
        git::stash_drop(&r.dir, 0).unwrap();
        let lost = lost_stashes(&r.dir).unwrap();
        assert_eq!(lost.len(), 1);
        assert!(recover_stash(&r.dir, &base).is_err());
        recover_stash(&r.dir, &lost[0].hash).unwrap();
        assert_eq!(git::stashes(&r.dir).unwrap()[0].message, "keep me");
        assert!(lost_stashes(&r.dir).unwrap().is_empty());

        r.write("a", "edited\r\nmore\n");
        r.log.discard(&r.dir, &["a".into()]).unwrap();
        assert_eq!(r.read("a"), "one\r\n");
        assert_eq!(r.offered(), Some(Kind::Discard));
        r.undo().unwrap();
        assert_eq!(r.read("a"), "edited\r\nmore\n");
        // A file that was gone is gone again, unless it changed since.
        std::fs::remove_file(r.dir.join("a")).unwrap();
        r.log.discard(&r.dir, &["a".into()]).unwrap();
        r.write("a", "newer\n");
        assert_ne!(r.offered(), Some(Kind::Discard));
        r.write("a", "one\r\n");
        r.undo().unwrap();
        assert!(!r.dir.join("a").exists());
    }

    #[test]
    fn discarded_lines_and_many_files_come_back() {
        let r = Repo::new("lines");
        std::fs::create_dir_all(r.dir.join("şub dir")).unwrap();
        let path = "şub dir/f.txt";
        r.commit(path, "one\ntwo\n");
        r.write(path, "one\ntwo\nthree\n");
        let diff = git::diff(&r.dir, path, None, false, false, false).unwrap();
        let line = diff.split('\n').position(|l| l == "+three").unwrap();
        r.log.discard_lines(&r.dir, &diff, &[line]).unwrap();
        assert_eq!(r.read(path), "one\ntwo\n");
        assert_eq!(r.offered(), Some(Kind::Discard));
        r.undo().unwrap();
        assert_eq!(r.read(path), "one\ntwo\nthree\n");
        r.log.discard(&r.dir, &[path.into()]).unwrap();

        // More than fits in one batch.
        let names: Vec<String> = (0..1100).map(|i| format!("f{i}")).collect();
        for n in &names {
            r.write(n, "old\n");
        }
        git::stage(&r.dir, &names).unwrap();
        for n in &names {
            r.write(n, &format!("new {n}\n"));
        }
        r.log.discard(&r.dir, &names).unwrap();
        assert_eq!(r.read("f1099"), "old\n");
        r.undo().unwrap();
        assert!(names.iter().all(|n| r.read(n) == format!("new {n}\n")));
    }

    #[test]
    fn paths_are_quoted_only_when_needed() {
        assert_eq!(quoted("a b/ş"), "a b/ş");
        assert_eq!(quoted("a\nb"), "\"a\\nb\"");
        // The quoted form a non-text name gets is complete already.
        assert_eq!(quoted("\"caf\\351.txt\""), "\"caf\\351.txt\"");
    }

    #[test]
    fn reads_the_reflog() {
        let r = Repo::new("reflog");
        assert!(reflog(&r.dir, None).unwrap().is_empty());
        let first = r.commit("a", "one\n");
        let second = r.commit("a", "two\n");
        git::reset(&r.dir, &first, ResetMode::Hard).unwrap();
        let log = reflog(&r.dir, Some("main")).unwrap();
        let hashes: Vec<_> = log.iter().map(|e| e.hash.as_str()).collect();
        assert_eq!(hashes, [&first, &second, &first]);
        assert!(log[0].action.starts_with("reset: moving to"));
        assert_eq!(log[1].subject, "two");
        assert!(log[1].time > 1_500_000_000);
        assert!(reflog(&r.dir, Some("nope")).unwrap().is_empty());
    }
}
