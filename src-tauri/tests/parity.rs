//! State parity against the real `git` binary.
//!
//! The backend is a parser over git's output, and its unit tests check that
//! parse against fixed expectations. This file asks the other question: it
//! drives a scratch repository through the backend's own functions, reads the
//! same state a second time straight from the `git` CLI, and compares the two
//! independent reads.
//!
//! What gets compared are canonical facts, never raw porcelain text: sets of
//! (path, status) pairs, sets of commit hashes with their subjects and
//! parents, counts. A git release may reflow its output and that must not
//! paint this lab red, while a parse that drifts from git must.
//!
//! Every test is `#[ignore]`d, so `cargo test` stays fast and the per-push
//! gate never runs this. See docs/TESTING.md.

use gitgud_lib::git;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

// ---------------------------------------------------------------------------
// The real git binary

/// Runs `git` in `dir` and returns its stdout, or panics with git's stderr.
///
/// The environment is inherited on purpose: the backend runs git the same way,
/// so a machine-level setting that would break one breaks both and a parity
/// failure means the parse, not the setup. What the fixture pins (identity,
/// signing, hooks, excludes) lives in the repository's own config, which
/// outranks the global one.
fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("the git CLI has to be on PATH: this lab is a comparison with it");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr).trim()
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

// ---------------------------------------------------------------------------
// The fixture

/// A throwaway repository, removed when the test ends, panic or not.
struct Scratch {
    dir: PathBuf,
}

/// Keeps two tests in one process off each other's directory.
static NEXT: AtomicU32 = AtomicU32::new(0);

impl Scratch {
    /// An empty repository on `main`, with a fixed identity and the settings
    /// that make a fixture reproducible on any machine.
    fn new(name: &str) -> Scratch {
        let dir = std::env::temp_dir().join(format!(
            "gitgud-parity-{}-{}-{name}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let repo = Scratch { dir };

        repo.git(&["init", "-q", "-b", "main"]);
        // An excludes file of our own, so a global one can't hide a file from
        // one reader and not the other; no hooks, so neither runs behind our
        // back. Both point at paths that don't exist, which is what git wants.
        let excludes = repo.dir.join("no-global-excludes").display().to_string();
        for (key, value) in [
            ("user.name", "Parity Lab"),
            ("user.email", "parity@example.com"),
            ("commit.gpgsign", "false"),
            ("tag.gpgsign", "false"),
            ("core.autocrlf", "false"),
            ("core.hooksPath", "no-hooks"),
            ("core.excludesfile", &excludes),
        ] {
            repo.git(&["config", key, value]);
        }
        repo
    }

    /// The same repository with three fixed commits and a known file set:
    /// README.md, docs/guide.md, src/lib.rs, src/main.rs, tests/smoke.rs.
    fn seeded(name: &str) -> Scratch {
        let repo = Scratch::new(name);
        repo.write("README.md", "# scratch\n");
        repo.write("src/main.rs", "fn main() {}\n");
        repo.commit("seed the repository");

        repo.write("docs/guide.md", "read me first\n");
        repo.write("src/lib.rs", "pub fn answer() -> u32 {\n    42\n}\n");
        repo.commit("add a guide");

        repo.write("README.md", "# scratch\n\nstill scratch\n");
        repo.write("tests/smoke.rs", "#[test]\nfn smoke() {}\n");
        repo.commit("write the smoke test");
        repo
    }

    fn repo(&self) -> &Path {
        &self.dir
    }

    fn git(&self, args: &[&str]) -> String {
        git(&self.dir, args)
    }

    fn write(&self, path: &str, content: &str) {
        let path = self.dir.join(path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    /// Stages everything and commits through the CLI, so the fixture state is
    /// made by git itself and not by the code under test.
    fn commit(&self, message: &str) {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", message]);
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

// ---------------------------------------------------------------------------
// Two reads of one state, reduced to the same facts

/// What a status read says, in a shape both sides can produce: which paths are
/// staged and with what, which are changed in the working tree, which git has
/// never seen, which are mid-conflict.
#[derive(Debug, Default, PartialEq, Eq)]
struct Facts {
    staged: BTreeSet<(String, char)>,
    unstaged: BTreeSet<(String, char)>,
    untracked: BTreeSet<String>,
    conflicted: BTreeSet<String>,
}

impl Facts {
    /// Records one path's index and worktree status, the way porcelain spells
    /// them: '.' is "unchanged".
    fn record(&mut self, path: &str, index: char, worktree: char) {
        if index != '.' {
            self.staged.insert((path.to_string(), index));
        }
        if worktree != '.' {
            self.unstaged.insert((path.to_string(), worktree));
        }
    }

    /// Read one: the backend's status, as sets.
    fn from_backend(repo: &Path) -> Facts {
        let status = git::status(repo).expect("the backend should read a scratch repository");
        let mut facts = Facts::default();
        for file in status.files {
            if file.untracked {
                facts.untracked.insert(file.path);
            } else if file.conflicted {
                facts.conflicted.insert(file.path);
            } else {
                facts.record(&file.path, file.index, file.worktree);
            }
        }
        facts
    }

    /// Read two: `git status --porcelain=v2 -z`, parsed here from git's own
    /// record types rather than through the backend's parser.
    fn from_cli(repo: &Path) -> Facts {
        let raw = git(
            repo,
            &["status", "--porcelain=v2", "-z", "--untracked-files=all"],
        );
        let mut entries = raw.split('\0').filter(|entry| !entry.is_empty());
        let mut facts = Facts::default();
        while let Some(entry) = entries.next() {
            // The record's second field is XY, the index and worktree status.
            let xy = |field: &str| {
                let mut chars = field.chars();
                (chars.next().unwrap_or('.'), chars.next().unwrap_or('.'))
            };
            match entry.as_bytes()[0] {
                // 1 XY sub mH mI mW hH hI path
                b'1' => {
                    let f: Vec<&str> = entry.splitn(9, ' ').collect();
                    if f.len() == 9 {
                        let (index, worktree) = xy(f[1]);
                        facts.record(f[8], index, worktree);
                    }
                }
                // 2 XY sub mH mI mW hH hI Xscore path, then the old path as
                // its own record, which is skipped here.
                b'2' => {
                    let f: Vec<&str> = entry.splitn(10, ' ').collect();
                    entries.next();
                    if f.len() == 10 {
                        let (index, worktree) = xy(f[1]);
                        facts.record(f[9], index, worktree);
                    }
                }
                // u XY sub m1 m2 m3 mW h1 h2 h3 path
                b'u' => {
                    let f: Vec<&str> = entry.splitn(11, ' ').collect();
                    if f.len() == 11 {
                        facts.conflicted.insert(f[10].to_string());
                    }
                }
                // ? path
                b'?' => {
                    facts.untracked.insert(entry[2..].to_string());
                }
                _ => {}
            }
        }
        facts
    }
}

/// The whole point: two reads of one state, compared, with a failure that
/// names the state they disagree about. The CLI's read comes back, so a test
/// can also assert what the state should be.
fn parity(repo: &Path, state: &str) -> Facts {
    let backend = Facts::from_backend(repo);
    let cli = Facts::from_cli(repo);
    assert_eq!(
        backend, cli,
        "the backend and the git CLI disagree about {state}: backend on the left, git on the right"
    );
    cli
}

fn pairs<const N: usize>(items: [(&str, char); N]) -> BTreeSet<(String, char)> {
    items
        .into_iter()
        .map(|(path, status)| (path.to_string(), status))
        .collect()
}

fn names<const N: usize>(items: [&str; N]) -> BTreeSet<String> {
    items.into_iter().map(str::to_string).collect()
}

// ---------------------------------------------------------------------------
// Tests: opt-in, and each one runs the real git binary

#[test]
#[ignore = "the parity lab: see docs/TESTING.md, run with cargo test --test parity -- --ignored"]
fn fresh_repo_status_parity() {
    let repo = Scratch::seeded("status");

    // A clean tree: every set is empty, read twice.
    let clean = parity(repo.repo(), "a clean tree");
    assert_eq!(clean, Facts::default());

    // The same question about the repository itself.
    let info = git::open(repo.repo()).unwrap();
    assert_eq!(
        Path::new(&info.path).canonicalize().unwrap(),
        repo.repo().canonicalize().unwrap()
    );
    assert_eq!(
        info.name,
        repo.repo().file_name().unwrap().to_string_lossy()
    );
    let status = git::status(repo.repo()).unwrap();
    assert_eq!(
        status.branch.as_deref(),
        Some(git(repo.repo(), &["rev-parse", "--abbrev-ref", "HEAD"]).trim())
    );

    // One edit, one deletion, one file git has never seen.
    repo.write("README.md", "# scratch\n\nedited by hand\n");
    fs::remove_file(repo.repo().join("docs/guide.md")).unwrap();
    repo.write("notes.txt", "a thought\n");

    let dirty = parity(repo.repo(), "a dirty tree");
    assert_eq!(dirty.staged, BTreeSet::new());
    assert_eq!(
        dirty.unstaged,
        pairs([("README.md", 'M'), ("docs/guide.md", 'D')])
    );
    assert_eq!(dirty.untracked, names(["notes.txt"]));
    assert_eq!(dirty.conflicted, BTreeSet::new());
}

#[test]
#[ignore = "the parity lab: see docs/TESTING.md, run with cargo test --test parity -- --ignored"]
fn unborn_branch_status_parity() {
    // Nothing committed yet: HEAD points nowhere, and staging has no HEAD to
    // restore from, which is a separate path on both sides.
    let repo = Scratch::new("unborn");
    repo.write("first.txt", "hello\n");

    let fresh = parity(repo.repo(), "an unborn branch");
    assert_eq!(fresh.untracked, names(["first.txt"]));
    assert_eq!(fresh.staged, BTreeSet::new());
    assert!(git::log(repo.repo(), 10).unwrap().is_empty());

    git::stage(repo.repo(), &["first.txt".to_string()]).unwrap();
    let staged = parity(repo.repo(), "a file staged before the first commit");
    assert_eq!(staged.staged, pairs([("first.txt", 'A')]));
    assert!(staged.untracked.is_empty());

    git::unstage(repo.repo(), &["first.txt".to_string()]).unwrap();
    let unstaged = parity(repo.repo(), "a file unstaged before the first commit");
    assert_eq!(unstaged.untracked, names(["first.txt"]));
}

#[test]
#[ignore = "the parity lab: see docs/TESTING.md, run with cargo test --test parity -- --ignored"]
fn stage_parity() {
    let repo = Scratch::seeded("stage");
    repo.write("README.md", "# scratch\n\nstaged on purpose\n");
    repo.write("src/lib.rs", "pub fn answer() -> u32 {\n    43\n}\n");
    repo.write("notes.txt", "untracked\n");

    // The backend stages one file; git says what that did to the index.
    git::stage(repo.repo(), &["README.md".to_string()]).unwrap();
    let one = parity(repo.repo(), "one file staged through the backend");
    assert_eq!(one.staged, pairs([("README.md", 'M')]));
    assert_eq!(one.unstaged, pairs([("src/lib.rs", 'M')]));
    assert_eq!(one.untracked, names(["notes.txt"]));

    // Then the rest, including a file git had never seen.
    git::stage(
        repo.repo(),
        &["src/lib.rs".to_string(), "notes.txt".to_string()],
    )
    .unwrap();
    let all = parity(repo.repo(), "everything staged through the backend");
    assert_eq!(
        all.staged,
        pairs([("README.md", 'M'), ("src/lib.rs", 'M'), ("notes.txt", 'A')])
    );
    assert!(all.unstaged.is_empty());
    assert!(all.untracked.is_empty());
}

#[test]
#[ignore = "the parity lab: see docs/TESTING.md, run with cargo test --test parity -- --ignored"]
fn commit_parity() {
    let repo = Scratch::seeded("commit");
    let parent = git::log(repo.repo(), 1).unwrap()[0].hash.clone();

    repo.write("src/lib.rs", "pub fn answer() -> u32 {\n    7\n}\n");
    git::stage(repo.repo(), &["src/lib.rs".to_string()]).unwrap();
    git::commit(repo.repo(), "the answer is seven").unwrap();

    // The backend's HEAD and git's HEAD are the same commit.
    let head = git(repo.repo(), &["rev-parse", "HEAD"]).trim().to_string();
    let log = git::log(repo.repo(), 1).unwrap();
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].hash, head);
    assert_eq!(log[0].subject, "the answer is seven");
    assert_eq!(log[0].parents, vec![parent]);

    // Its tree holds the file, at the content that was staged, and the tree
    // is clean afterwards.
    let tree = git(repo.repo(), &["ls-tree", "-r", "--name-only", "HEAD"]);
    assert!(tree.lines().any(|line| line == "src/lib.rs"));
    assert_eq!(
        git(repo.repo(), &["show", "HEAD:src/lib.rs"]),
        "pub fn answer() -> u32 {\n    7\n}\n"
    );
    let settled = parity(repo.repo(), "a tree committed through the backend");
    assert_eq!(settled, Facts::default());
}

#[test]
#[ignore = "the parity lab: see docs/TESTING.md, run with cargo test --test parity -- --ignored"]
fn history_parity() {
    let repo = Scratch::seeded("history");
    let backend = git::log(repo.repo(), 100).unwrap();

    // The same refs, in the same order, read straight from git.
    let raw = git(
        repo.repo(),
        &[
            "log",
            "--date-order",
            "-n100",
            "--branches",
            "--remotes",
            "--tags",
            "HEAD",
            "--format=%H%x1f%P%x1f%s%x1e",
        ],
    );
    let cli: Vec<(String, Vec<String>, String)> = raw
        .split('\x1e')
        .filter_map(|record| {
            let mut f = record.trim_start_matches('\n').split('\x1f');
            let hash = f.next().filter(|h| !h.is_empty())?.to_string();
            let parents = f.next()?.split_whitespace().map(String::from).collect();
            let subject = f.next()?.to_string();
            Some((hash, parents, subject))
        })
        .collect();

    // Hash, parents and subject, position by position: the two reads were
    // asked for the same order, so a shuffled history fails here too.
    let backend_facts: Vec<(&str, Vec<&str>, &str)> = backend
        .iter()
        .map(|commit| {
            (
                commit.hash.as_str(),
                commit.parents.iter().map(String::as_str).collect(),
                commit.subject.as_str(),
            )
        })
        .collect();
    let cli_facts: Vec<(&str, Vec<&str>, &str)> = cli
        .iter()
        .map(|(hash, parents, subject)| {
            (
                hash.as_str(),
                parents.iter().map(String::as_str).collect(),
                subject.as_str(),
            )
        })
        .collect();
    assert_eq!(
        backend_facts, cli_facts,
        "the backend's history and git's log disagree"
    );

    // And the counts, which are the cheapest fact to say out loud.
    assert_eq!(backend.len(), 3);
    assert_eq!(cli.len(), 3);
    assert_eq!(
        git(repo.repo(), &["rev-list", "--count", "HEAD"]).trim(),
        "3"
    );
    let distinct: BTreeSet<&str> = cli.iter().map(|(hash, _, _)| hash.as_str()).collect();
    assert_eq!(distinct.len(), 3);
}
