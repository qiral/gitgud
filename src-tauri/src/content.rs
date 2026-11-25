//! A file's content at some point, for what a diff alone doesn't have: the
//! lines around its hunks, and pictures.

use base64::Engine;
use std::path::Path;

use crate::git::{self, file_in_repo, writable_file_in_repo, GitError, Result};

const MAX_TEXT: usize = 5 * 1024 * 1024;
const MAX_IMAGE: usize = 20 * 1024 * 1024;

/// `at` is "worktree", "index" or a commit. None when the file isn't there.
fn read(repo: &Path, path: &str, at: &str, limit: usize) -> Result<Option<Vec<u8>>> {
    file_in_repo(repo, path)?;
    let too_big = || GitError::Failed(format!("{path} is too big to show"));
    if at == "worktree" {
        // A link's content is wherever it points; that isn't part of the diff.
        let full = writable_file_in_repo(repo, path)?;
        return match std::fs::metadata(&full) {
            Ok(m) if !m.is_file() => Ok(None),
            Ok(m) if m.len() > limit as u64 => Err(too_big()),
            Ok(_) => Ok(Some(std::fs::read(full)?)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        };
    }
    let object = if at == "index" {
        format!(":0:{path}")
    } else {
        match git::resolve_commit(repo, at) {
            Ok(commit) => format!("{commit}:{path}"),
            // E.g. the parent of the first commit.
            Err(_) => return Ok(None),
        }
    };
    let size = git::output(repo, &["cat-file", "-s", &object])?;
    if !size.status.success() {
        return Ok(None);
    }
    let size = String::from_utf8_lossy(&size.stdout);
    if size.trim().parse::<usize>().unwrap_or(0) > limit {
        return Err(too_big());
    }
    let out = git::output(repo, &["cat-file", "blob", &object])?;
    Ok(out.status.success().then_some(out.stdout))
}

pub fn text(repo: &Path, path: &str, at: &str) -> Result<Option<String>> {
    Ok(read(repo, path, at, MAX_TEXT)?.and_then(|bytes| String::from_utf8(bytes).ok()))
}

fn image_type(path: &str) -> Option<&'static str> {
    let (_, extension) = path.rsplit_once('.')?;
    Some(match extension.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// The picture as a `data:` URL.
pub fn image(repo: &Path, path: &str, at: &str) -> Result<Option<String>> {
    let kind =
        image_type(path).ok_or_else(|| GitError::Failed(format!("{path} is not a picture")))?;
    Ok(read(repo, path, at, MAX_IMAGE)?.map(|bytes| {
        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
        format!("data:{kind};base64,{data}")
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_every_version() {
        let dir = std::env::temp_dir().join(format!("gitgud-content-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.as_path();
        git::run(repo, &["init", "-q", "-b", "main"]).unwrap();
        for (k, v) in [
            ("user.name", "T"),
            ("user.email", "t@x"),
            ("commit.gpgsign", "false"),
            ("core.autocrlf", "false"),
        ] {
            git::run(repo, &["config", k, v]).unwrap();
        }
        let write = |text: &str| std::fs::write(repo.join("a b.txt"), text).unwrap();
        write("one\n");
        git::stage(repo, &["a b.txt".into()]).unwrap();
        git::commit(repo, "first").unwrap();
        write("two\n");
        git::stage(repo, &["a b.txt".into()]).unwrap();
        write("three\n");
        let at = |at: &str| text(repo, "a b.txt", at).unwrap();
        assert_eq!(at("HEAD").as_deref(), Some("one\n"));
        assert_eq!(at("index").as_deref(), Some("two\n"));
        assert_eq!(at("worktree").as_deref(), Some("three\n"));
        assert_eq!(at("HEAD^"), None);
        assert_eq!(text(repo, "nope.txt", "HEAD").unwrap(), None);
        assert_eq!(text(repo, "nope.txt", "worktree").unwrap(), None);
        assert!(text(repo, "../a", "worktree").is_err());
        assert!(text(repo, "/etc/hostname", "worktree").is_err());

        // Bytes, not text.
        std::fs::write(repo.join("p.PNG"), [0x89, 0xff, 0]).unwrap();
        assert_eq!(
            image(repo, "p.PNG", "worktree").unwrap().as_deref(),
            Some("data:image/png;base64,if8A")
        );
        assert_eq!(text(repo, "p.PNG", "worktree").unwrap(), None);
        assert!(image(repo, "a b.txt", "worktree").is_err());
        git::stage(repo, &["p.PNG".into()]).unwrap();
        assert!(image(repo, "p.PNG", "index").unwrap().is_some());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/hostname", repo.join("out.png")).unwrap();
            assert!(image(repo, "out.png", "worktree").is_err());
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
