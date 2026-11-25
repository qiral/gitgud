//! Listing and updating submodules.

use serde::Serialize;
use std::path::Path;

use crate::git::{self, file_in_repo, GitError, Result};
use crate::hosts;

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum State {
    /// Its files haven't been downloaded.
    Missing,
    /// Another commit than the repository asks for.
    Changed,
    Current,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    pub path: String,
    /// The commit the repository asks for.
    pub recorded: String,
    pub checked_out: Option<String>,
    pub state: State,
}

pub fn list(repo: &Path) -> Result<Vec<Submodule>> {
    // Most repositories have none: don't read the whole index for that.
    if !repo.join(".gitmodules").is_file() {
        return Ok(Vec::new());
    }
    let raw = git::run(repo, &["ls-files", "--stage", "-z"])?;
    Ok(gitlinks(&raw)
        .into_iter()
        .map(|(path, recorded)| {
            let checked_out = checked_out(repo, &path);
            let state = match &checked_out {
                None => State::Missing,
                Some(at) if *at == recorded => State::Current,
                Some(_) => State::Changed,
            };
            Submodule {
                path,
                recorded,
                checked_out,
                state,
            }
        })
        .collect())
}

/// The submodules in `git ls-files --stage -z` as (path, commit).
fn gitlinks(raw: &str) -> Vec<(String, String)> {
    let mut found: Vec<(String, String)> = raw
        .split('\0')
        .filter_map(|entry| {
            let (info, path) = entry.split_once('\t')?;
            let mut info = info.split(' ');
            let (mode, oid) = (info.next()?, info.next()?);
            (mode == "160000").then(|| (path.to_string(), oid.to_string()))
        })
        .collect();
    // Conflicts list one several times.
    found.dedup_by(|a, b| a.0 == b.0);
    found
}

fn checked_out(repo: &Path, path: &str) -> Option<String> {
    let dir = file_in_repo(repo, path).ok()?;
    // Without this, git would answer for the repository around it.
    if !dir.join(".git").exists() {
        return None;
    }
    let out = git::run(&dir, &["rev-parse", "--verify", "-q", "HEAD"]).ok()?;
    Some(out.trim().to_string())
}

/// Checks out the recorded commits, downloading what's missing: of one
/// submodule, or of all of them.
pub fn update(repo: &Path, path: Option<&str>) -> Result<()> {
    let mut args = vec!["submodule", "update", "--init", "--recursive"];
    if let Some(path) = path {
        if !list(repo)?.iter().any(|s| s.path == path) {
            return Err(GitError::Failed(format!("No submodule at {path}")));
        }
        args.extend(["--", path]);
    }
    let mut urls = git::remote_urls(repo)?;
    urls.extend(configured_urls(repo));
    git::run_with_env(repo, &args, &hosts::git_env_for(&urls)).map(drop)
}

fn configured_urls(repo: &Path) -> Vec<String> {
    let args = [
        "config",
        "--file",
        ".gitmodules",
        "--get-regexp",
        r"^submodule\..*\.url$",
    ];
    let out = git::run(repo, &args).unwrap_or_default();
    out.lines()
        .filter_map(|line| line.rsplit_once(' '))
        .map(|(_, url)| url.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn configure(dir: &Path) {
        for (k, v) in [
            ("user.name", "T"),
            ("user.email", "t@x"),
            ("commit.gpgsign", "false"),
        ] {
            git::run(dir, &["config", k, v]).unwrap();
        }
    }

    #[test]
    fn finds_gitlinks() {
        let raw =
            "100644 aaa 0\tfile\x00160000 bbb 0\tlibs/a b\x00160000 c1 1\tx\x00160000 c2 2\tx\x00";
        assert_eq!(
            gitlinks(raw),
            [("libs/a b".into(), "bbb".into()), ("x".into(), "c1".into())]
        );
    }

    #[test]
    fn lists_updates_and_records() {
        let base = std::env::temp_dir().join(format!("gitgud-subs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (lib, repo) = (base.join("lib"), base.join("repo"));
        for dir in [&lib, &repo] {
            std::fs::create_dir_all(dir).unwrap();
            git::run(dir, &["init", "-q", "-b", "main"]).unwrap();
            configure(dir);
            git::run(dir, &["commit", "-q", "--allow-empty", "-m", "base"]).unwrap();
        }
        assert!(list(&repo).unwrap().is_empty());
        // Local paths are only allowed when asked for.
        let file = [
            ("GIT_CONFIG_COUNT".to_string(), "1".to_string()),
            ("GIT_CONFIG_KEY_0".into(), "protocol.file.allow".into()),
            ("GIT_CONFIG_VALUE_0".into(), "always".into()),
        ];
        let url = lib.to_string_lossy().replace('\\', "/");
        let add = ["submodule", "add", "-q", "--", &url, "libs/my lib"];
        git::run_with_env(&repo, &add, &file).unwrap();
        git::commit(&repo, "add lib").unwrap();
        let sub = repo.join("libs/my lib");
        configure(&sub);
        let state = || list(&repo).unwrap()[0].state;
        assert_eq!(state(), State::Current);

        // A commit in it shows up as a change of the repository.
        git::run(&sub, &["commit", "-q", "--allow-empty", "-m", "more"]).unwrap();
        assert_eq!(state(), State::Changed);
        let status = git::status(&repo).unwrap();
        let change = status.files[0].submodule.as_ref().unwrap();
        assert!(change.commit && !change.modified && !change.untracked);
        std::fs::write(sub.join("new.txt"), "x").unwrap();
        let status = git::status(&repo).unwrap();
        assert!(status.files[0].submodule.as_ref().unwrap().untracked);
        std::fs::remove_file(sub.join("new.txt")).unwrap();

        git::stage(&repo, &["libs/my lib".into()]).unwrap();
        git::commit(&repo, "bump").unwrap();
        assert_eq!(state(), State::Current);

        // Back to what's recorded.
        git::run(&sub, &["checkout", "-q", "HEAD~1"]).unwrap();
        assert_eq!(state(), State::Changed);
        assert!(update(&repo, Some("nope")).is_err());
        update(&repo, Some("libs/my lib")).unwrap();
        assert_eq!(state(), State::Current);
        assert_eq!(git::open(&sub).unwrap().name, "my lib");

        git::run(&repo, &["submodule", "deinit", "-q", "-f", "--all"]).unwrap();
        assert_eq!(state(), State::Missing);
        update(&repo, None).unwrap();
        assert_eq!(state(), State::Current);
        std::fs::remove_dir_all(base).unwrap();
    }
}
