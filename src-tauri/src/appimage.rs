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

/// `value` without the entries inside `appdir`: None if nothing is left, the
/// value as it was if there were none.
fn without_appdir(value: &OsStr, appdir: &Path) -> Option<OsString> {
    let inside = |entry: &Path| entry.starts_with(appdir);
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn drops_only_what_the_appimage_added() {
        let vars = [
            ("LD_LIBRARY_PATH", "/tmp/.mount_x/usr/lib/:"),
            ("PATH", "/tmp/.mount_x/usr/bin/:/home/me/bin:/usr/bin"),
            ("PYTHONHOME", "/tmp/.mount_x/usr/"),
            ("GTK_PATH", "/tmp/.mount_x//usr/lib/gtk-3.0"),
            ("GTK_THEME", "Adwaita:dark"),
            ("HOME", "/home/me"),
            ("OTHER", "/tmp/.mount_xy:/a::b"),
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
}
