//! GitHub Copilot through the official SDK.
//!
//! The SDK drives the `copilot` CLI as a child process. GitGud never bundles
//! it: it uses the one on `PATH`, or downloads the pinned version from npm
//! into its app data folder and checks it against the hashes below.

use std::borrow::Cow;
use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use github_copilot_sdk::{
    CliProgram, Client, ClientMode, ClientOptions, Error as SdkError, ErrorKind, MessageOptions,
    SessionConfig, SessionErrorKind, Transport,
};
use serde::Serialize;
use sha2::{Digest, Sha512};

use tauri::async_runtime::Mutex;

use crate::conflict::{self, Part};
use crate::git::{self, GitError, Result};
use crate::github;

/// The CLI version `github-copilot-sdk` is built against; bump them together.
pub const VERSION: &str = "1.0.112";

/// `dist.integrity` of each `@github/copilot-<platform>` package at
/// [`VERSION`], printed by:
/// `for p in darwin-arm64 darwin-x64 linux-arm64 linux-x64 win32-arm64 win32-x64; do echo "$p $(npm view @github/copilot-$p@VERSION dist.integrity)"; done`
const HASHES: [(&str, &str); 6] = [
    ("darwin-arm64", "sha512-KhEgTlMtHkDWaBWwHGS+17wlsJLOt+rEC4Y5JLQ5QE+nVIgyA8QpEmrf4RuJWs1i9JLLYldtpk8dTyD+LIbM2Q=="),
    ("darwin-x64", "sha512-e+GtWjgen/DyUIFPzT+EHQBG+ck2NW5ouSDYOM4vY6flLbGrchcOfqz6O9E5z3JXvns2EQtZ9W5byFiFbq4XcA=="),
    ("linux-arm64", "sha512-cy6L7HS8A0GcHkrLpDdzS6y5bw/k1gQkCZyf7mxr3jScfXW32D7Cr1aKFomZwNODhIE8CWukBftQAg75UB6Whw=="),
    ("linux-x64", "sha512-uvlB+3hFwrcg2Il+i/amD9jlrDqN1nG0MKRAsXkTCXaVNuW38QS1LLbzN2jNj6CVfuU/dGtulqU93qJzbcJXBQ=="),
    ("win32-arm64", "sha512-S3p5aKbtFmn4B1WTqWswJAgHMqBBvka8nMzx3lhhESm3YtWmI3i4RGWCxzDnaVTtg+Cx1Y6HfNZ/olmSO4lhmA=="),
    ("win32-x64", "sha512-zmWIkGjes2PkBb02+mvC0ZVCeEmVWsTSNac82ffhk7kR7/CicWg5IlhixcgiTc+5TFZSTpVUMHxK9fW0A+l/qQ=="),
];

#[cfg(windows)]
const BINARY: &str = "copilot.exe";
#[cfg(not(windows))]
const BINARY: &str = "copilot";

const USER_AGENT: &str = concat!("GitGud/", env!("CARGO_PKG_VERSION"));

fn io_error(e: std::io::Error) -> GitError {
    GitError::Failed(format!("Could not install the Copilot CLI: {e}"))
}

// ---------------------------------------------------------------------------
// Finding and installing the CLI

/// `PATH` plus the folders Homebrew and GitHub's install script put
/// `copilot` in: apps opened from Finder or the Dock only get
/// `/usr/bin:/bin:/usr/sbin:/sbin`.
// ponytail: fixed folders rather than the login shell's PATH, so nvm/asdf
// installs still fall back to GitGud's own download.
fn search_path(path_var: &OsStr) -> OsString {
    let extra: Vec<PathBuf> = if cfg!(unix) {
        std::env::home_dir()
            .map(|home| home.join(".local/bin"))
            .into_iter()
            .chain(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from))
            .collect()
    } else {
        Vec::new()
    };
    std::env::join_paths(std::env::split_paths(path_var).chain(extra))
        .unwrap_or_else(|_| path_var.to_owned())
}

/// The npm package suffix for this system, e.g. `darwin-arm64`.
fn platform() -> Option<&'static str> {
    Some(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("linux", "aarch64") => "linux-arm64",
        ("linux", "x86_64") => "linux-x64",
        ("windows", "aarch64") => "win32-arm64",
        ("windows", "x86_64") => "win32-x64",
        _ => return None,
    })
}

fn expected_hash(platform: &str) -> Option<&'static str> {
    HASHES
        .iter()
        .find(|(p, _)| *p == platform)
        .map(|(_, hash)| *hash)
}

/// The first `copilot` in `path_var`. On Windows only a real `copilot.exe`
/// counts: npm's `copilot.cmd` shim needs Node.
fn find_on_path(path_var: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(path_var)
        .map(|dir| dir.join(BINARY))
        .find(|bin| bin.is_file())
}

/// The copy [`install`] put in `app_data`, if any.
fn installed(app_data: &Path) -> Option<PathBuf> {
    let bin = app_data.join("copilot").join(VERSION).join(BINARY);
    bin.is_file().then_some(bin)
}

/// Saves the package to a temp file while hashing it, then extracts the
/// binary into `dest_dir` only if the hash is `expected`.
fn unpack(mut tgz: impl Read, expected: &str, dest_dir: &Path) -> Result<PathBuf> {
    let tmp = dest_dir.join(".download");
    let result = (|| {
        let mut file = File::create(&tmp).map_err(io_error)?;
        let mut hasher = Sha512::new();
        let mut buf = vec![0; 64 * 1024];
        loop {
            let n = tgz.read(&mut buf).map_err(io_error)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            file.write_all(&buf[..n]).map_err(io_error)?;
        }
        let actual = format!(
            "sha512-{}",
            base64::engine::general_purpose::STANDARD.encode(hasher.finalize())
        );
        if actual != expected {
            return Err(GitError::Failed(
                "Downloaded Copilot CLI failed verification".into(),
            ));
        }

        let gz = flate2::read::GzDecoder::new(File::open(&tmp).map_err(io_error)?);
        let mut archive = tar::Archive::new(gz);
        let wanted = Path::new("package").join(BINARY);
        for entry in archive.entries().map_err(io_error)? {
            let mut entry = entry.map_err(io_error)?;
            if entry.path().map_err(io_error)? != wanted {
                continue;
            }
            let bin = dest_dir.join(BINARY);
            let mut out = File::create(&bin).map_err(io_error)?;
            std::io::copy(&mut entry, &mut out).map_err(io_error)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                out.set_permissions(std::fs::Permissions::from_mode(0o755))
                    .map_err(io_error)?;
            }
            return Ok(bin);
        }
        Err(GitError::Failed(
            "The Copilot CLI package has no binary".into(),
        ))
    })();
    let _ = std::fs::remove_file(&tmp);
    result
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallProgress {
    pub percent: u8,
}

/// Counts bytes read so [`install`] can report a percentage.
struct Progress<R, F> {
    inner: R,
    read: u64,
    total: Option<u64>,
    last: Option<u8>,
    on_progress: F,
}

impl<R: Read, F: FnMut(u8)> Read for Progress<R, F> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read += n as u64;
        if let Some(total) = self.total.filter(|t| *t > 0) {
            let percent = (self.read * 100 / total).min(100) as u8;
            if self.last != Some(percent) {
                self.last = Some(percent);
                (self.on_progress)(percent);
            }
        }
        Ok(n)
    }
}

/// `stall` bounds connecting and waiting for the server to answer; the body
/// gets a generous total so a dead connection can't hang forever.
fn agent(stall: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(stall))
        .timeout_recv_response(Some(stall))
        .timeout_recv_body(Some(Duration::from_secs(30 * 60)))
        .build()
        .into()
}

/// Downloads the pinned CLI into `app_data` and returns its path. A failed
/// or interrupted download leaves nothing that [`installed`] would pick up.
pub fn install(app_data: &Path, on_progress: impl FnMut(u8)) -> Result<PathBuf> {
    let platform = platform().ok_or_else(|| {
        GitError::Failed("GitHub Copilot CLI isn't available for this system".into())
    })?;
    let expected = expected_hash(platform).expect("every platform has a hash");
    let url = format!(
        "https://registry.npmjs.org/@github/copilot-{platform}/-/copilot-{platform}-{VERSION}.tgz"
    );
    let res = agent(Duration::from_secs(30))
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .call()
        .map_err(|e| GitError::Failed(format!("Could not download the Copilot CLI: {e}")))?;
    let total = res
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok()?.parse().ok());

    let root = app_data.join("copilot");
    let staging = root.join(format!(".{VERSION}-partial"));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(io_error)?;
    let reader = Progress {
        inner: res.into_body().into_reader(),
        read: 0,
        total,
        last: None,
        on_progress,
    };
    let result = unpack(reader, expected, &staging).and_then(|_| {
        let dest = root.join(VERSION);
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::rename(&staging, &dest).map_err(io_error)?;
        Ok(dest.join(BINARY))
    });
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result
}

// ---------------------------------------------------------------------------
// Asking Copilot

/// Error text when no CLI was found; the frontend offers [`install`] on it.
pub const COPILOT_MISSING: &str = "Copilot CLI not installed";

const TIMEOUT: Duration = Duration::from_secs(120);

const SIGN_IN: &str = "Sign in to GitHub to use Copilot";
const SIGNED_OUT: &str =
    "GitHub didn't accept GitGud's sign-in for Copilot. Sign out and sign in again.";
const NO_ACCESS: &str = "This GitHub account can't use Copilot. Check that it has a Copilot \
                         plan (Copilot Free works too) and that your organization allows it.";
const LIMIT: &str =
    "You've reached your Copilot usage limit. Try again later, or check your plan on github.com.";
const OFFLINE: &str = "Couldn't reach GitHub. Check your internet connection and try again.";
const CRASHED: &str = "Copilot stopped unexpectedly. Try again.";

fn error_message(e: &SdkError) -> String {
    let message = e.message().map_or_else(|| e.to_string(), str::to_string);
    // ponytail: the CLI only reports these as text, so match on it; switch to
    // typed errors if the SDK starts exposing them.
    let has = |needles: &[&str]| needles.iter().any(|n| message.contains(n));
    match e.kind() {
        ErrorKind::BinaryNotFound { .. } => COPILOT_MISSING.into(),
        ErrorKind::Session(SessionErrorKind::Timeout(_)) => {
            "Copilot took too long to answer. Try again.".into()
        }
        _ if e.is_transport_failure() => CRASHED.into(),
        _ if has(&["No GitHub OAuth token"]) => SIGN_IN.into(),
        _ if has(&["401 Unauthorized", "Bad credentials", "Authorization error"]) => {
            SIGNED_OUT.into()
        }
        _ if has(&["403 Forbidden", "404 Not Found"]) => NO_ACCESS.into(),
        _ if has(&[
            "429 Too Many Requests",
            "402 Payment Required",
            "rate limit",
            "quota",
        ]) =>
        {
            LIMIT.into()
        }
        _ if has(&[
            "fetch failed",
            "ENOTFOUND",
            "ECONNREFUSED",
            "ETIMEDOUT",
            "EAI_AGAIN",
        ]) =>
        {
            OFFLINE.into()
        }
        _ => format!("Copilot failed: {}", detail(&message)),
    }
}

/// The CLI's own words, without the RPC wrapping around them.
fn detail(message: &str) -> &str {
    let message = message
        .split_once("failed with message: ")
        .map_or(message, |(_, m)| m);
    message
        .strip_prefix("Execution failed: ")
        .and_then(|m| m.split_once(", "))
        .map_or(message, |(_, m)| m)
}

fn sdk_error(e: SdkError) -> GitError {
    GitError::Failed(error_message(&e))
}

/// Sessions run here, so the CLI never sees a repository.
fn work_dir(app_data: &Path) -> Result<PathBuf> {
    let dir = app_data.join("copilot").join("work");
    std::fs::create_dir_all(&dir).map_err(io_error)?;
    Ok(dir)
}

/// GitGud gives the CLI its own settings folder, so the user's MCP servers,
/// plugins and instructions never load, and only the GitGud token signs it in.
fn client_options(bin: PathBuf, app_data: &Path, path_var: &OsStr) -> Result<ClientOptions> {
    let home = app_data.join("copilot").join("home");
    std::fs::create_dir_all(&home).map_err(io_error)?;
    let mut options = ClientOptions::default();
    options.program = CliProgram::Path(bin);
    options.transport = Transport::Stdio;
    options.mode = ClientMode::Empty;
    options.base_directory = Some(home);
    // Otherwise the CLI looks for a `gh` login in the system keychain.
    options.use_logged_in_user = Some(false);
    options.working_directory = work_dir(app_data)?;
    // The same PATH it was found with, so an npm install can find `node`.
    options.env = vec![
        ("COPILOT_AUTO_UPDATE".into(), "false".into()),
        ("PATH".into(), path_var.into()),
    ];
    options.disable_client_telemetry = true;
    Ok(options)
}

/// Starts the CLI on `PATH`, or GitGud's own copy when there is none or it
/// won't start: starting is local, so a failure means that copy is unusable.
async fn start(app_data: &Path, path_var: &OsStr) -> Result<Client> {
    if let Some(bin) = find_on_path(path_var) {
        if let Ok(client) = Client::start(client_options(bin, app_data, path_var)?).await {
            return Ok(client);
        }
    }
    match installed(app_data) {
        Some(bin) => Client::start(client_options(bin, app_data, path_var)?)
            .await
            .map_err(sdk_error),
        None => Err(GitError::Failed(COPILOT_MISSING.into())),
    }
}

/// One single-shot session: no tools, no permissions, no repository.
async fn run(
    client: &Client,
    work_dir: PathBuf,
    prompt: String,
    token: Option<String>,
) -> std::result::Result<Option<String>, SdkError> {
    let mut config = SessionConfig::default().deny_all_permissions();
    config.available_tools = Some(Vec::new());
    config.enable_config_discovery = Some(false);
    config.enable_skills = Some(false);
    config.hooks = Some(false);
    config.working_directory = Some(work_dir);
    config.github_token = token;

    let session = client.create_session(config).await?;
    let reply = session
        .send_and_wait(MessageOptions::new(prompt).with_wait_timeout(TIMEOUT))
        .await;
    let _ = session.disconnect().await;
    // Sessions are saved with the prompt, i.e. the user's code; keep nothing.
    let _ = client.delete_session(session.id()).await;
    Ok(reply?.and_then(|event| event.data["content"].as_str().map(str::to_string)))
}

fn answer(content: Option<String>) -> Result<String> {
    content.ok_or_else(|| GitError::Failed("Copilot didn't answer. Try again.".into()))
}

/// The running client, numbered so a request that saw it fail only drops
/// that one and not a newer client another request already started.
struct Slot<C = Client> {
    generation: u64,
    client: Option<C>,
}

impl<C> Default for Slot<C> {
    fn default() -> Self {
        Slot {
            generation: 0,
            client: None,
        }
    }
}

impl<C> Slot<C> {
    fn forget(&mut self, generation: u64) {
        if self.generation == generation {
            self.client = None;
        }
    }
}

/// The SDK client, started on first use and kept for later requests.
#[derive(Default)]
pub struct Copilot {
    slot: Mutex<Slot>,
}

impl Copilot {
    pub async fn ask(&self, app_data: &Path, prompt: String) -> Result<String> {
        let path_var = search_path(&std::env::var_os("PATH").unwrap_or_default());
        self.ask_with_path(app_data, prompt, &path_var).await
    }

    async fn ask_with_path(
        &self,
        app_data: &Path,
        prompt: String,
        path_var: &OsStr,
    ) -> Result<String> {
        let (generation, client) = {
            let mut slot = self.slot.lock().await;
            if slot.client.is_none() {
                slot.client = Some(start(app_data, path_var).await?);
                slot.generation += 1;
            }
            (slot.generation, slot.client.clone().expect("started above"))
        };
        let token = blocking(github::token)
            .await
            .map_err(|_| GitError::Failed(SIGN_IN.into()))?;
        match run(&client, work_dir(app_data)?, prompt, Some(token)).await {
            Ok(content) => answer(content),
            Err(e) => {
                if e.is_transport_failure() {
                    self.slot.lock().await.forget(generation);
                }
                let message = error_message(&e);
                if message != SIGNED_OUT {
                    return Err(GitError::Failed(message));
                }
                // Copilot turned the token down: was it revoked, or is it
                // Copilot that won't take this account?
                match blocking(github::validate).await? {
                    github::Validation::Expired => {
                        self.slot.lock().await.forget(generation);
                        Err(GitError::Failed(github::SIGNED_OUT.into()))
                    }
                    github::Validation::Valid { .. } => Err(GitError::Failed(NO_ACCESS.into())),
                    _ => Err(GitError::Failed(message)),
                }
            }
        }
    }

    pub async fn stop(&self) {
        if let Some(client) = self.slot.lock().await.client.take() {
            let _ = client.stop().await;
        }
    }

    pub async fn commit_message(&self, app_data: &Path, repo: PathBuf) -> Result<String> {
        let (stat, diff, subjects) = blocking(move || {
            Ok((
                git::staged_stat(&repo)?,
                git::staged_diff(&repo)?,
                git::recent_subjects(&repo, 10)?,
            ))
        })
        .await?;
        if diff.trim().is_empty() {
            return Err(GitError::Failed("Stage some changes first".into()));
        }
        let message = self
            .ask(app_data, commit_prompt(&stat, &diff, &subjects))
            .await?;
        Ok(message.trim().to_string())
    }
}

impl Copilot {
    /// A title and description for a pull request with these commits, made
    /// of everything since `merge_base`. The reply's first line is the title.
    pub async fn pull_request(
        &self,
        app_data: &Path,
        repo: PathBuf,
        merge_base: String,
        commits: Vec<String>,
    ) -> Result<String> {
        let (stat, diff) = blocking(move || {
            Ok((
                git::branch_stat(&repo, &merge_base)?,
                git::branch_diff(&repo, &merge_base)?,
            ))
        })
        .await?;
        let reply = self
            .ask(app_data, pull_request_prompt(&commits, &stat, &diff))
            .await?;
        Ok(reply.trim().to_string())
    }
}

impl Copilot {
    pub async fn explain(&self, app_data: &Path, diff: &str) -> Result<String> {
        let explanation = self.ask(app_data, explain_prompt(diff)).await?;
        Ok(explanation.trim().to_string())
    }
}

impl Copilot {
    /// Suggests merged code for the `index`-th conflict in `path`.
    pub async fn resolve(
        &self,
        app_data: &Path,
        repo: PathBuf,
        path: String,
        index: usize,
    ) -> Result<String> {
        let prompt = blocking(move || {
            let parts = conflict::parse(&git::read_text(&repo, &path)?);
            let at = parts
                .iter()
                .enumerate()
                .filter(|(_, p)| matches!(p, Part::Conflict { .. }))
                .nth(index)
                .map(|(i, _)| i)
                .ok_or_else(|| GitError::Failed("That conflict no longer exists".into()))?;
            let text = |i: Option<usize>| match i.and_then(|i| parts.get(i)) {
                Some(Part::Text { lines }) => lines.as_slice(),
                _ => &[],
            };
            let before = text(at.checked_sub(1));
            let after = text(Some(at + 1));
            Ok(conflict_prompt(
                &path,
                &before[before.len().saturating_sub(CONTEXT)..],
                &parts[at],
                &after[..after.len().min(CONTEXT)],
            ))
        })
        .await?;
        Ok(parse_suggestion(&self.ask(app_data, prompt).await?))
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| GitError::Failed(e.to_string()))?
}

// ---------------------------------------------------------------------------
// Prompts

/// Upper bound for diffs and files sent to Copilot, to keep requests fast
/// and quota-friendly.
const MAX_INPUT: usize = 50_000;

fn cap(text: &str, max: usize) -> Cow<'_, str> {
    if text.len() <= max {
        return Cow::Borrowed(text);
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    Cow::Owned(format!("{}\n[… truncated]", &text[..end]))
}

fn commit_prompt(stat: &str, diff: &str, subjects: &[String]) -> String {
    let mut prompt = String::from(
        "Write a git commit message for the staged changes below.\n\n\
         - First line: a summary under 72 characters.\n\
         - If more explanation helps, add a blank line and a short body.\n\
         - Reply with the commit message only: no code fences, no commentary.\n",
    );
    if !subjects.is_empty() {
        prompt.push_str("- Match the style of this repository's recent commit subjects:\n");
        for subject in subjects {
            prompt.push_str(&format!("  {subject}\n"));
        }
    }
    prompt.push_str(&format!(
        "\nStaged files:\n{stat}\nStaged changes:\n{}",
        cap(diff, MAX_INPUT)
    ));
    prompt
}

fn pull_request_prompt(commits: &[String], stat: &str, diff: &str) -> String {
    let mut prompt = String::from(
        "Write a GitHub pull request title and description for the branch below.\n\n\
         - First line: the title, under 72 characters, no prefix like \"Title:\".\n\
         - Then a blank line and the description in Markdown: what changes and why, \
         as short bullet points; mention anything a reviewer should look at closely.\n\
         - Reply with the title and description only: no code fences around them, \
         no commentary.\n\nCommits, oldest first:\n",
    );
    for message in commits {
        prompt.push_str(&format!("---\n{}\n", message.trim()));
    }
    prompt.push_str(&format!(
        "\nChanged files:\n{stat}\nChanges:\n{}",
        cap(diff, MAX_INPUT)
    ));
    prompt
}

/// Lines of code shown to Copilot on each side of a conflict.
const CONTEXT: usize = 20;

fn conflict_prompt(path: &str, before: &[String], part: &Part, after: &[String]) -> String {
    let Part::Conflict {
        ours_label,
        ours,
        base,
        theirs_label,
        theirs,
        ..
    } = part
    else {
        return String::new();
    };
    let section = |title: &str, lines: &[String]| {
        let mut code = cap(&lines.concat(), MAX_INPUT / 4).into_owned();
        if !code.is_empty() && !code.ends_with('\n') {
            code.push('\n');
        }
        format!("{title}:\n```\n{code}```\n\n")
    };
    let mut prompt = format!(
        "Resolve this merge conflict in {path}. Keep what both sides intended \
         where they don't contradict. Reply with only the merged code that \
         replaces the conflict, in one fenced code block.\n\n"
    );
    prompt.push_str(&section("Code before the conflict", before));
    prompt.push_str(&section(&format!("Ours ({ours_label})"), ours));
    if let Some(base) = base {
        prompt.push_str(&section("Original (common ancestor)", base));
    }
    prompt.push_str(&section(&format!("Theirs ({theirs_label})"), theirs));
    prompt.push_str(&section("Code after the conflict", after));
    prompt
}

/// The first fenced code block of `reply`, or all of it when there is none.
fn parse_suggestion(reply: &str) -> String {
    reply
        .split_once("```")
        .and_then(|(_, rest)| {
            let (_, code) = rest.split_once('\n')?;
            let (code, _) = code.split_once("```")?;
            Some(code.trim_end().to_string())
        })
        .unwrap_or_else(|| reply.trim().to_string())
}

fn explain_prompt(diff: &str) -> String {
    format!(
        "Explain the change below to a developer in a few short paragraphs: what \
         changed and why it likely changed. Don't restate the diff line by line. \
         Plain text, no headings.\n\n{}",
        cap(diff, MAX_INPUT)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use sha2::{Digest, Sha512};

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("gitgud-copilot-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn package(binary: &[u8]) -> Vec<u8> {
        let mut tar = tar::Builder::new(Vec::new());
        let mut header = tar::Header::new_gnu();
        header.set_size(binary.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        tar.append_data(&mut header, format!("package/{BINARY}"), binary)
            .unwrap();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        std::io::Write::write_all(&mut gz, &tar.into_inner().unwrap()).unwrap();
        gz.finish().unwrap()
    }

    fn integrity(bytes: &[u8]) -> String {
        let digest = Sha512::digest(bytes);
        format!(
            "sha512-{}",
            base64::engine::general_purpose::STANDARD.encode(digest)
        )
    }

    #[test]
    fn platform_names_match_npm_packages() {
        let platform = platform().expect("supported platform");
        let arch = match std::env::consts::ARCH {
            "aarch64" => "arm64",
            "x86_64" => "x64",
            other => other,
        };
        assert!(platform.ends_with(arch), "{platform}");
        assert!(expected_hash(platform).unwrap().starts_with("sha512-"));
    }

    #[test]
    fn finds_copilot_on_path() {
        let empty = temp_dir("path-empty");
        let with = temp_dir("path-with");
        std::fs::write(with.join(BINARY), "").unwrap();

        let both = std::env::join_paths([&empty, &with]).unwrap();
        assert_eq!(find_on_path(&both), Some(with.join(BINARY)));
        let none = std::env::join_paths([&empty]).unwrap();
        assert_eq!(find_on_path(&none), None);
    }

    #[test]
    fn missing_cli_is_reported_for_setup() {
        let app_data = temp_dir("missing");
        let empty = std::env::join_paths([&app_data]).unwrap();
        let err = tauri::async_runtime::block_on(Copilot::default().ask_with_path(
            &app_data,
            "hi".into(),
            &empty,
        ))
        .unwrap_err();
        assert_eq!(err.to_string(), COPILOT_MISSING);
    }

    #[test]
    fn error_messages_are_readable() {
        use github_copilot_sdk::{Error, ErrorKind};
        let missing = Error::with_message(
            ErrorKind::BinaryNotFound {
                name: "copilot".into(),
                hint: None,
            },
            "not found",
        );
        assert_eq!(error_message(&missing), COPILOT_MISSING);
        let other = Error::with_message(ErrorKind::InvalidConfig, "bad options");
        assert_eq!(error_message(&other), "Copilot failed: bad options");
    }

    #[test]
    fn cap_leaves_short_text_alone() {
        assert_eq!(cap("short", MAX_INPUT), "short");
    }

    #[test]
    fn cap_truncates_on_a_char_boundary() {
        let long = "é".repeat(30_000);
        let capped = cap(&long, MAX_INPUT);
        assert!(capped.len() <= MAX_INPUT + 20, "{}", capped.len());
        assert!(capped.ends_with("[… truncated]"));
    }

    #[test]
    fn commit_prompt_includes_style_examples() {
        let prompt = commit_prompt("", "+new line", &["fix: typo".into(), "add login".into()]);
        assert!(prompt.contains("fix: typo"));
        assert!(prompt.contains("add login"));
        assert!(prompt.contains("+new line"));
    }

    #[test]
    fn explain_prompt_caps_the_diff() {
        let prompt = explain_prompt(&"+x\n".repeat(100_000));
        assert!(prompt.len() < MAX_INPUT + 2_000, "{}", prompt.len());
        assert!(prompt.contains("[… truncated]"));
    }

    #[test]
    fn parse_suggestion_takes_the_fenced_block() {
        assert_eq!(
            parse_suggestion("Here:\n```rust\nfoo();\nbar();\n```\nDone."),
            "foo();\nbar();"
        );
        assert_eq!(parse_suggestion("  foo();\n"), "foo();");
    }

    #[test]
    fn conflict_prompt_includes_base_when_present() {
        let part = Part::Conflict {
            ours_label: "HEAD".into(),
            ours: vec!["a();\n".into()],
            base: Some(vec!["original();\n".into()]),
            theirs_label: "feature".into(),
            theirs: vec!["b();\n".into()],
            raw: String::new(),
        };
        let prompt = conflict_prompt(
            "src/main.rs",
            &["before();\n".into()],
            &part,
            &["after();\n".into()],
        );
        for expected in [
            "src/main.rs",
            "HEAD",
            "feature",
            "a();",
            "b();",
            "original();",
            "before();",
            "after();",
        ] {
            assert!(prompt.contains(expected), "missing {expected}");
        }
    }

    #[test]
    fn client_uses_gitgud_s_own_copilot_folder() {
        let app_data = temp_dir("home");
        let options = client_options("copilot".into(), &app_data, OsStr::new("/a:/b")).unwrap();
        let home = app_data.join("copilot").join("home");
        assert_eq!(options.base_directory, Some(home.clone()));
        assert!(home.is_dir());
        assert!(options.env_remove.is_empty());
        assert_eq!(options.use_logged_in_user, Some(false));
        assert!(options.env.contains(&("PATH".into(), "/a:/b".into())));
    }

    #[test]
    fn sessions_run_in_gitgud_s_own_folder() {
        let app_data = temp_dir("work");
        let dir = work_dir(&app_data).unwrap();
        assert_eq!(dir, app_data.join("copilot").join("work"));
        assert!(dir.is_dir());
    }

    #[test]
    fn commit_prompt_lists_every_file_even_when_truncated() {
        let stat = " Cargo.lock  | 9000 +++\n src/main.rs |    2 +-\n";
        let prompt = commit_prompt(stat, &"+lock\n".repeat(20_000), &[]);
        assert!(prompt.contains("src/main.rs |    2 +-"));
        assert!(prompt.contains("[… truncated]"));
    }

    #[test]
    fn stalled_downloads_time_out() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let started = std::time::Instant::now();
        let result = agent(Duration::from_millis(200)).get(&url).call();
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
        drop(listener);
    }

    #[test]
    fn a_failed_client_is_forgotten_only_if_still_current() {
        let mut slot = Slot {
            generation: 2,
            client: Some("restarted"),
        };
        slot.forget(1);
        assert_eq!(slot.client, Some("restarted"));
        slot.forget(2);
        assert_eq!(slot.client, None);
    }

    #[test]
    fn an_empty_reply_says_so_plainly() {
        assert_eq!(answer(Some("hi".into())).unwrap(), "hi");
        assert_eq!(
            answer(None).unwrap_err().to_string(),
            "Copilot didn't answer. Try again."
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_copilot_that_wont_start_falls_back_to_setup() {
        use std::os::unix::fs::PermissionsExt;
        let app_data = temp_dir("broken");
        let bin = temp_dir("broken-bin");
        let script = bin.join(BINARY);
        std::fs::write(&script, "#!/usr/bin/env gitgud-no-such-node\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = std::env::join_paths([&bin]).unwrap();
        let err = tauri::async_runtime::block_on(Copilot::default().ask_with_path(
            &app_data,
            "hi".into(),
            &path,
        ))
        .unwrap_err();
        assert_eq!(err.to_string(), COPILOT_MISSING);
    }

    #[cfg(unix)]
    #[test]
    fn searches_where_copilot_usually_lives() {
        let path = search_path(OsStr::new("/first:/second"));
        let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
        assert_eq!(
            dirs[..2],
            [PathBuf::from("/first"), PathBuf::from("/second")]
        );
        for dir in ["/opt/homebrew/bin", "/usr/local/bin"] {
            assert!(dirs.contains(&PathBuf::from(dir)), "missing {dir}");
        }
        let local = std::env::home_dir().unwrap().join(".local/bin");
        assert!(dirs.contains(&local));
    }

    #[test]
    fn explains_common_copilot_errors() {
        use github_copilot_sdk::{Error, ErrorKind};
        let rpc = |message: &str| {
            Error::with_message(ErrorKind::Rpc { code: -32603 }, message.to_string())
        };
        let failed = "Request session.create failed with message: GitHub token validation failed: \
                      Failed to fetch Copilot user info:";
        assert_eq!(
            error_message(&rpc(&format!(
                "{failed} 401 Unauthorized: {{\"message\":\"Bad credentials\"}}"
            ))),
            SIGNED_OUT
        );
        assert_eq!(
            error_message(&rpc(&format!("{failed} 403 Forbidden"))),
            NO_ACCESS
        );
        assert_eq!(
            error_message(&Error::with_message(
                ErrorKind::Session(SessionErrorKind::AgentError),
                "Execution failed: Authorization error. Your credentials may be expired or invalid. (Request ID: C36F)"
            )),
            SIGNED_OUT
        );
        assert_eq!(
            error_message(&rpc(&format!("{failed} 404 Not Found"))),
            NO_ACCESS
        );
        assert_eq!(
            error_message(&rpc("429 Too Many Requests: rate limit exceeded")),
            LIMIT
        );
        assert_eq!(
            error_message(&rpc(
                "TypeError: fetch failed (getaddrinfo ENOTFOUND api.github.com)"
            )),
            OFFLINE
        );
        assert_eq!(
            error_message(&Error::with_message(ErrorKind::Io, "broken pipe")),
            CRASHED
        );
        assert_eq!(
            error_message(&rpc("Request session.create failed with message: boom")),
            "Copilot failed: boom"
        );
        assert_eq!(
            error_message(&Error::with_message(
                ErrorKind::Session(SessionErrorKind::AgentError),
                "Execution failed: InvalidArg, something odd"
            )),
            "Copilot failed: something odd"
        );
    }

    #[test]
    fn rejects_a_tampered_download() {
        let dest = temp_dir("tampered");
        let tgz = package(b"binary");
        let wrong = integrity(b"something else");

        let err = unpack(tgz.as_slice(), &wrong, &dest).unwrap_err();
        assert_eq!(
            err.to_string(),
            "Downloaded Copilot CLI failed verification"
        );
        assert_eq!(std::fs::read_dir(&dest).unwrap().count(), 0);
    }

    #[test]
    fn unpacks_a_verified_download() {
        let dest = temp_dir("verified");
        let tgz = package(b"binary");

        let bin = unpack(tgz.as_slice(), &integrity(&tgz), &dest).unwrap();
        assert_eq!(bin, dest.join(BINARY));
        assert_eq!(std::fs::read(&bin).unwrap(), b"binary");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&bin).unwrap().permissions().mode();
            assert_ne!(mode & 0o100, 0);
        }
    }

    #[test]
    fn installed_looks_in_the_versioned_folder() {
        let app_data = temp_dir("installed");
        assert_eq!(installed(&app_data), None);

        let dir = app_data.join("copilot").join(VERSION);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(BINARY), "").unwrap();
        assert_eq!(installed(&app_data), Some(dir.join(BINARY)));
    }
}
