mod blame;
mod conflict;
mod copilot;
pub mod git;
mod github;
mod graph;
mod hosts;
mod ignore;
mod patch;
mod pulls;
mod rebase;
mod remotes;
mod undo;

use blame::Blame;
use conflict::{Choice, Part};
use copilot::{Copilot, InstallProgress};
use git::{
    Branch, CloneCancel, Commit, DeleteBranchOutcome, GitError, LastCommit, LineAction,
    MergeOutcome, PullMode, PullOutcome, RepoInfo, ResetMode, Result, Side, Stash, Status,
};
use github::{Account, CreatedRepo, DeviceCode, PollResult, RemoteRepo};
use hosts::{Host, HostKind};
use ignore::IgnoreKind;
use pulls::{Comparison, Parent, PullRequest, PullTarget};
use rebase::{RebaseOutcome, RebasePlan, TodoItem};
use remotes::Remote;
use std::path::Path;
use tauri::{Emitter, Manager};
use undo::{Kind, ReflogEntry, UndoLog, Undoable};

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
fn discard(undo: tauri::State<UndoLog>, repo: String, paths: Vec<String>) -> Result<()> {
    let repo = Path::new(&repo);
    undo.discard(repo, &paths)
}

#[tauri::command(async)]
fn apply_lines(
    undo: tauri::State<UndoLog>,
    repo: String,
    diff: String,
    lines: Vec<usize>,
    action: LineAction,
) -> Result<()> {
    let repo = Path::new(&repo);
    match action {
        LineAction::Discard => undo.discard_lines(repo, &diff, &lines),
        _ => git::apply_lines(repo, &diff, &lines, action),
    }
}

#[tauri::command(async)]
fn ignore(repo: String, path: String, kind: IgnoreKind) -> Result<()> {
    ignore::add(Path::new(&repo), &path, kind)
}

/// What committing now would finish, if anything is in progress.
fn finishing(repo: &Path) -> Result<Option<Kind>> {
    Ok(git::status(repo)?.operation.map(|op| match op {
        git::Operation::CherryPick => Kind::CherryPick,
        git::Operation::Revert => Kind::Revert,
        git::Operation::Merge => Kind::Merge,
    }))
}

#[tauri::command(async)]
fn commit(undo: tauri::State<UndoLog>, repo: String, message: String) -> Result<()> {
    let repo = Path::new(&repo);
    // With a message typed, this is also how a merge or pick is finished.
    let kind = finishing(repo)?.unwrap_or(Kind::Commit);
    undo.track(repo, kind, || git::commit(repo, &message))
}

#[tauri::command(async)]
fn amend(undo: tauri::State<UndoLog>, repo: String, message: String) -> Result<()> {
    let repo = Path::new(&repo);
    undo.track(repo, Kind::Amend, || git::amend(repo, &message))
}

#[tauri::command(async)]
fn last_commit(repo: String) -> Result<Option<LastCommit>> {
    git::last_commit(Path::new(&repo))
}

#[tauri::command(async)]
fn diff(
    repo: String,
    path: String,
    staged: bool,
    untracked: bool,
    ignore_whitespace: bool,
) -> Result<String> {
    git::diff(
        Path::new(&repo),
        &path,
        staged,
        untracked,
        ignore_whitespace,
    )
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
fn delete_branch(
    undo: tauri::State<UndoLog>,
    repo: String,
    name: String,
    force: bool,
) -> Result<DeleteBranchOutcome> {
    let repo = Path::new(&repo);
    undo.delete_branch(repo, &name, force)
}

#[tauri::command(async)]
fn rename_branch(repo: String, old: String, new: String) -> Result<()> {
    git::rename_branch(Path::new(&repo), &old, &new)
}

#[tauri::command(async)]
fn log(repo: String, limit: u32) -> Result<Vec<Commit>> {
    git::log(Path::new(&repo), limit)
}

#[tauri::command(async)]
fn search_log(repo: String, query: String, limit: u32) -> Result<Vec<Commit>> {
    git::search_log(Path::new(&repo), &query, limit)
}

#[tauri::command(async)]
fn file_log(repo: String, path: String, limit: u32) -> Result<Vec<Commit>> {
    git::file_log(Path::new(&repo), &path, limit)
}

#[tauri::command(async)]
fn blame(
    repo: String,
    path: String,
    rev: Option<String>,
    ignore_whitespace: bool,
    follow_moves: bool,
) -> Result<Blame> {
    blame::blame(
        Path::new(&repo),
        &path,
        rev.as_deref(),
        ignore_whitespace,
        follow_moves,
    )
}

/// Lays out the graph again for a subset of the history, e.g. with some
/// branch lines hidden. `commits` are (hash, parent hashes), newest first.
#[tauri::command(async)]
fn graph_layout(commits: Vec<(String, Vec<String>)>) -> Vec<graph::GraphRow> {
    graph::layout(&commits)
}

#[tauri::command(async)]
fn show_commit(repo: String, hash: String, ignore_whitespace: bool) -> Result<String> {
    git::show_commit(Path::new(&repo), &hash, ignore_whitespace)
}

#[tauri::command(async)]
fn merge(undo: tauri::State<UndoLog>, repo: String, branch: String) -> Result<MergeOutcome> {
    let repo = Path::new(&repo);
    undo.track(repo, Kind::Merge, || git::merge(repo, &branch))
}

#[tauri::command(async)]
fn merge_abort(repo: String) -> Result<()> {
    git::merge_abort(Path::new(&repo))
}

#[tauri::command(async)]
fn merge_commit(undo: tauri::State<UndoLog>, repo: String) -> Result<()> {
    let repo = Path::new(&repo);
    let kind = finishing(repo)?.unwrap_or(Kind::Merge);
    undo.track(repo, kind, || git::merge_commit(repo))
}

#[tauri::command(async)]
fn cherry_pick(undo: tauri::State<UndoLog>, repo: String, hash: String) -> Result<MergeOutcome> {
    let repo = Path::new(&repo);
    undo.track(repo, Kind::CherryPick, || git::cherry_pick(repo, &hash))
}

#[tauri::command(async)]
fn revert(undo: tauri::State<UndoLog>, repo: String, hash: String) -> Result<MergeOutcome> {
    let repo = Path::new(&repo);
    undo.track(repo, Kind::Revert, || git::revert(repo, &hash))
}

#[tauri::command(async)]
fn reset(undo: tauri::State<UndoLog>, repo: String, hash: String, mode: ResetMode) -> Result<()> {
    let repo = Path::new(&repo);
    undo.reset(repo, &hash, mode)
}

#[tauri::command(async)]
fn create_branch_at(repo: String, name: String, hash: String) -> Result<()> {
    git::create_branch_at(Path::new(&repo), &name, &hash)
}

#[tauri::command(async)]
fn create_tag(repo: String, name: String, hash: String, message: String) -> Result<()> {
    git::create_tag(Path::new(&repo), &name, &hash, &message)
}

#[tauri::command(async)]
fn delete_tag(repo: String, name: String) -> Result<()> {
    git::delete_tag(Path::new(&repo), &name)
}

#[tauri::command(async)]
fn push_tag(repo: String, name: String, remote: Option<String>) -> Result<()> {
    git::push_tag(
        Path::new(&repo),
        &name,
        remote.as_deref(),
        &hosts::git_env(),
    )
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
fn resolve_block_text(repo: String, path: String, index: usize, text: String) -> Result<()> {
    git::resolve_block_text(Path::new(&repo), &path, index, &text)
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
fn rebase_start(
    undo: tauri::State<UndoLog>,
    repo: String,
    from: String,
    items: Vec<TodoItem>,
) -> Result<RebaseOutcome> {
    let repo = Path::new(&repo);
    undo.track(repo, Kind::Rebase, || rebase::start(repo, &from, &items))
}

#[tauri::command(async)]
fn rebase_continue(undo: tauri::State<UndoLog>, repo: String) -> Result<RebaseOutcome> {
    let repo = Path::new(&repo);
    undo.track_continue(repo, || rebase::continue_(repo))
}

#[tauri::command(async)]
fn rebase_abort(repo: String) -> Result<()> {
    rebase::abort(Path::new(&repo))
}

#[tauri::command(async)]
fn push_force(repo: String) -> Result<()> {
    git::push_force(Path::new(&repo), &hosts::git_env())
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
fn stash_drop(undo: tauri::State<UndoLog>, repo: String, index: u32) -> Result<()> {
    let repo = Path::new(&repo);
    undo.drop_stash(repo, index)
}

#[tauri::command(async)]
fn stash_show(repo: String, index: u32, ignore_whitespace: bool) -> Result<String> {
    git::stash_show(Path::new(&repo), index, ignore_whitespace)
}

/// What `undo` would take back, if anything.
#[tauri::command(async)]
fn undo_available(undo: tauri::State<UndoLog>, repo: String) -> Result<Option<Undoable>> {
    undo.available(Path::new(&repo))
}

#[tauri::command(async)]
fn undo_last(undo: tauri::State<UndoLog>, repo: String, id: u64) -> Result<()> {
    undo.undo(Path::new(&repo), id)
}

#[tauri::command(async)]
fn reflog(repo: String, branch: Option<String>) -> Result<Vec<ReflogEntry>> {
    undo::reflog(Path::new(&repo), branch.as_deref())
}

#[tauri::command(async)]
fn lost_stashes(repo: String) -> Result<Vec<ReflogEntry>> {
    undo::lost_stashes(Path::new(&repo))
}

#[tauri::command(async)]
fn recover_stash(repo: String, hash: String) -> Result<()> {
    undo::recover_stash(Path::new(&repo), &hash)
}

#[tauri::command(async)]
fn fetch(repo: String, remote: Option<String>, prune: bool) -> Result<()> {
    git::fetch(
        Path::new(&repo),
        remote.as_deref(),
        prune,
        &hosts::git_env(),
    )
}

#[tauri::command(async)]
fn pull(repo: String, mode: Option<PullMode>, remember: bool) -> Result<PullOutcome> {
    git::pull(Path::new(&repo), &hosts::git_env(), mode, remember)
}

#[tauri::command(async)]
fn push(repo: String, remote: Option<String>) -> Result<()> {
    git::push(Path::new(&repo), remote.as_deref(), &hosts::git_env())
}

#[tauri::command(async)]
fn remotes(repo: String) -> Result<Vec<Remote>> {
    remotes::list(Path::new(&repo))
}

#[tauri::command(async)]
fn remote_branches(repo: String) -> Result<Vec<String>> {
    remotes::branches(Path::new(&repo))
}

#[tauri::command(async)]
fn add_remote(repo: String, name: String, url: String) -> Result<()> {
    remotes::add(Path::new(&repo), &name, &url)
}

#[tauri::command(async)]
fn rename_remote(repo: String, old: String, new: String) -> Result<()> {
    remotes::rename(Path::new(&repo), &old, &new)
}

#[tauri::command(async)]
fn set_remote_url(repo: String, name: String, url: String) -> Result<()> {
    remotes::set_url(Path::new(&repo), &name, &url)
}

#[tauri::command(async)]
fn remove_remote(repo: String, name: String) -> Result<()> {
    remotes::remove(Path::new(&repo), &name)
}

#[tauri::command(async)]
fn set_upstream(repo: String, branch: String, upstream: Option<String>) -> Result<()> {
    remotes::set_upstream(Path::new(&repo), &branch, upstream.as_deref())
}

#[tauri::command(async)]
fn github_parent(repo: String) -> Result<Option<Parent>> {
    pulls::parent(Path::new(&repo))
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

#[tauri::command(async)]
fn hosts_list() -> Result<Vec<Host>> {
    hosts::list()
}

#[tauri::command(async)]
fn host_add(url: String, kind: HostKind, username: String, token: String) -> Result<Host> {
    hosts::add(&url, kind, &username, &token)
}

#[tauri::command(async)]
fn host_remove(url: String) -> Result<()> {
    hosts::remove(&url)
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
    git::push(path, Some("origin"), &hosts::git_env())?;
    Ok(created)
}

#[tauri::command(async)]
fn github_pull_target(repo: String) -> Result<Option<PullTarget>> {
    pulls::target(Path::new(&repo))
}

#[tauri::command(async)]
fn github_branches(base_repo: String) -> Result<Vec<String>> {
    pulls::branches(&base_repo)
}

#[tauri::command(async)]
fn github_compare(
    base_repo: String,
    base: String,
    head_repo: String,
    branch: String,
) -> Result<Comparison> {
    pulls::compare(&base_repo, &base, &head_repo, &branch)
}

/// Opens a pull request for the current branch. The target is looked up
/// again so the frontend can't point it somewhere else.
#[tauri::command(async)]
fn github_create_pull_request(
    repo: String,
    base: String,
    title: String,
    body: String,
    draft: bool,
) -> Result<PullRequest> {
    let target = pulls::target(Path::new(&repo))?
        .ok_or_else(|| GitError::Failed("This branch hasn't been pushed to GitHub yet".into()))?;
    pulls::create(&target, &base, &title, &body, draft)
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
    let cancel = app.state::<CloneCancel>();
    let dest = git::clone(
        &url,
        Path::new(&parent),
        &name,
        &hosts::git_env(),
        &cancel,
        |p| {
            let _ = app.emit("clone-progress", p);
        },
    )?;
    git::open(&dest)
}

fn app_data(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| GitError::Failed(format!("Could not find the app data folder: {e}")))
}

/// Downloads the Copilot CLI into app data, emitting `copilot-progress` events.
#[tauri::command(async)]
fn copilot_install(app: tauri::AppHandle) -> Result<()> {
    copilot::install(&app_data(&app)?, |percent| {
        let _ = app.emit("copilot-progress", InstallProgress { percent });
    })
    .map(drop)
}

#[tauri::command]
async fn copilot_commit_message(
    app: tauri::AppHandle,
    copilot: tauri::State<'_, Copilot>,
    repo: String,
) -> Result<String> {
    copilot.commit_message(&app_data(&app)?, repo.into()).await
}

#[tauri::command]
async fn copilot_pull_request(
    app: tauri::AppHandle,
    copilot: tauri::State<'_, Copilot>,
    repo: String,
    merge_base: String,
    commits: Vec<String>,
) -> Result<String> {
    copilot
        .pull_request(&app_data(&app)?, repo.into(), merge_base, commits)
        .await
}

#[tauri::command]
async fn copilot_squash_message(
    app: tauri::AppHandle,
    copilot: tauri::State<'_, Copilot>,
    repo: String,
    hashes: Vec<String>,
) -> Result<String> {
    copilot
        .squash_message(&app_data(&app)?, repo.into(), hashes)
        .await
}

#[tauri::command]
async fn copilot_release_notes(
    app: tauri::AppHandle,
    copilot: tauri::State<'_, Copilot>,
    repo: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<String> {
    copilot
        .release_notes(&app_data(&app)?, repo.into(), from, to)
        .await
}

#[tauri::command]
async fn copilot_branch_name(
    app: tauri::AppHandle,
    copilot: tauri::State<'_, Copilot>,
    repo: String,
    description: String,
) -> Result<String> {
    copilot
        .branch_name(&app_data(&app)?, repo.into(), description)
        .await
}

#[tauri::command]
async fn copilot_review(
    app: tauri::AppHandle,
    copilot: tauri::State<'_, Copilot>,
    repo: String,
) -> Result<String> {
    copilot.review(&app_data(&app)?, repo.into()).await
}

#[tauri::command]
async fn copilot_explain(
    app: tauri::AppHandle,
    copilot: tauri::State<'_, Copilot>,
    diff: String,
) -> Result<String> {
    copilot.explain(&app_data(&app)?, &diff).await
}

#[tauri::command]
async fn copilot_resolve(
    app: tauri::AppHandle,
    copilot: tauri::State<'_, Copilot>,
    repo: String,
    path: String,
    index: usize,
) -> Result<String> {
    copilot
        .resolve(&app_data(&app)?, repo.into(), path, index)
        .await
}

/// Stops the running `clone_repo`, which then fails with "Clone cancelled".
#[tauri::command]
fn cancel_clone(cancel: tauri::State<CloneCancel>) {
    cancel.cancel();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CloneCancel::default())
        .manage(Copilot::default())
        .manage(UndoLog::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            initial_repo,
            open_repo,
            status,
            stage,
            unstage,
            discard,
            apply_lines,
            ignore,
            commit,
            amend,
            last_commit,
            diff,
            branches,
            switch_branch,
            create_branch,
            delete_branch,
            rename_branch,
            log,
            search_log,
            file_log,
            blame,
            graph_layout,
            show_commit,
            merge,
            merge_abort,
            merge_commit,
            cherry_pick,
            revert,
            reset,
            create_branch_at,
            create_tag,
            delete_tag,
            push_tag,
            conflict_parts,
            resolve_block,
            resolve_block_text,
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
            undo_available,
            undo_last,
            reflog,
            lost_stashes,
            recover_stash,
            fetch,
            pull,
            push,
            remotes,
            remote_branches,
            add_remote,
            rename_remote,
            set_remote_url,
            remove_remote,
            set_upstream,
            github_parent,
            github_account,
            github_start_sign_in,
            github_poll_sign_in,
            github_sign_out,
            hosts_list,
            host_add,
            host_remove,
            publish_to_github,
            github_repos,
            github_pull_target,
            github_branches,
            github_compare,
            github_create_pull_request,
            clone_repo,
            cancel_clone,
            copilot_install,
            copilot_commit_message,
            copilot_explain,
            copilot_review,
            copilot_branch_name,
            copilot_release_notes,
            copilot_squash_message,
            copilot_pull_request,
            copilot_resolve,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                tauri::async_runtime::block_on(app.state::<Copilot>().stop());
            }
        });
}
