//! Listing, adding and removing worktrees.

use serde::Serialize;
use std::path::Path;

use crate::git::{self, GitError, Result};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    /// None when detached.
    pub branch: Option<String>,
    pub head: Option<String>,
    /// The repository itself, which can't be removed.
    pub main: bool,
    /// The one that's open.
    pub current: bool,
    pub locked: bool,
    /// Its folder is gone.
    pub missing: bool,
}

pub fn list(repo: &Path) -> Result<Vec<Worktree>> {
    let mut all = parse(&git::run(repo, &["worktree", "list", "--porcelain"])?);
    let here = repo.canonicalize().ok();
    for w in &mut all {
        w.current = here.is_some() && Path::new(&w.path).canonicalize().ok() == here;
    }
    Ok(all)
}

/// Parses blocks of `key value` lines. A bare repository has no files to open
/// and is left out.
fn parse(raw: &str) -> Vec<Worktree> {
    let raw = raw.replace("\r\n", "\n");
    raw.split("\n\n")
        .enumerate()
        .filter_map(|(i, block)| {
            let mut w = Worktree {
                path: String::new(),
                branch: None,
                head: None,
                main: i == 0,
                current: false,
                locked: false,
                missing: false,
            };
            for line in block.lines() {
                let (key, value) = line.split_once(' ').unwrap_or((line, ""));
                match key {
                    "worktree" => w.path = value.into(),
                    "HEAD" => w.head = Some(value.into()),
                    "branch" => {
                        w.branch = Some(value.strip_prefix("refs/heads/").unwrap_or(value).into());
                    }
                    "locked" => w.locked = true,
                    "prunable" => w.missing = true,
                    "bare" => return None,
                    _ => {}
                }
            }
            (!w.path.is_empty()).then_some(w)
        })
        .collect()
}

/// Checks `branch` out in a new folder; with `create`, makes the branch first,
/// at HEAD. Returns the folder.
pub fn add(repo: &Path, path: &str, branch: &str, create: bool) -> Result<String> {
    let path = path.trim();
    if !Path::new(path).is_absolute() {
        return Err(GitError::Failed(format!("{path} is not a full path")));
    }
    git::check_branch_name(repo, branch)?;
    if create {
        git::run(repo, &["worktree", "add", "-b", branch, "--", path])?;
    } else {
        // Anything else would be guessed from a remote, or be detached.
        if !git::branches(repo)?.iter().any(|b| b.name == branch) {
            return Err(GitError::Failed(format!("No branch named '{branch}'")));
        }
        git::run(repo, &["worktree", "add", "--", path, branch])?;
    }
    Ok(path.to_string())
}

#[derive(Debug, Serialize, PartialEq)]
pub struct RemoveOutcome {
    /// Nothing was removed: there are changes that would be lost, so removing
    /// it needs `force`.
    pub dirty: bool,
}

/// Deletes the worktree's folder; its branch stays.
pub fn remove(repo: &Path, path: &str, force: bool) -> Result<RemoveOutcome> {
    let Some(w) = list(repo)?.into_iter().find(|w| w.path == path) else {
        return Err(GitError::Failed(format!("No worktree at {path}")));
    };
    if w.main || w.current {
        return Err(GitError::Failed(
            "The open worktree and the repository itself can't be removed".into(),
        ));
    }
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.extend(["--", path]);
    let out = git::output(repo, &args)?;
    if out.status.success() {
        return Ok(RemoveOutcome { dirty: false });
    }
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    // Submodules need force as well, whether or not they have changes.
    if !force
        && (stderr.contains("modified or untracked files")
            || stderr.contains("containing submodules"))
    {
        return Ok(RemoveOutcome { dirty: true });
    }
    Err(GitError::Failed(stderr))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_list() {
        let raw = "worktree /repo\nHEAD aaa\nbranch refs/heads/main\n\n\
                   worktree /with space\nHEAD bbb\ndetached\nlocked usb stick\n\n\
                   worktree /gone\nHEAD ccc\nbranch refs/heads/x/y\nprunable gitdir file\n\n";
        let got = parse(raw);
        assert_eq!(got.len(), 3);
        assert!(got[0].main && !got[1].main);
        assert_eq!(got[1].path, "/with space");
        assert_eq!((got[1].branch.as_ref(), got[1].locked), (None, true));
        assert_eq!(got[2].branch.as_deref(), Some("x/y"));
        assert!(got[2].missing);
        assert!(parse("worktree /r.git\nbare\n\n").is_empty());
    }

    #[test]
    fn adds_and_removes() {
        let base = std::env::temp_dir().join(format!("gitgud-trees-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let repo = base.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git::run(&repo, &["init", "-q", "-b", "main"]).unwrap();
        for (k, v) in [
            ("user.name", "T"),
            ("user.email", "t@x"),
            ("commit.gpgsign", "false"),
        ] {
            git::run(&repo, &["config", k, v]).unwrap();
        }
        git::run(&repo, &["commit", "-q", "--allow-empty", "-m", "base"]).unwrap();
        git::run(&repo, &["branch", "old"]).unwrap();
        let path = |name: &str| base.join(name).to_string_lossy().into_owned();

        add(&repo, &path("a b"), "old", false).unwrap();
        add(&repo, &path("new"), "feature/x", true).unwrap();
        assert!(add(&repo, "relative", "y", true).is_err());
        assert!(add(&repo, &path("z"), "nope", false).is_err());
        assert!(add(&repo, &path("z"), "main", false).is_err());
        assert!(add(&repo, &path("z"), "--detach", false).is_err());

        let all = list(&repo).unwrap();
        assert_eq!(all.len(), 3);
        assert!(all[0].main && all[0].current);
        let tree = |branch: &str| {
            let all = list(&repo).unwrap();
            all.into_iter()
                .find(|w| w.branch.as_deref() == Some(branch))
                .map(|w| w.path)
        };
        let old = tree("old").unwrap();
        // The branches know where they are.
        let branches = git::branches(&repo).unwrap();
        let of = |name: &str| branches.iter().find(|b| b.name == name).unwrap();
        assert!(of("old").worktree.is_some());
        assert_eq!(of("main").worktree, None);
        let opened = git::open(Path::new(&old)).unwrap();
        assert_eq!(opened.name, "a b");

        assert!(remove(&repo, &all[0].path, true).is_err());
        assert!(remove(&repo, "/nowhere", true).is_err());
        assert!(remove(Path::new(&old), &old, true).is_err());
        std::fs::write(Path::new(&old).join("work.txt"), "x").unwrap();
        assert!(remove(&repo, &old, false).unwrap().dirty);
        assert!(Path::new(&old).exists());
        assert!(!remove(&repo, &old, true).unwrap().dirty);
        assert!(!Path::new(&old).exists());
        // One whose folder was deleted by hand.
        let gone = tree("feature/x").unwrap();
        std::fs::remove_dir_all(&gone).unwrap();
        assert!(!remove(&repo, &gone, false).unwrap().dirty);
        assert_eq!(list(&repo).unwrap().len(), 1);
        assert_eq!(git::branches(&repo).unwrap().len(), 3);
        std::fs::remove_dir_all(base).unwrap();
    }
}
