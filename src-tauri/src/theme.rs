//! Detects the Linux desktop color scheme ("dark" or "light") directly from
//! desktop settings, because WebKitGTK's `prefers-color-scheme` media query
//! often ignores KDE Plasma / GNOME / XDG Desktop Portal dark mode and stops
//! updating when `set_theme` is called on the GTK window.

use std::path::PathBuf;
use std::process::{Command, Stdio};

/// Reads the current Linux desktop color scheme, trying the freedesktop portal,
/// GNOME/KDE gsettings, GTK3 settings, and KDE Plasma globals in order.
pub(crate) fn detect_linux(clean_env: fn(&mut Command)) -> Option<&'static str> {
    if let Some(out) = run_command(
        clean_env,
        "dbus-send",
        &[
            "--session",
            "--print-reply=literal",
            "--dest=org.freedesktop.portal.Desktop",
            "/org/freedesktop/portal/desktop",
            "org.freedesktop.portal.Settings.Read",
            "string:org.freedesktop.appearance",
            "string:color-scheme",
        ],
    ) {
        if let Some(theme) = parse_portal_color_scheme(&out) {
            return Some(theme);
        }
    }

    if let Some(out) = run_command(
        clean_env,
        "gsettings",
        &["get", "org.gnome.desktop.interface", "color-scheme"],
    ) {
        if let Some(theme) = parse_gsettings_color_scheme(&out) {
            return Some(theme);
        }
    }

    if let Some(config) = config_dir() {
        if let Ok(ini) = std::fs::read_to_string(config.join("gtk-3.0").join("settings.ini")) {
            if let Some(theme) = parse_gtk_ini(&ini) {
                return Some(theme);
            }
        }
        if let Ok(kde) = std::fs::read_to_string(config.join("kdeglobals")) {
            if let Some(theme) = parse_kdeglobals(&kde) {
                return Some(theme);
            }
        }
    }

    if let Some(out) = run_command(
        clean_env,
        "gsettings",
        &["get", "org.gnome.desktop.interface", "gtk-theme"],
    ) {
        if let Some(theme) = parse_theme_name(&out) {
            return Some(theme);
        }
    }

    None
}

fn config_dir() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
}

fn run_command(clean_env: fn(&mut Command), program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped());
    clean_env(&mut cmd);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

/// Parses `org.freedesktop.appearance` `color-scheme`:
/// 0 = no preference, 1 = prefer dark, 2 = prefer light.
fn parse_portal_color_scheme(output: &str) -> Option<&'static str> {
    let mut tokens = output.split_whitespace();
    while let Some(tok) = tokens.next() {
        if tok == "uint32" {
            return match tokens.next() {
                Some("1") => Some("dark"),
                Some("2") => Some("light"),
                _ => None,
            };
        }
    }
    None
}

fn parse_gsettings_color_scheme(output: &str) -> Option<&'static str> {
    let lower = output.trim().trim_matches('\'').to_ascii_lowercase();
    if lower.contains("dark") {
        Some("dark")
    } else if lower.contains("light") {
        Some("light")
    } else {
        None
    }
}

fn parse_gtk_ini(contents: &str) -> Option<&'static str> {
    let mut prefer_dark: Option<bool> = None;
    let mut theme_name: Option<&str> = None;
    for raw in contents.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('[') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key == "gtk-application-prefer-dark-theme" {
            prefer_dark = match value.to_ascii_lowercase().as_str() {
                "true" | "1" | "yes" => Some(true),
                "false" | "0" | "no" => Some(false),
                _ => None,
            };
        } else if key == "gtk-theme-name" {
            theme_name = Some(value);
        }
    }
    if prefer_dark == Some(true) {
        return Some("dark");
    }
    if let Some(name) = theme_name {
        if let Some(theme) = parse_theme_name(name) {
            return Some(theme);
        }
    }
    if prefer_dark == Some(false) {
        return Some("light");
    }
    None
}

fn parse_kdeglobals(contents: &str) -> Option<&'static str> {
    let mut look_and_feel: Option<&str> = None;
    let mut color_scheme: Option<&str> = None;
    for raw in contents.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('[') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key == "LookAndFeelPackage" {
            look_and_feel = Some(value);
        } else if key == "ColorScheme" {
            color_scheme = Some(value);
        }
    }
    for candidate in [color_scheme, look_and_feel].into_iter().flatten() {
        if let Some(theme) = parse_theme_name(candidate) {
            return Some(theme);
        }
    }
    None
}

fn parse_theme_name(value: &str) -> Option<&'static str> {
    let lower = value.trim().trim_matches('\'').to_ascii_lowercase();
    if lower.is_empty() {
        return None;
    }
    if lower.contains("dark") {
        Some("dark")
    } else if lower.contains("light") {
        Some("light")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_portal_color_scheme() {
        assert_eq!(
            parse_portal_color_scheme("   variant       variant          uint32 1\n"),
            Some("dark")
        );
        assert_eq!(
            parse_portal_color_scheme("   variant       variant          uint32 2\n"),
            Some("light")
        );
        assert_eq!(
            parse_portal_color_scheme("   variant       variant          uint32 0\n"),
            None
        );
    }

    #[test]
    fn parses_gsettings_color_scheme() {
        assert_eq!(
            parse_gsettings_color_scheme("'prefer-dark'\n"),
            Some("dark")
        );
        assert_eq!(
            parse_gsettings_color_scheme("'prefer-light'\n"),
            Some("light")
        );
        assert_eq!(parse_gsettings_color_scheme("'default'\n"), None);
    }

    #[test]
    fn parses_gtk3_settings_ini() {
        let dark = "[Settings]\ngtk-application-prefer-dark-theme=true\ngtk-theme-name=Breeze\n";
        assert_eq!(parse_gtk_ini(dark), Some("dark"));

        let dark_by_name =
            "[Settings]\ngtk-application-prefer-dark-theme=false\ngtk-theme-name=Adwaita-dark\n";
        assert_eq!(parse_gtk_ini(dark_by_name), Some("dark"));

        let light = "[Settings]\ngtk-application-prefer-dark-theme=false\ngtk-theme-name=Breeze\n";
        assert_eq!(parse_gtk_ini(light), Some("light"));
    }

    #[test]
    fn parses_kdeglobals() {
        let dark = "[KDE]\nLookAndFeelPackage=org.kde.breezedark.desktop\n";
        assert_eq!(parse_kdeglobals(dark), Some("dark"));

        let light = "[General]\nColorScheme=BreezeLight\n";
        assert_eq!(parse_kdeglobals(light), Some("light"));
    }
}
