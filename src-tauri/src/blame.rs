//! Who last changed each line of a file.

use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

use crate::git::{self, check_hash, GitError, Result};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    /// Where the lines come from; `BlameLine::origin` indexes into this.
    pub origins: Vec<Origin>,
    pub lines: Vec<BlameLine>,
}

/// A commit, and the file in it that lines come from. One commit has several
/// when lines were moved between files.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Origin {
    /// None for lines that aren't committed yet.
    pub hash: Option<String>,
    pub author: String,
    /// Unix timestamp in seconds.
    pub time: i64,
    pub subject: String,
    pub path: String,
    /// The parent commit and the file's path there; None where the file began.
    pub previous: Option<Previous>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Previous {
    pub hash: String,
    pub path: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub origin: usize,
    /// The line's number in its commit, counted from 1.
    pub original: usize,
    pub text: String,
}

/// Blames `path` at commit `rev`, or as it is on disk.
pub fn blame(
    repo: &Path,
    path: &str,
    rev: Option<&str>,
    ignore_whitespace: bool,
    follow_moves: bool,
) -> Result<Blame> {
    if path.is_empty() {
        return Err(GitError::Failed("No file given".into()));
    }
    let mut args = vec!["-c", "core.quotePath=false", "blame", "--porcelain"];
    if ignore_whitespace {
        args.push("-w");
    }
    if follow_moves {
        args.extend(["-M", "-C"]);
    }
    if let Some(rev) = rev {
        check_hash(rev)?;
        args.push(rev);
    }
    args.extend(["--", path]);
    let raw = git::run(repo, &args)?;
    if raw.contains('\0') {
        return Err(GitError::Failed(format!("{path} is a binary file")));
    }
    Ok(parse(&raw))
}

/// Undoes git's quoting of unusual paths: `"a\tb"`.
fn unquote(path: &str) -> String {
    let Some(inner) = path.strip_prefix('"').and_then(|p| p.strip_suffix('"')) else {
        return path.to_string();
    };
    let mut out = Vec::new();
    let mut bytes = inner.bytes().peekable();
    while let Some(b) = bytes.next() {
        if b != b'\\' {
            out.push(b);
            continue;
        }
        match bytes.next() {
            Some(first @ b'0'..=b'7') => {
                let mut code = u32::from(first - b'0');
                for _ in 0..2 {
                    if let Some(d) = bytes.next_if(|d| (b'0'..=b'7').contains(d)) {
                        code = code * 8 + u32::from(d - b'0');
                    }
                }
                out.push(code as u8);
            }
            Some(b'a') => out.push(7),
            Some(b'b') => out.push(8),
            Some(b't') => out.push(b'\t'),
            Some(b'n') => out.push(b'\n'),
            Some(b'v') => out.push(11),
            Some(b'f') => out.push(12),
            Some(b'r') => out.push(b'\r'),
            Some(other) => out.push(other),
            None => {}
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Parses `git blame --porcelain`. Each line is a `<hash> <original line>
/// <line>` header, details of the commit the first time it comes up, and the
/// text after a tab. A commit with lines from several files repeats the file.
fn parse(raw: &str) -> Blame {
    let mut origins: Vec<Origin> = Vec::new();
    let mut lines = Vec::new();
    // The origin used last for each commit.
    let mut latest: HashMap<&str, usize> = HashMap::new();

    let mut input = raw.split('\n');
    while let Some(header) = input.next() {
        let mut fields = header.split(' ');
        let (Some(hash), Some(original)) = (
            fields.next().filter(|h| !h.is_empty()),
            fields.next().and_then(|n| n.parse().ok()),
        ) else {
            continue;
        };
        let mut origin = match latest.get(hash) {
            Some(&i) => origins[i].clone(),
            None => Origin {
                hash: hash.bytes().any(|b| b != b'0').then(|| hash.to_string()),
                author: String::new(),
                time: 0,
                subject: String::new(),
                path: String::new(),
                previous: None,
            },
        };
        let mut previous = None;
        let mut text = "";
        for detail in input.by_ref() {
            if let Some(t) = detail.strip_prefix('\t') {
                text = t.strip_suffix('\r').unwrap_or(t);
                break;
            }
            match detail.split_once(' ') {
                Some(("author", v)) => origin.author = v.into(),
                Some(("author-time", v)) => origin.time = v.parse().unwrap_or(0),
                Some(("summary", v)) => origin.subject = v.into(),
                Some(("previous", v)) => {
                    previous = v.split_once(' ').map(|(hash, path)| Previous {
                        hash: hash.into(),
                        path: unquote(path),
                    });
                }
                // Always the last detail, and `previous` comes with it.
                Some(("filename", v)) => {
                    origin.path = unquote(v);
                    origin.previous = previous.take();
                }
                _ => {}
            }
        }
        let index = origins
            .iter()
            .position(|o| *o == origin)
            .unwrap_or_else(|| {
                origins.push(origin);
                origins.len() - 1
            });
        latest.insert(hash, index);
        lines.push(BlameLine {
            origin: index,
            original,
            text: text.into(),
        });
    }
    Blame { origins, lines }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unquotes_paths() {
        assert_eq!(unquote("plain name.txt"), "plain name.txt");
        assert_eq!(unquote(r#""a\tb\"c\\d""#), "a\tb\"c\\d");
        assert_eq!(unquote(r#""\303\274.txt""#), "ü.txt");
    }

    #[test]
    fn one_commit_can_have_lines_from_two_files() {
        let raw =
            "aaaa 1 1 1\nauthor A\nauthor-time 5\nsummary s\nprevious bbbb x\nfilename x\n\tone\n\
                   aaaa 7 2 2\nfilename y\n\ttwo\naaaa 8 3\n\t\n";
        let got = parse(raw);
        let paths: Vec<_> = got.origins.iter().map(|o| o.path.as_str()).collect();
        assert_eq!(paths, ["x", "y"]);
        assert!(got.origins[0].previous.is_some() && got.origins[1].previous.is_none());
        assert_eq!(got.origins[1].author, "A");
        let lines: Vec<_> = got
            .lines
            .iter()
            .map(|l| (l.origin, l.original, l.text.as_str()))
            .collect();
        assert_eq!(lines, [(0, 1, "one"), (1, 7, "two"), (1, 8, "")]);
    }

    /// A repository can name a program in its own config (a textconv driver),
    /// and `git.rs` promises that looking at a file never runs one. Blame is
    /// one of the commands that can, so this asks with a marker file.
    #[test]
    fn blame_does_not_run_the_repositorys_textconv() {
        let dir =
            std::env::temp_dir().join(format!("gitgud-blame-textconv-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.as_path();
        git::run(repo, &["init", "-q", "-b", "main"]).unwrap();
        for (k, v) in [
            ("user.name", "Ada"),
            ("user.email", "a@x"),
            ("commit.gpgsign", "false"),
            ("core.autocrlf", "false"),
        ] {
            git::run(repo, &["config", k, v]).unwrap();
        }
        let marker = repo.join("driver-ran");
        git::run(
            repo,
            &[
                "config",
                "diff.pwn.textconv",
                &format!("sh -c 'touch {}; cat \"$0\"'", marker.display()),
            ],
        )
        .unwrap();
        std::fs::write(repo.join(".gitattributes"), "*.txt diff=pwn\n").unwrap();
        std::fs::write(repo.join("f.txt"), "one\ntwo\n").unwrap();
        git::run(repo, &["add", "-A"]).unwrap();
        git::run(repo, &["commit", "-q", "-m", "seed"]).unwrap();

        blame(repo, "f.txt", None, false, false).unwrap();

        assert!(
            !marker.exists(),
            "blame ran the program the repository's own config names"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn blames_commits_renames_and_local_changes() {
        let dir = std::env::temp_dir().join(format!("gitgud-blame-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.as_path();
        git::run(repo, &["init", "-q", "-b", "main"]).unwrap();
        for (k, v) in [
            ("user.name", "Ada"),
            ("user.email", "a@x"),
            ("commit.gpgsign", "false"),
            ("core.autocrlf", "false"),
        ] {
            git::run(repo, &["config", k, v]).unwrap();
        }
        let save = |file: &str, content: &str| std::fs::write(dir.join(file), content).unwrap();
        let commit = |message: &str| {
            git::run(repo, &["add", "-A"]).unwrap();
            git::commit(repo, message).unwrap();
            git::log(repo, 1).unwrap()[0].hash.clone()
        };
        let body = "one\ntwo\nthree\nfour\nfive\n";
        save("ö old.txt", body);
        let first = commit("first");
        git::run(repo, &["mv", "ö old.txt", "new.txt"]).unwrap();
        save("new.txt", "one\n  two\nthree\nfour\nFIVE\n");
        let second = commit("second");
        save("new.txt", "ONE\n  two\nthree\nfour\nFIVE\n");

        let hashes = |b: &Blame| -> Vec<Option<String>> {
            b.lines
                .iter()
                .map(|l| b.origins[l.origin].hash.clone())
                .collect()
        };
        let (f, s) = (Some(first.clone()), Some(second.clone()));

        let disk = blame(repo, "new.txt", None, false, false).unwrap();
        assert_eq!(
            hashes(&disk),
            [None, s.clone(), f.clone(), f.clone(), s.clone()]
        );
        assert_eq!(disk.lines[1].text, "  two");
        let local = &disk.origins[disk.lines[0].origin];
        assert_eq!(local.previous.as_ref().unwrap().hash, second);

        // The change's parent has the file under its old name.
        let origin = &disk.origins[disk.lines[4].origin];
        assert_eq!(
            (origin.author.as_str(), origin.subject.as_str()),
            ("Ada", "second")
        );
        let previous = origin.previous.clone().unwrap();
        assert_eq!(
            (previous.hash.as_str(), previous.path.as_str()),
            (first.as_str(), "ö old.txt")
        );
        let parent = blame(repo, &previous.path, Some(&previous.hash), false, false).unwrap();
        assert_eq!(hashes(&parent), vec![f.clone(); 5]);
        assert_eq!(parent.origins[0].previous, None);

        let loose = blame(repo, "new.txt", Some(&second), true, true).unwrap();
        assert_eq!(hashes(&loose)[1], f);

        assert!(blame(repo, "nope.txt", None, false, false).is_err());
        assert!(blame(repo, "new.txt", Some("--contents=x"), false, false).is_err());
        save("bin", "a\0b\n");
        let bin = commit("binary");
        assert!(blame(repo, "bin", Some(&bin), false, false).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
