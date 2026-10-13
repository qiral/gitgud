//! Sign-in to Git hosts other than GitHub (GitLab, Gitea, Forgejo,
//! self-hosted servers, ...) with a personal access token.
//!
//! The list of hosts and each host's token live in the OS keychain, like the
//! GitHub token. A token is only handed to git for URLs under its own host
//! (see `git_env`), so it never reaches another server.

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::git::{GitError, Result};
use crate::github;

const KEYRING_SERVICE: &str = "dev.gitgud.app";
/// Keychain entry holding the list of hosts (no tokens).
const KEYRING_INDEX: &str = "hosts";
const USER_AGENT: &str = concat!("GitGud/", env!("CARGO_PKG_VERSION"));

fn keyring_error(e: keyring::Error) -> GitError {
    GitError::Failed(format!("Could not access the system keychain: {e}"))
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HostKind {
    Gitlab,
    /// Gitea and its fork Forgejo (e.g. Codeberg) share the same API.
    Gitea,
    /// Any other server: the token is used as is, without checking it.
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    /// Normalized base URL, e.g. `https://gitlab.com/`; see `normalize_url`.
    pub url: String,
    pub kind: HostKind,
    /// Username sent to git along with the token.
    pub login: String,
}

// ---------------------------------------------------------------------------
// Keychain

fn index_entry() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_INDEX).map_err(keyring_error)
}

fn token_entry(url: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("host:{url}")).map_err(keyring_error)
}

pub fn list() -> Result<Vec<Host>> {
    match index_entry()?.get_password() {
        Ok(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        Err(keyring::Error::NoEntry) => Ok(Vec::new()),
        Err(e) => Err(keyring_error(e)),
    }
}

fn save_list(hosts: &[Host]) -> Result<()> {
    let entry = index_entry()?;
    if hosts.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keyring_error(e)),
        };
    }
    let json = serde_json::to_string(hosts).expect("serializable");
    entry.set_password(&json).map_err(keyring_error)
}

/// Checks the token with the host (when its API is known), then stores it.
/// Adding a host that is already there replaces its token.
pub fn add(url: &str, kind: HostKind, username: &str, token: &str) -> Result<Host> {
    let url = normalize_url(url)?;
    let token = token.trim();
    if token.is_empty() {
        return Err(GitError::Failed("Enter a token".into()));
    }
    let login = match kind {
        HostKind::Gitlab | HostKind::Gitea => verify(&url, kind, token)?,
        HostKind::Other => match username.trim() {
            "" => return Err(GitError::Failed("Enter your username".into())),
            name => name.to_string(),
        },
    };

    token_entry(&url)?
        .set_password(token)
        .map_err(keyring_error)?;
    let host = Host { url, kind, login };
    let mut hosts = list()?;
    hosts.retain(|h| h.url != host.url);
    hosts.push(host.clone());
    save_list(&hosts)?;
    Ok(host)
}

pub fn remove(url: &str) -> Result<()> {
    match token_entry(url)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(keyring_error(e)),
    }
    let mut hosts = list()?;
    hosts.retain(|h| h.url != url);
    save_list(&hosts)
}

// ---------------------------------------------------------------------------
// URLs

/// Turns what the user typed (`gitlab.example.com`, `https://Git.Example.com/`,
/// `https://example.com/gitlab`) into `https://host[:port][/path]/`.
///
/// The trailing slash matters: git matches `http.<url>.*` settings by path
/// prefix, and `https://example.com/gitlab/` must not also match
/// `https://example.com/gitlab-other/`.
pub fn normalize_url(input: &str) -> Result<String> {
    let input = input.trim();
    let rest = match input.split_once("://") {
        None => input,
        Some((scheme, rest)) if scheme.eq_ignore_ascii_case("https") => rest,
        Some(_) => {
            return Err(GitError::Failed(
                "Only https:// addresses are supported, so the token is never sent unencrypted"
                    .into(),
            ))
        }
    };
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = host.to_ascii_lowercase();
    let valid_host = !host.is_empty()
        && !rest.contains(char::is_whitespace)
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'));
    if !valid_host {
        return Err(GitError::Failed(format!(
            "'{input}' is not a valid address"
        )));
    }
    if host == "github.com" || host == "www.github.com" {
        return Err(GitError::Failed(
            "Use \"Sign in to GitHub\" for github.com".into(),
        ));
    }
    let path = path.trim_matches('/');
    Ok(if path.is_empty() {
        format!("https://{host}/")
    } else {
        format!("https://{host}/{path}/")
    })
}

// ---------------------------------------------------------------------------
// API

#[derive(Deserialize)]
struct ApiUser {
    /// GitLab calls it `username`, Gitea `login`.
    #[serde(alias = "login")]
    username: String,
}

/// Asks the host who the token belongs to and returns that username.
fn verify(url: &str, kind: HostKind, token: &str) -> Result<String> {
    let request = match kind {
        HostKind::Gitlab => ureq::get(format!("{url}api/v4/user")).header("PRIVATE-TOKEN", token),
        HostKind::Gitea => {
            ureq::get(format!("{url}api/v1/user")).header("Authorization", format!("token {token}"))
        }
        HostKind::Other => unreachable!("tokens for other hosts are not checked"),
    };
    let res = request
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
        .config()
        .http_status_as_error(false)
        .build()
        .call()
        .map_err(|e| GitError::Failed(format!("Could not reach {url}: {e}")))?;

    let status = res.status().as_u16();
    if status == 401 || status == 403 {
        return Err(GitError::Failed(format!(
            "{url} rejected the token. Check that it is correct and not expired."
        )));
    }
    if !(200..300).contains(&status) {
        return Err(GitError::Failed(format!(
            "{url} answered with HTTP {status}. Is the address and server type right?"
        )));
    }
    res.into_body()
        .read_json::<ApiUser>()
        .map(|u| u.username)
        .map_err(|_| {
            GitError::Failed(format!(
                "Unexpected answer from {url}. Is the server type right?"
            ))
        })
}

// ---------------------------------------------------------------------------
// git

/// Environment variables that make git authenticate to every signed-in host,
/// GitHub included. Passed via `GIT_CONFIG_*` rather than `-c` so tokens
/// don't show up in the process list.
pub fn git_env() -> Vec<(String, String)> {
    let mut creds = Vec::new();
    if let Some(github) = github::credentials() {
        creds.push(github);
    }
    for host in list().unwrap_or_default() {
        if let Ok(token) =
            token_entry(&host.url).and_then(|e| e.get_password().map_err(keyring_error))
        {
            creds.push((host.url, host.login, token));
        }
    }
    env_for(&creds)
}

/// Builds `GIT_CONFIG_*` variables setting an `Authorization` header for
/// each `(url, username, token)`, scoped to that URL.
fn env_for(creds: &[(String, String, String)]) -> Vec<(String, String)> {
    if creds.is_empty() {
        return Vec::new();
    }
    let mut env = vec![("GIT_CONFIG_COUNT".to_string(), creds.len().to_string())];
    for (i, (url, user, token)) in creds.iter().enumerate() {
        let basic = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{token}"));
        env.push((
            format!("GIT_CONFIG_KEY_{i}"),
            format!("http.{url}.extraHeader"),
        ));
        env.push((
            format!("GIT_CONFIG_VALUE_{i}"),
            format!("Authorization: Basic {basic}"),
        ));
    }
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_what_people_type() {
        let ok = |s| normalize_url(s).unwrap();
        assert_eq!(ok("gitlab.com"), "https://gitlab.com/");
        assert_eq!(
            ok("  https://GitLab.Example.com/  "),
            "https://gitlab.example.com/"
        );
        assert_eq!(ok("HTTPS://example.com:8443"), "https://example.com:8443/");
        assert_eq!(
            ok("https://example.com/gitlab//"),
            "https://example.com/gitlab/"
        );
        assert_eq!(ok("example.com/Git/Lab"), "https://example.com/Git/Lab/");
    }

    #[test]
    fn rejects_unsafe_or_wrong_addresses() {
        for bad in [
            "http://gitlab.com",
            "ssh://git@x.com",
            "",
            "user@host.com",
            "github.com",
        ] {
            assert!(normalize_url(bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn reads_usernames_from_gitlab_and_gitea() {
        let gitlab: ApiUser = serde_json::from_str(r#"{"id":1,"username":"ada"}"#).unwrap();
        let gitea: ApiUser = serde_json::from_str(r#"{"id":1,"login":"bob"}"#).unwrap();
        assert_eq!(
            (gitlab.username.as_str(), gitea.username.as_str()),
            ("ada", "bob")
        );
    }

    #[test]
    fn scopes_each_token_to_its_own_host() {
        let env = env_for(&[
            ("https://github.com/".into(), "octocat".into(), "t1".into()),
            ("https://gitlab.com/".into(), "ada".into(), "t2".into()),
        ]);
        let get = |k: &str| env.iter().find(|(key, _)| key == k).unwrap().1.clone();
        assert_eq!(get("GIT_CONFIG_COUNT"), "2");
        assert_eq!(
            get("GIT_CONFIG_KEY_0"),
            "http.https://github.com/.extraHeader"
        );
        assert_eq!(
            get("GIT_CONFIG_KEY_1"),
            "http.https://gitlab.com/.extraHeader"
        );
        // base64("ada:t2")
        assert_eq!(get("GIT_CONFIG_VALUE_1"), "Authorization: Basic YWRhOnQy");
        assert!(env_for(&[]).is_empty());
    }
}
