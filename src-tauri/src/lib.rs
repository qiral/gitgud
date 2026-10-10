mod conflict;
mod git;
mod github;
mod graph;
mod patch;
mod rebase;

use conflict::{Choice, Part};
use git::{
    Branch, Commit, GitError, LineAction, MergeOutcome, PullMode, PullOutcome, RepoInfo, Result,
    Side, Stash, Status,
};
use github::{Account, CreatedRepo, DeviceCode, PollResult, RemoteRepo};
use rebase::{RebaseOutcome, RebasePlan, TodoItem};
use std::path::Path;
use tauri::Emitter;

// Commands are marked `async` so git runs on a worker thread instead of
// blocking the UI thread.

/// Repository passed on the command line, e.g. `gitgud ~/code/project`.
#[tauri::command]
fn initial_repo() -> Option<String> {
    std::env::args().nth(1)
}

#[tauri::command(async)]
fn open_repo(path: String) -> Result<RepoInfo> {
    git::open(Path::new(&path))
}

#[tauri::command(async)]
fn status(repo: String) -> Result<Status> {
    git::status(Path::new(&repo))
}

#[tauri::command(async)]
fn stage(repo: String, paths: Vec<String>) -> Result<()> {
    git::stage(Path::new(&repo), &paths)
}

#[tauri::command(async)]
fn unstage(repo: String, paths: Vec<String>) -> Result<()> {
    git::unstage(Path::new(&repo), &paths)
}

#[tauri::command(async)]
fn discard(repo: String, paths: Vec<String>) -> Result<()> {
    git::discard(Path::new(&repo), &paths)
}

#[tauri::command(async)]
fn apply_lines(repo: String, diff: String, lines: Vec<usize>, action: LineAction) -> Result<()> {
    git::apply_lines(Path::new(&repo), &diff, &lines, action)
}

#[tauri::command(async)]
fn commit(repo: String, message: String) -> Result<()> {
    git::commit(Path::new(&repo), &message)
}

#[tauri::command(async)]
fn diff(repo: String, path: String, staged: bool, untracked: bool) -> Result<String> {
    git::diff(Path::new(&repo), &path, staged, untracked)
}

#[tauri::command(async)]
fn branches(repo: String) -> Result<Vec<Branch>> {
    git::branches(Path::new(&repo))
}

#[tauri::command(async)]
fn switch_branch(repo: String, name: String) -> Result<()> {
    git::switch_branch(Path::new(&repo), &name)
}

#[tauri::command(async)]
fn create_branch(repo: String, name: String) -> Result<()> {
    git::create_branch(Path::new(&repo), &name)
}

#[tauri::command(async)]
fn log(repo: String, limit: u32) -> Result<Vec<Commit>> {
    git::log(Path::new(&repo), limit)
}

#[tauri::command(async)]
fn show_commit(repo: String, hash: String) -> Result<String> {
    git::show_commit(Path::new(&repo), &hash)
}

#[tauri::command(async)]
fn merge(repo: String, branch: String) -> Result<MergeOutcome> {
    git::merge(Path::new(&repo), &branch)
}

#[tauri::command(async)]
fn merge_abort(repo: String) -> Result<()> {
    git::merge_abort(Path::new(&repo))
}

#[tauri::command(async)]
fn merge_commit(repo: String) -> Result<()> {
    git::merge_commit(Path::new(&repo))
}

#[tauri::command(async)]
fn conflict_parts(repo: String, path: String) -> Result<Vec<Part>> {
    git::conflict_parts(Path::new(&repo), &path)
}

#[tauri::command(async)]
fn resolve_block(repo: String, path: String, index: usize, choice: Choice) -> Result<()> {
    git::resolve_block(Path::new(&repo), &path, index, choice)
}

#[tauri::command(async)]
fn resolve_file(repo: String, path: String, side: Side) -> Result<()> {
    git::resolve_file(Path::new(&repo), &path, side)
}

#[tauri::command(async)]
fn mark_resolved(repo: String, path: String) -> Result<()> {
    git::mark_resolved(Path::new(&repo), &path)
}

#[tauri::command(async)]
fn rebase_plan(repo: String, from: String) -> Result<RebasePlan> {
    rebase::plan(Path::new(&repo), &from)
}

#[tauri::command(async)]
fn rebase_start(repo: String, from: String, items: Vec<TodoItem>) -> Result<RebaseOutcome> {
    rebase::start(Path::new(&repo), &from, &items)
}

#[tauri::command(async)]
fn rebase_continue(repo: String) -> Result<RebaseOutcome> {
    rebase::continue_(Path::new(&repo))
}

#[tauri::command(async)]
fn rebase_abort(repo: String) -> Result<()> {
    rebase::abort(Path::new(&repo))
}

#[tauri::command(async)]
fn push_force(repo: String) -> Result<()> {
    git::push_force(Path::new(&repo), &github::git_env())
}

#[tauri::command(async)]
fn stashes(repo: String) -> Result<Vec<Stash>> {
    git::stashes(Path::new(&repo))
}

#[tauri::command(async)]
fn stash_push(repo: String, message: String, include_untracked: bool) -> Result<()> {
    git::stash_push(Path::new(&repo), &message, include_untracked)
}

#[tauri::command(async)]
fn stash_apply(repo: String, index: u32) -> Result<()> {
    git::stash_apply(Path::new(&repo), index)
}

#[tauri::command(async)]
fn stash_pop(repo: String, index: u32) -> Result<()> {
    git::stash_pop(Path::new(&repo), index)
}

#[tauri::command(async)]
fn stash_drop(repo: String, index: u32) -> Result<()> {
    git::stash_drop(Path::new(&repo), index)
}

#[tauri::command(async)]
fn stash_show(repo: String, index: u32) -> Result<String> {
    git::stash_show(Path::new(&repo), index)
}

#[tauri::command(async)]
fn fetch(repo: String) -> Result<()> {
    git::fetch(Path::new(&repo), &github::git_env())
}

#[tauri::command(async)]
fn pull(repo: String, mode: Option<PullMode>, remember: bool) -> Result<PullOutcome> {
    git::pull(Path::new(&repo), &github::git_env(), mode, remember)
}

#[tauri::command(async)]
fn push(repo: String) -> Result<()> {
    git::push(Path::new(&repo), &github::git_env())
}

#[tauri::command(async)]
fn origin_url(repo: String) -> Result<Option<String>> {
    git::origin_url(Path::new(&repo))
}

#[tauri::command(async)]
fn github_account() -> Result<Option<Account>> {
    github::account()
}

#[tauri::command(async)]
fn github_start_sign_in() -> Result<DeviceCode> {
    github::start_sign_in()
}

#[tauri::command(async)]
fn github_poll_sign_in(device_code: String, interval: u64) -> Result<PollResult> {
    github::poll_sign_in(&device_code, interval)
}

#[tauri::command(async)]
fn github_sign_out() -> Result<()> {
    github::sign_out()
}

/// Creates a GitHub repository, adds it as `origin` and pushes the current branch.
#[tauri::command(async)]
fn publish_to_github(
    repo: String,
    name: String,
    description: String,
    private: bool,
) -> Result<CreatedRepo> {
    let path = Path::new(&repo);
    if git::origin_url(path)?.is_some() {
        return Err(GitError::Failed(
            "This repository already has an 'origin' remote".into(),
        ));
    }
    let created = github::create_repo(&name, &description, private)?;
    git::add_origin(path, &created.clone_url)?;
    git::push(path, &github::git_env())?;
    Ok(created)
}

#[tauri::command(async)]
fn github_repos() -> Result<Vec<RemoteRepo>> {
    github::list_repos()
}

/// Clones into `parent/name`, emitting `clone-progress` events while it runs.
#[tauri::command(async)]
fn clone_repo(
    app: tauri::AppHandle,
    url: String,
    parent: String,
    name: String,
) -> Result<RepoInfo> {
    let dest = git::clone(&url, Path::new(&parent), &name, &github::git_env(), |p| {
        let _ = app.emit("clone-progress", p);
    })?;
    git::open(&dest)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            initial_repo,
            open_repo,
            status,
            stage,
            unstage,
            discard,
            apply_lines,
            commit,
            diff,
            branches,
            switch_branch,
            create_branch,
            log,
            show_commit,
            merge,
            merge_abort,
            merge_commit,
            conflict_parts,
            resolve_block,
            resolve_file,
            mark_resolved,
            rebase_plan,
            rebase_start,
            rebase_continue,
            rebase_abort,
            push_force,
            stashes,
            stash_push,
            stash_apply,
            stash_pop,
            stash_drop,
            stash_show,
            fetch,
            pull,
            push,
            origin_url,
            github_account,
            github_start_sign_in,
            github_poll_sign_in,
            github_sign_out,
            publish_to_github,
            github_repos,
            clone_repo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
