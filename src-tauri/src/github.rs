//! GitHub sign-in (OAuth device flow), token storage and API calls.
//!
//! The token lives in the OS keychain (Secret Service, macOS Keychain or
//! Windows Credential Manager) and is only handed to git through environment
//! variables, scoped to `https://github.com/` URLs.

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::git::{GitError, Result};

/// Public client ID of the GitGud OAuth App. Device flow needs no secret.
const CLIENT_ID: &str = "Ov23li9VaKu4azd6eO0H";
/// `repo` to push and create repositories, `workflow` to push changes to
/// `.github/workflows`, and read access to the profile for display.
const SCOPES: &str = "repo workflow read:user user:email";
const KEYRING_SERVICE: &str = "dev.gitgud.app";
const KEYRING_USER: &str = "github";
const USER_AGENT: &str = concat!("GitGud/", env!("CARGO_PKG_VERSION"));

fn http_error(e: ureq::Error) -> GitError {
    GitError::Failed(format!("GitHub request failed: {e}"))
}

fn keyring_error(e: keyring::Error) -> GitError {
    GitError::Failed(format!("Could not access the system keychain: {e}"))
}

// ---------------------------------------------------------------------------
// Stored account

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub login: String,
    pub name: Option<String>,
    /// GitHub's API sends `avatar_url`; the keychain copy uses `avatarUrl`.
    #[serde(alias = "avatar_url")]
    pub avatar_url: String,
}

/// What is kept in the keychain. The token never leaves the backend.
#[derive(Serialize, Deserialize)]
struct Stored {
    token: String,
    account: Account,
}

fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(keyring_error)
}

fn load() -> Result<Option<Stored>> {
    match entry()?.get_password() {
        Ok(json) => Ok(serde_json::from_str(&json).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(keyring_error(e)),
    }
}

pub fn account() -> Result<Option<Account>> {
    Ok(load()?.map(|s| s.account))
}

pub fn sign_out() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keyring_error(e)),
    }
}

/// Environment variables that make git authenticate to github.com with the
/// stored token. Passed via `GIT_CONFIG_*` rather than `-c` so the token
/// doesn't show up in the process list.
pub fn git_env() -> Vec<(String, String)> {
    let Ok(Some(stored)) = load() else {
        return Vec::new();
    };
    let basic = base64::engine::general_purpose::STANDARD
        .encode(format!("{}:{}", stored.account.login, stored.token));
    vec![
        ("GIT_CONFIG_COUNT".into(), "1".into()),
        (
            "GIT_CONFIG_KEY_0".into(),
            "http.https://github.com/.extraHeader".into(),
        ),
        (
            "GIT_CONFIG_VALUE_0".into(),
            format!("Authorization: Basic {basic}"),
        ),
    ]
}

// ---------------------------------------------------------------------------
// Device flow

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

pub fn start_sign_in() -> Result<DeviceCode> {
    ureq::post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
        .send_form([("client_id", CLIENT_ID), ("scope", SCOPES)])
        .map_err(http_error)?
        .body_mut()
        .read_json()
        .map_err(http_error)
}

#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum PollResult {
    /// The user hasn't approved yet; poll again after `interval` seconds.
    Pending {
        interval: u64,
    },
    Done {
        account: Account,
    },
    /// The code expired or the user denied access.
    Failed {
        message: String,
    },
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    interval: Option<u64>,
}

pub fn poll_sign_in(device_code: &str, interval: u64) -> Result<PollResult> {
    let res: TokenResponse = ureq::post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
        .send_form([
            ("client_id", CLIENT_ID),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .map_err(http_error)?
        .body_mut()
        .read_json()
        .map_err(http_error)?;

    if let Some(token) = res.access_token {
        let account = fetch_account(&token)?;
        let stored = Stored {
            token,
            account: account.clone(),
        };
        let json = serde_json::to_string(&stored).expect("serializable");
        entry()?.set_password(&json).map_err(keyring_error)?;
        return Ok(PollResult::Done { account });
    }

    Ok(match res.error.as_deref() {
        Some("authorization_pending") => PollResult::Pending { interval },
        // GitHub asks us to back off; it sends the new interval to use.
        Some("slow_down") => PollResult::Pending {
            interval: res.interval.unwrap_or(interval + 5),
        },
        Some("expired_token") => PollResult::Failed {
            message: "The code expired. Please try again.".into(),
        },
        Some("access_denied") => PollResult::Failed {
            message: "Sign-in was cancelled on GitHub.".into(),
        },
        _ => PollResult::Failed {
            message: res
                .error_description
                .or(res.error)
                .unwrap_or_else(|| "Unexpected response from GitHub".into()),
        },
    })
}

// ---------------------------------------------------------------------------
// API

fn api_get(token: &str, path: &str) -> ureq::RequestBuilder<ureq::typestate::WithoutBody> {
    ureq::get(format!("https://api.github.com{path}"))
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", USER_AGENT)
}

fn fetch_account(token: &str) -> Result<Account> {
    api_get(token, "/user")
        .call()
        .map_err(http_error)?
        .body_mut()
        .read_json()
        .map_err(http_error)
}

fn token() -> Result<String> {
    load()?
        .map(|s| s.token)
        .ok_or_else(|| GitError::Failed("Sign in to GitHub first".into()))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct CreatedRepo {
    pub full_name: String,
    pub clone_url: String,
    pub html_url: String,
}

pub fn create_repo(name: &str, description: &str, private: bool) -> Result<CreatedRepo> {
    let res = ureq::post("https://api.github.com/user/repos")
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {}", token()?))
        .header("User-Agent", USER_AGENT)
        .config()
        .http_status_as_error(false)
        .build()
        .send_json(serde_json::json!({
            "name": name,
            "description": description,
            "private": private,
        }))
        .map_err(http_error)?;

    let status = res.status();
    let mut body = res.into_body();
    if status.is_success() {
        return body.read_json().map_err(http_error);
    }

    // GitHub explains validation errors (e.g. name already taken) in the body.
    let detail: serde_json::Value = body.read_json().unwrap_or_default();
    let reason = detail["errors"][0]["message"]
        .as_str()
        .or(detail["message"].as_str())
        .unwrap_or("unknown error");
    Err(GitError::Failed(format!(
        "Could not create repository: {reason}"
    )))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Owner {
    pub login: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct RemoteRepo {
    pub full_name: String,
    pub name: String,
    pub owner: Owner,
    pub description: Option<String>,
    pub private: bool,
    pub fork: bool,
    pub clone_url: String,
    pub updated_at: String,
}

/// Repositories the user owns, collaborates on, or can see through an
/// organization, most recently updated first.
pub fn list_repos() -> Result<Vec<RemoteRepo>> {
    const PER_PAGE: usize = 100;
    // Enough for almost everyone; avoids hammering the API for huge orgs.
    const MAX_PAGES: usize = 10;

    let token = token()?;
    let mut repos = Vec::new();
    for page in 1..=MAX_PAGES {
        let batch: Vec<RemoteRepo> = api_get(
            &token,
            &format!("/user/repos?sort=updated&per_page={PER_PAGE}&page={page}"),
        )
        .call()
        .map_err(http_error)?
        .body_mut()
        .read_json()
        .map_err(http_error)?;
        let done = batch.len() < PER_PAGE;
        repos.extend(batch);
        if done {
            break;
        }
    }
    Ok(repos)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_account_from_github_and_from_the_keychain() {
        // Trimmed GET /user response.
        let api = r#"{"login":"octocat","id":1,"avatar_url":"https://a/1","name":null}"#;
        let account: Account = serde_json::from_str(api).unwrap();
        assert_eq!(account.avatar_url, "https://a/1");

        let stored = Stored {
            token: "t".into(),
            account,
        };
        let json = serde_json::to_string(&stored).unwrap();
        assert!(json.contains("avatarUrl"), "the frontend reads camelCase");
        let back: Stored = serde_json::from_str(&json).unwrap();
        assert_eq!(back.account.login, "octocat");
    }
}
