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
    (valid_part(owner) && valid_part(name)).then(|| (owner.to_string(), name.to_string()))
}

/// A GitHub owner or repository name, safe to put in an API path.
fn valid_part(s: &str) -> bool {
    !s.is_empty()
        && s != "."
        && s != ".."
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Checks an `owner/name` the frontend passed back before it goes in a URL.
fn check_repo(full_name: &str) -> Result<()> {
    match full_name.split_once('/') {
        Some((owner, name)) if valid_part(owner) && valid_part(name) => Ok(()),
        _ => Err(GitError::Failed(format!("Invalid repository: {full_name}"))),
    }
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
fn read<T: DeserializeOwned>(
    res: ureq::http::Response<ureq::Body>,
    what: &str,
    token: &str,
) -> Result<T> {
    let status = res.status();
    if status == 401 {
        return Err(crate::github::signed_out(token));
    }
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
    read(res, what, token)
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
    check_repo(base_repo)?;
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
    check_repo(base_repo)?;
    check_repo(head_repo)?;
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
    check_repo(&target.base_repo)?;
    check_repo(&target.head_repo)?;
    let head_owner = target.head_repo.split('/').next().unwrap_or_default();
    let token = token()?;
    let res = ureq::post(format!(
        "https://api.github.com/repos/{}/pulls",
        target.base_repo
    ))
    .header("Accept", "application/vnd.github+json")
    .header("Authorization", format!("Bearer {token}"))
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
    read::<ApiPull>(res, "create the pull request", &token).map(Into::into)
}

// ---------------------------------------------------------------------------
// Open pull requests: their checks, reviews and checking them out

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Checks {
    Passed,
    Failed,
    Pending,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Review {
    Approved,
    ChangesRequested,
    Required,
}

/// A pull request with what GitHub thinks of it.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullDetails {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub draft: bool,
    /// None once the account is gone.
    pub author: Option<String>,
    /// The branch, and for another repository's `owner:branch`.
    pub head: String,
    pub base: String,
    /// ISO 8601
    pub updated_at: String,
    /// None without any checks.
    pub checks: Option<Checks>,
    /// None when no review is asked for.
    pub review: Option<Review>,
    #[serde(skip)]
    head_ref: String,
    #[serde(skip)]
    from_fork: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullList {
    /// `owner/repo`
    pub repo: String,
    pub pulls: Vec<PullDetails>,
    /// All open ones, which can be more than are listed.
    pub total: u64,
}

const PULL_FIELDS: &str = "number title url isDraft author{login} headRefName isCrossRepository \
     headRepositoryOwner{login} baseRefName updatedAt reviewDecision \
     commits(last:1){nodes{commit{statusCheckRollup{state}}}}";

fn details(v: &serde_json::Value) -> Option<PullDetails> {
    let text = |key: &str| Some(v[key].as_str()?.to_string());
    let head_ref = text("headRefName")?;
    let from_fork = v["isCrossRepository"].as_bool().unwrap_or(false);
    let rollup = &v["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"];
    Some(PullDetails {
        number: v["number"].as_u64()?,
        title: text("title")?,
        url: text("url")?,
        draft: v["isDraft"].as_bool().unwrap_or(false),
        author: v["author"]["login"].as_str().map(str::to_string),
        head: match v["headRepositoryOwner"]["login"].as_str() {
            Some(owner) if from_fork => format!("{owner}:{head_ref}"),
            _ => head_ref.clone(),
        },
        base: text("baseRefName")?,
        updated_at: text("updatedAt")?,
        checks: match rollup.as_str() {
            Some("SUCCESS") => Some(Checks::Passed),
            Some("FAILURE" | "ERROR") => Some(Checks::Failed),
            Some(_) => Some(Checks::Pending),
            None => None,
        },
        review: match v["reviewDecision"].as_str() {
            Some("APPROVED") => Some(Review::Approved),
            Some("CHANGES_REQUESTED") => Some(Review::ChangesRequested),
            Some("REVIEW_REQUIRED") => Some(Review::Required),
            _ => None,
        },
        head_ref,
        from_fork,
    })
}

/// Asks for `body` of a repository; `number` is `$number` in it.
fn graphql(
    base_repo: &str,
    parameters: &str,
    body: &str,
    number: Option<u64>,
    what: &str,
) -> Result<serde_json::Value> {
    check_repo(base_repo)?;
    let (owner, name) = base_repo.split_once('/').unwrap_or_default();
    let token = token()?;
    let res = ureq::post("https://api.github.com/graphql")
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", USER_AGENT)
        .config()
        .http_status_as_error(false)
        .build()
        .send_json(serde_json::json!({
            "query": format!(
                "query($owner:String!,$name:String!{parameters}){{repository(owner:$owner,name:$name){{{body}}}}}"
            ),
            "variables": { "owner": owner, "name": name, "number": number },
        }))
        .map_err(http_error)?;
    let mut answer: serde_json::Value = read(res, what, &token)?;
    let repository = answer["data"]["repository"].take();
    if repository.is_null() {
        // GraphQL errors come with a 200.
        let reason = answer["errors"][0]["message"]
            .as_str()
            .unwrap_or("no answer");
        return Err(GitError::Failed(format!("Could not {what}: {reason}")));
    }
    Ok(repository)
}

/// One pull request.
pub fn pull(base_repo: &str, number: u64) -> Result<PullDetails> {
    let what = "read the pull request";
    let repository = graphql(
        base_repo,
        ",$number:Int!",
        &format!("pullRequest(number:$number){{{PULL_FIELDS}}}"),
        Some(number),
        what,
    )?;
    details(&repository["pullRequest"])
        .ok_or_else(|| GitError::Failed(format!("Could not {what}: #{number} wasn't found")))
}

/// The GitHub repository that pull requests of `repo` are in: where the
/// current branch or the default remote points, or the parent of that fork.
fn home(repo: &Path) -> Result<String> {
    let url = match upstream(repo)? {
        Some((url, _)) if parse_remote(&url).is_some() => Some(url),
        _ => {
            let list = remotes::list(repo)?;
            let default = remotes::default(repo).ok();
            list.iter()
                .filter(|r| parse_remote(&r.url).is_some())
                .max_by_key(|r| Some(&r.name) == default.as_ref())
                .map(|r| r.url.clone())
        }
    };
    let Some((owner, name)) = url.as_deref().and_then(parse_remote) else {
        return Err(GitError::Failed(
            "This repository has no remote on GitHub".into(),
        ));
    };
    let found: ApiRepo = get(
        &token()?,
        &format!("/repos/{owner}/{name}"),
        &[],
        "read the repository",
    )?;
    Ok(found.parent.map_or(found.full_name, |p| p.full_name))
}

/// The open pull requests, most recently updated first.
pub fn list(repo: &Path) -> Result<PullList> {
    let base_repo = home(repo)?;
    let found = graphql(
        &base_repo,
        "",
        &format!(
            "pullRequests(states:OPEN,first:50,orderBy:{{field:UPDATED_AT,direction:DESC}})\
             {{totalCount nodes{{{PULL_FIELDS}}}}}"
        ),
        None,
        "list pull requests",
    )?;
    let nodes = found["pullRequests"]["nodes"].as_array();
    Ok(PullList {
        repo: base_repo,
        pulls: nodes
            .map(|n| n.iter().filter_map(details).collect())
            .unwrap_or_default(),
        total: found["pullRequests"]["totalCount"].as_u64().unwrap_or(0),
    })
}

/// Switches to a pull request's commits and returns the branch they're on:
/// the branch itself if it's in the base repository, so it can be pushed to,
/// or else `pr/<number>`. Doing it again brings in what's new.
pub fn checkout(repo: &Path, base_repo: &str, number: u64) -> Result<String> {
    let pull = pull(base_repo, number)?;
    let list = remotes::list(repo)?;
    let remote = list.iter().find(|r| {
        parse_remote(&r.url)
            .is_some_and(|(o, n)| format!("{o}/{n}").eq_ignore_ascii_case(base_repo))
    });
    let url = match remote {
        Some(r) => r.url.clone(),
        None => format!("https://github.com/{base_repo}.git"),
    };
    let env = crate::hosts::git_env_for(std::slice::from_ref(&url));
    let branch = (!pull.from_fork).then_some(pull.head_ref.as_str());
    match remote {
        Some(r) => checkout_from(repo, &r.name, branch, number, &env),
        None => checkout_from(repo, &url, None, number, &env),
    }
}

/// `source` is a remote, or a URL when there is no `branch`.
fn checkout_from(
    repo: &Path,
    source: &str,
    branch: Option<&str>,
    number: u64,
    env: &[(String, String)],
) -> Result<String> {
    if let Some(branch) = branch {
        git::check_branch_name(repo, branch)?;
        let existing = git::branches(repo)?.into_iter().find(|b| b.name == branch);
        let tracked = format!("{source}/{branch}");
        // A branch that only shares the name isn't the pull request's.
        if existing
            .as_ref()
            .is_none_or(|b| b.upstream.as_deref() == Some(tracked.as_str()))
        {
            let refspec = format!("+refs/heads/{branch}:refs/remotes/{tracked}");
            git::run_with_env(repo, &["fetch", "--", source, &refspec], env)?;
            if existing.is_none() {
                let at = format!("refs/remotes/{tracked}");
                git::run(repo, &["switch", "-c", branch, "--track", &at])?;
            } else {
                git::switch_branch(repo, branch)?;
                git::run(
                    repo,
                    &["merge", "--ff-only", &format!("refs/remotes/{tracked}")],
                )
                .map_err(|_| moved_on(branch))?;
            }
            return Ok(branch.to_string());
        }
    }

    let name = format!("pr/{number}");
    let head = format!("refs/pull/{number}/head");
    if git::current_branch(repo)?.as_deref() == Some(name.as_str()) {
        git::run_with_env(repo, &["fetch", "--", source, &head], env)?;
        git::run(repo, &["merge", "--ff-only", "FETCH_HEAD"]).map_err(|_| moved_on(&name))?;
    } else {
        let refspec = format!("{head}:refs/heads/{name}");
        git::run_with_env(repo, &["fetch", "--", source, &refspec], env).map_err(|e| {
            if e.to_string().contains("non-fast-forward") {
                moved_on(&name)
            } else {
                e
            }
        })?;
        git::switch_branch(repo, &name)?;
    }
    Ok(name)
}

fn moved_on(branch: &str) -> GitError {
    GitError::Failed(format!(
        "'{branch}' and the pull request have different commits. Rename or delete the branch, then check the pull request out again."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_checks_and_reviews() {
        let v = serde_json::json!({
            "number": 7, "title": "t", "url": "u", "isDraft": true,
            "author": { "login": "grace" }, "headRefName": "fix", "isCrossRepository": true,
            "headRepositoryOwner": { "login": "grace" }, "baseRefName": "main",
            "updatedAt": "2026-01-01T00:00:00Z", "reviewDecision": "CHANGES_REQUESTED",
            "commits": { "nodes": [{ "commit": { "statusCheckRollup": { "state": "ERROR" } } }] },
        });
        let p = details(&v).unwrap();
        assert_eq!(p.head, "grace:fix");
        assert_eq!(p.checks, Some(Checks::Failed));
        assert_eq!(p.review, Some(Review::ChangesRequested));
        // A deleted account and fork, and no checks.
        let v = serde_json::json!({
            "number": 8, "title": "t", "url": "u", "isDraft": false, "author": null,
            "headRefName": "fix", "isCrossRepository": true, "headRepositoryOwner": null,
            "baseRefName": "main", "updatedAt": "x", "reviewDecision": null,
            "commits": { "nodes": [{ "commit": { "statusCheckRollup": null } }] },
        });
        let p = details(&v).unwrap();
        assert_eq!((p.head.as_str(), p.author, p.checks), ("fix", None, None));
    }

    #[test]
    fn checks_out_pull_requests() {
        let base = std::env::temp_dir().join(format!("gitgud-prs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (origin, repo) = (base.join("origin"), base.join("repo"));
        std::fs::create_dir_all(&origin).unwrap();
        let commit = |dir: &Path, message: &str| {
            git::run(dir, &["commit", "-q", "--allow-empty", "-m", message]).unwrap();
        };
        let configure = |dir: &Path| {
            for (k, v) in [
                ("user.name", "T"),
                ("user.email", "t@x"),
                ("commit.gpgsign", "false"),
            ] {
                git::run(dir, &["config", k, v]).unwrap();
            }
        };
        git::run(&origin, &["init", "-q", "-b", "main"]).unwrap();
        configure(&origin);
        commit(&origin, "base");
        let url = origin.to_string_lossy().into_owned();
        git::run(&base, &["clone", "-q", &url, "repo"]).unwrap();
        configure(&repo);
        // #1 is a branch there, #2 came from a fork.
        git::run(&origin, &["switch", "-q", "-c", "feature/x"]).unwrap();
        commit(&origin, "one");
        git::run(&origin, &["update-ref", "refs/pull/1/head", "HEAD"]).unwrap();
        git::run(&origin, &["update-ref", "refs/pull/2/head", "HEAD"]).unwrap();

        let go = |branch: Option<&str>, n| checkout_from(&repo, "origin", branch, n, &[]);
        let subject = || git::log(&repo, 1).unwrap()[0].subject.clone();
        assert_eq!(go(Some("feature/x"), 1).unwrap(), "feature/x");
        let b = git::branches(&repo).unwrap();
        let b = b.iter().find(|b| b.current).unwrap();
        assert_eq!(b.upstream.as_deref(), Some("origin/feature/x"));
        assert_eq!(go(None, 2).unwrap(), "pr/2");
        assert_eq!(subject(), "one");

        // Again, from either branch, with something new.
        commit(&origin, "two");
        git::run(&origin, &["update-ref", "refs/pull/2/head", "HEAD"]).unwrap();
        assert_eq!(go(None, 2).unwrap(), "pr/2");
        assert_eq!(subject(), "two");
        assert_eq!(go(Some("feature/x"), 1).unwrap(), "feature/x");
        assert_eq!(subject(), "two");
        commit(&origin, "three");
        git::run(&origin, &["update-ref", "refs/pull/2/head", "HEAD"]).unwrap();
        assert_eq!(go(None, 2).unwrap(), "pr/2");
        assert_eq!(subject(), "three");

        // Rewritten since: nothing local is lost.
        git::switch_branch(&repo, "main").unwrap();
        git::run(&origin, &["reset", "-q", "--hard", "main"]).unwrap();
        commit(&origin, "rewritten");
        git::run(&origin, &["update-ref", "refs/pull/2/head", "HEAD"]).unwrap();
        assert!(go(None, 2).unwrap_err().to_string().contains("pr/2"));
        // A local branch that isn't the pull request's is left alone.
        git::run(&origin, &["branch", "mine"]).unwrap();
        git::run(&origin, &["update-ref", "refs/pull/3/head", "mine"]).unwrap();
        git::run(&repo, &["branch", "--no-track", "mine"]).unwrap();
        assert_eq!(go(Some("mine"), 3).unwrap(), "pr/3");
        assert!(go(Some("--x"), 4).is_err());
        std::fs::remove_dir_all(base).unwrap();
    }

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
    fn only_owner_slash_name_reaches_the_api() {
        for ok in ["qiral/gitgud", "me/my.repo-name_2"] {
            assert!(check_repo(ok).is_ok(), "{ok}");
        }
        for bad in [
            "qiral",
            "qiral/gitgud/pulls",
            "../user",
            "qiral/..",
            "a/b?x=1",
            "a/b#c",
            "/x",
            "x/",
            "a b/c",
        ] {
            assert!(check_repo(bad).is_err(), "{bad}");
        }
        assert!(branches("../../user").is_err());
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
