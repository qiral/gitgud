//! Sign-in to Git hosts other than GitHub (GitLab, Gitea, Forgejo,
//! self-hosted servers, ...) with a personal access token.
//!
//! The list of hosts and each host's token live in the OS keychain, like the
//! GitHub token. A token is only handed to git for URLs under its own host
//! (see `git_env`), so it never reaches another server.

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::cache::Cached;
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

/// Read from the keychain once per run, like the GitHub sign-in.
static HOSTS: Cached<Vec<Host>> = Cached::new();
/// `(url, username, token)` for each host, for `git_env`.
static CREDENTIALS: Cached<Vec<(String, String, String)>> = Cached::new();

pub fn list() -> Result<Vec<Host>> {
    HOSTS.get_or_load(|| match index_entry()?.get_password() {
        Ok(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        Err(keyring::Error::NoEntry) => Ok(Vec::new()),
        Err(e) => Err(keyring_error(e)),
    })
}

fn save_list(hosts: &[Host]) -> Result<()> {
    let entry = index_entry()?;
    let saved = if hosts.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keyring_error(e)),
        }
    } else {
        let json = serde_json::to_string(hosts).expect("serializable");
        entry.set_password(&json).map_err(keyring_error)
    };
    HOSTS.set(hosts.to_vec());
    // Last, so credentials are never rebuilt from the old list.
    CREDENTIALS.clear();
    saved
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
        HostKind::Gitlab => ureq::get(format!("{url}api/v4/user"))
            .header("Authorization", format!("Bearer {token}")),
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
        // The token is only for the address the user typed, never wherever
        // that server sends us next.
        .max_redirects(0)
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

/// [`git_env_for`] the remotes of `repo`.
pub fn git_env_for_repo(repo: &std::path::Path) -> Vec<(String, String)> {
    git_env_for(&crate::git::remote_urls(repo).unwrap_or_default())
}

/// Environment variables that make git authenticate to the signed-in hosts,
/// GitHub included, that `remotes` point at, and no others: hooks and
/// filters git starts see this environment too. Passed via `GIT_CONFIG_*`
/// rather than `-c` so tokens don't show up in the process list.
pub fn git_env_for(remotes: &[String]) -> Vec<(String, String)> {
    let mut creds = Vec::new();
    if let Some(github) = github::credentials() {
        creds.push(github);
    }
    creds.extend(
        CREDENTIALS
            .get_or_load(|| {
                let mut creds = Vec::new();
                for host in list()? {
                    match token_entry(&host.url)?.get_password() {
                        Ok(token) => creds.push((host.url, host.login, token)),
                        Err(keyring::Error::NoEntry) => {}
                        // Not cached, so a denied keychain prompt is asked again.
                        Err(e) => return Err(keyring_error(e)),
                    }
                }
                Ok(creds)
            })
            .unwrap_or_default(),
    );
    env_for(&for_remotes(&creds, remotes))
}

/// The credentials whose URL covers one of `remotes`.
fn for_remotes(
    creds: &[(String, String, String)],
    remotes: &[String],
) -> Vec<(String, String, String)> {
    let remotes: Vec<String> = remotes.iter().filter_map(|r| comparable(r)).collect();
    creds
        .iter()
        .filter(|(url, _, _)| {
            comparable(url).is_some_and(|url| remotes.iter().any(|r| r.starts_with(&url)))
        })
        .cloned()
        .collect()
}

/// An http(s) URL with the scheme and host lowercased and any `user@`
/// dropped, the way git compares `http.<url>` settings.
fn comparable(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return None;
    }
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host)
        .to_ascii_lowercase();
    Some(format!("{scheme}://{host}/{path}"))
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
    fn only_the_hosts_a_command_talks_to_get_their_tokens() {
        let cred = |url: &str| {
            (
                url.to_string(),
                "me".to_string(),
                format!("token-for-{url}"),
            )
        };
        let creds = [
            cred("https://github.com/"),
            cred("https://gitlab.example.com/"),
            cred("https://example.org/git/"),
        ];
        let urls = |targets: &[&str]| {
            for_remotes(
                &creds,
                &targets.iter().map(|t| t.to_string()).collect::<Vec<_>>(),
            )
            .into_iter()
            .map(|(url, _, _)| url)
            .collect::<Vec<_>>()
        };
        assert_eq!(
            urls(&["https://GitHub.com/qiral/gitgud.git"]),
            ["https://github.com/"]
        );
        assert_eq!(
            urls(&["https://me@gitlab.example.com/a/b.git"]),
            ["https://gitlab.example.com/"]
        );
        assert_eq!(
            urls(&["https://example.org/git/repo.git"]),
            ["https://example.org/git/"]
        );
        assert!(urls(&["https://example.org/other/repo.git"]).is_empty());
        assert!(
            urls(&["git@github.com:qiral/gitgud.git"]).is_empty(),
            "ssh needs no token"
        );
        assert!(urls(&["https://github.com.evil.example/x.git"]).is_empty());
        assert!(urls(&[]).is_empty());
    }

    /// Answers one request with `response` and reports what it was sent.
    fn serve_once(response: String) -> (String, std::sync::mpsc::Receiver<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = format!("http://{}/", listener.local_addr().unwrap());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let _ = tx.send(String::from_utf8_lossy(&buf[..n]).into_owned());
                let _ = stream.write_all(response.as_bytes());
            }
        });
        (addr, rx)
    }

    #[test]
    fn a_redirect_never_carries_a_token_to_another_host() {
        let ok = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 17\r\nConnection: close\r\n\r\n{\"username\":\"x\"}";
        for kind in [HostKind::Gitlab, HostKind::Gitea] {
            let (other, seen_by_other) = serve_once(ok.to_string());
            let (first, _) = serve_once(format!(
                "HTTP/1.1 302 Found\r\nLocation: {other}api/v4/user\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            ));
            assert!(verify(&first, kind, "secret-token").is_err(), "{kind:?}");
            let leaked = seen_by_other
                .recv_timeout(std::time::Duration::from_millis(300))
                .is_ok_and(|request| request.contains("secret-token"));
            assert!(!leaked, "{kind:?} sent the token to the other host");
        }
    }

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
