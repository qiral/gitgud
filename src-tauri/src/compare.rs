//! What differs between two branches or commits.

use crate::git::{log_with, output, resolve_commit, run, Commit, GitError, Result};
use serde::Serialize;
use std::path::Path;

/// Lists at most this many commits of each side; the counts are exact.
const MAX_COMMITS: u32 = 500;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Differences {
    pub base_hash: String,
    pub head_hash: String,
    /// Whether the two share any history.
    pub related: bool,
    /// Commits only `head` has, newest first.
    pub ahead: Vec<Commit>,
    pub ahead_count: u32,
    /// Commits only `base` has, newest first.
    pub behind: Vec<Commit>,
    pub behind_count: u32,
    pub diff: String,
}

/// Compares `head` with `base`. The diff is what `head` changed since the two
/// split (`git diff base...head`), or with `direct` everything that differs
/// between them (`git diff base head`), as it also is without shared history.
pub fn compare(
    repo: &Path,
    base: &str,
    head: &str,
    direct: bool,
    ignore_whitespace: bool,
) -> Result<Differences> {
    let base = resolve_commit(repo, base)?;
    let head = resolve_commit(repo, head)?;

    // Exits with 1, printing nothing, when there is no common ancestor.
    let out = output(repo, &["merge-base", &base, &head])?;
    let ancestor = out
        .status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string());
    if ancestor.is_none() && out.status.code() != Some(1) {
        let message = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(GitError::Failed(message));
    }

    let span = format!("{base}...{head}");
    let counts = run(repo, &["rev-list", "--left-right", "--count", &span])?;
    let mut counts = counts.split_whitespace().map(|n| n.parse().unwrap_or(0));
    let behind_count = counts.next().unwrap_or(0);
    let ahead_count = counts.next().unwrap_or(0);
    let commits = |from: &str, to: &str| log_with(repo, MAX_COMMITS, &[&format!("{from}..{to}")]);

    let from = match &ancestor {
        Some(ancestor) if !direct => ancestor,
        _ => &base,
    };
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--no-textconv"];
    if ignore_whitespace {
        args.push("-w");
    }
    args.extend([from.as_str(), head.as_str(), "--"]);

    Ok(Differences {
        related: ancestor.is_some(),
        ahead: commits(&base, &head)?,
        ahead_count,
        behind: commits(&head, &base)?,
        behind_count,
        diff: run(repo, &args)?,
        base_hash: base,
        head_hash: head,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commit(repo: &Path, file: &str, text: &str) {
        std::fs::write(repo.join(file), text).unwrap();
        run(repo, &["add", "-A"]).unwrap();
        run(repo, &["commit", "-q", "-m", file]).unwrap();
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("gitgud-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        run(&dir, &["init", "-q", "-b", "main"]).unwrap();
        for (key, value) in [
            ("user.name", "Test"),
            ("user.email", "test@example.com"),
            ("commit.gpgsign", "false"),
            ("core.autocrlf", "false"),
        ] {
            run(&dir, &["config", key, value]).unwrap();
        }
        dir
    }

    fn subjects(commits: &[Commit]) -> Vec<&str> {
        commits.iter().map(|c| c.subject.as_str()).collect()
    }

    #[test]
    fn compares_diverged_branches() {
        let dir = scratch("compare");
        let repo = dir.as_path();
        commit(repo, "start", "start\n");
        run(repo, &["switch", "-qc", "feature"]).unwrap();
        commit(repo, "one", "one\n");
        commit(repo, "two", "two\n");
        run(repo, &["switch", "-q", "main"]).unwrap();
        commit(repo, "other", "other\n");

        let d = compare(repo, "refs/heads/main", "refs/heads/feature", false, false).unwrap();
        assert!(d.related);
        assert_eq!(subjects(&d.ahead), ["two", "one"]);
        assert_eq!(subjects(&d.behind), ["other"]);
        assert_eq!((d.ahead_count, d.behind_count), (2, 1));
        // Only what feature did.
        assert!(d.diff.contains("+one") && !d.diff.contains("other"));

        // Directly, main's own work is missing from feature.
        let d = compare(repo, "main", "feature", true, false).unwrap();
        assert!(d.diff.contains("+one") && d.diff.contains("-other"));

        // Swapped.
        let d = compare(repo, "feature", "main", false, false).unwrap();
        assert_eq!((d.ahead_count, d.behind_count), (1, 2));
        assert!(d.diff.contains("+other") && !d.diff.contains("one"));

        let d = compare(repo, "main", "main", false, false).unwrap();
        assert!(d.diff.is_empty() && d.ahead.is_empty() && d.behind.is_empty());

        assert!(compare(repo, "--output=x", "main", false, false).is_err());
        assert!(compare(repo, "main", "no-such-branch", false, false).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn compares_unrelated_and_whitespace() {
        let dir = scratch("compare-unrelated");
        let repo = dir.as_path();
        commit(repo, "a", "x y\n");
        run(repo, &["switch", "-q", "--orphan", "island"]).unwrap();
        commit(repo, "a", "x  y\n");

        let d = compare(repo, "main", "island", false, false).unwrap();
        assert!(!d.related);
        assert_eq!((d.ahead_count, d.behind_count), (1, 1));
        assert!(d.diff.contains("+x  y"));
        let d = compare(repo, "main", "island", false, true).unwrap();
        assert!(d.diff.is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
