//! GitHub sign-in (OAuth device flow), token storage and API calls.
//!
//! The token lives in the OS keychain (Secret Service, macOS Keychain or
//! Windows Credential Manager) and is only handed to git through environment
//! variables, scoped to `https://github.com/` URLs (see `hosts::git_env`).

use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::cache::Cached;
use crate::git::{GitError, Result};

/// Public client ID of the GitGud OAuth App. Device flow needs no secret.
const CLIENT_ID: &str = "Ov23li9VaKu4azd6eO0H";
/// `repo` to push and create repositories, `workflow` to push changes to
/// `.github/workflows`, and read access to the profile for display.
const SCOPES: &str = "repo workflow";
const KEYRING_SERVICE: &str = "dev.gitgud.app";
const KEYRING_USER: &str = "github";
pub(crate) const USER_AGENT: &str = concat!("GitGud/", env!("CARGO_PKG_VERSION"));

/// Error text when GitHub no longer accepts the stored token; the frontend
/// shows the user as signed out on it.
pub const SIGNED_OUT: &str = "Your GitHub sign-in expired or was revoked. Sign in again.";

pub(crate) fn http_error(e: ureq::Error) -> GitError {
    GitError::Failed(format!("GitHub request failed: {e}"))
}

/// Like [`http_error`], for a request sent with the stored `token`: a 401
/// means GitHub no longer accepts it.
pub(crate) fn token_error(e: ureq::Error, token: &str) -> GitError {
    match e {
        ureq::Error::StatusCode(401) => signed_out(token),
        e => http_error(e),
    }
}

/// For a request GitHub turned down with 401: forgets `token` if it's
/// still the stored one, and says so.
pub(crate) fn signed_out(token: &str) -> GitError {
    if forget_if(token) {
        GitError::Failed(SIGNED_OUT.into())
    } else {
        GitError::Failed("GitHub turned the request down. Try again.".into())
    }
}

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Lets GitGud tell the frontend when it forgets a rejected sign-in.
pub fn set_app(app: tauri::AppHandle) {
    let _ = APP.set(app);
}

fn keyring_error(e: keyring::Error) -> GitError {
    GitError::Failed(format!("Could not access the system keychain: {e}"))
}

// ---------------------------------------------------------------------------
// Stored account

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub login: String,
    pub name: Option<String>,
    /// GitHub's API sends `avatar_url`; the keychain copy uses `avatarUrl`.
    #[serde(alias = "avatar_url")]
    pub avatar_url: String,
}

/// What is kept in the keychain. The token never leaves the backend.
#[derive(Clone, Serialize, Deserialize)]
struct Stored {
    token: String,
    account: Account,
}

/// The keychain is read once per run: each read can ask for the user's
/// password on macOS.
static STORED: Cached<Option<Stored>> = Cached::new();

/// Held while the cache and the keychain are changed together, so two
/// changes can't interleave and leave them disagreeing.
static WRITING: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn writing() -> std::sync::MutexGuard<'static, ()> {
    WRITING.lock().unwrap_or_else(|e| e.into_inner())
}

fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(keyring_error)
}

fn load() -> Result<Option<Stored>> {
    STORED.get_or_load(|| match entry()?.get_password() {
        Ok(json) => Ok(serde_json::from_str(&json).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(keyring_error(e)),
    })
}

fn save(stored: Stored) -> Result<()> {
    let json = serde_json::to_string(&stored).expect("serializable");
    let _writing = writing();
    entry()?.set_password(&json).map_err(keyring_error)?;
    STORED.set(Some(stored));
    Ok(())
}

pub fn account() -> Result<Option<Account>> {
    Ok(load()?.map(|s| s.account.clone()))
}

pub fn sign_out() -> Result<()> {
    let _writing = writing();
    STORED.set(None);
    delete()
}

fn delete() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keyring_error(e)),
    }
}

/// Forgets the sign-in if its token is still `rejected`, so a late answer
/// about an old token can't remove a newer sign-in. Returns whether it did,
/// and tells the frontend.
fn forget_if(rejected: &str) -> bool {
    let writing = writing();
    let forgot = STORED.replace_if(
        |stored| stored.as_ref().is_some_and(|s| s.token == rejected),
        None,
    );
    if forgot {
        let _ = delete();
        drop(writing);
        if let Some(app) = APP.get() {
            let _ = app.emit("github-signed-out", ());
        }
    }
    forgot
}

/// `(url, username, token)` for git, scoped to `https://github.com/`.
/// See `hosts::git_env`, which hands it to git.
pub fn credentials() -> Option<(String, String, String)> {
    let stored = load().ok()??;
    Some((
        "https://github.com/".into(),
        stored.account.login.clone(),
        stored.token.clone(),
    ))
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
        save(Stored {
            token,
            account: account.clone(),
        })?;
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

pub(crate) fn api_get(
    token: &str,
    path: &str,
) -> ureq::RequestBuilder<ureq::typestate::WithoutBody> {
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

/// What GitHub says about the stored sign-in.
#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Validation {
    SignedOut,
    #[serde(rename_all = "camelCase")]
    Valid {
        account: Account,
        /// Scopes GitGud asks for that the token doesn't have, e.g. after
        /// GitGud started asking for a new one.
        missing_scopes: Vec<String>,
    },
    /// GitHub rejected the token; it has been forgotten.
    Expired,
    /// GitHub couldn't be asked, e.g. offline. The sign-in is kept.
    Unreachable,
}

/// `SCOPES` the `X-OAuth-Scopes` header doesn't list.
fn missing_scopes(granted: &str) -> Vec<String> {
    let granted: Vec<&str> = granted.split(',').map(str::trim).collect();
    SCOPES
        .split(' ')
        .filter(|scope| !granted.contains(scope))
        .map(str::to_string)
        .collect()
}

/// Asks GitHub whether the stored token still works, without signing out
/// when GitHub can't be reached.
pub fn validate() -> Result<Validation> {
    let Some(stored) = load()? else {
        return Ok(Validation::SignedOut);
    };
    let res = match api_get(&stored.token, "/user")
        .config()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .call()
    {
        Ok(res) => res,
        Err(_) => return Ok(Validation::Unreachable),
    };
    match res.status().as_u16() {
        401 => {
            forget_if(&stored.token);
            Ok(Validation::Expired)
        }
        200 => {
            // Without the header (e.g. a proxy dropped it) there's nothing to check.
            let missing = res
                .headers()
                .get("x-oauth-scopes")
                .and_then(|v| v.to_str().ok())
                .map(missing_scopes)
                .unwrap_or_default();
            let account: Account = res.into_body().read_json().map_err(http_error)?;
            if account != stored.account {
                let updated = Stored {
                    token: stored.token.clone(),
                    account: account.clone(),
                };
                let _writing = writing();
                let still_current = STORED.replace_if(
                    |s| s.as_ref().is_some_and(|s| s.token == stored.token),
                    Some(updated.clone()),
                );
                if still_current {
                    let json = serde_json::to_string(&updated).expect("serializable");
                    entry()?.set_password(&json).map_err(keyring_error)?;
                }
            }
            Ok(Validation::Valid {
                account,
                missing_scopes: missing,
            })
        }
        _ => Ok(Validation::Unreachable),
    }
}

pub(crate) fn token() -> Result<String> {
    load()?
        .map(|s| s.token.clone())
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
    let token = token()?;
    let res = ureq::post("https://api.github.com/user/repos")
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {token}"))
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
    if status == 401 {
        return Err(signed_out(&token));
    }
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
        .map_err(|e| token_error(e, &token))?
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
    fn spots_missing_scopes() {
        assert!(missing_scopes("repo, workflow").is_empty());
        assert!(
            missing_scopes("repo, workflow, read:user, user:email").is_empty(),
            "older sign-ins asked for more"
        );
        assert_eq!(missing_scopes("repo, read:user"), ["workflow"]);
        assert_eq!(missing_scopes(""), ["repo", "workflow"]);
    }

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
