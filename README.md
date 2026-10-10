<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo/logo-dark.png">
    <img src="logo/logo.png" alt="GitGud" width="300">
  </picture>
</p>

<p align="center">
  <em>git gud at git.</em>
</p>

<p align="center">
  <a href="https://github.com/qiral/gitgud/actions/workflows/ci.yml"><img src="https://github.com/qiral/gitgud/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/qiral/gitgud/releases/latest"><img src="https://img.shields.io/github/v/release/qiral/gitgud" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/qiral/gitgud" alt="MIT license"></a>
</p>

A fast, lightweight, open-source Git GUI for Linux, Windows and macOS.

GitGud aims to be as approachable as GitHub Desktop while exposing more of Git's power: history, branches, stash, merges, conflict resolution and interactive rebase, without hiding what Git is doing.

> **Status:** early development. Expect rough edges. [Download the latest release](https://github.com/qiral/gitgud/releases/latest).

![History with the commit graph](docs/screenshots/history.png)

## Features

- Open any local repository (or pass it on the command line: `gitgud ~/code/project`)
- Clone from a URL or pick from your GitHub repositories, with live progress
- See changed files, stage and unstage per file or all at once, and discard changes
- Stage, unstage or discard individual lines and hunks right from the diff
- Merge branches and resolve conflicts block by block, or abort the merge
- Edit history: reorder commits by dragging, squash, fixup, reword or drop them
- Inline diff viewer with line numbers
- Commit (`Ctrl+Enter` in the message box)
- Stash changes (optionally with untracked files), then apply, pop, preview or delete stashes
- Create and switch branches
- History with a commit graph across all branches, remote branches and tags, plus each commit's changes
- Fetch, pull and push, including publishing new branches; when your branch and its upstream have both moved on, pull asks whether to merge or rebase (or follows your `pull.rebase` setting)
- Sign in with GitHub (device flow, token kept in the OS keychain) to push over HTTPS
- Publish a local repository to GitHub in one step
- Light and dark themes that follow your system

## Screenshots

**Stage exactly the lines you want.** Click line numbers in the diff (Shift+click for a range), or stage a whole hunk from its header.

![Staging individual lines](docs/screenshots/changes.png)

**Resolve merge conflicts** block by block (ours, theirs or both), or take one side for the whole file.

![Resolving a merge conflict](docs/screenshots/conflicts.png)

**Edit history** without the terminal: drag commits into a new order, squash or drop them, or fix a message.

![Editing history with interactive rebase](docs/screenshots/rebase.png)

**Stash work in progress** and preview it before bringing it back. Light and dark themes follow your system.

![Stashes in the light theme](docs/screenshots/stashes-light.png)

## Tech stack

- **[Tauri 2](https://tauri.app)** — native shell, small binaries
- **Rust** backend (`src-tauri/`) that drives the `git` CLI without a shell, so file names and commit messages can never be run as commands
- **React + TypeScript + Tailwind CSS** frontend (`src/`), built with Vite

## Development

Prerequisites:

- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Node.js](https://nodejs.org) 20+
- `git` on your `PATH`
- Tauri's system dependencies for your OS: see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

```bash
git clone https://github.com/Huseynteymurzade28/GitGud.git
cd GitGud
npm install
npm run tauri dev
```

To open a specific repository during development:

```bash
npm run tauri dev -- -- /path/to/repo
```

Other commands:

| Command                                           | What it does                       |
| ------------------------------------------------- | ---------------------------------- |
| `npm run tauri build`                             | Build a release bundle for your OS |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Run the Rust tests                 |
| `npm run build`                                   | Type-check and build the frontend  |
| `npm run format`                                  | Format the frontend with Prettier  |

## Project layout

```
src/                  React frontend
  lib/git.ts          Typed wrappers for the Rust commands
  components/         UI components
src-tauri/
  src/git.rs          Git operations (runs the git CLI, parses its output)
  src/github.rs       GitHub sign-in, token storage and API calls
  src/lib.rs          Tauri commands exposed to the frontend
```

## Roadmap

Planned work lives in [GitHub issues](https://github.com/qiral/gitgud/issues). Issues labeled [good first issue](https://github.com/qiral/gitgud/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are a nice place to start contributing.

## Releases

Push a tag such as `v0.2.0` and the Release workflow builds installers for Linux (AppImage, .deb, .rpm), Windows (.msi, .exe) and macOS (Intel and Apple Silicon .dmg), then attaches them to a draft GitHub release. Bump `version` in `src-tauri/tauri.conf.json` first. Builds are not code-signed yet, so Windows and macOS will warn on first launch.

## Contributing

Contributions are welcome. Open an issue to discuss larger changes before starting on them.

1. Fork the repository and create a branch: `git switch -c feature/my-feature`
2. Make your change; run `cargo test` and `npm run build`
3. Open a pull request

## License

[MIT](LICENSE)
