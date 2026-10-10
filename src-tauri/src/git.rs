//! Thin wrapper around the `git` CLI.
//!
//! Every call goes through [`run`], which passes arguments directly to the
//! process (no shell), so user input such as commit messages or file names
//! can never be interpreted as commands.

use serde::Serialize;

use crate::conflict;
use crate::graph::{self, GraphRow};
use crate::patch;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("git could not be started: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("{0}")]
    Failed(String),
    #[error("not a git repository: {0}")]
    NotARepo(String),
}

// Tauri sends command errors to the frontend as JSON, so serialize as a plain message.
impl Serialize for GitError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, GitError>;

fn command(repo: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(repo)
        .args(args)
        // Fail instead of hanging on an invisible credential prompt.
        .env("GIT_TERMINAL_PROMPT", "0")
        // Don't take locks for read-only commands like `status`.
        .env("GIT_OPTIONAL_LOCKS", "0")
        // Stable, parseable output regardless of the user's locale.
        .env("LC_ALL", "C");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd
}

pub(crate) fn output(repo: &Path, args: &[&str]) -> Result<Output> {
    Ok(command(repo, args).output()?)
}

/// Runs git and returns stdout, or stderr as the error when git exits non-zero.
pub(crate) fn run(repo: &Path, args: &[&str]) -> Result<String> {
    run_with_env(repo, args, &[])
}

/// Like [`run`], with extra environment variables (used for credentials).
pub(crate) fn run_with_env(repo: &Path, args: &[&str], env: &[(String, String)]) -> Result<String> {
    let out = command(repo, args).envs(env.iter().cloned()).output()?;
    finish(out, args)
}

/// Like [`run`], writing `input` to git's stdin.
fn run_with_input(repo: &Path, args: &[&str], input: &str) -> Result<String> {
    use std::io::Write;
    let mut child = command(repo, args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .expect("stdin is piped")
        .write_all(input.as_bytes())?;
    finish(child.wait_with_output()?, args)
}

fn finish(out: Output, args: &[&str]) -> Result<String> {
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(GitError::Failed(if stderr.is_empty() {
            format!("git {} failed", args.first().unwrap_or(&""))
        } else {
            stderr
        }))
    }
}

fn has_head(repo: &Path) -> Result<bool> {
    Ok(output(repo, &["rev-parse", "--verify", "-q", "HEAD"])?
        .status
        .success())
}

// ---------------------------------------------------------------------------
// Repository

#[derive(Debug, Serialize)]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
}

pub fn open(path: &Path) -> Result<RepoInfo> {
    let root = run(path, &["rev-parse", "--show-toplevel"])
        .map_err(|_| GitError::NotARepo(path.display().to_string()))?;
    let root = root.trim().to_string();
    let name = Path::new(&root)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.clone());
    Ok(RepoInfo { path: root, name })
}

// ---------------------------------------------------------------------------
// Status

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// Original path for renames and copies.
    pub orig_path: Option<String>,
    /// Status in the index (staged), e.g. 'M', 'A', 'D', 'R', or '.' for unchanged.
    pub index: char,
    /// Status in the working tree (unstaged), same codes as `index`.
    pub worktree: char,
    pub untracked: bool,
    pub conflicted: bool,
}

#[derive(Debug, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// `None` when HEAD is detached.
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<FileChange>,
    /// While a merge is in progress: its message, e.g. "Merge branch 'x'".
    pub merging: Option<String>,
    /// While an interactive rebase is stopped (e.g. for conflicts).
    pub rebasing: Option<crate::rebase::RebaseProgress>,
}

pub fn status(repo: &Path) -> Result<Status> {
    let raw = run(
        repo,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
    )?;
    let mut status = parse_status(&raw);
    status.merging = merge_message(repo)?;
    status.rebasing = crate::rebase::progress(repo)?;
    Ok(status)
}

fn xy(field: &str) -> (char, char) {
    let mut chars = field.chars();
    (chars.next().unwrap_or('.'), chars.next().unwrap_or('.'))
}

fn parse_status(raw: &str) -> Status {
    let mut status = Status::default();
    let mut entries = raw.split('\0').filter(|e| !e.is_empty());

    while let Some(entry) = entries.next() {
        if let Some(header) = entry.strip_prefix("# ") {
            let (key, value) = header.split_once(' ').unwrap_or((header, ""));
            match key {
                "branch.head" if value != "(detached)" => status.branch = Some(value.into()),
                "branch.upstream" => status.upstream = Some(value.into()),
                "branch.ab" => {
                    for part in value.split(' ') {
                        if let Some(n) = part.strip_prefix('+') {
                            status.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            status.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }

        let kind = entry.as_bytes()[0];
        match kind {
            // 1 XY sub mH mI mW hH hI path
            b'1' => {
                let f: Vec<&str> = entry.splitn(9, ' ').collect();
                if f.len() == 9 {
                    let (index, worktree) = xy(f[1]);
                    status.files.push(FileChange {
                        path: f[8].into(),
                        orig_path: None,
                        index,
                        worktree,
                        untracked: false,
                        conflicted: false,
                    });
                }
            }
            // 2 XY sub mH mI mW hH hI Xscore path, followed by origPath as its own entry
            b'2' => {
                let f: Vec<&str> = entry.splitn(10, ' ').collect();
                let orig = entries.next().map(String::from);
                if f.len() == 10 {
                    let (index, worktree) = xy(f[1]);
                    status.files.push(FileChange {
                        path: f[9].into(),
                        orig_path: orig,
                        index,
                        worktree,
                        untracked: false,
                        conflicted: false,
                    });
                }
            }
            // u XY sub m1 m2 m3 mW h1 h2 h3 path
            b'u' => {
                let f: Vec<&str> = entry.splitn(11, ' ').collect();
                if f.len() == 11 {
                    let (index, worktree) = xy(f[1]);
                    status.files.push(FileChange {
                        path: f[10].into(),
                        orig_path: None,
                        index,
                        worktree,
                        untracked: false,
                        conflicted: true,
                    });
                }
            }
            b'?' => status.files.push(FileChange {
                path: entry[2..].into(),
                orig_path: None,
                index: '.',
                worktree: '?',
                untracked: true,
                conflicted: false,
            }),
            _ => {}
        }
    }

    status
}

// ---------------------------------------------------------------------------
// Merging and conflicts

/// The pending merge's message if a merge is in progress.
fn merge_message(repo: &Path) -> Result<Option<String>> {
    if !output(repo, &["rev-parse", "-q", "--verify", "MERGE_HEAD"])?
        .status
        .success()
    {
        return Ok(None);
    }
    let path = run(repo, &["rev-parse", "--git-path", "MERGE_MSG"])?;
    let message = std::fs::read_to_string(repo.join(path.trim())).unwrap_or_default();
    let first = message
        .lines()
        .next()
        .unwrap_or("Merge in progress")
        .to_string();
    Ok(Some(first))
}

#[derive(Debug, Serialize, PartialEq)]
pub struct MergeOutcome {
    /// True when the merge stopped with conflicts to resolve.
    pub conflicts: bool,
}

/// Merges a local or remote-tracking branch into the current branch.
pub fn merge(repo: &Path, branch: &str) -> Result<MergeOutcome> {
    let is_branch = ["refs/heads/", "refs/remotes/"].iter().any(|prefix| {
        output(
            repo,
            &["rev-parse", "-q", "--verify", &format!("{prefix}{branch}")],
        )
        .is_ok_and(|o| o.status.success())
    });
    if !is_branch {
        return Err(GitError::Failed(format!("No branch named '{branch}'")));
    }
    let out = output(repo, &["merge", "--no-edit", branch])?;
    if out.status.success() {
        return Ok(MergeOutcome { conflicts: false });
    }
    if merge_message(repo)?.is_some() {
        return Ok(MergeOutcome { conflicts: true });
    }
    // Refused to start, e.g. local changes would be overwritten.
    Err(GitError::Failed(
        String::from_utf8_lossy(&out.stderr).trim().to_string(),
    ))
}

pub fn merge_abort(repo: &Path) -> Result<()> {
    run(repo, &["merge", "--abort"]).map(drop)
}

/// Concludes a merge with git's prepared message.
pub fn merge_commit(repo: &Path) -> Result<()> {
    run(repo, &["commit", "--no-edit"]).map(drop)
}

/// `path` inside `repo`, refusing anything that could point outside it.
fn file_in_repo(repo: &Path, path: &str) -> Result<PathBuf> {
    use std::path::Component;
    let relative = Path::new(path);
    if path.is_empty()
        || !relative
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
    {
        return Err(GitError::Failed(format!("Invalid path: {path}")));
    }
    Ok(repo.join(relative))
}

fn read_text(repo: &Path, path: &str) -> Result<String> {
    let bytes = std::fs::read(file_in_repo(repo, path)?)?;
    String::from_utf8(bytes).map_err(|_| GitError::Failed(format!("{path} is not a text file")))
}

pub fn conflict_parts(repo: &Path, path: &str) -> Result<Vec<conflict::Part>> {
    Ok(conflict::parse(&read_text(repo, path)?))
}

/// Resolves one conflict block in the working tree file (doesn't stage it).
pub fn resolve_block(
    repo: &Path,
    path: &str,
    index: usize,
    choice: conflict::Choice,
) -> Result<()> {
    let content = read_text(repo, path)?;
    let resolved = conflict::resolve(&content, index, choice)
        .ok_or_else(|| GitError::Failed("That conflict no longer exists".into()))?;
    std::fs::write(file_in_repo(repo, path)?, resolved)?;
    Ok(())
}

#[derive(Debug, Clone, Copy, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Ours,
    Theirs,
}

/// Takes one side's version of the whole file and marks it resolved. If that
/// side deleted the file, the file is removed.
pub fn resolve_file(repo: &Path, path: &str, side: Side) -> Result<()> {
    file_in_repo(repo, path)?;
    // Stage 2 is ours, stage 3 is theirs.
    let stage = match side {
        Side::Ours => "2",
        Side::Theirs => "3",
    };
    let stages = run(repo, &["ls-files", "-u", "--", path])?;
    let present = stages
        .lines()
        .any(|l| l.split_whitespace().nth(2) == Some(stage));
    if present {
        let flag = match side {
            Side::Ours => "--ours",
            Side::Theirs => "--theirs",
        };
        run(repo, &["checkout", flag, "--", path])?;
        run(repo, &["add", "--", path]).map(drop)
    } else {
        run(repo, &["rm", "-q", "--", path]).map(drop)
    }
}

/// Stages a conflicted file after checking no conflict markers are left.
pub fn mark_resolved(repo: &Path, path: &str) -> Result<()> {
    let file = file_in_repo(repo, path)?;
    if file.exists() && conflict::has_conflicts(&read_text(repo, path)?) {
        return Err(GitError::Failed(format!(
            "{path} still has conflict markers"
        )));
    }
    run(repo, &["add", "-A", "--", path]).map(drop)
}

// ---------------------------------------------------------------------------
// Staging and committing

pub fn stage(repo: &Path, paths: &[String]) -> Result<()> {
    let mut args = vec!["add", "-A", "--"];
    args.extend(paths.iter().map(String::as_str));
    run(repo, &args).map(drop)
}

pub fn unstage(repo: &Path, paths: &[String]) -> Result<()> {
    // `restore --staged` needs a HEAD to restore from; before the first
    // commit, removing the paths from the index has the same effect.
    let mut args = if has_head(repo)? {
        vec!["restore", "--staged", "--"]
    } else {
        vec!["rm", "--cached", "-r", "-q", "--"]
    };
    args.extend(paths.iter().map(String::as_str));
    run(repo, &args).map(drop)
}

pub fn discard(repo: &Path, paths: &[String]) -> Result<()> {
    let mut args = vec!["restore", "--worktree", "--"];
    args.extend(paths.iter().map(String::as_str));
    run(repo, &args).map(drop)
}

pub fn commit(repo: &Path, message: &str) -> Result<()> {
    if message.trim().is_empty() {
        return Err(GitError::Failed("Commit message cannot be empty".into()));
    }
    run(repo, &["commit", "-m", message]).map(drop)
}

// ---------------------------------------------------------------------------
// Diff

pub fn diff(repo: &Path, path: &str, staged: bool, untracked: bool) -> Result<String> {
    if untracked {
        // `--no-index` exits with 1 when the files differ, which is always the
        // case here, so read the output regardless of the exit code.
        let out = output(
            repo,
            &["diff", "--no-color", "--no-index", "--", "/dev/null", path],
        )?;
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    // Fixed prefixes so the output can be fed back to `git apply`, whatever
    // the user's diff.noprefix / diff.mnemonicPrefix settings are.
    let mut args = vec![
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--src-prefix=a/",
        "--dst-prefix=b/",
    ];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path]);
    run(repo, &args)
}

/// What to do with the selected lines of a file's diff.
#[derive(Debug, Clone, Copy, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LineAction {
    /// Working tree diff → index.
    Stage,
    /// Staged diff → back out of the index.
    Unstage,
    /// Working tree diff → removed from the working tree.
    Discard,
}

/// Applies only the `selected` lines (indexes into `diff.split('\n')`) of a
/// diff that was shown to the user. Using the displayed text means that if
/// the file changed in the meantime, `git apply` refuses instead of touching
/// lines the user never saw.
pub fn apply_lines(repo: &Path, diff: &str, selected: &[usize], action: LineAction) -> Result<()> {
    let direction = match action {
        LineAction::Stage => patch::Direction::Forward,
        LineAction::Unstage | LineAction::Discard => patch::Direction::Reverse,
    };
    let selected = selected.iter().copied().collect();
    let patch = patch::partial(diff, &selected, direction).map_err(|e| match e {
        patch::PatchError::NothingSelected => GitError::Failed("No changed lines selected".into()),
        patch::PatchError::WholeFileOnly => {
            GitError::Failed("New, deleted and binary files can only be staged as a whole".into())
        }
    })?;
    let args: &[&str] = match action {
        LineAction::Stage => &["apply", "--cached", "--recount", "--whitespace=nowarn", "-"],
        LineAction::Unstage => &[
            "apply",
            "--cached",
            "--reverse",
            "--recount",
            "--whitespace=nowarn",
            "-",
        ],
        LineAction::Discard => &[
            "apply",
            "--reverse",
            "--recount",
            "--whitespace=nowarn",
            "-",
        ],
    };
    run_with_input(repo, args, &patch).map(drop)
}

// ---------------------------------------------------------------------------
// Branches

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub current: bool,
    pub upstream: Option<String>,
}

pub fn branches(repo: &Path) -> Result<Vec<Branch>> {
    let raw = run(
        repo,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)",
            "refs/heads",
        ],
    )?;
    Ok(parse_branches(&raw))
}

fn parse_branches(raw: &str) -> Vec<Branch> {
    raw.lines()
        .filter_map(|line| {
            let mut f = line.split('\x1f');
            let name = f.next()?.to_string();
            let current = f.next()? == "*";
            let upstream = f.next().filter(|u| !u.is_empty()).map(String::from);
            Some(Branch {
                name,
                current,
                upstream,
            })
        })
        .collect()
}

pub fn switch_branch(repo: &Path, name: &str) -> Result<()> {
    run(repo, &["switch", "--", name]).map(drop)
}

pub fn create_branch(repo: &Path, name: &str) -> Result<()> {
    run(repo, &["check-ref-format", "--branch", name])
        .map_err(|_| GitError::Failed(format!("'{name}' is not a valid branch name")))?;
    run(repo, &["switch", "-c", name]).map(drop)
}

// ---------------------------------------------------------------------------
// History

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub email: String,
    /// Unix timestamp in seconds.
    pub time: i64,
    pub subject: String,
    pub parents: Vec<String>,
    pub refs: Vec<RefLabel>,
    pub graph: GraphRow,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RefKind {
    /// The checked-out branch (or "HEAD" when detached).
    Head,
    Branch,
    Remote,
    Tag,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct RefLabel {
    pub name: String,
    pub kind: RefKind,
}

/// Parses `%D` output from `git log --decorate=full`, e.g.
/// `HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main`.
fn parse_refs(raw: &str) -> Vec<RefLabel> {
    raw.split(", ")
        .filter(|r| !r.is_empty())
        .filter_map(|r| {
            let label = |name: &str, kind| {
                Some(RefLabel {
                    name: name.into(),
                    kind,
                })
            };
            if let Some(branch) = r.strip_prefix("HEAD -> refs/heads/") {
                label(branch, RefKind::Head)
            } else if r == "HEAD" {
                label("HEAD", RefKind::Head)
            } else if let Some(tag) = r.strip_prefix("tag: refs/tags/") {
                label(tag, RefKind::Tag)
            } else if let Some(branch) = r.strip_prefix("refs/heads/") {
                label(branch, RefKind::Branch)
            } else if let Some(remote) = r.strip_prefix("refs/remotes/") {
                // "origin/HEAD" just points at the default branch; skip the noise.
                (!remote.ends_with("/HEAD")).then(|| RefLabel {
                    name: remote.into(),
                    kind: RefKind::Remote,
                })
            } else {
                None
            }
        })
        .collect()
}

pub fn log(repo: &Path, limit: u32) -> Result<Vec<Commit>> {
    if !has_head(repo)? {
        return Ok(Vec::new());
    }
    let limit = format!("-n{limit}");
    let raw = run(
        repo,
        &[
            "log",
            "--date-order",
            "--decorate=full",
            &limit,
            "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%D%x1f%s%x1e",
            // Every branch, remote branch and tag, so the graph shows how they relate.
            "--branches",
            "--remotes",
            "--tags",
            "HEAD",
        ],
    )?;
    Ok(parse_log(&raw))
}

/// Full patch for a single commit, with a short header.
pub fn show_commit(repo: &Path, hash: &str) -> Result<String> {
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(GitError::Failed(format!("invalid commit hash: {hash}")));
    }
    run(
        repo,
        &[
            "show",
            "--no-color",
            "--no-ext-diff",
            // Merges have no diff by default; show what they brought in.
            "--diff-merges=first-parent",
            "--format=%B",
            hash,
        ],
    )
}

fn parse_log(raw: &str) -> Vec<Commit> {
    let mut commits: Vec<Commit> = raw
        .split('\x1e')
        .filter_map(|record| {
            let mut f = record.trim_start_matches('\n').split('\x1f');
            Some(Commit {
                hash: f.next().filter(|h| !h.is_empty())?.into(),
                short_hash: f.next()?.into(),
                author: f.next()?.into(),
                email: f.next()?.into(),
                time: f.next()?.parse().ok()?,
                parents: f.next()?.split_whitespace().map(String::from).collect(),
                refs: parse_refs(f.next()?),
                subject: f.next()?.into(),
                graph: GraphRow::default(),
            })
        })
        .collect();

    let graph_input: Vec<(String, Vec<String>)> = commits
        .iter()
        .map(|c| (c.hash.clone(), c.parents.clone()))
        .collect();
    for (commit, row) in commits.iter_mut().zip(graph::layout(&graph_input)) {
        commit.graph = row;
    }
    commits
}

// ---------------------------------------------------------------------------
// Stash

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    /// N in `stash@{N}`; 0 is the most recent.
    pub index: u32,
    pub message: String,
    /// Branch the stash was made on, if git recorded one.
    pub branch: Option<String>,
    /// Unix timestamp in seconds.
    pub time: i64,
}

fn stash_ref(index: u32) -> String {
    format!("stash@{{{index}}}")
}

pub fn stashes(repo: &Path) -> Result<Vec<Stash>> {
    let raw = run(repo, &["stash", "list", "--format=%gd%x1f%gs%x1f%ct"])?;
    Ok(parse_stashes(&raw))
}

/// Parses `stash@{0}<US>On main: message<US>1700000000` lines. git writes the
/// subject as "WIP on <branch>: <commit>" or "On <branch>: <message>".
fn parse_stashes(raw: &str) -> Vec<Stash> {
    raw.lines()
        .filter_map(|line| {
            let mut f = line.split('\x1f');
            let index = f
                .next()?
                .strip_prefix("stash@{")?
                .strip_suffix('}')?
                .parse()
                .ok()?;
            let subject = f.next()?;
            let time = f.next()?.parse().ok()?;
            let (branch, message) = subject
                .strip_prefix("WIP on ")
                .or_else(|| subject.strip_prefix("On "))
                .and_then(|rest| rest.split_once(": "))
                .map(|(b, m)| (Some(b.to_string()), m.to_string()))
                .unwrap_or((None, subject.to_string()));
            Some(Stash {
                index,
                message,
                branch,
                time,
            })
        })
        .collect()
}

pub fn stash_push(repo: &Path, message: &str, include_untracked: bool) -> Result<()> {
    let mut args = vec!["stash", "push"];
    if include_untracked {
        args.push("--include-untracked");
    }
    if !message.trim().is_empty() {
        args.extend(["-m", message]);
    }
    let out = run(repo, &args)?;
    // git exits 0 here, so turn it into an error the UI can show.
    if out.contains("No local changes to save") {
        return Err(GitError::Failed("No local changes to stash".into()));
    }
    Ok(())
}

pub fn stash_apply(repo: &Path, index: u32) -> Result<()> {
    run(repo, &["stash", "apply", &stash_ref(index)]).map(drop)
}

/// Applies and then drops the stash. If applying conflicts, git keeps it.
pub fn stash_pop(repo: &Path, index: u32) -> Result<()> {
    run(repo, &["stash", "pop", &stash_ref(index)]).map(drop)
}

pub fn stash_drop(repo: &Path, index: u32) -> Result<()> {
    run(repo, &["stash", "drop", &stash_ref(index)]).map(drop)
}

/// The stash's changes as a patch, including files that were untracked.
pub fn stash_show(repo: &Path, index: u32) -> Result<String> {
    run(
        repo,
        &[
            "stash",
            "show",
            "-p",
            "--include-untracked",
            "--no-color",
            &stash_ref(index),
        ],
    )
}

// ---------------------------------------------------------------------------
// Remotes

// `env` carries credentials for hosts the user signed in to (see `github::git_env`).

pub fn fetch(repo: &Path, env: &[(String, String)]) -> Result<()> {
    run_with_env(repo, &["fetch", "--all", "--prune"], env).map(drop)
}

#[derive(Debug, Clone, Copy, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PullMode {
    Merge,
    Rebase,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct PullOutcome {
    /// Both sides have new commits and no mode was chosen or configured,
    /// so nothing happened; ask the user how to combine them.
    pub diverged: bool,
    /// The merge or rebase stopped with conflicts to resolve.
    pub conflicts: bool,
}

fn config(repo: &Path, key: &str) -> Result<Option<String>> {
    let out = output(repo, &["config", "--get", key])?;
    Ok(out
        .status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_lowercase()))
}

/// The mode the user's `pull.rebase` setting asks for, if they set one.
/// The system-wide value is ignored: the Git for Windows installer writes
/// `pull.rebase=false` there by default, which isn't a real choice.
fn configured_pull_mode(repo: &Path) -> Result<Option<PullMode>> {
    let out = output(repo, &["config", "--get", "--show-scope", "pull.rebase"])?;
    let line = String::from_utf8_lossy(&out.stdout).trim().to_lowercase();
    let Some((scope, value)) = line.split_once(char::is_whitespace) else {
        return Ok(None);
    };
    if !out.status.success() || scope == "system" {
        return Ok(None);
    }
    Ok(Some(match value.trim() {
        "false" | "no" | "off" | "0" => PullMode::Merge,
        // true, merges, interactive and their short forms all rebase.
        _ => PullMode::Rebase,
    }))
}

/// True when the branch and its upstream both have commits the other lacks.
fn diverged(repo: &Path) -> Result<bool> {
    let out = output(
        repo,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )?;
    let counts = String::from_utf8_lossy(&out.stdout);
    let mut n = counts.split_whitespace().map(|c| c.parse().unwrap_or(0u32));
    Ok(out.status.success() && n.next() > Some(0) && n.next() > Some(0))
}

/// Pulls the upstream branch. With no `mode` it follows `pull.rebase`, or
/// only fast-forwards when that isn't set. `remember` saves `mode` as this
/// repository's `pull.rebase`.
pub fn pull(
    repo: &Path,
    env: &[(String, String)],
    mode: Option<PullMode>,
    remember: bool,
) -> Result<PullOutcome> {
    if merge_message(repo)?.is_some() || crate::rebase::progress(repo)?.is_some() {
        return Err(GitError::Failed(
            "Finish or abort the merge or rebase in progress first".into(),
        ));
    }
    if let (Some(mode), true) = (mode, remember) {
        let value = if mode == PullMode::Rebase {
            "true"
        } else {
            "false"
        };
        run(repo, &["config", "pull.rebase", value])?;
    }
    let mode = match mode {
        Some(m) => Some(m),
        None => configured_pull_mode(repo)?,
    };
    let mut args = vec!["pull"];
    match mode {
        None => args.push("--ff-only"),
        Some(PullMode::Merge) => {
            args.extend(["--no-rebase", "--no-edit"]);
            // pull.ff=only would refuse the merge that was just asked for.
            if config(repo, "pull.ff")?.as_deref() == Some("only") {
                args.push("--ff");
            }
        }
        // Local changes are set aside and come back once the rebase ends.
        Some(PullMode::Rebase) => args.extend(["--rebase", "--autostash"]),
    }

    match run_with_env(repo, &args, env) {
        Ok(_) => Ok(PullOutcome {
            diverged: false,
            conflicts: false,
        }),
        Err(e) => {
            if merge_message(repo)?.is_some() || crate::rebase::progress(repo)?.is_some() {
                Ok(PullOutcome {
                    diverged: false,
                    conflicts: true,
                })
            } else if mode.is_none() && diverged(repo)? {
                Ok(PullOutcome {
                    diverged: true,
                    conflicts: false,
                })
            } else {
                Err(e)
            }
        }
    }
}

pub fn push(repo: &Path, env: &[(String, String)]) -> Result<()> {
    // Publish branches that don't have an upstream yet.
    let branch = run(repo, &["symbolic-ref", "--short", "HEAD"])?;
    let has_upstream = output(repo, &["rev-parse", "--abbrev-ref", "@{upstream}"])?
        .status
        .success();
    if has_upstream {
        run_with_env(repo, &["push"], env).map(drop)
    } else {
        run_with_env(repo, &["push", "-u", "origin", branch.trim()], env).map(drop)
    }
}

/// Overwrites the upstream branch after history was rewritten. The lease
/// makes it fail if someone else pushed in the meantime.
pub fn push_force(repo: &Path, env: &[(String, String)]) -> Result<()> {
    run_with_env(repo, &["push", "--force-with-lease"], env).map(drop)
}

/// URL of the `origin` remote, if there is one.
pub fn origin_url(repo: &Path) -> Result<Option<String>> {
    let out = output(repo, &["remote", "get-url", "origin"])?;
    Ok(out
        .status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string()))
}

pub fn add_origin(repo: &Path, url: &str) -> Result<()> {
    run(repo, &["remote", "add", "origin", url]).map(drop)
}

// ---------------------------------------------------------------------------
// Clone

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CloneProgress {
    /// e.g. "Receiving objects"
    pub phase: String,
    pub percent: u8,
}

/// Accepts the URL forms people actually paste, and nothing that could make
/// git run a helper program (such as `ext::`) or be read as an option.
fn is_allowed_clone_url(url: &str) -> bool {
    let schemes = ["https://", "http://", "ssh://", "git://"];
    if schemes.iter().any(|s| url.starts_with(s)) {
        return true;
    }
    // scp-like syntax: user@host:path
    match url.split_once(':') {
        Some((user_host, path)) => {
            !path.is_empty()
                && user_host.contains('@')
                && !user_host.starts_with('-')
                && !user_host.contains('/')
        }
        None => false,
    }
}

/// Parses one line of `git clone --progress` output, e.g.
/// `Receiving objects:  45% (450/1000), 1.20 MiB | 2.00 MiB/s`.
fn parse_progress(line: &str) -> Option<CloneProgress> {
    let line = line.trim().trim_start_matches("remote: ");
    let (phase, rest) = line.split_once(':')?;
    let percent = rest.trim_start().split('%').next()?.trim().parse().ok()?;
    Some(CloneProgress {
        phase: phase.trim().to_string(),
        percent,
    })
}

/// Clones `url` into `parent/name` and returns the new repository's path.
/// `on_progress` is called whenever git reports a new percentage.
pub fn clone(
    url: &str,
    parent: &Path,
    name: &str,
    env: &[(String, String)],
    on_progress: impl FnMut(CloneProgress),
) -> Result<PathBuf> {
    let url = url.trim();
    if !is_allowed_clone_url(url) {
        return Err(GitError::Failed(format!(
            "Unsupported repository URL: {url}"
        )));
    }
    clone_unchecked(url, parent, name, env, on_progress)
}

/// [`clone`] without the URL allow-list; tests use it with `file://` URLs.
fn clone_unchecked(
    url: &str,
    parent: &Path,
    name: &str,
    env: &[(String, String)],
    mut on_progress: impl FnMut(CloneProgress),
) -> Result<PathBuf> {
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err(GitError::Failed(format!("Invalid folder name: {name}")));
    }
    let dest = parent.join(name);
    if dest.exists() {
        return Err(GitError::Failed(format!(
            "{} already exists",
            dest.display()
        )));
    }

    let mut child = command(parent, &["clone", "--progress", "--", url, name])
        .envs(env.iter().cloned())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;

    // git rewrites progress lines in place with '\r', so split on both.
    let mut stderr = child.stderr.take().expect("stderr is piped");
    let mut messages = Vec::new();
    let mut line = Vec::new();
    let mut last: Option<CloneProgress> = None;
    let mut buf = [0u8; 4096];
    loop {
        let n = stderr.read(&mut buf)?;
        if n == 0 {
            break;
        }
        for &byte in &buf[..n] {
            if byte != b'\r' && byte != b'\n' {
                line.push(byte);
                continue;
            }
            let text = String::from_utf8_lossy(&line).into_owned();
            line.clear();
            match parse_progress(&text) {
                Some(p) if last.as_ref() != Some(&p) => {
                    on_progress(p.clone());
                    last = Some(p);
                }
                Some(_) => {}
                None if !text.trim().is_empty() => messages.push(text),
                None => {}
            }
        }
    }

    if child.wait()?.success() {
        Ok(dest)
    } else {
        let tail = messages[messages.len().saturating_sub(5)..].join("\n");
        Err(GitError::Failed(if tail.is_empty() {
            "git clone failed".into()
        } else {
            tail
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_status() {
        let raw = concat!(
            "# branch.oid abc\0",
            "# branch.head main\0",
            "# branch.upstream origin/main\0",
            "# branch.ab +2 -1\0",
            "1 M. N... 100644 100644 100644 aaa bbb src/a file.rs\0",
            "1 .M N... 100644 100644 100644 aaa bbb b.rs\0",
            "2 R. N... 100644 100644 100644 aaa bbb R100 new.rs\0old.rs\0",
            "u UU N... 100644 100644 100644 100644 a b c conflict.rs\0",
            "? untracked.txt\0",
        );
        let s = parse_status(raw);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (2, 1));
        assert_eq!(s.files.len(), 5);
        assert_eq!(s.files[0].path, "src/a file.rs");
        assert_eq!((s.files[0].index, s.files[0].worktree), ('M', '.'));
        assert_eq!(s.files[2].path, "new.rs");
        assert_eq!(s.files[2].orig_path.as_deref(), Some("old.rs"));
        assert!(s.files[3].conflicted);
        assert!(s.files[4].untracked);
    }

    #[test]
    fn parses_detached_head() {
        let s = parse_status("# branch.head (detached)\0");
        assert_eq!(s.branch, None);
    }

    #[test]
    fn parses_branches() {
        let b = parse_branches("main\x1f*\x1forigin/main\nfeature\x1f \x1f\n");
        assert_eq!(b.len(), 2);
        assert!(b[0].current);
        assert_eq!(b[0].upstream.as_deref(), Some("origin/main"));
        assert!(!b[1].current);
        assert_eq!(b[1].upstream, None);
    }

    /// Exercises the real `git` binary in a throwaway repository.
    #[test]
    fn end_to_end_flow() {
        let dir = std::env::temp_dir().join(format!("gitgud-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.as_path();
        run(repo, &["init", "-q", "-b", "main"]).unwrap();
        run(repo, &["config", "user.name", "Test"]).unwrap();
        run(repo, &["config", "user.email", "test@example.com"]).unwrap();
        run(repo, &["config", "commit.gpgsign", "false"]).unwrap();

        // Unborn branch: empty log, untracked file, stage/unstage without HEAD.
        assert!(log(repo, 10).unwrap().is_empty());
        std::fs::write(dir.join("a b.txt"), "hello\n").unwrap();
        assert!(status(repo).unwrap().files[0].untracked);
        assert!(diff(repo, "a b.txt", false, true)
            .unwrap()
            .contains("+hello"));
        stage(repo, &["a b.txt".into()]).unwrap();
        assert_eq!(status(repo).unwrap().files[0].index, 'A');
        unstage(repo, &["a b.txt".into()]).unwrap();
        assert!(status(repo).unwrap().files[0].untracked);

        // Shell metacharacters in the message must be stored verbatim.
        stage(repo, &["a b.txt".into()]).unwrap();
        let message = r#"first "quoted" $(touch pwned) `x`"#;
        commit(repo, message).unwrap();
        assert!(!dir.join("pwned").exists());
        let commits = log(repo, 10).unwrap();
        assert_eq!(commits[0].subject, message);
        assert!(status(repo).unwrap().files.is_empty());
        let shown = show_commit(repo, &commits[0].hash).unwrap();
        assert!(shown.contains("+hello"));
        assert!(show_commit(repo, "--help").is_err());

        create_branch(repo, "feature/x").unwrap();
        assert!(create_branch(repo, "bad..name").is_err());
        let b = branches(repo).unwrap();
        assert!(b.iter().any(|b| b.name == "feature/x" && b.current));
        switch_branch(repo, "main").unwrap();
        assert_eq!(status(repo).unwrap().branch.as_deref(), Some("main"));

        assert_eq!(origin_url(repo).unwrap(), None);
        add_origin(repo, "https://github.com/example/repo.git").unwrap();
        assert_eq!(
            origin_url(repo).unwrap().as_deref(),
            Some("https://github.com/example/repo.git")
        );

        assert!(matches!(
            open(&std::env::temp_dir()),
            Err(GitError::NotARepo(_))
        ));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn checks_clone_urls() {
        for ok in [
            "https://github.com/a/b.git",
            "git@github.com:a/b.git",
            "ssh://git@host/a/b",
        ] {
            assert!(is_allowed_clone_url(ok), "{ok}");
        }
        for bad in [
            "ext::sh -c touch% /tmp/pwned",
            "--upload-pack=touch /tmp/pwned",
            "/local/path",
            "file:///etc",
            "-u@host:path",
            "github.com/a/b",
        ] {
            assert!(!is_allowed_clone_url(bad), "{bad}");
        }
    }

    #[test]
    fn parses_clone_progress() {
        assert_eq!(
            parse_progress("Receiving objects:  45% (450/1000), 1.20 MiB | 2.00 MiB/s"),
            Some(CloneProgress {
                phase: "Receiving objects".into(),
                percent: 45
            })
        );
        assert_eq!(
            parse_progress("remote: Counting objects: 100% (12/12), done."),
            Some(CloneProgress {
                phase: "Counting objects".into(),
                percent: 100
            })
        );
        assert_eq!(parse_progress("Cloning into 'x'..."), None);
        assert_eq!(parse_progress("remote: Total 12 (delta 0)"), None);
    }

    #[test]
    fn clones_with_progress() {
        let base = std::env::temp_dir().join(format!("gitgud-clone-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        run(&src, &["init", "-q", "-b", "main"]).unwrap();
        std::fs::write(src.join("f.txt"), "x").unwrap();
        run(&src, &["add", "."]).unwrap();
        run(
            &src,
            &[
                "-c",
                "user.name=T",
                "-c",
                "user.email=t@x",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-qm",
                "c",
            ],
        )
        .unwrap();

        // file:///C:/... on Windows, file:///tmp/... elsewhere.
        let path = src.display().to_string().replace('\\', "/");
        let url = format!("file:///{}", path.trim_start_matches('/'));
        assert!(
            clone(&url, &base, "dst", &[], |_| {}).is_err(),
            "file:// is not user-facing"
        );

        let mut events = Vec::new();
        let dest = clone_unchecked(&url, &base, "dst", &[], |p| events.push(p)).unwrap();
        assert!(dest.join("f.txt").exists());
        assert!(events.iter().any(|p| p.percent == 100), "{events:?}");

        assert!(
            clone_unchecked(&url, &base, "dst", &[], |_| {}).is_err(),
            "dest exists"
        );
        assert!(
            clone_unchecked(&url, &base, "../x", &[], |_| {}).is_err(),
            "bad name"
        );
        std::fs::remove_dir_all(&base).unwrap();
    }

    /// Needs network access: `cargo test -- --ignored`
    #[test]
    #[ignore]
    fn clones_from_github() {
        let base = std::env::temp_dir().join(format!("gitgud-gh-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let mut events = Vec::new();
        let dest = clone(
            "https://github.com/octocat/Hello-World.git",
            &base,
            "hello",
            &[],
            |p| events.push(p),
        )
        .unwrap();
        assert!(dest.join("README").exists());
        assert!(!events.is_empty());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn shows_what_a_merge_brought_in() {
        let dir = std::env::temp_dir().join(format!("gitgud-merge-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.as_path();
        run(repo, &["init", "-q", "-b", "main"]).unwrap();
        run(repo, &["config", "user.name", "T"]).unwrap();
        run(repo, &["config", "user.email", "t@x"]).unwrap();
        run(repo, &["config", "commit.gpgsign", "false"]).unwrap();
        std::fs::write(dir.join("a.txt"), "a\n").unwrap();
        stage(repo, &["a.txt".into()]).unwrap();
        commit(repo, "init").unwrap();
        create_branch(repo, "feature").unwrap();
        std::fs::write(dir.join("b.txt"), "from feature\n").unwrap();
        stage(repo, &["b.txt".into()]).unwrap();
        commit(repo, "feature work").unwrap();
        switch_branch(repo, "main").unwrap();
        run(
            repo,
            &["merge", "-q", "--no-ff", "-m", "merge feature", "feature"],
        )
        .unwrap();

        let merge = &log(repo, 1).unwrap()[0];
        assert_eq!(merge.parents.len(), 2);
        let shown = show_commit(repo, &merge.hash).unwrap();
        assert!(shown.contains("+from feature"), "{shown}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn conflict_repo(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("gitgud-conflict-{name}-{}", std::process::id()));
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
        std::fs::write(dir.join("f.txt"), "start\nmiddle\nend\n").unwrap();
        std::fs::write(dir.join("gone.txt"), "x\n").unwrap();
        stage(repo, &["f.txt".into(), "gone.txt".into()]).unwrap();
        commit(repo, "init").unwrap();

        create_branch(repo, "feature").unwrap();
        std::fs::write(dir.join("f.txt"), "start\nfeature\nend\n").unwrap();
        std::fs::write(dir.join("gone.txt"), "changed on feature\n").unwrap();
        stage(repo, &["f.txt".into(), "gone.txt".into()]).unwrap();
        commit(repo, "feature").unwrap();

        switch_branch(repo, "main").unwrap();
        std::fs::write(dir.join("f.txt"), "start\nmain\nend\n").unwrap();
        std::fs::remove_file(dir.join("gone.txt")).unwrap();
        stage(repo, &["f.txt".into(), "gone.txt".into()]).unwrap();
        commit(repo, "main").unwrap();
        dir
    }

    #[test]
    fn merge_resolve_and_commit() {
        let dir = conflict_repo("merge");
        let repo = dir.as_path();
        assert!(merge(repo, "nope").is_err());

        assert_eq!(
            merge(repo, "feature").unwrap(),
            MergeOutcome { conflicts: true }
        );
        let s = status(repo).unwrap();
        assert_eq!(s.merging.as_deref(), Some("Merge branch 'feature'"));
        assert_eq!(s.files.iter().filter(|f| f.conflicted).count(), 2);

        let parts = conflict_parts(repo, "f.txt").unwrap();
        assert!(
            matches!(&parts[1], conflict::Part::Conflict { ours, theirs, .. }
            if ours == &vec!["main\n".to_string()] && theirs == &vec!["feature\n".to_string()])
        );
        assert!(mark_resolved(repo, "f.txt").is_err(), "markers still there");
        resolve_block(repo, "f.txt", 0, conflict::Choice::Both).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("f.txt")).unwrap(),
            "start\nmain\nfeature\nend\n"
        );
        mark_resolved(repo, "f.txt").unwrap();

        // Deleted on main, modified on feature: taking ours removes it.
        resolve_file(repo, "gone.txt", Side::Ours).unwrap();
        assert!(!dir.join("gone.txt").exists());

        let s = status(repo).unwrap();
        assert!(s.files.iter().all(|f| !f.conflicted), "{:?}", s.files);
        merge_commit(repo).unwrap();
        assert_eq!(status(repo).unwrap().merging, None);
        let head = &log(repo, 1).unwrap()[0];
        assert_eq!(head.parents.len(), 2);
        assert_eq!(head.subject, "Merge branch 'feature'");

        assert!(conflict_parts(repo, "../outside").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn merge_abort_and_take_theirs() {
        let dir = conflict_repo("abort");
        let repo = dir.as_path();
        merge(repo, "feature").unwrap();
        merge_abort(repo).unwrap();
        assert_eq!(status(repo).unwrap().merging, None);
        assert_eq!(
            std::fs::read_to_string(dir.join("f.txt")).unwrap(),
            "start\nmain\nend\n"
        );

        merge(repo, "feature").unwrap();
        resolve_file(repo, "f.txt", Side::Theirs).unwrap();
        resolve_file(repo, "gone.txt", Side::Theirs).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("gone.txt")).unwrap(),
            "changed on feature\n"
        );
        merge_commit(repo).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("f.txt")).unwrap(),
            "start\nfeature\nend\n"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parses_stashes() {
        let raw = "stash@{0}\x1fOn main: half-done login\x1f200\n\
                   stash@{1}\x1fWIP on feature/x: abc123 fix: thing\x1f100\n";
        let s = parse_stashes(raw);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].index, 0);
        assert_eq!(s[0].branch.as_deref(), Some("main"));
        assert_eq!(s[0].message, "half-done login");
        assert_eq!(s[1].branch.as_deref(), Some("feature/x"));
        assert_eq!(s[1].message, "abc123 fix: thing");
        assert_eq!(s[1].time, 100);
    }

    #[test]
    fn stash_round_trip() {
        let dir = std::env::temp_dir().join(format!("gitgud-stash-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.as_path();
        run(repo, &["init", "-q", "-b", "main"]).unwrap();
        run(repo, &["config", "user.name", "T"]).unwrap();
        run(repo, &["config", "user.email", "t@x"]).unwrap();
        run(repo, &["config", "commit.gpgsign", "false"]).unwrap();
        // Windows runners default to autocrlf=true, which would rewrite "two\n".
        run(repo, &["config", "core.autocrlf", "false"]).unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        stage(repo, &["a.txt".into()]).unwrap();
        commit(repo, "init").unwrap();

        assert!(stash_push(repo, "", true).is_err(), "nothing to stash");

        std::fs::write(dir.join("a.txt"), "two\n").unwrap();
        std::fs::write(dir.join("new.txt"), "untracked\n").unwrap();
        stash_push(repo, "my work", true).unwrap();
        assert!(status(repo).unwrap().files.is_empty());

        let list = stashes(repo).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].message, "my work");
        assert_eq!(list[0].branch.as_deref(), Some("main"));
        let patch = stash_show(repo, 0).unwrap();
        assert!(
            patch.contains("+two") && patch.contains("+untracked"),
            "{patch}"
        );

        stash_apply(repo, 0).unwrap();
        assert_eq!(stashes(repo).unwrap().len(), 1, "apply keeps the stash");
        run(repo, &["checkout", "--", "a.txt"]).unwrap();
        std::fs::remove_file(dir.join("new.txt")).unwrap();

        stash_pop(repo, 0).unwrap();
        assert!(stashes(repo).unwrap().is_empty(), "pop removes it");
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "two\n");

        stash_push(repo, "", false).unwrap();
        assert!(dir.join("new.txt").exists(), "untracked stays without -u");
        stash_drop(repo, 0).unwrap();
        assert!(stashes(repo).unwrap().is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stages_unstages_and_discards_single_lines() {
        let dir = std::env::temp_dir().join(format!("gitgud-lines-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.as_path();
        run(repo, &["init", "-q", "-b", "main"]).unwrap();
        run(repo, &["config", "user.name", "T"]).unwrap();
        run(repo, &["config", "user.email", "t@x"]).unwrap();
        run(repo, &["config", "commit.gpgsign", "false"]).unwrap();
        run(repo, &["config", "core.autocrlf", "false"]).unwrap();
        // Prefixes are forced, so this setting must not break applying.
        run(repo, &["config", "diff.noprefix", "true"]).unwrap();
        let original: String = (1..=20).map(|i| format!("line {i}\n")).collect();
        std::fs::write(dir.join("f.txt"), &original).unwrap();
        stage(repo, &["f.txt".into()]).unwrap();
        commit(repo, "init").unwrap();

        // Two separate edits, far enough apart to be two hunks.
        let edited = original
            .replace("line 2\n", "line 2 edited\n")
            .replace("line 18\n", "line 18 edited\n");
        std::fs::write(dir.join("f.txt"), &edited).unwrap();

        let index_of = |diff: &str, text: &str| {
            diff.split('\n')
                .position(|l| l == text)
                .unwrap_or_else(|| panic!("{text} in {diff}"))
        };

        // Stage only the first edit.
        let d = diff(repo, "f.txt", false, false).unwrap();
        let picked = [index_of(&d, "-line 2"), index_of(&d, "+line 2 edited")];
        apply_lines(repo, &d, &picked, LineAction::Stage).unwrap();
        let staged = diff(repo, "f.txt", true, false).unwrap();
        assert!(staged.contains("+line 2 edited") && !staged.contains("line 18 edited"));
        let unstaged = diff(repo, "f.txt", false, false).unwrap();
        assert!(unstaged.contains("+line 18 edited") && !unstaged.contains("line 2 edited"));

        // Unstage just the added line: the index loses "line 2" entirely.
        let s = diff(repo, "f.txt", true, false).unwrap();
        apply_lines(
            repo,
            &s,
            &[index_of(&s, "+line 2 edited")],
            LineAction::Unstage,
        )
        .unwrap();
        let staged = diff(repo, "f.txt", true, false).unwrap();
        assert!(
            staged.contains("-line 2") && !staged.contains("+line 2 edited"),
            "{staged}"
        );
        unstage(repo, &["f.txt".into()]).unwrap();

        // Discard only the second edit from the working tree.
        let d = diff(repo, "f.txt", false, false).unwrap();
        let picked = [index_of(&d, "-line 18"), index_of(&d, "+line 18 edited")];
        apply_lines(repo, &d, &picked, LineAction::Discard).unwrap();
        let now = std::fs::read_to_string(dir.join("f.txt")).unwrap();
        assert_eq!(now, original.replace("line 2\n", "line 2 edited\n"));

        // A stale diff (file changed since it was shown) is refused.
        std::fs::write(dir.join("f.txt"), "something else\n").unwrap();
        assert!(apply_lines(repo, &d, &picked, LineAction::Discard).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parses_log() {
        let raw =
            "h2\x1fs2\x1fBo\x1fb@x\x1f200\x1fh1\x1fHEAD -> refs/heads/main\x1fsecond | pipes\x1e\n\
                   h1\x1fs1\x1fAda\x1fa@x\x1f100\x1f\x1f\x1ffirst\x1e\n";
        let c = parse_log(raw);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].subject, "second | pipes");
        assert_eq!(c[0].time, 200);
        assert_eq!(c[0].parents, vec!["h1".to_string()]);
        assert_eq!(
            c[0].refs[0],
            RefLabel {
                name: "main".into(),
                kind: RefKind::Head
            }
        );
        assert!(c[1].parents.is_empty() && c[1].refs.is_empty());
        assert_eq!((c[0].graph.lane, c[1].graph.lane), (0, 0));
    }

    #[test]
    fn parses_refs() {
        let r = parse_refs(
            "HEAD -> refs/heads/main, tag: refs/tags/v0.1.0, refs/remotes/origin/main, \
             refs/remotes/origin/HEAD, refs/heads/feature/x",
        );
        let names: Vec<_> = r.iter().map(|r| (r.name.as_str(), &r.kind)).collect();
        assert_eq!(
            names,
            vec![
                ("main", &RefKind::Head),
                ("v0.1.0", &RefKind::Tag),
                ("origin/main", &RefKind::Remote),
                ("feature/x", &RefKind::Branch),
            ]
        );
        assert_eq!(parse_refs("HEAD")[0].kind, RefKind::Head);
        assert!(parse_refs("").is_empty());
    }

    /// A clone of a bare remote where `f.txt` was changed both locally and
    /// upstream, in the same line when `conflicting`.
    fn diverged_clone(name: &str, conflicting: bool) -> PathBuf {
        let base = std::env::temp_dir().join(format!("gitgud-pull-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        run(&base, &["init", "-q", "--bare", "-b", "main", "remote.git"]).unwrap();
        let setup = |dir: &Path| {
            for (k, v) in [
                ("user.name", "T"),
                ("user.email", "t@x"),
                ("commit.gpgsign", "false"),
                ("core.autocrlf", "false"),
            ] {
                run(dir, &["config", k, v]).unwrap();
            }
        };
        let edit = |dir: &Path, content: &str, message: &str| {
            std::fs::write(dir.join("f.txt"), content).unwrap();
            stage(dir, &["f.txt".into()]).unwrap();
            commit(dir, message).unwrap();
        };

        run(&base, &["clone", "-q", "remote.git", "theirs"]).unwrap();
        let theirs = base.join("theirs");
        setup(&theirs);
        edit(&theirs, "one\ntwo\nthree\n", "base");
        run(&theirs, &["push", "-q", "-u", "origin", "main"]).unwrap();

        run(&base, &["clone", "-q", "remote.git", "mine"]).unwrap();
        let mine = base.join("mine");
        setup(&mine);
        edit(&theirs, "one\ntwo\nTHREE\n", "theirs");
        run(&theirs, &["push", "-q"]).unwrap();
        let local = if conflicting {
            "one\ntwo\nmine\n"
        } else {
            "ONE\ntwo\nthree\n"
        };
        edit(&mine, local, "mine");
        mine
    }

    #[test]
    fn pull_asks_when_branches_diverge() {
        let repo = diverged_clone("ask", false);
        let outcome = pull(&repo, &[], None, false).unwrap();
        assert_eq!(
            outcome,
            PullOutcome {
                diverged: true,
                conflicts: false
            }
        );
        // Nothing was merged, but the upstream commit was fetched.
        let commits = log(&repo, 10).unwrap();
        assert_eq!((commits.len(), commits[0].parents.len()), (3, 1));
        let status = status(&repo).unwrap();
        assert_eq!((status.ahead, status.behind), (1, 1));
    }

    #[test]
    fn pull_merges_and_remembers() {
        let repo = diverged_clone("merge", false);
        run(&repo, &["config", "pull.ff", "only"]).unwrap();
        let outcome = pull(&repo, &[], Some(PullMode::Merge), true).unwrap();
        assert_eq!(
            outcome,
            PullOutcome {
                diverged: false,
                conflicts: false
            }
        );
        assert_eq!(log(&repo, 1).unwrap()[0].parents.len(), 2);
        assert_eq!(
            std::fs::read_to_string(repo.join("f.txt")).unwrap(),
            "ONE\ntwo\nTHREE\n"
        );
        assert_eq!(configured_pull_mode(&repo).unwrap(), Some(PullMode::Merge));
    }

    #[test]
    fn pull_rebases_from_config_with_local_changes() {
        let repo = diverged_clone("rebase", false);
        run(&repo, &["config", "pull.rebase", "true"]).unwrap();
        std::fs::write(repo.join("notes.txt"), "draft\n").unwrap();
        stage(&repo, &["notes.txt".into()]).unwrap();
        let outcome = pull(&repo, &[], None, false).unwrap();
        assert_eq!(
            outcome,
            PullOutcome {
                diverged: false,
                conflicts: false
            }
        );
        let subjects: Vec<_> = log(&repo, 10)
            .unwrap()
            .into_iter()
            .map(|c| c.subject)
            .collect();
        assert_eq!(subjects, ["mine", "theirs", "base"]);
        // The autostashed change is back.
        assert!(status(&repo)
            .unwrap()
            .files
            .iter()
            .any(|f| f.path == "notes.txt"));
    }

    #[test]
    fn pull_rebase_stops_for_conflicts() {
        let repo = diverged_clone("conflict", true);
        let outcome = pull(&repo, &[], Some(PullMode::Rebase), false).unwrap();
        assert_eq!(
            outcome,
            PullOutcome {
                diverged: false,
                conflicts: true
            }
        );
        let at = crate::rebase::progress(&repo).unwrap().unwrap();
        assert_eq!(at.branch, "main");
        assert!(!at.editing_history);
        assert!(pull(&repo, &[], None, false).is_err());

        // While rebasing, "theirs" is the local commit being replayed.
        resolve_file(&repo, "f.txt", Side::Theirs).unwrap();
        assert!(!crate::rebase::continue_(&repo).unwrap().stopped);
        let subjects: Vec<_> = log(&repo, 10)
            .unwrap()
            .into_iter()
            .map(|c| c.subject)
            .collect();
        assert_eq!(subjects, ["mine", "theirs", "base"]);
    }
}
