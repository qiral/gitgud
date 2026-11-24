//! Adding untracked files to the repository's `.gitignore`.

use serde::Deserialize;
use std::path::Path;

use crate::git::{GitError, Result};

/// What to ignore, based on one untracked file.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum IgnoreKind {
    /// Just this file: `/dir/name.ext`.
    File,
    /// Every file with the same extension, anywhere: `*.ext`.
    Extension,
    /// The folder the file is in: `/dir/`.
    Folder,
}

/// Escapes characters that mean something in a gitignore pattern, so a
/// path is matched literally.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '*' | '?' | '[' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    // Trailing spaces are dropped by git unless escaped.
    let trimmed = out.trim_end_matches(' ').len();
    let spaces = out.len() - trimmed;
    out.truncate(trimmed);
    out.push_str(&"\\ ".repeat(spaces));
    out
}

/// The extension used for "ignore all *.ext files", if the file has one.
/// Dotfiles like `.env` don't count as having an extension.
pub fn extension(path: &str) -> Option<&str> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let (stem, ext) = name.rsplit_once('.')?;
    (!stem.is_empty() && !ext.is_empty()).then_some(ext)
}

/// The pattern that ignores what `kind` asks for. Paths are relative to the
/// repository root and use `/`, like `git status` prints them.
pub fn pattern(path: &str, kind: IgnoreKind) -> Result<String> {
    let invalid = || GitError::Failed(format!("can't ignore {path} this way"));
    let path = path.trim_matches('/');
    if path.is_empty() {
        return Err(invalid());
    }
    Ok(match kind {
        // Anchored with a leading slash so only this exact path matches;
        // that also stops a name starting with `#` or `!` from being read
        // as a comment or a negation.
        IgnoreKind::File => format!("/{}", escape(path)),
        IgnoreKind::Extension => format!("*.{}", escape(extension(path).ok_or_else(invalid)?)),
        IgnoreKind::Folder => {
            let (dir, _) = path.rsplit_once('/').ok_or_else(invalid)?;
            format!("/{}/", escape(dir))
        }
    })
}

/// Adds the pattern to `.gitignore` at the repository root, creating the
/// file if needed. Does nothing if the exact line is already there.
pub fn add(repo: &Path, path: &str, kind: IgnoreKind) -> Result<()> {
    let line = pattern(path, kind)?;
    let file = crate::git::writable_file_in_repo(repo, ".gitignore")?;
    let existing = match std::fs::read_to_string(&file) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };
    if existing.lines().any(|l| l.trim_end_matches('\r') == line) {
        return Ok(());
    }
    // Keep the file's line endings.
    let newline = if existing.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut text = existing;
    if !text.is_empty() && !text.ends_with('\n') {
        text.push_str(newline);
    }
    text.push_str(&line);
    text.push_str(newline);
    std::fs::write(&file, text)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn a_linked_gitignore_is_left_alone() {
        let dir = std::env::temp_dir().join(format!("gitgud-ignore-link-{}", std::process::id()));
        let outside =
            std::env::temp_dir().join(format!("gitgud-ignore-victim-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&outside, "keep\n").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join(".gitignore")).unwrap();
        std::fs::write(dir.join("junk.log"), "").unwrap();

        assert!(add(&dir, "junk.log", IgnoreKind::File).is_err());
        assert_eq!(std::fs::read_to_string(&outside).unwrap(), "keep\n");
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::remove_file(&outside).unwrap();
    }
    use crate::git::{run, status};

    #[test]
    fn builds_patterns() {
        use IgnoreKind::*;
        assert_eq!(pattern("build/out.log", File).unwrap(), "/build/out.log");
        assert_eq!(pattern("build/out.log", Extension).unwrap(), "*.log");
        assert_eq!(pattern("build/out.log", Folder).unwrap(), "/build/");
        assert_eq!(pattern("a/b/c.txt", Folder).unwrap(), "/a/b/");
        assert_eq!(
            pattern("#notes [1]*.md", File).unwrap(),
            r"/#notes \[1]\*.md"
        );
        assert_eq!(pattern("trailing ", File).unwrap(), r"/trailing\ ");
        assert!(pattern("top.txt", Folder).is_err());
        assert!(pattern(".env", Extension).is_err());
        assert!(pattern("Makefile", Extension).is_err());
        assert!(pattern("", File).is_err());
    }

    #[test]
    fn finds_extensions() {
        assert_eq!(extension("a/b.tar.gz"), Some("gz"));
        assert_eq!(extension("dir.d/file"), None);
        assert_eq!(extension(".gitignore"), None);
        assert_eq!(extension("x."), None);
    }

    #[test]
    fn appends_once_and_hides_files() {
        let dir = std::env::temp_dir().join(format!("gitgud-ignore-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("logs")).unwrap();
        let repo = dir.as_path();
        run(repo, &["init", "-q", "-b", "main"]).unwrap();
        // The user's global excludes mustn't hide the test files.
        run(repo, &["config", "core.excludesFile", "/dev/null"]).unwrap();
        std::fs::write(dir.join("logs/a.log"), "").unwrap();
        std::fs::write(dir.join("logs/b.txt"), "").unwrap();
        std::fs::write(dir.join("c.log"), "").unwrap();
        // Unescaped, `[odd].txt` would match "o.txt" or "d.txt" but not itself.
        // (No `*` in the name: Windows doesn't allow it.)
        std::fs::write(dir.join("[odd].txt"), "").unwrap();
        // No trailing newline, so the new line must start on its own.
        std::fs::write(dir.join(".gitignore"), "target").unwrap();

        let untracked = || -> Vec<String> {
            let mut v: Vec<_> = status(repo)
                .unwrap()
                .files
                .into_iter()
                .map(|f| f.path)
                .collect();
            v.sort();
            v
        };

        add(repo, "[odd].txt", IgnoreKind::File).unwrap();
        assert_eq!(
            untracked(),
            [".gitignore", "c.log", "logs/a.log", "logs/b.txt"]
        );

        add(repo, "c.log", IgnoreKind::Extension).unwrap();
        add(repo, "logs/a.log", IgnoreKind::Extension).unwrap();
        assert_eq!(untracked(), [".gitignore", "logs/b.txt"]);

        add(repo, "logs/b.txt", IgnoreKind::Folder).unwrap();
        assert_eq!(untracked(), [".gitignore"]);

        let text = std::fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert_eq!(text, "target\n/\\[odd].txt\n*.log\n/logs/\n");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn keeps_crlf_endings() {
        let dir = std::env::temp_dir().join(format!("gitgud-ignore-crlf-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(".gitignore"), "a\r\n").unwrap();
        add(&dir, "b.txt", IgnoreKind::File).unwrap();
        add(&dir, "b.txt", IgnoreKind::File).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join(".gitignore")).unwrap(),
            "a\r\n/b.txt\r\n"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
