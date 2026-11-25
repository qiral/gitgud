//! Keeps the AppImage's environment out of programs GitGud starts.
//!
//! The AppImage points LD_LIBRARY_PATH and friends at the libraries it ships.
//! GitGud needs those, but the system's own programs break on them: a browser
//! started with them can die on a missing symbol, while `xdg-open` still
//! reports success.

use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::process::Command;

/// Set by the AppImage without its path in the value.
const ALWAYS_REMOVE: [&str; 6] = [
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
    "GTK_THEME",
    "PYTHONDONTWRITEBYTECODE",
];

/// Whether `entry` belongs to an AppImage: ours, or one that started us. After
/// an update GitGud is started by the version it replaces, so that one's mount
/// is in the variables too, and APPDIR only names the newest.
fn in_appimage(entry: &Path, appdir: &Path) -> bool {
    entry.starts_with(appdir)
        || entry
            .components()
            .any(|part| part.as_os_str().as_encoded_bytes().starts_with(b".mount_"))
}

/// `value` without the entries inside an AppImage: None if nothing is left, the
/// value as it was if there were none.
fn without_appdir(value: &OsStr, appdir: &Path) -> Option<OsString> {
    let inside = |entry: &Path| in_appimage(entry, appdir);
    if !std::env::split_paths(value).any(|entry| inside(&entry)) {
        return Some(value.to_owned());
    }
    let kept: Vec<_> = std::env::split_paths(value)
        // An empty entry means the current folder in LD_LIBRARY_PATH and PATH.
        .filter(|entry| !entry.as_os_str().is_empty() && !inside(entry))
        .collect();
    if kept.is_empty() {
        return None;
    }
    std::env::join_paths(kept).ok()
}

/// Gives `cmd` the environment GitGud had before the AppImage changed it.
/// Does nothing outside an AppImage.
pub(crate) fn clean_env(cmd: &mut Command) {
    let Some(appdir) = std::env::var_os("APPDIR").filter(|dir| Path::new(dir).is_absolute()) else {
        return;
    };
    clean(cmd, Path::new(&appdir), std::env::vars_os());
}

fn clean(cmd: &mut Command, appdir: &Path, vars: impl Iterator<Item = (OsString, OsString)>) {
    for name in ALWAYS_REMOVE {
        cmd.env_remove(name);
    }
    for (name, value) in vars {
        if ALWAYS_REMOVE.iter().any(|remove| name == *remove) {
            continue;
        }
        match without_appdir(&value, appdir) {
            None => {
                cmd.env_remove(name);
            }
            Some(cleaned) if cleaned != value => {
                cmd.env(name, cleaned);
            }
            Some(_) => {}
        }
    }
}

/// Overrides that neutralize AppImage-injected search paths when a child
/// process API only supports setting variables rather than removing them.
pub(crate) fn clean_env_overrides(path_var: &OsStr) -> Vec<(&'static str, OsString)> {
    let Some(appdir) = std::env::var_os("APPDIR").filter(|dir| Path::new(dir).is_absolute()) else {
        return vec![("PATH", path_var.to_owned())];
    };
    clean_overrides(Path::new(&appdir), path_var, std::env::vars_os())
}

fn clean_overrides(
    appdir: &Path,
    path_var: &OsStr,
    vars: impl Iterator<Item = (OsString, OsString)>,
) -> Vec<(&'static str, OsString)> {
    let mut overrides = vec![("PATH", without_appdir(path_var, appdir).unwrap_or_default())];
    for (name, value) in vars {
        let Some(key) = ["LD_LIBRARY_PATH", "PYTHONHOME", "GTK_PATH"]
            .into_iter()
            .find(|candidate| name == *candidate)
        else {
            continue;
        };
        let cleaned = without_appdir(&value, appdir).unwrap_or_default();
        if cleaned != value {
            overrides.push((key, cleaned));
        }
    }
    overrides
}

/// Opens `url` in the default browser from inside an AppImage.
#[cfg(target_os = "linux")]
pub(crate) fn open_url(url: &str) -> std::io::Result<()> {
    use std::os::unix::process::CommandExt;
    use std::process::Stdio;

    let start = |program: &str, args: &[&str]| {
        let mut cmd = Command::new(program);
        cmd.args(args)
            .arg(url)
            // The AppImage starts in its own mount, which a browser that
            // outlives GitGud would keep busy.
            .current_dir("/")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        clean_env(&mut cmd);
        cmd.spawn()
    };
    let mut child = start("xdg-open", &[]).or_else(|_| start("gio", &["open"]))?;
    // May run as long as the browser does.
    std::thread::spawn(move || child.wait());
    Ok(())
}

/// Opens `path`'s folder in the file manager from inside an AppImage.
#[cfg(target_os = "linux")]
pub(crate) fn reveal_item(path: &Path) -> std::io::Result<()> {
    use std::os::unix::process::CommandExt;
    use std::process::Stdio;

    let target = if path.is_dir() {
        path
    } else {
        path.parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or(path)
    };
    let start = |program: &str, args: &[&str]| {
        let mut cmd = Command::new(program);
        cmd.args(args)
            .arg(target)
            .current_dir("/")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        clean_env(&mut cmd);
        cmd.spawn()
    };
    let mut child = start("xdg-open", &[]).or_else(|_| start("gio", &["open"]))?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn drops_only_what_the_appimage_added() {
        let vars = [
            (
                "LD_LIBRARY_PATH",
                "/tmp/.mount_x/usr/lib/:/tmp/.mount_old/usr/lib/:",
            ),
            (
                "PATH",
                "/tmp/.mount_x/usr/bin/:/tmp/.mount_old/bin/:/home/me/bin:/usr/bin",
            ),
            ("PYTHONHOME", "/tmp/.mount_x/usr/"),
            ("GTK_PATH", "/tmp/.mount_x//usr/lib/gtk-3.0"),
            ("GTK_THEME", "Adwaita:dark"),
            ("HOME", "/home/me"),
            ("OTHER", "/tmp/mount_x:/a::b"),
        ];
        let mut cmd = Command::new("true");
        clean(
            &mut cmd,
            Path::new("/tmp/.mount_x"),
            vars.iter().map(|(k, v)| (k.into(), v.into())),
        );
        let env: std::collections::HashMap<_, _> = cmd.get_envs().collect();
        for name in ["LD_LIBRARY_PATH", "PYTHONHOME", "GTK_PATH", "GTK_THEME"] {
            assert_eq!(env.get(OsStr::new(name)), Some(&None), "{name}");
        }
        assert_eq!(
            env.get(OsStr::new("PATH")),
            Some(&Some(OsStr::new("/home/me/bin:/usr/bin")))
        );
        assert!(!env.contains_key(OsStr::new("HOME")));
        assert!(!env.contains_key(OsStr::new("OTHER")));
    }

    #[test]
    fn overrides_strip_appimage_paths_for_child_sdks() {
        let vars = [
            ("LD_LIBRARY_PATH", "/tmp/.mount_x/usr/lib:/usr/local/lib"),
            ("PYTHONHOME", "/tmp/.mount_x/usr"),
            ("GTK_PATH", "/usr/lib/gtk-3.0"),
        ];
        let overrides: std::collections::HashMap<_, _> = clean_overrides(
            Path::new("/tmp/.mount_x"),
            OsStr::new("/tmp/.mount_x/usr/bin:/usr/bin"),
            vars.iter().map(|(k, v)| (k.into(), v.into())),
        )
        .into_iter()
        .collect();
        assert_eq!(overrides.get("PATH"), Some(&OsString::from("/usr/bin")));
        assert_eq!(
            overrides.get("LD_LIBRARY_PATH"),
            Some(&OsString::from("/usr/local/lib"))
        );
        assert_eq!(overrides.get("PYTHONHOME"), Some(&OsString::new()));
        assert!(!overrides.contains_key("GTK_PATH"));
    }
}
