//! GitHub pull requests for the current branch.
//!
//! The branch's upstream remote says which GitHub repository the branch was
//! pushed to. Pull requests go to that repository, or to its parent when
//! it's a fork, which is where a fork's changes are usually meant to land.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::git::{self, GitError, Result};
use crate::github::{api_get, http_error, token, USER_AGENT};
use crate::remotes::{self, Remote};

/// `owner/repo` for a remote URL on github.com, in the forms git accepts.
pub fn parse_remote(url: &str) -> Option<(String, String)> {
    let url = url.trim();
    let rest = if let Some(r) = url.strip_prefix("git@github.com:") {
        r
    } else {
        let (scheme, r) = url.split_once("://")?;
        if !matches!(scheme, "https" | "http" | "ssh" | "git") {
            return None;
        }
        // Drop credentials (user@) and a port, then require github.com.
        let r = r.rsplit_once('@').map_or(r, |(_, host)| host);
        let (host, path) = r.split_once('/')?;
        let host = host.split(':').next()?;
        if !host.eq_ignore_ascii_case("github.com") {
            return None;
        }
        path
    };
    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let (owner, name) = rest.split_once('/')?;
    let valid = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    (valid(owner) && valid(name)).then(|| (owner.to_string(), name.to_string()))
}

/// Percent-encodes a branch name for a URL path, keeping `/`.
fn encode_path(text: &str) -> String {
    let mut out = String::new();
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~/".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

// ---------------------------------------------------------------------------
// API plumbing

/// Reads a JSON response, or GitHub's own explanation when it failed.
fn read<T: DeserializeOwned>(res: ureq::http::Response<ureq::Body>, what: &str) -> Result<T> {
    let status = res.status();
    let mut body = res.into_body();
    if status.is_success() {
        return body.read_json().map_err(http_error);
    }
    let detail: serde_json::Value = body.read_json().unwrap_or_default();
    let reason = detail["errors"][0]["message"]
        .as_str()
        .or(detail["message"].as_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("HTTP {status}"));
    Err(GitError::Failed(format!("Could not {what}: {reason}")))
}

fn get<T: DeserializeOwned>(
    token: &str,
    path: &str,
    query: &[(&str, &str)],
    what: &str,
) -> Result<T> {
    let mut req = api_get(token, path);
    for (k, v) in query {
        req = req.query(*k, *v);
    }
    let res = req
        .config()
        .http_status_as_error(false)
        .build()
        .call()
        .map_err(http_error)?;
    read(res, what)
}

// ---------------------------------------------------------------------------
// The current branch's pull request

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    /// "open", "closed" or "merged".
    pub state: String,
    pub draft: bool,
    pub url: String,
}

#[derive(Deserialize)]
struct ApiPull {
    number: u64,
    title: String,
    state: String,
    #[serde(default)]
    draft: bool,
    html_url: String,
    merged_at: Option<String>,
}

impl From<ApiPull> for PullRequest {
    fn from(p: ApiPull) -> Self {
        PullRequest {
            number: p.number,
            title: p.title,
            state: if p.merged_at.is_some() {
                "merged".into()
            } else {
                p.state
            },
            draft: p.draft,
            url: p.html_url,
        }
    }
}

/// Where a pull request for the current branch goes, and the one that's
/// already there.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullTarget {
    /// `owner/repo` the pull request is opened in.
    pub base_repo: String,
    /// `owner/repo` the branch was pushed to; differs from `base_repo` for forks.
    pub head_repo: String,
    /// The branch's name on the remote.
    pub branch: String,
    /// The base repository's default branch, e.g. "main".
    pub default_base: String,
    /// The newest pull request from this branch, open or not.
    pub existing: Option<PullRequest>,
}

#[derive(Deserialize)]
struct ApiRepo {
    full_name: String,
    default_branch: String,
    parent: Option<Box<ApiRepo>>,
}

/// The current branch's upstream as `(remote URL, branch on the remote)`.
fn upstream(repo: &Path) -> Result<Option<(String, String)>> {
    let config = |key: String| -> Result<Option<String>> {
        let out = git::output(repo, &["config", "--get", &key])?;
        Ok(out
            .status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string()))
    };
    let Ok(branch) = git::run(repo, &["symbolic-ref", "-q", "--short", "HEAD"]) else {
        return Ok(None);
    };
    let branch = branch.trim();
    let (Some(remote), Some(merge)) = (
        config(format!("branch.{branch}.remote"))?,
        config(format!("branch.{branch}.merge"))?,
    ) else {
        return Ok(None);
    };
    let Some(remote_branch) = merge.strip_prefix("refs/heads/") else {
        return Ok(None);
    };
    let url = match git::output(repo, &["remote", "get-url", "--", &remote])? {
        out if out.status.success() => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        // `branch.x.remote` can be a URL instead of a remote's name.
        _ => remote,
    };
    Ok(Some((url, remote_branch.to_string())))
}

/// None when the branch has no upstream on github.com.
pub fn target(repo: &Path) -> Result<Option<PullTarget>> {
    let Some((url, branch)) = upstream(repo)? else {
        return Ok(None);
    };
    let Some((owner, name)) = parse_remote(&url) else {
        return Ok(None);
    };
    let token = token()?;
    let pushed_to: ApiRepo = get(
        &token,
        &format!("/repos/{owner}/{name}"),
        &[],
        "read the repository",
    )?;
    let base = pushed_to.parent.as_deref().unwrap_or(&pushed_to);
    let (head_owner, _) = pushed_to
        .full_name
        .split_once('/')
        .unwrap_or((&owner, &name));
    let pulls: Vec<ApiPull> = get(
        &token,
        &format!("/repos/{}/pulls", base.full_name),
        &[
            ("head", &format!("{head_owner}:{branch}")),
            ("state", "all"),
            ("per_page", "1"),
        ],
        "look for pull requests",
    )?;
    Ok(Some(PullTarget {
        base_repo: base.full_name.clone(),
        head_repo: pushed_to.full_name.clone(),
        branch,
        default_base: base.default_branch.clone(),
        existing: pulls.into_iter().next().map(Into::into),
    }))
}

// ---------------------------------------------------------------------------
// Forks

/// The repository that `origin` was forked from.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Parent {
    /// `owner/repo`
    pub full_name: String,
    /// Uses SSH when `origin` does.
    pub url: String,
}

/// None when `origin` isn't a fork on github.com, or a remote already points
/// at the parent.
pub fn parent(repo: &Path) -> Result<Option<Parent>> {
    let list = remotes::list(repo)?;
    let Some(origin) = list.iter().find(|r| r.name == "origin") else {
        return Ok(None);
    };
    let Some((owner, name)) = parse_remote(&origin.url) else {
        return Ok(None);
    };
    let fork: ApiRepo = get(
        &token()?,
        &format!("/repos/{owner}/{name}"),
        &[],
        "read the repository",
    )?;
    Ok(fork
        .parent
        .and_then(|p| missing_parent(&list, &origin.url, p.full_name)))
}

fn missing_parent(list: &[Remote], origin_url: &str, full_name: String) -> Option<Parent> {
    let known = list.iter().any(|r| {
        parse_remote(&r.url)
            .is_some_and(|(o, n)| format!("{o}/{n}").eq_ignore_ascii_case(&full_name))
    });
    let ssh = origin_url.starts_with("git@") || origin_url.starts_with("ssh://");
    let url = if ssh {
        format!("git@github.com:{full_name}.git")
    } else {
        format!("https://github.com/{full_name}.git")
    };
    (!known).then_some(Parent { full_name, url })
}

// ---------------------------------------------------------------------------
// Creating one

/// Branch names of a repository, for picking the base.
pub fn branches(base_repo: &str) -> Result<Vec<String>> {
    #[derive(Deserialize)]
    struct Branch {
        name: String,
    }
    let list: Vec<Branch> = get(
        &token()?,
        &format!("/repos/{base_repo}/branches"),
        &[("per_page", "100")],
        "list branches",
    )?;
    Ok(list.into_iter().map(|b| b.name).collect())
}

/// What a pull request from `head_repo:branch` into `base` would contain.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub merge_base: String,
    /// Full commit messages, oldest first.
    pub commits: Vec<String>,
}

pub fn compare(base_repo: &str, base: &str, head_repo: &str, branch: &str) -> Result<Comparison> {
    #[derive(Deserialize)]
    struct Sha {
        sha: String,
    }
    #[derive(Deserialize)]
    struct Inner {
        message: String,
    }
    #[derive(Deserialize)]
    struct ApiCommit {
        commit: Inner,
    }
    #[derive(Deserialize)]
    struct Api {
        merge_base_commit: Sha,
        commits: Vec<ApiCommit>,
    }
    let head_owner = head_repo.split('/').next().unwrap_or(head_repo);
    let res: Api = get(
        &token()?,
        &format!(
            "/repos/{base_repo}/compare/{}...{}:{}",
            encode_path(base),
            encode_path(head_owner),
            encode_path(branch)
        ),
        &[],
        "compare the branches",
    )?;
    Ok(Comparison {
        merge_base: res.merge_base_commit.sha,
        commits: res.commits.into_iter().map(|c| c.commit.message).collect(),
    })
}

pub fn create(
    target: &PullTarget,
    base: &str,
    title: &str,
    body: &str,
    draft: bool,
) -> Result<PullRequest> {
    let head_owner = target.head_repo.split('/').next().unwrap_or_default();
    let res = ureq::post(format!(
        "https://api.github.com/repos/{}/pulls",
        target.base_repo
    ))
    .header("Accept", "application/vnd.github+json")
    .header("Authorization", format!("Bearer {}", token()?))
    .header("User-Agent", USER_AGENT)
    .config()
    .http_status_as_error(false)
    .build()
    .send_json(serde_json::json!({
        "title": title,
        "body": body,
        "head": format!("{head_owner}:{}", target.branch),
        "base": base,
        "draft": draft,
    }))
    .map_err(http_error)?;
    read::<ApiPull>(res, "create the pull request").map(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offers_the_parent_of_a_fork_once() {
        let remote = |name: &str, url: &str| Remote {
            name: name.into(),
            url: url.into(),
            push_url: None,
        };
        let https = "https://github.com/me/app.git";
        let ssh = "git@github.com:me/app.git";
        let url =
            |list: &[Remote]| missing_parent(list, &list[0].url, "them/App".into()).map(|p| p.url);
        assert_eq!(
            url(&[remote("origin", https)]).as_deref(),
            Some("https://github.com/them/App.git")
        );
        assert_eq!(
            url(&[remote("origin", ssh)]).as_deref(),
            Some("git@github.com:them/App.git")
        );
        let known = remote("up", "https://github.com/Them/app");
        assert_eq!(url(&[remote("origin", https), known]), None);
    }

    #[test]
    fn parses_github_remotes() {
        let want = Some(("qiral".to_string(), "gitgud".to_string()));
        for url in [
            "https://github.com/qiral/gitgud.git",
            "https://github.com/qiral/gitgud",
            "https://github.com/qiral/gitgud/",
            "https://someone@github.com/qiral/gitgud.git",
            "git@github.com:qiral/gitgud.git",
            "ssh://git@github.com/qiral/gitgud.git",
            "ssh://git@github.com:22/qiral/gitgud",
            "https://GitHub.com/qiral/gitgud.git",
        ] {
            assert_eq!(parse_remote(url), want, "{url}");
        }
        for url in [
            "https://gitlab.com/qiral/gitgud.git",
            "https://github.com.evil.example/qiral/gitgud",
            "https://github.com/qiral",
            "file:///tmp/repo",
            "/home/me/repo",
            "https://github.com/qiral/git gud",
        ] {
            assert_eq!(parse_remote(url), None, "{url}");
        }
    }

    #[test]
    fn encodes_branch_names() {
        assert_eq!(encode_path("feature/a-b_c.d"), "feature/a-b_c.d");
        assert_eq!(encode_path("fix#1 ü"), "fix%231%20%C3%BC");
    }

    #[test]
    fn reads_merged_state() {
        let api = r#"[{"number":7,"title":"t","state":"closed","draft":false,
            "html_url":"https://github.com/o/r/pull/7","merged_at":"2026-01-01T00:00:00Z"},
            {"number":8,"title":"u","state":"open","html_url":"h","merged_at":null}]"#;
        let pulls: Vec<ApiPull> = serde_json::from_str(api).unwrap();
        let pulls: Vec<PullRequest> = pulls.into_iter().map(Into::into).collect();
        assert_eq!(pulls[0].state, "merged");
        assert_eq!(pulls[1].state, "open");
        assert!(!pulls[1].draft);
    }

    #[test]
    fn finds_the_upstream() {
        let dir = std::env::temp_dir().join(format!("gitgud-pulls-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.as_path();
        git::run(repo, &["init", "-q", "-b", "main"]).unwrap();
        assert_eq!(upstream(repo).unwrap(), None);
        git::run(
            repo,
            &["remote", "add", "origin", "git@github.com:me/fork.git"],
        )
        .unwrap();
        git::run(repo, &["config", "branch.main.remote", "origin"]).unwrap();
        git::run(
            repo,
            &["config", "branch.main.merge", "refs/heads/feature/x"],
        )
        .unwrap();
        assert_eq!(
            upstream(repo).unwrap(),
            Some(("git@github.com:me/fork.git".into(), "feature/x".into()))
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
