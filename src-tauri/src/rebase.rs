//! Interactive rebase driven by a todo list the UI builds.
//!
//! `git rebase -i` normally opens an editor twice: once for the todo list and
//! again for commit messages. We point `GIT_SEQUENCE_EDITOR` at a `cp` of our
//! own todo file and `GIT_EDITOR` at `:` (a no-op), so git never waits for
//! input. Reworded messages are written to files and applied with
//! `exec git commit --amend -F <file>`, so a message is never parsed by a
//! shell. The files live under `.git/gitgud-rebase` until the rebase ends,
//! because a rebase that stops for conflicts still needs them afterwards.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::git::{output, run, run_with_env, GitError, Result};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    /// Full message, to prefill rewording.
    pub message: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RebasePlan {
    /// Oldest first, the order git replays them in.
    pub commits: Vec<PlanCommit>,
    /// Some of these commits are on the upstream branch already, so
    /// rewriting them needs a force push.
    pub pushed: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Pick,
    Reword,
    Squash,
    Fixup,
    Drop,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub hash: String,
    pub action: Action,
    /// New message for `Reword`.
    pub message: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct RebaseOutcome {
    /// True when the rebase stopped and needs the user (usually conflicts).
    pub stopped: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RebaseProgress {
    pub step: u32,
    pub total: u32,
    /// Branch being rebased, e.g. "main".
    pub branch: String,
    /// True for a history edit started here, false for e.g. a pull rebase.
    pub editing_history: bool,
}

fn is_hash(s: &str) -> bool {
    s.len() >= 7 && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn git_path(repo: &Path, name: &str) -> Result<PathBuf> {
    Ok(repo.join(run(repo, &["rev-parse", "--git-path", name])?.trim()))
}

/// The parent of `from`, or `None` if `from` is a root commit.
fn base_of(repo: &Path, from: &str) -> Result<Option<String>> {
    let out = output(repo, &["rev-parse", "-q", "--verify", &format!("{from}^")])?;
    Ok(out
        .status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string()))
}

/// The commits that a rebase starting at `from` (inclusive) would rewrite.
pub fn plan(repo: &Path, from: &str) -> Result<RebasePlan> {
    if !is_hash(from) {
        return Err(GitError::Failed(format!("Invalid commit: {from}")));
    }
    if !output(repo, &["merge-base", "--is-ancestor", from, "HEAD"])?
        .status
        .success()
    {
        return Err(GitError::Failed(
            "That commit isn't part of the current branch".into(),
        ));
    }
    if !output(repo, &["symbolic-ref", "-q", "HEAD"])?
        .status
        .success()
    {
        return Err(GitError::Failed(
            "Check out a branch first; HEAD is detached".into(),
        ));
    }
    let range = match base_of(repo, from)? {
        Some(base) => format!("{base}..HEAD"),
        None => "HEAD".to_string(),
    };
    let merges = run(repo, &["rev-list", "--merges", "--count", &range])?;
    if merges.trim() != "0" {
        return Err(GitError::Failed(
            "These commits include a merge; rebasing across merges isn't supported yet".into(),
        ));
    }

    let raw = run(
        repo,
        &[
            "log",
            "--reverse",
            "--format=%H%x1f%h%x1f%s%x1f%B%x1e",
            &range,
        ],
    )?;
    let commits = raw
        .split('\x1e')
        .filter_map(|record| {
            let mut f = record.trim_start_matches('\n').split('\x1f');
            Some(PlanCommit {
                hash: f.next().filter(|h| !h.is_empty())?.into(),
                short_hash: f.next()?.into(),
                subject: f.next()?.into(),
                message: f.next()?.trim_end().into(),
            })
        })
        .collect();

    let has_upstream = output(repo, &["rev-parse", "-q", "--verify", "@{upstream}"])?
        .status
        .success();
    let pushed = has_upstream
        && output(repo, &["merge-base", "--is-ancestor", from, "@{upstream}"])?
            .status
            .success();

    Ok(RebasePlan { commits, pushed })
}

/// Quotes a path for the POSIX shell git runs editors and `exec` lines with.
/// Forward slashes keep Windows paths working in Git for Windows' shell.
fn shell_path(path: &Path) -> Result<String> {
    let p = path.display().to_string().replace('\\', "/");
    if p.contains('\'') {
        return Err(GitError::Failed(format!(
            "Unsupported character in path: {p}"
        )));
    }
    Ok(format!("'{p}'"))
}

/// Builds the todo list. Returns its text and the reword messages to write,
/// as (file name, message) pairs.
fn todo(items: &[TodoItem], dir: &Path) -> Result<(String, Vec<(String, String)>)> {
    let mut lines = Vec::new();
    let mut messages = Vec::new();
    for (i, item) in items.iter().enumerate() {
        let verb = match item.action {
            Action::Pick | Action::Reword => "pick",
            Action::Squash => "squash",
            Action::Fixup => "fixup",
            Action::Drop => "drop",
        };
        lines.push(format!("{verb} {}", item.hash));
        if item.action == Action::Reword {
            let message = item.message.as_deref().unwrap_or("").trim();
            if message.is_empty() {
                return Err(GitError::Failed("A reworded commit needs a message".into()));
            }
            let name = format!("message-{i}.txt");
            let path = shell_path(&dir.join(&name))?;
            lines.push(format!(
                "exec git commit --amend --allow-empty --cleanup=strip -F {path}"
            ));
            messages.push((name, format!("{message}\n")));
        }
    }
    Ok((lines.join("\n") + "\n", messages))
}

fn editor_env(dir: &Path) -> Result<Vec<(String, String)>> {
    Ok(vec![
        (
            "GIT_SEQUENCE_EDITOR".into(),
            format!("cp {}", shell_path(&dir.join("todo"))?),
        ),
        // Keep git's prepared message for squashes and continued picks.
        ("GIT_EDITOR".into(), ":".into()),
    ])
}

fn finish(repo: &Path, result: Result<String>) -> Result<RebaseOutcome> {
    match result {
        Ok(_) => {
            cleanup(repo)?;
            Ok(RebaseOutcome { stopped: false })
        }
        Err(e) => {
            if progress(repo)?.is_some() {
                Ok(RebaseOutcome { stopped: true })
            } else {
                cleanup(repo)?;
                Err(e)
            }
        }
    }
}

fn cleanup(repo: &Path) -> Result<()> {
    let dir = git_path(repo, "gitgud-rebase")?;
    if dir.exists() {
        std::fs::remove_dir_all(dir)?;
    }
    Ok(())
}

/// Rewrites history from `from` (inclusive) following `items`, oldest first.
/// `items` must cover exactly the commits of `plan(repo, from)`.
pub fn start(repo: &Path, from: &str, items: &[TodoItem]) -> Result<RebaseOutcome> {
    let expected = plan(repo, from)?;
    let mut want: Vec<&str> = expected.commits.iter().map(|c| c.hash.as_str()).collect();
    let mut got: Vec<&str> = items.iter().map(|i| i.hash.as_str()).collect();
    want.sort_unstable();
    got.sort_unstable();
    if want != got {
        return Err(GitError::Failed(
            "The branch changed since the rebase was planned; please reopen it".into(),
        ));
    }
    if let Some(first) = items.iter().find(|i| i.action != Action::Drop) {
        if matches!(first.action, Action::Squash | Action::Fixup) {
            return Err(GitError::Failed(
                "The first kept commit can't be squashed: there's nothing above it to squash into"
                    .into(),
            ));
        }
    }
    if progress(repo)?.is_some() {
        return Err(GitError::Failed("A rebase is already in progress".into()));
    }

    let dir = git_path(repo, "gitgud-rebase")?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    std::fs::create_dir_all(&dir)?;
    let (todo_text, messages) = todo(items, &dir)?;
    std::fs::write(dir.join("todo"), todo_text)?;
    for (name, message) in messages {
        std::fs::write(dir.join(name), message)?;
    }

    let env = editor_env(&dir)?;
    let base = base_of(repo, from)?;
    let mut args = vec!["rebase", "-i", "--no-autosquash"];
    match &base {
        Some(b) => args.push(b),
        None => args.push("--root"),
    }
    finish(repo, run_with_env(repo, &args, &env))
}

pub fn continue_(repo: &Path) -> Result<RebaseOutcome> {
    let dir = git_path(repo, "gitgud-rebase")?;
    let env = editor_env(&dir)?;
    finish(repo, run_with_env(repo, &["rebase", "--continue"], &env))
}

pub fn abort(repo: &Path) -> Result<()> {
    run(repo, &["rebase", "--abort"])?;
    cleanup(repo)
}

/// Where a stopped rebase is, if one is in progress.
pub fn progress(repo: &Path) -> Result<Option<RebaseProgress>> {
    let dir = git_path(repo, "rebase-merge")?;
    if !dir.is_dir() {
        return Ok(None);
    }
    let read = |name: &str| {
        std::fs::read_to_string(dir.join(name))
            .unwrap_or_default()
            .trim()
            .to_string()
    };
    Ok(Some(RebaseProgress {
        step: read("msgnum").parse().unwrap_or(0),
        total: read("end").parse().unwrap_or(0),
        branch: read("head-name")
            .trim_start_matches("refs/heads/")
            .to_string(),
        editing_history: git_path(repo, "gitgud-rebase")?.is_dir(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{self, Side};

    fn repo_with_commits(name: &str, files: &[(&str, &str, &str)]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gitgud-rebase-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.as_path();
        run(repo, &["init", "-q", "-b", "main"]).unwrap();
        for (k, v) in [
            ("user.name", "T"),
            ("user.email", "t@x"),
            ("commit.gpgsign", "false"),
            ("core.autocrlf", "false"),
        ] {
            run(repo, &["config", k, v]).unwrap();
        }
        for (file, content, message) in files {
            std::fs::write(dir.join(file), content).unwrap();
            git::stage(repo, &[file.to_string()]).unwrap();
            git::commit(repo, message).unwrap();
        }
        dir
    }

    fn subjects(repo: &Path) -> Vec<String> {
        git::log(repo, 20)
            .unwrap()
            .into_iter()
            .map(|c| c.subject)
            .collect()
    }

    fn item(c: &PlanCommit, action: Action) -> TodoItem {
        TodoItem {
            hash: c.hash.clone(),
            action,
            message: None,
        }
    }

    #[test]
    fn reorders_squashes_drops_and_rewords() {
        let dir = repo_with_commits(
            "edit",
            &[
                ("a.txt", "a\n", "add a"),
                ("b.txt", "b\n", "add b"),
                ("c.txt", "c\n", "add c"),
                ("d.txt", "d\n", "add d"),
                ("e.txt", "e\n", "add e"),
            ],
        );
        let repo = dir.as_path();
        let history = git::log(repo, 10).unwrap();
        let from = &history[3].hash; // "add b"
        let p = plan(repo, from).unwrap();
        let names: Vec<_> = p.commits.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(names, ["add b", "add c", "add d", "add e"]);
        assert!(!p.pushed);

        let [b, c, d, e] = &p.commits[..] else {
            panic!()
        };
        let tricky = "it's \"quoted\" $(touch pwned) `x`\n\nwith a body";
        let items = vec![
            item(d, Action::Pick),
            item(b, Action::Squash),
            TodoItem {
                hash: e.hash.clone(),
                action: Action::Reword,
                message: Some(tricky.into()),
            },
            item(c, Action::Drop),
        ];
        assert_eq!(
            start(repo, from, &items).unwrap(),
            RebaseOutcome { stopped: false }
        );

        assert_eq!(
            subjects(repo),
            [tricky.lines().next().unwrap(), "add d", "add a"]
        );
        assert!(!dir.join("pwned").exists());
        assert!(!dir.join("c.txt").exists(), "dropped");
        assert!(dir.join("b.txt").exists(), "squashed in");
        let body = run(repo, &["log", "-1", "--format=%B"]).unwrap();
        assert!(body.contains("with a body"));
        assert_eq!(progress(repo).unwrap(), None);
        assert!(
            !git_path(repo, "gitgud-rebase").unwrap().exists(),
            "cleaned up"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_bad_plans() {
        let dir = repo_with_commits(
            "bad",
            &[("a.txt", "a\n", "add a"), ("b.txt", "b\n", "add b")],
        );
        let repo = dir.as_path();
        let root = &git::log(repo, 10).unwrap()[1].hash;
        let p = plan(repo, root).unwrap();
        assert_eq!(p.commits.len(), 2, "root commit included");

        let squash_first = vec![
            item(&p.commits[0], Action::Squash),
            item(&p.commits[1], Action::Pick),
        ];
        assert!(start(repo, root, &squash_first).is_err());
        let missing = vec![item(&p.commits[0], Action::Pick)];
        assert!(start(repo, root, &missing).is_err());
        assert!(plan(repo, "--exec=x").is_err());
        assert_eq!(subjects(repo), ["add b", "add a"], "nothing changed");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stops_on_conflict_then_continues_or_aborts() {
        let dir = repo_with_commits(
            "conflict",
            &[
                ("f.txt", "1\n", "one"),
                ("f.txt", "2\n", "two"),
                ("f.txt", "3\n", "three"),
            ],
        );
        let repo = dir.as_path();
        let history = git::log(repo, 10).unwrap();
        let from = &history[1].hash; // "two"
        let p = plan(repo, from).unwrap();
        // Swapping two edits of the same line conflicts.
        let swapped = vec![
            item(&p.commits[1], Action::Pick),
            item(&p.commits[0], Action::Pick),
        ];

        assert_eq!(
            start(repo, from, &swapped).unwrap(),
            RebaseOutcome { stopped: true }
        );
        let at = progress(repo).unwrap().unwrap();
        assert_eq!((at.step, at.total, at.branch.as_str()), (1, 2, "main"));
        assert!(at.editing_history);
        abort(repo).unwrap();
        assert_eq!(progress(repo).unwrap(), None);
        assert_eq!(subjects(repo), ["three", "two", "one"]);

        assert!(start(repo, from, &swapped).unwrap().stopped);
        git::resolve_file(repo, "f.txt", Side::Theirs).unwrap();
        // The second pick conflicts as well; keep going until done.
        let mut outcome = continue_(repo).unwrap();
        while outcome.stopped {
            git::resolve_file(repo, "f.txt", Side::Theirs).unwrap();
            outcome = continue_(repo).unwrap();
        }
        assert_eq!(subjects(repo), ["two", "three", "one"]);
        assert_eq!(std::fs::read_to_string(dir.join("f.txt")).unwrap(), "2\n");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
