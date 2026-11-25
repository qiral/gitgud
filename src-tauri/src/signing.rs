//! Signing commits with GPG or SSH, and checking signatures.
//!
//! Signing itself is git's: it follows `commit.gpgsign`, `gpg.format` and
//! `user.signingkey` for every command that makes commits. This module edits
//! those settings for one repository, explains failures, and checks the
//! signatures History shows.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::appimage;
use crate::git::{self, check_hash, GitError, Result};

/// Checked in one call at most.
const MAX_CHECKED: usize = 200;

fn get(repo: &Path, args: &[&str]) -> Option<String> {
    let mut all = vec!["config"];
    all.extend_from_slice(args);
    let out = git::output(repo, &all).ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !text.is_empty()).then_some(text)
}

// ---------------------------------------------------------------------------
// Settings

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Key {
    /// "openpgp" or "ssh".
    pub format: String,
    /// What `user.signingkey` is set to.
    pub value: String,
    pub label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
    /// "openpgp", "ssh" or "x509".
    pub format: String,
    /// None lets git pick a key by the committer's email.
    pub key: Option<String>,
    /// Keys found on this computer.
    pub keys: Vec<Key>,
}

pub fn settings(repo: &Path) -> Settings {
    let mut keys = gpg_keys(repo);
    keys.extend(ssh_keys());
    Settings {
        enabled: get(repo, &["--type=bool", "--get", "commit.gpgsign"]).as_deref() == Some("true"),
        format: get(repo, &["--get", "gpg.format"]).unwrap_or_else(|| "openpgp".into()),
        key: get(repo, &["--get", "user.signingkey"]),
        keys,
    }
}

/// Turns signing on or off for this repository only. Without a key, git picks
/// one by the committer's email.
pub fn set(repo: &Path, enabled: bool, format: &str, key: Option<&str>) -> Result<()> {
    if !matches!(format, "openpgp" | "ssh" | "x509") {
        return Err(GitError::Failed(format!(
            "Unknown signature format: {format}"
        )));
    }
    let key = key.map(str::trim).filter(|k| !k.is_empty());
    if key.is_some_and(|k| k.starts_with('-') || k.contains(['\n', '\r', '\0'])) {
        return Err(GitError::Failed("That isn't a key".into()));
    }
    if enabled && format == "ssh" && key.is_none() {
        return Err(GitError::Failed("Choose an SSH key to sign with".into()));
    }
    let local =
        |name: &str, value: &str| git::run(repo, &["config", "--local", name, value]).map(drop);
    if enabled {
        local("gpg.format", format)?;
        match key {
            Some(key) => local("user.signingkey", key)?,
            // Exits with 5 when it isn't set.
            None => drop(git::output(
                repo,
                &["config", "--local", "--unset-all", "user.signingkey"],
            )?),
        }
    }
    local("commit.gpgsign", if enabled { "true" } else { "false" })
}

fn gpg_keys(repo: &Path) -> Vec<Key> {
    let Ok(mut cmd) = program(&trusted_program(repo, "gpg.program", "gpg")) else {
        return Vec::new();
    };
    cmd.args(["--batch", "--list-secret-keys", "--with-colons"]);
    match cmd.output() {
        Ok(out) => parse_gpg_keys(&String::from_utf8_lossy(&out.stdout)),
        Err(_) => Vec::new(),
    }
}

/// Parses `gpg --list-secret-keys --with-colons`, skipping keys that can't
/// sign anymore.
fn parse_gpg_keys(raw: &str) -> Vec<Key> {
    let mut keys = Vec::new();
    let mut id: Option<String> = None;
    for line in raw.lines() {
        let f: Vec<&str> = line.split(':').collect();
        match f[0] {
            "sec" => {
                let usable = !matches!(f.get(1), Some(&("r" | "e" | "i" | "d")))
                    && f.get(11).is_some_and(|c| c.contains('S'));
                id = f
                    .get(4)
                    .filter(|k| usable && !k.is_empty())
                    .map(|k| k.to_string());
            }
            // The first user id names the key.
            "uid" => {
                if let (Some(key), Some(name)) = (id.take(), f.get(9)) {
                    keys.push(Key {
                        format: "openpgp".into(),
                        label: format!("{} ({key})", name.replace("\\x3a", ":")),
                        value: key,
                    });
                }
            }
            _ => {}
        }
    }
    keys
}

fn home() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(PathBuf::from)
}

/// The public keys in `~/.ssh` as (file, content).
fn ssh_public_keys() -> Vec<(PathBuf, String)> {
    let Some(entries) = home().and_then(|h| std::fs::read_dir(h.join(".ssh")).ok()) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "pub"))
        .collect();
    files.sort();
    files
        .into_iter()
        .filter_map(|p| {
            let text = std::fs::read_to_string(&p).ok()?.trim().to_string();
            let kind = text.split_whitespace().next()?;
            // Certificates and anything else aren't keys to sign with.
            let key = ["ssh-", "ecdsa-", "sk-"]
                .iter()
                .any(|s| kind.starts_with(s));
            (key && !kind.contains("-cert-") && text.lines().count() == 1).then_some((p, text))
        })
        .collect()
}

fn ssh_keys() -> Vec<Key> {
    ssh_public_keys()
        .into_iter()
        .map(|(path, text)| {
            let file = path.file_name().unwrap_or_default().to_string_lossy();
            let comment = text.splitn(3, ' ').nth(2).unwrap_or_default();
            Key {
                format: "ssh".into(),
                label: if comment.is_empty() {
                    file.into_owned()
                } else {
                    format!("{file} ({comment})")
                },
                value: path.to_string_lossy().into_owned(),
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Failures

const UNSIGNED: &str = "The commit couldn't be signed.";

/// Whether git stopped because it couldn't sign, see [`explain`].
pub fn is_failure(e: &GitError) -> bool {
    matches!(e, GitError::Failed(m) if m.starts_with(UNSIGNED))
}

/// Turns git's message about a commit it couldn't sign into something to act
/// on; None for any other failure.
pub fn explain(stderr: &str) -> Option<String> {
    let has = |text: &str| stderr.contains(text);
    if !has("failed to write commit object") && !has("failed to sign") {
        return None;
    }
    let hint = if has("No secret key") || has("secret key not available") {
        "gpg has no secret key for it. Pick another key in Commit signing."
    } else if has("No pinentry") || has("Inappropriate ioctl") || has("Screen or window too small")
    {
        "gpg couldn't ask for your passphrase. Install a graphical pinentry, or unlock the key in a terminal first."
    } else if has("Operation cancelled") || has("Operation canceled") {
        "The passphrase wasn't entered."
    } else if has("Bad passphrase") || has("incorrect passphrase") {
        "The passphrase is wrong, or the SSH key isn't loaded. Add it with ssh-add and try again."
    } else if has("can't connect to the agent")
        || has("No agent running")
        || has("Couldn't get agent socket")
    {
        "The agent that holds the key isn't running."
    } else if has("No private key found") || has("No such file") || has("Couldn't load public key")
    {
        "The SSH key wasn't found, or isn't loaded in the SSH agent."
    } else if has("cannot run") || has("cannot exec") {
        "The program that signs (gpg or ssh-keygen) isn't installed."
    } else if has("user.signingkey") || has("defaultKeyCommand") {
        "No key is set. Pick one in Commit signing."
    } else {
        // "failed to write commit object" alone can be a full disk.
        if !has("sign") && !has("gpg") {
            return None;
        }
        "See git's message below."
    };
    Some(format!("{UNSIGNED} {hint}\n\n{}", stderr.trim()))
}

// ---------------------------------------------------------------------------
// Checking

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum State {
    /// Good, by a key that's trusted here.
    Verified,
    /// Signed, but this computer can't tell whether it's good: the key is
    /// missing, not trusted or expired.
    Unknown,
    /// Doesn't match the commit, or the key was revoked.
    Bad,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Signature {
    pub state: State,
    /// "openpgp", "ssh" or "x509".
    pub format: String,
    /// Who signed, as far as it's known.
    pub signer: Option<String>,
    /// The key's id or fingerprint.
    pub key: Option<String>,
}

/// A setting that names a program or a list of trusted keys, from the user's
/// own config. The repository's could run anything, or vouch for itself, just
/// because GitGud looked at its history.
fn trusted(repo: &Path, name: &str) -> Option<String> {
    ["--global", "--system"]
        .iter()
        .find_map(|scope| get(repo, &[scope, "--includes", "--type=path", "--get", name]))
}

fn trusted_program(repo: &Path, name: &str, default: &str) -> String {
    trusted(repo, name).unwrap_or_else(|| default.into())
}

fn program(name: &str) -> Result<Command> {
    let path = if Path::new(name).is_absolute() {
        PathBuf::from(name)
    } else {
        let file = if cfg!(windows) && !name.ends_with(".exe") {
            format!("{name}.exe")
        } else {
            name.to_string()
        };
        git::find_on_path(&std::env::var_os("PATH").unwrap_or_default(), &file)
            .ok_or_else(|| GitError::Failed(format!("{name} isn't installed")))?
    };
    let mut cmd = Command::new(path);
    appimage::clean_env(&mut cmd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(cmd)
}

/// The keys SSH signatures are checked against: the user's own list, or
/// without one the keys in `~/.ssh`, written to `data`.
fn allowed_signers(repo: &Path, data: &Path) -> Option<String> {
    if let Some(list) = trusted(repo, "gpg.ssh.allowedSignersFile") {
        return Some(list);
    }
    let email = get(repo, &["--global", "--get", "user.email"])
        .filter(|e| !e.contains([' ', ',', '"', '*', '?', '!']))
        .unwrap_or_else(|| "you".into());
    let lines: String = ssh_public_keys()
        .iter()
        .map(|(_, key)| format!("{email} namespaces=\"git\" {key}\n"))
        .collect();
    let file = data.join("allowed_signers");
    // Not rewritten each time: another check may be reading it.
    if std::fs::read_to_string(&file).ok().as_deref() != Some(lines.as_str()) {
        std::fs::create_dir_all(data).ok()?;
        std::fs::write(&file, lines).ok()?;
    }
    Some(file.to_string_lossy().into_owned())
}

/// Signatures of those of `hashes` that have one. `data` is a folder of the
/// app's own.
pub fn check(repo: &Path, hashes: &[String], data: &Path) -> Result<HashMap<String, Signature>> {
    let hashes = &hashes[..hashes.len().min(MAX_CHECKED)];
    for hash in hashes {
        check_hash(hash)?;
    }
    if hashes.is_empty() {
        return Ok(HashMap::new());
    }
    // Finding them first is cheap; checking starts a program for each.
    let mut args = vec!["rev-list", "--header", "--no-walk=unsorted"];
    args.extend(hashes.iter().map(String::as_str));
    let signed = formats(&git::run(repo, &args)?);
    if signed.is_empty() {
        return Ok(HashMap::new());
    }

    let settings = [
        format!(
            "gpg.program={}",
            trusted_program(repo, "gpg.program", "gpg")
        ),
        format!(
            "gpg.openpgp.program={}",
            trusted(repo, "gpg.openpgp.program").unwrap_or_else(|| trusted_program(
                repo,
                "gpg.program",
                "gpg"
            ))
        ),
        format!(
            "gpg.x509.program={}",
            trusted_program(repo, "gpg.x509.program", "gpgsm")
        ),
        format!(
            "gpg.ssh.program={}",
            trusted_program(repo, "gpg.ssh.program", "ssh-keygen")
        ),
        format!(
            "gpg.ssh.allowedSignersFile={}",
            allowed_signers(repo, data).unwrap_or_default()
        ),
        format!(
            "gpg.ssh.revocationFile={}",
            trusted(repo, "gpg.ssh.revocationFile").unwrap_or_default()
        ),
        "gpg.minTrustLevel=undefined".to_string(),
    ];
    let mut args = Vec::new();
    for s in &settings {
        args.extend(["-c", s.as_str()]);
    }
    args.extend([
        "log",
        "--no-walk=unsorted",
        "--format=%H%x1f%G?%x1f%GS%x1f%GK%x1e",
    ]);
    args.extend(signed.keys().map(String::as_str));
    Ok(parse(&git::run(repo, &args)?, &signed))
}

/// The signature formats in `git rev-list --header` output, by commit.
fn formats(raw: &str) -> HashMap<String, String> {
    raw.split('\0')
        .filter_map(|record| {
            let (hash, rest) = record.trim_start_matches('\n').split_once('\n')?;
            // The message starts after the first empty line.
            let headers = rest.split("\n\n").next()?;
            let signature = headers
                .lines()
                .find(|l| l.starts_with("gpgsig ") || l.starts_with("gpgsig-sha256 "))?;
            let format = if signature.contains("SSH SIGNATURE") {
                "ssh"
            } else if signature.contains("SIGNED MESSAGE") {
                "x509"
            } else {
                "openpgp"
            };
            Some((hash.to_string(), format.to_string()))
        })
        .collect()
}

fn parse(raw: &str, signed: &HashMap<String, String>) -> HashMap<String, Signature> {
    raw.split('\x1e')
        .filter_map(|record| {
            let f: Vec<&str> = record.trim_start_matches('\n').split('\x1f').collect();
            let [hash, code, signer, key] = f[..] else {
                return None;
            };
            let text = |s: &str| (!s.trim().is_empty()).then(|| s.trim().to_string());
            let state = match code {
                "G" => State::Verified,
                "B" | "R" => State::Bad,
                _ => State::Unknown,
            };
            Some((
                hash.to_string(),
                Signature {
                    state,
                    format: signed.get(hash)?.clone(),
                    signer: text(signer),
                    key: text(key),
                },
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gitgud-sign-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("repo")).unwrap();
        let repo = dir.join("repo");
        git::run(&repo, &["init", "-q", "-b", "main"]).unwrap();
        for (k, v) in [
            ("user.name", "T"),
            ("user.email", "t@x"),
            ("commit.gpgsign", "false"),
        ] {
            git::run(&repo, &["config", k, v]).unwrap();
        }
        dir
    }

    fn commit(repo: &Path, file: &str) -> Result<String> {
        std::fs::write(repo.join(file), file).unwrap();
        git::stage(repo, &[file.into()]).unwrap();
        git::commit(repo, file)?;
        git::resolve_commit(repo, "HEAD")
    }

    #[test]
    fn reads_gpg_keys() {
        let raw = "sec:u:255:22:AAAA1111BBBB2222:1600000000:::u:::scSC:::+::ed25519:::0:\n\
                   fpr:::::::::F00:\n\
                   uid:u::::1600000000::X::Grace \\x3a <g@x>::::::::::0:\n\
                   uid:u::::1600000000::X::Other <o@x>::::::::::0:\n\
                   ssb:u:255:18:CCCC:::::::e:::+::cv25519::\n\
                   sec:r:255:22:DEAD:1600000000:::u:::scSC:::+::ed25519:::0:\n\
                   uid:r::::1600000000::X::Revoked <r@x>::::::::::0:\n";
        assert_eq!(
            parse_gpg_keys(raw),
            [Key {
                format: "openpgp".into(),
                value: "AAAA1111BBBB2222".into(),
                label: "Grace : <g@x> (AAAA1111BBBB2222)".into(),
            }]
        );
    }

    #[test]
    fn finds_signed_commits_by_their_headers() {
        let raw = "aaa\ntree t\ngpgsig -----BEGIN SSH SIGNATURE-----\n x\n\n    subject\n\0\
                   bbb\ntree t\n\n    gpgsig -----BEGIN PGP SIGNATURE-----\n\0\
                   ccc\ntree t\ngpgsig -----BEGIN PGP SIGNATURE-----\n x\n\n    m\n\0";
        let found = formats(raw);
        assert_eq!(found.len(), 2);
        assert_eq!(found["aaa"], "ssh");
        assert_eq!(found["ccc"], "openpgp");
    }

    #[test]
    fn explains_signing_failures_only() {
        let gpg = "error: gpg failed to sign the data:\ngpg: signing failed: No pinentry\n\
                   fatal: failed to write commit object";
        assert!(explain(gpg).unwrap().contains("graphical pinentry"));
        let ssh = "error: Load key \"/k\": incorrect passphrase supplied to decrypt private key?\n\
                   fatal: failed to write commit object";
        assert!(explain(ssh).unwrap().contains("ssh-add"));
        assert_eq!(explain("fatal: failed to write commit object"), None);
        assert_eq!(explain("error: pathspec 'x' did not match"), None);
    }

    #[test]
    fn signs_with_ssh_and_checks_it() {
        let dir = scratch("ssh");
        let repo = dir.join("repo");
        let key = dir.join("key");
        let made = Command::new("ssh-keygen")
            .args(["-q", "-t", "ed25519", "-N", "", "-C", "test", "-f"])
            .arg(&key)
            .output();
        // Not everywhere, e.g. some Windows machines.
        if !made.is_ok_and(|o| o.status.success()) {
            return;
        }
        let plain = commit(&repo, "plain").unwrap();
        let public = key.with_extension("pub").to_string_lossy().into_owned();
        assert!(set(&repo, true, "ssh", None).is_err());
        assert!(set(&repo, true, "ssh", Some("--x")).is_err());
        assert!(set(&repo, true, "nope", Some(&public)).is_err());
        set(&repo, true, "ssh", Some(&public)).unwrap();
        let s = settings(&repo);
        assert!(s.enabled);
        assert_eq!((s.format.as_str(), s.key.as_ref()), ("ssh", Some(&public)));
        // A config that would run something if the repository had a say.
        let ran = dir.join("ran");
        let signed = commit(&repo, "signed").unwrap();
        git::run(
            &repo,
            &[
                "config",
                "gpg.ssh.program",
                &format!("touch {}", ran.display()),
            ],
        )
        .unwrap();
        git::run(&repo, &["config", "log.showSignature", "true"]).unwrap();

        let checked = check(&repo, &[plain.clone(), signed.clone()], &dir).unwrap();
        assert!(!checked.contains_key(&plain));
        // Signed by a key nobody vouches for.
        assert_eq!(checked[&signed].state, State::Unknown);
        assert_eq!(checked[&signed].format, "ssh");
        assert_eq!(git::log(&repo, 5).unwrap().len(), 2);
        assert!(!ran.exists());
        git::run(&repo, &["config", "--unset", "gpg.ssh.program"]).unwrap();

        // The other commands that make commits sign too.
        git::amend(&repo, "amended").unwrap();
        let revert = git::resolve_commit(&repo, "HEAD").unwrap();
        git::revert(&repo, &revert).unwrap();
        let head = git::resolve_commit(&repo, "HEAD").unwrap();
        let all = check(&repo, &[revert, head], &dir).unwrap();
        assert_eq!(all.len(), 2);

        set(&repo, false, "ssh", None).unwrap();
        let off = commit(&repo, "off").unwrap();
        assert!(check(&repo, &[off], &dir).unwrap().is_empty());

        // A key that's gone is explained, also when picking.
        set(&repo, true, "ssh", Some("/nowhere/key.pub")).unwrap();
        let failed = commit(&repo, "failing").unwrap_err().to_string();
        assert!(failed.contains("couldn't be signed"), "{failed}");
        git::run(&repo, &["reset", "-q", "--hard"]).unwrap();
        let last = git::resolve_commit(&repo, "HEAD").unwrap();
        let failed = git::revert(&repo, &last).unwrap_err().to_string();
        assert!(failed.contains("couldn't be signed"), "{failed}");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn lists_verified_signers() {
        let signed = HashMap::from([("aaa".to_string(), "ssh".to_string())]);
        let got = parse(
            "aaa\x1fG\x1fme@x\x1fSHA256:k\x1e\nbbb\x1fN\x1f\x1f\x1e\n",
            &signed,
        );
        assert_eq!(got.len(), 1);
        assert_eq!(got["aaa"].state, State::Verified);
        assert_eq!(got["aaa"].signer.as_deref(), Some("me@x"));
    }
}
