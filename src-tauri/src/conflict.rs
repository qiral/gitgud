//! Parses files with merge conflict markers and resolves conflicts one block
//! at a time.
//!
//! ```text
//! <<<<<<< HEAD
//! our lines
//! ||||||| base          (only with merge.conflictStyle = diff3 / zdiff3)
//! base lines
//! =======
//! their lines
//! >>>>>>> feature
//! ```
//!
//! Lines keep their line endings so resolving a block leaves the rest of the
//! file byte for byte the same.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Part {
    Text {
        lines: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    Conflict {
        ours_label: String,
        ours: Vec<String>,
        base: Option<Vec<String>>,
        theirs_label: String,
        theirs: Vec<String>,
        /// The whole block as it appears in the file, markers included.
        #[serde(skip)]
        raw: String,
    },
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Choice {
    Ours,
    Theirs,
    /// Ours followed by theirs.
    Both,
}

fn marker<'a>(line: &'a str, prefix: &str) -> Option<&'a str> {
    let rest = line.strip_prefix(prefix)?;
    // The marker is exactly seven characters, then a space or the line end.
    match rest.chars().next() {
        None | Some(' ') | Some('\r') | Some('\n') => Some(rest.trim()),
        _ => None,
    }
}

pub fn parse(content: &str) -> Vec<Part> {
    enum State {
        Text,
        Ours,
        Base,
        Theirs,
    }

    let mut parts = Vec::new();
    let mut text: Vec<String> = Vec::new();
    let mut state = State::Text;
    let (mut ours_label, mut ours, mut base, mut theirs) =
        (String::new(), Vec::new(), None::<Vec<String>>, Vec::new());
    // Lines of a block in progress, so an unterminated one can fall back to text.
    let mut raw_block: Vec<String> = Vec::new();

    for line in content.split_inclusive('\n') {
        match state {
            State::Text => {
                if let Some(label) = marker(line, "<<<<<<<") {
                    ours_label = label.to_string();
                    ours.clear();
                    base = None;
                    theirs.clear();
                    raw_block = vec![line.to_string()];
                    state = State::Ours;
                } else {
                    text.push(line.to_string());
                }
            }
            State::Ours | State::Base | State::Theirs => {
                raw_block.push(line.to_string());
                match state {
                    State::Ours if marker(line, "|||||||").is_some() => {
                        base = Some(Vec::new());
                        state = State::Base;
                    }
                    State::Ours | State::Base if marker(line, "=======").is_some() => {
                        state = State::Theirs;
                    }
                    State::Theirs => {
                        if let Some(label) = marker(line, ">>>>>>>") {
                            if !text.is_empty() {
                                parts.push(Part::Text {
                                    lines: std::mem::take(&mut text),
                                });
                            }
                            parts.push(Part::Conflict {
                                ours_label: ours_label.clone(),
                                ours: std::mem::take(&mut ours),
                                base: base.take(),
                                theirs_label: label.to_string(),
                                theirs: std::mem::take(&mut theirs),
                                raw: raw_block.concat(),
                            });
                            state = State::Text;
                        } else {
                            theirs.push(line.to_string());
                        }
                    }
                    State::Ours => ours.push(line.to_string()),
                    State::Base => base.get_or_insert_with(Vec::new).push(line.to_string()),
                    State::Text => unreachable!(),
                }
            }
        }
    }

    // An unterminated block isn't a conflict; keep it as plain text.
    if !matches!(state, State::Text) {
        text.append(&mut raw_block);
    }
    if !text.is_empty() {
        parts.push(Part::Text { lines: text });
    }
    parts
}

pub fn has_conflicts(content: &str) -> bool {
    parse(content)
        .iter()
        .any(|p| matches!(p, Part::Conflict { .. }))
}

/// Replaces the `index`-th conflict (counting conflicts only) with the chosen
/// side. Returns `None` if there is no such conflict.
pub fn resolve(content: &str, index: usize, choice: Choice) -> Option<String> {
    rewrite(content, index, |ours, theirs, out| match choice {
        Choice::Ours => out.extend(ours),
        Choice::Theirs => out.extend(theirs),
        Choice::Both => {
            let ours_ends_cleanly = ours.last().is_none_or(|l| l.ends_with('\n'));
            out.extend(ours);
            if !ours_ends_cleanly && !theirs.is_empty() {
                out.push('\n');
            }
            out.extend(theirs);
        }
    })
}

/// Replaces the `index`-th conflict with `text`, written with the file's
/// line endings. Returns `None` if there is no such conflict.
pub fn replace(content: &str, index: usize, text: &str) -> Option<String> {
    let eol = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    rewrite(content, index, |_, _, out| {
        for line in text.lines() {
            out.push_str(line);
            out.push_str(eol);
        }
    })
}

/// Copies `content`, letting `write` fill in the `index`-th conflict from its
/// ours and theirs lines.
fn rewrite(
    content: &str,
    index: usize,
    write: impl FnOnce(Vec<String>, Vec<String>, &mut String),
) -> Option<String> {
    let mut seen = 0;
    let mut write = Some(write);
    let mut out = String::with_capacity(content.len());
    for part in parse(content) {
        match part {
            Part::Text { lines } => out.extend(lines),
            Part::Conflict {
                ours, theirs, raw, ..
            } => {
                match write.take_if(|_| seen == index) {
                    Some(write) => write(ours, theirs, &mut out),
                    // Other conflicts go back exactly as they were.
                    None => out.push_str(&raw),
                }
                seen += 1;
            }
        }
    }
    write.is_none().then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = "\
fn main() {
<<<<<<< HEAD
    println!(\"ours\");
=======
    println!(\"theirs\");
>>>>>>> feature
    shared();
<<<<<<< HEAD
    a();
||||||| base
    original();
=======
    b();
>>>>>>> feature
}
";

    #[test]
    fn replace_swaps_one_block() {
        let replaced = replace(FILE, 1, "    merged();").unwrap();
        let first_block_end = FILE.find("    shared();").unwrap();
        assert_eq!(
            replaced,
            format!(
                "{}    shared();\n    merged();\n}}\n",
                &FILE[..first_block_end]
            )
        );
        assert_eq!(replace(FILE, 2, "x"), None);
    }

    #[test]
    fn replace_keeps_the_files_line_endings() {
        let crlf = FILE.replace('\n', "\r\n");
        let replaced = replace(&crlf, 0, "a\nb\n").unwrap();
        assert!(replaced.starts_with("fn main() {\r\na\r\nb\r\n    shared();\r\n"));
    }

    #[test]
    fn parses_blocks_and_text() {
        let parts = parse(FILE);
        assert_eq!(parts.len(), 5);
        let Part::Conflict {
            ours_label,
            ours,
            base,
            theirs_label,
            theirs,
            ..
        } = &parts[1]
        else {
            panic!("expected a conflict: {parts:?}")
        };
        assert_eq!(ours_label, "HEAD");
        assert_eq!(theirs_label, "feature");
        assert_eq!(ours, &vec!["    println!(\"ours\");\n".to_string()]);
        assert_eq!(theirs, &vec!["    println!(\"theirs\");\n".to_string()]);
        assert_eq!(base, &None);
        let Part::Conflict { base, .. } = &parts[3] else {
            panic!()
        };
        assert_eq!(base, &Some(vec!["    original();\n".to_string()]));
        assert!(has_conflicts(FILE));
    }

    #[test]
    fn resolves_one_block_at_a_time() {
        let once = resolve(FILE, 0, Choice::Theirs).unwrap();
        assert!(once.starts_with("fn main() {\n    println!(\"theirs\");\n    shared();\n"));
        assert!(
            once.contains("||||||| base\n"),
            "untouched block is byte for byte the same"
        );
        assert!(has_conflicts(&once), "second conflict is still there");

        let twice = resolve(&once, 0, Choice::Both).unwrap();
        assert_eq!(
            twice,
            "fn main() {\n    println!(\"theirs\");\n    shared();\n    a();\n    b();\n}\n"
        );
        assert!(!has_conflicts(&twice));
        assert_eq!(resolve(&twice, 0, Choice::Ours), None);
    }

    #[test]
    fn keeps_crlf_and_ignores_lookalikes() {
        let block = "<<<<<<< HEAD\r\nx\r\n=======\r\ny\r\n>>>>>>> b\r\n";
        let crlf = format!("a\r\n{block}z\r\n{block}");
        assert_eq!(
            resolve(&crlf, 0, Choice::Ours).unwrap(),
            format!("a\r\nx\r\nz\r\n{block}")
        );

        // Eight '<' or no closing marker: not a conflict.
        assert!(!has_conflicts("<<<<<<<< not a marker\n"));
        let unterminated = "a\n<<<<<<< HEAD\nb\n";
        assert!(!has_conflicts(unterminated));
        assert_eq!(
            parse(unterminated),
            vec![Part::Text {
                lines: vec!["a\n".into(), "<<<<<<< HEAD\n".into(), "b\n".into()]
            }]
        );
    }
}
