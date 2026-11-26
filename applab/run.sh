#!/usr/bin/env bash
# The app lab: drives the real GitGud window over WebDriver, against a real
# git repository, with no mocks anywhere in the chain.
#
#   npm run test:app                 # use the debug binary as built
#   npm run test:app -- --rebuild    # build it first
#   npm run test:app -- --only open  # one spec, by file name
#
# Everything here is throwaway: its own X display, its own ports, its own data
# directory, its own fixture repository. Nothing lands in your real app profile
# and no window opens on the desktop you are sitting at.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
binary="$root/src-tauri/target/debug/gitgud"

rebuild=0
only=""
while [ $# -gt 0 ]; do
  case "$1" in
    --rebuild) rebuild=1 ;;
    --only)
      shift
      only="${1:-}"
      [ -n "$only" ] || { echo "--only needs a spec name" >&2; exit 2; }
      ;;
    -h | --help)
      sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $1 (see --help)" >&2
      exit 2
      ;;
  esac
  shift
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# One prerequisite, with the package that provides it on the two systems this
# lab gets used on. Anything else gets the binary name and no guess.
need() { # command, arch package, debian package
  command -v "$1" >/dev/null 2>&1 && return 0
  echo "missing: $1" >&2
  echo "  Arch Linux:    sudo pacman -S $2" >&2
  echo "  Debian/Ubuntu: sudo apt install $3" >&2
  exit 1
}

command -v tauri-driver >/dev/null 2>&1 || {
  echo "missing: tauri-driver" >&2
  echo "  any distro: cargo install tauri-driver --locked" >&2
  exit 1
}

need Xvfb xorg-server-xvfb xvfb
need WebKitWebDriver webkitgtk-6.0 webkit2gtk-driver
need git git git
need node nodejs nodejs
need npm npm npm

if [ "$rebuild" = 1 ] || [ ! -x "$binary" ]; then
  say "building the debug app"
  # A machine may need its own environment for the Rust build (an OpenSSL on a
  # non-standard prefix, for one). That belongs in your shell, not in this
  # repo, so the whole command can be handed over instead.
  build="${LAB_BUILD_CMD:-npm run tauri build -- --debug --no-bundle}"
  # Through a shell, so LAB_BUILD_CMD can carry an `env=value` prefix as is.
  (cd "$root" && bash -c "$build") || {
    echo "the debug build failed; if this machine needs an env var for it," >&2
    echo "put the whole command in LAB_BUILD_CMD and run it again" >&2
    exit 1
  }
fi
[ -x "$binary" ] || { echo "no debug binary at $binary; run with --rebuild" >&2; exit 1; }

work="$(mktemp -d "${TMPDIR:-/tmp}/gitgud-applab.XXXXXX")"
display=""
driver_pid=""
driver_port=""
native_port=""
xvfb_pid=""

# The app this lab launched, told apart from a GitGud of your own by its
# display: only the windows on our Xvfb carry our DISPLAY.
kill_apps() {
  for pid in $(pgrep -f "$binary" 2>/dev/null || true); do
    if tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | grep -qx "DISPLAY=$display"; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
}

cleanup() {
  status=$?
  # Teardown runs to the end whatever happens, including a closed stdout:
  # `run.sh | head` must not be able to stop it halfway, so a failed write is
  # an error and not a signal.
  trap '' PIPE
  trap - EXIT INT TERM HUP
  set +e
  say "tearing down"
  if [ -n "$driver_pid" ] && kill -0 "$driver_pid" 2>/dev/null; then
    kill -TERM "$driver_pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$driver_pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL "$driver_pid" 2>/dev/null || true
  fi
  # A crashed spec can leave the app it launched, and the native driver it came
  # with, behind. Each of these is allowed to find nothing.
  if [ -n "$display" ]; then kill_apps; fi
  if [ -n "$native_port" ]; then pkill -f "WebKitWebDriver --port=$native_port" 2>/dev/null || true; fi
  if [ -n "$xvfb_pid" ] && kill -0 "$xvfb_pid" 2>/dev/null; then
    kill -TERM "$xvfb_pid" 2>/dev/null || true
    for _ in $(seq 1 30); do
      kill -0 "$xvfb_pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL "$xvfb_pid" 2>/dev/null || true
  fi
  if [ "${LAB_KEEP:-0}" = 1 ]; then
    echo "kept: $work (display $display)"
  else
    rm -rf "$work"
  fi
  echo "torn down"
  exit "$status"
}
# PIPE too: `run.sh | head` must not leave a window behind when head exits.
trap cleanup EXIT INT TERM HUP PIPE

# A display of our own, never the one you are looking at.
for n in $(seq 90 120); do
  if [ ! -e "/tmp/.X11-unix/X$n" ]; then
    display=":$n"
    break
  fi
done
[ -n "$display" ] || { echo "no free X display number in :90-:120" >&2; exit 1; }

say "starting Xvfb on $display"
Xvfb "$display" -screen 0 1400x1000x24 -nolisten tcp >"$work/xvfb.log" 2>&1 &
xvfb_pid=$!
for _ in $(seq 1 100); do
  [ -e "/tmp/.X11-unix/X${display#:}" ] && break
  sleep 0.1
done
[ -e "/tmp/.X11-unix/X${display#:}" ] || { echo "Xvfb did not come up; see $work/xvfb.log" >&2; exit 1; }
export DISPLAY="$display"

# On a Wayland desktop GTK would ignore DISPLAY and put the window on your own
# compositor, where it flashes and cannot be driven. The lab is an X11 client or
# it is a bug in the lab.
unset WAYLAND_DISPLAY
export GDK_BACKEND=x11

free_port() { # start, end
  for p in $(seq "$1" "$2"); do
    if ! timeout -k 1 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/$p" 2>/dev/null; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

driver_port="$(free_port 4444 4460)"
native_port="$(free_port 4461 4480)"
[ -n "$driver_port" ] && [ -n "$native_port" ] || { echo "no free ports for the driver" >&2; exit 1; }

export LAB_APP_BINARY="$binary"
export LAB_DRIVER_PORT="$driver_port"
export LAB_WORK="$work"

failed=0
ran=0
for spec in "$here"/specs/*.mjs; do
  name="$(basename "$spec" .mjs)"
  if [ -n "$only" ] && [ "$name" != "$only" ]; then continue; fi
  ran=$((ran + 1))
  say "spec: $name"

  # A fixture and an app profile of its own per spec: they run one after
  # another, and one of them writes a branch. Recents live in the profile, so
  # a shared one would open the previous spec's repository instead of the
  # start screen.
  export LAB_REPO="$work/$name/fixture"
  export XDG_DATA_HOME="$work/$name/data"
  export XDG_CACHE_HOME="$work/$name/cache"
  export XDG_CONFIG_HOME="$work/$name/config"
  mkdir -p "$LAB_REPO" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME"
  "$here/fixtures/make-repo.sh" "$LAB_REPO" >/dev/null

  # The driver, and the app behind it, inherit this environment, so the
  # profile above is the one the window gets: a spec that opens a repository
  # cannot leave it open for the next one.
  tauri-driver --port "$driver_port" --native-port "$native_port" \
    >"$work/$name/tauri-driver.log" 2>&1 &
  driver_pid=$!

  ready=0
  for _ in $(seq 1 100); do
    if timeout -k 1 2 curl -sf "http://127.0.0.1:$driver_port/status" 2>/dev/null |
      grep -q '"ready":true'; then
      ready=1
      break
    fi
    kill -0 "$driver_pid" 2>/dev/null || break
    sleep 0.2
  done
  if [ "$ready" != 1 ]; then
    echo "the WebDriver endpoint never became ready; see $work/$name/tauri-driver.log" >&2
    tail -5 "$work/$name/tauri-driver.log" >&2 || true
    failed=$((failed + 1))
    driver_pid=""
    continue
  fi

  if ! (cd "$root" && timeout -k 5 180 node "$spec"); then
    failed=$((failed + 1))
  fi

  kill -TERM "$driver_pid" 2>/dev/null || true
  wait "$driver_pid" 2>/dev/null || true
  driver_pid=""
  # A spec that died mid-session leaves its window and the native driver
  # behind; the next spec gets a clean display either way.
  kill_apps
  pkill -f "WebKitWebDriver --port=$native_port" 2>/dev/null || true
done

[ "$ran" = 0 ] && { echo "no spec matched '$only'" >&2; exit 1; }

if [ "$failed" != 0 ]; then
  say "$failed of $ran specs failed"
  exit 1
fi
say "$ran specs passed against the real app"
