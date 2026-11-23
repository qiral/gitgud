//! Listing and changing a repository's remotes.

use serde::Serialize;
use std::path::Path;

use crate::git::{self, is_allowed_clone_url, GitError, Result};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub url: String,
    /// Set when pushes go somewhere other than `url`.
    pub push_url: Option<String>,
}

/// The remotes in the order git config has them. Reads the config instead of
/// `git remote get-url`, which would apply `insteadOf` rewrites to the URLs.
pub fn list(repo: &Path) -> Result<Vec<Remote>> {
    let args = [
        "config",
        "--null",
        "--get-regexp",
        r"^remote\..+\.(url|pushurl)$",
    ];
    let out = git::output(repo, &args)?;
    match out.status.code() {
        Some(0) => Ok(parse(&String::from_utf8_lossy(&out.stdout))),
        // Nothing matched.
        Some(1) => Ok(Vec::new()),
        _ => Err(GitError::Failed(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        )),
    }
}

/// Parses `key\nvalue\0` records. Only the first URL of each kind counts.
fn parse(raw: &str) -> Vec<Remote> {
    let mut remotes: Vec<Remote> = Vec::new();
    let mut push_urls: Vec<(String, String)> = Vec::new();
    for record in raw.split('\0') {
        let Some((key, value)) = record.split_once('\n') else {
            continue;
        };
        let Some(key) = key.strip_prefix("remote.") else {
            continue;
        };
        if let Some(name) = key.strip_suffix(".url") {
            if !remotes.iter().any(|r| r.name == name) {
                remotes.push(Remote {
                    name: name.into(),
                    url: value.into(),
                    push_url: None,
                });
            }
        } else if let Some(name) = key.strip_suffix(".pushurl") {
            push_urls.push((name.into(), value.into()));
        }
    }
    for remote in &mut remotes {
        remote.push_url = push_urls
            .iter()
            .find(|(name, url)| *name == remote.name && *url != remote.url)
            .map(|(_, url)| url.clone());
    }
    remotes
}

/// Refuses names that aren't a remote, so they can't be read as a URL or an
/// option.
pub fn check_exists(repo: &Path, name: &str) -> Result<()> {
    if !name.starts_with('-') && list(repo)?.iter().any(|r| r.name == name) {
        return Ok(());
    }
    Err(GitError::Failed(format!("No remote named '{name}'")))
}

fn check_new_name(repo: &Path, name: &str) -> Result<()> {
    let as_ref = format!("refs/remotes/{name}/x");
    if name.is_empty()
        || name.starts_with('-')
        || git::run(repo, &["check-ref-format", &as_ref]).is_err()
    {
        return Err(GitError::Failed(format!(
            "'{name}' is not a valid remote name"
        )));
    }
    if list(repo)?.iter().any(|r| r.name == name) {
        return Err(GitError::Failed(format!(
            "There is already a remote named '{name}'"
        )));
    }
    Ok(())
}

fn check_url(url: &str) -> Result<()> {
    // A folder on this computer is fine too, unlike helpers such as `ext::`.
    if is_allowed_clone_url(url) || Path::new(url).is_absolute() {
        return Ok(());
    }
    Err(GitError::Failed(format!(
        "'{url}' is not a URL git can use. Try https://… or git@host:owner/repo.git"
    )))
}

pub fn add(repo: &Path, name: &str, url: &str) -> Result<()> {
    let (name, url) = (name.trim(), url.trim());
    check_new_name(repo, name)?;
    check_url(url)?;
    git::run(repo, &["remote", "add", "--", name, url]).map(drop)
}

/// Also moves the remote's branches and the upstreams that point at them.
pub fn rename(repo: &Path, old: &str, new: &str) -> Result<()> {
    let new = new.trim();
    check_exists(repo, old)?;
    check_new_name(repo, new)?;
    // No `--`: git before 2.35 doesn't parse options here and would count it.
    git::run(repo, &["remote", "rename", old, new]).map(drop)
}

pub fn set_url(repo: &Path, name: &str, url: &str) -> Result<()> {
    let url = url.trim();
    check_exists(repo, name)?;
    check_url(url)?;
    git::run(repo, &["remote", "set-url", "--", name, url]).map(drop)
}

/// Also drops the remote's branches and the upstreams that point at them.
pub fn remove(repo: &Path, name: &str) -> Result<()> {
    check_exists(repo, name)?;
    git::run(repo, &["remote", "remove", name]).map(drop)
}

/// Where to push when nothing says otherwise: `origin`, else the first one.
pub fn default(repo: &Path) -> Result<String> {
    let remotes = list(repo)?;
    remotes
        .iter()
        .find(|r| r.name == "origin")
        .or(remotes.first())
        .map(|r| r.name.clone())
        .ok_or_else(|| GitError::Failed("This repository has no remotes".into()))
}

/// Branches of all remotes as `remote/branch`, most recent first.
pub fn branches(repo: &Path) -> Result<Vec<String>> {
    let raw = git::run(
        repo,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:lstrip=2)%1f%(symref)",
            "refs/remotes",
        ],
    )?;
    Ok(raw
        .lines()
        .filter_map(|line| line.split_once('\x1f'))
        // `origin/HEAD` only points at another branch.
        .filter(|(_, symref)| symref.is_empty())
        .map(|(name, _)| name.to_string())
        .collect())
}

/// Sets the remote branch that `branch` pulls from and pushes to, or clears it.
pub fn set_upstream(repo: &Path, branch: &str, upstream: Option<&str>) -> Result<()> {
    if git::run(
        repo,
        &["show-ref", "--verify", &format!("refs/heads/{branch}")],
    )
    .is_err()
    {
        return Err(GitError::Failed(format!("No branch named '{branch}'")));
    }
    match upstream {
        // The full name, in case a local branch is called the same.
        Some(u) => git::run(
            repo,
            &[
                "branch",
                &format!("--set-upstream-to=refs/remotes/{u}"),
                "--",
                branch,
            ],
        ),
        None => git::run(repo, &["branch", "--unset-upstream", "--", branch]),
    }
    .map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// An empty bare repository `origin.git` and `fork.git`, and a repository
    /// with one commit and no remotes.
    fn setup(name: &str) -> (PathBuf, PathBuf) {
        let base =
            std::env::temp_dir().join(format!("gitgud-remotes-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let repo = base.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        for bare in ["origin.git", "fork.git"] {
            git::run(&base, &["init", "-q", "--bare", "-b", "main", bare]).unwrap();
        }
        git::run(&repo, &["init", "-q", "-b", "main"]).unwrap();
        for (k, v) in [
            ("user.name", "T"),
            ("user.email", "t@x"),
            ("commit.gpgsign", "false"),
        ] {
            git::run(&repo, &["config", k, v]).unwrap();
        }
        git::run(&repo, &["commit", "-q", "--allow-empty", "-m", "base"]).unwrap();
        (base, repo)
    }

    #[test]
    fn parses_config_records() {
        let raw = "remote.origin.url\nhttps://a/b.git\0remote.my.fork.url\ngit@h:x/y\0\
                   remote.origin.url\nhttps://second\0remote.my.fork.pushurl\ngit@h:x/z\0\
                   remote.origin.pushurl\nhttps://a/b.git\0";
        let got: Vec<_> = parse(raw)
            .into_iter()
            .map(|r| (r.name, r.url, r.push_url))
            .collect();
        assert_eq!(
            got,
            [
                ("origin".into(), "https://a/b.git".into(), None),
                (
                    "my.fork".into(),
                    "git@h:x/y".into(),
                    Some("git@h:x/z".into())
                ),
            ]
        );
    }

    #[test]
    fn adds_edits_renames_and_removes() {
        let (base, repo) = setup("edit");
        assert!(list(&repo).unwrap().is_empty());
        assert!(default(&repo).is_err());

        add(&repo, " fork ", "https://example.com/f.git").unwrap();
        assert_eq!(default(&repo).unwrap(), "fork");
        add(&repo, "origin", "git@example.com:o/r.git").unwrap();
        assert_eq!(default(&repo).unwrap(), "origin");

        for (name, url) in [
            ("origin", "https://example.com/x"),
            ("-f", "https://example.com/x"),
            ("", "https://example.com/x"),
            ("a b", "https://example.com/x"),
            ("x", "ext::sh -c true"),
            ("x", "--upload-pack=true"),
            ("x", ""),
        ] {
            assert!(add(&repo, name, url).is_err(), "{name} {url}");
        }

        set_url(&repo, "fork", "https://example.com/new.git").unwrap();
        assert!(set_url(&repo, "fork", "ext::sh").is_err());
        assert!(set_url(&repo, "nope", "https://example.com/x").is_err());
        rename(&repo, "fork", "mine").unwrap();
        assert!(rename(&repo, "mine", "origin").is_err());
        assert!(rename(&repo, "mine", "--progress").is_err());
        assert!(list(&repo).unwrap().contains(&Remote {
            name: "mine".into(),
            url: "https://example.com/new.git".into(),
            push_url: None,
        }));

        remove(&repo, "mine").unwrap();
        assert!(remove(&repo, "mine").is_err());
        assert_eq!(list(&repo).unwrap().len(), 1);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn publishes_fetches_and_tracks_the_chosen_remote() {
        let (base, repo) = setup("track");
        let url = |name: &str| base.join(name).to_string_lossy().into_owned();
        add(&repo, "origin", &url("origin.git")).unwrap();
        add(&repo, "upstream", &url("fork.git")).unwrap();

        git::push(&repo, Some("upstream"), &[]).unwrap();
        assert_eq!(branches(&repo).unwrap(), ["upstream/main"]);
        let upstream = |repo: &Path| git::branches(repo).unwrap()[0].upstream.clone();
        assert_eq!(upstream(&repo).as_deref(), Some("upstream/main"));

        set_upstream(&repo, "main", None).unwrap();
        assert_eq!(upstream(&repo), None);
        assert!(git::push(&repo, Some("--all"), &[]).is_err());
        // Without a choice it goes to origin.
        git::push(&repo, None, &[]).unwrap();
        assert_eq!(upstream(&repo).as_deref(), Some("origin/main"));
        set_upstream(&repo, "main", Some("upstream/main")).unwrap();
        assert_eq!(upstream(&repo).as_deref(), Some("upstream/main"));
        assert!(set_upstream(&repo, "main", Some("upstream/nope")).is_err());
        assert!(set_upstream(&repo, "nope", None).is_err());

        git::create_tag(&repo, "v1", &git::log(&repo, 1).unwrap()[0].hash, "").unwrap();
        git::push_tag(&repo, "v1", Some("origin"), &[]).unwrap();
        let tags = |name: &str| git::run(&base.join(name), &["tag", "-l"]).unwrap();
        assert_eq!(
            (tags("origin.git").trim(), tags("fork.git").trim()),
            ("v1", "")
        );
        // Without a choice it goes to the branch's remote.
        git::push_tag(&repo, "v1", None, &[]).unwrap();
        assert_eq!(tags("fork.git").trim(), "v1");

        // A branch that's gone from one remote only goes when pruning that one.
        git::run(
            &base.join("fork.git"),
            &["update-ref", "-d", "refs/heads/main"],
        )
        .unwrap();
        git::fetch(&repo, Some("upstream"), false, &[]).unwrap();
        git::fetch(&repo, Some("origin"), true, &[]).unwrap();
        assert_eq!(branches(&repo).unwrap().len(), 2);
        assert!(git::fetch(&repo, Some("--all"), true, &[]).is_err());
        git::fetch(&repo, None, true, &[]).unwrap();
        assert_eq!(branches(&repo).unwrap(), ["origin/main"]);
        std::fs::remove_dir_all(base).unwrap();
    }
}
