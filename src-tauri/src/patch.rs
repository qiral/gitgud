//! Builds patches that contain only some lines of a diff, for staging,
//! unstaging or discarding individual lines and hunks.
//!
//! Lines are identified by their index in the diff text (split on '\n'),
//! which is also how the frontend numbers them.

use std::collections::HashSet;

/// Which way the patch will be applied.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Direction {
    /// `git apply`: the diff's old side is the target (staging from the
    /// working tree into the index).
    Forward,
    /// `git apply --reverse`: the diff's new side is the target (unstaging,
    /// or discarding working tree changes).
    Reverse,
}

#[derive(Debug, PartialEq)]
pub enum PatchError {
    NothingSelected,
    /// Binary files can only be handled as a whole.
    WholeFileOnly,
}

/// Returns a patch with only the `selected` changed lines of `diff`.
///
/// Unselected changes are turned into whatever the target already has: an
/// unselected removal stays as context when applying forward (the line is
/// still in the index), an unselected addition stays as context when
/// applying in reverse. The hunk headers keep their start positions and are
/// meant to be applied with `--recount`, which fixes up the line counts.
///
/// New and deleted files work too: when some of their lines end up as
/// context, the patch no longer creates or deletes the file but modifies it,
/// so its header is rewritten to say that.
pub fn partial(
    diff: &str,
    selected: &HashSet<usize>,
    direction: Direction,
) -> Result<String, PatchError> {
    let lines: Vec<&str> = diff.split('\n').collect();
    let first_hunk = lines
        .iter()
        .position(|l| l.starts_with("@@"))
        .ok_or(PatchError::NothingSelected)?;

    let header = &lines[..first_hunk];
    if header.iter().any(|l| l.starts_with("Binary files")) {
        return Err(PatchError::WholeFileOnly);
    }
    let whole_file = header
        .iter()
        .any(|l| l.starts_with("new file mode") || l.starts_with("deleted file mode"));

    let mut patch: Vec<String> = Vec::new();
    let mut hunk: Vec<String> = Vec::new();
    let mut hunk_has_change = false;
    let mut any_change = false;
    // Whether an unselected line became context, i.e. the file exists on both
    // sides of the patch.
    let mut hunk_has_context = false;
    let mut any_context = false;
    // Whether the previous diff line made it into the patch, so a following
    // "\ No newline at end of file" marker is kept or dropped along with it.
    let mut last_kept = false;

    for (i, line) in lines.iter().enumerate().skip(first_hunk) {
        let kept = match line.chars().next() {
            Some('@') => {
                if hunk_has_change {
                    patch.append(&mut hunk);
                    any_context |= hunk_has_context;
                }
                hunk.clear();
                hunk_has_change = false;
                hunk_has_context = false;
                Some(line.to_string())
            }
            Some(' ') => {
                hunk_has_context = true;
                Some(line.to_string())
            }
            Some(sign @ ('+' | '-')) => {
                // The side the patch is applied onto already has this line.
                let in_target = match direction {
                    Direction::Forward => sign == '-',
                    Direction::Reverse => sign == '+',
                };
                if selected.contains(&i) {
                    hunk_has_change = true;
                    any_change = true;
                    Some(line.to_string())
                } else if in_target {
                    hunk_has_context = true;
                    Some(format!(" {}", &line[1..]))
                } else {
                    None
                }
            }
            Some('\\') => {
                if last_kept {
                    hunk.push(line.to_string());
                }
                continue;
            }
            // The empty string after the final newline.
            _ => None,
        };
        last_kept = kept.is_some();
        hunk.extend(kept);
    }
    if hunk_has_change {
        patch.append(&mut hunk);
        any_context |= hunk_has_context;
    }

    if !any_change {
        return Err(PatchError::NothingSelected);
    }
    let header = if whole_file {
        whole_file_header(header, any_context, &mut patch)
    } else {
        header.iter().map(|l| l.to_string()).collect()
    };
    Ok([header, patch].concat().join("\n") + "\n")
}

/// Header for a partial patch of a new or deleted file. Their `index` line
/// names a blob with every line, which the partial patch no longer matches,
/// so it is left out.
///
/// With `modifies` the file exists on both sides, so the creation/deletion
/// lines become plain `a/` and `b/` names, and the single hunk, which starts
/// at line 0 on the empty side, is renumbered to start at line 1.
fn whole_file_header(header: &[&str], modifies: bool, body: &mut [String]) -> Vec<String> {
    let old = header.iter().find_map(|l| l.strip_prefix("--- "));
    let new = header.iter().find_map(|l| l.strip_prefix("+++ "));
    let kept = header.iter().filter(|l| !l.starts_with("index "));
    if !modifies {
        return kept.map(|l| l.to_string()).collect();
    }
    if let Some(hunk) = body.iter_mut().find(|l| l.starts_with("@@")) {
        *hunk = "@@ -1 +1 @@".into();
    }
    kept.filter(|l| !l.starts_with("new file mode") && !l.starts_with("deleted file mode"))
        .map(|l| match (*l, old, new) {
            ("--- /dev/null", _, Some(name)) => format!("--- {}", swap_prefix(name, 'b', 'a')),
            ("+++ /dev/null", Some(name), _) => format!("+++ {}", swap_prefix(name, 'a', 'b')),
            _ => l.to_string(),
        })
        .collect()
}

/// `b/path` → `a/path`, also inside git's quoting (`"b/p\303\251"`).
fn swap_prefix(name: &str, from: char, to: char) -> String {
    let (quote, rest) = match name.strip_prefix('"') {
        Some(rest) => ("\"", rest),
        None => ("", name),
    };
    match rest.strip_prefix(from).and_then(|r| r.strip_prefix('/')) {
        Some(path) => format!("{quote}{to}/{path}"),
        None => name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIFF: &str = "\
diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1,4 +1,4 @@
 one
-two
+TWO
 three
-four
+FOUR
@@ -10,2 +10,3 @@ ten
 ten
+ten and a half
 eleven
";

    fn set(ids: &[usize]) -> HashSet<usize> {
        ids.iter().copied().collect()
    }

    #[test]
    fn stages_only_selected_lines() {
        // Select "-two" (6) and "+TWO" (7) only.
        let p = partial(DIFF, &set(&[6, 7]), Direction::Forward).unwrap();
        assert!(p.contains("-two\n+TWO\n"));
        assert!(p.contains(" four\n"), "unselected removal stays as context");
        assert!(!p.contains("FOUR"), "unselected addition is dropped");
        assert!(!p.contains("@@ -10"), "untouched hunk is left out");
    }

    #[test]
    fn reverse_keeps_unselected_additions_as_context() {
        // Unstage only "+ten and a half" (13).
        let p = partial(DIFF, &set(&[13]), Direction::Reverse).unwrap();
        assert!(!p.contains("@@ -1,4"), "first hunk has nothing selected");
        assert!(p.contains("+ten and a half\n"));

        let p = partial(DIFF, &set(&[7]), Direction::Reverse).unwrap();
        assert!(p.contains("+TWO\n"));
        assert!(
            !p.contains("-two"),
            "unselected removal is dropped in reverse"
        );
        assert!(
            p.contains(" FOUR\n"),
            "unselected addition stays as context"
        );
    }

    #[test]
    fn rejects_empty_selection_and_binary_files() {
        assert_eq!(
            partial(DIFF, &set(&[5]), Direction::Forward),
            Err(PatchError::NothingSelected),
            "context lines don't count"
        );
        // Binary diffs normally have no hunks at all; refuse one that does.
        let binary = "diff --git a/b b/b\nBinary files a/b and b/b differ\n@@ -1 +1 @@\n-x\n+y\n";
        assert_eq!(
            partial(binary, &set(&[3]), Direction::Forward),
            Err(PatchError::WholeFileOnly)
        );
    }

    const NEW_FILE: &str = "\
diff --git a/n x.txt b/n x.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/n x.txt\t
@@ -0,0 +1,3 @@
+a
+b
+c
";

    #[test]
    fn stages_some_lines_of_a_new_file() {
        // Nothing is in the index yet, so the patch still creates the file,
        // just with fewer lines.
        let p = partial(NEW_FILE, &set(&[6, 8]), Direction::Forward).unwrap();
        assert_eq!(
            p,
            "diff --git a/n x.txt b/n x.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n x.txt\t\n@@ -0,0 +1,3 @@\n+a\n+c\n"
        );
    }

    #[test]
    fn unstages_some_lines_of_a_new_file() {
        // The unselected line stays, so the file isn't deleted but modified.
        let p = partial(NEW_FILE, &set(&[7]), Direction::Reverse).unwrap();
        assert_eq!(
            p,
            "diff --git a/n x.txt b/n x.txt\n--- a/n x.txt\t\n+++ b/n x.txt\t\n@@ -1 +1 @@\n a\n+b\n c\n"
        );
        // Every line: the file goes away as a whole.
        let p = partial(NEW_FILE, &set(&[6, 7, 8]), Direction::Reverse).unwrap();
        assert!(p.contains("new file mode") && p.contains("--- /dev/null"));
    }

    const DELETED_FILE: &str = "\
diff --git a/d b/d
deleted file mode 100755
index 3333333..0000000
--- \"a/d\\303\\251\"
+++ /dev/null
@@ -1,2 +0,0 @@
-a
-b
";

    #[test]
    fn stages_and_unstages_some_lines_of_a_deleted_file() {
        // Staging one removal keeps the other line, so the file stays.
        let p = partial(DELETED_FILE, &set(&[6]), Direction::Forward).unwrap();
        assert_eq!(
            p,
            "diff --git a/d b/d\n--- \"a/d\\303\\251\"\n+++ \"b/d\\303\\251\"\n@@ -1 +1 @@\n-a\n b\n"
        );
        // Unstaging one removal recreates the file with just that line.
        let p = partial(DELETED_FILE, &set(&[7]), Direction::Reverse).unwrap();
        assert!(p.contains("deleted file mode 100755\n"), "{p}");
        assert!(p.ends_with("@@ -1,2 +0,0 @@\n-b\n"), "{p}");
        assert!(!p.contains("index "));
    }

    #[test]
    fn no_newline_marker_follows_its_line() {
        let diff = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n";
        // Only the removal: its marker stays, the dropped addition's goes.
        let p = partial(diff, &set(&[4]), Direction::Forward).unwrap();
        assert_eq!(
            p,
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n"
        );
    }
}
