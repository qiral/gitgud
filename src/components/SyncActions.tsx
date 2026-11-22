import { useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { git, type PullMode, type RepoInfo, type Status } from '../lib/git'
import PullDialog from './PullDialog'

type Act = (label: string, action: () => Promise<unknown>) => Promise<boolean>

/**
 * Fetch, pull and push for the toolbar buttons and the command palette.
 * Render `dialog` once; it asks how to pull when the branches diverged.
 */
export function useSync(
  repo: RepoInfo,
  status: Status | null,
  originUrl: string | null,
  act: Act,
  onPublish: () => void,
) {
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  const hasUpstream = Boolean(status?.upstream)
  // Without any remote, "push" means creating the repository on GitHub first.
  const needsRemote = !hasUpstream && originUrl === null
  // After editing pushed history, a normal push is rejected.
  const diverged = hasUpstream && ahead > 0 && behind > 0
  const [askPull, setAskPull] = useState(false)

  const fetch = () => act('fetch', () => git.fetch(repo.path))

  async function pull(mode: PullMode | null = null, remember = false) {
    if (!hasUpstream) return
    setAskPull(false)
    let mustAsk = false
    await act('pull', async () => {
      mustAsk = (await git.pull(repo.path, mode, remember)).diverged
    })
    // Conflicts show up in the Changes tab by themselves.
    if (mustAsk) setAskPull(true)
  }

  async function forcePush() {
    const ok = await confirm(
      `Your branch and ${status?.upstream} have diverged (${ahead} ahead, ${behind} behind).\n\n` +
        'Force pushing replaces the remote branch with yours. Do this after editing history you already pushed. ' +
        'If someone else pushed to this branch, Pull instead, or their commits will be lost.',
      { title: 'Force push', kind: 'warning', okLabel: 'Force push' },
    )
    if (ok) act('push', () => git.pushForce(repo.path))
  }

  /** Pushes, publishes the branch, publishes the repo or force pushes,
   *  whichever the branch needs. */
  function push() {
    if (!status?.branch) return
    if (needsRemote) onPublish()
    else if (diverged) forcePush()
    else act('push', () => git.push(repo.path))
  }

  const dialog = askPull && status?.branch && status.upstream && (
    <PullDialog
      branch={status.branch}
      upstream={status.upstream}
      ahead={ahead}
      behind={behind}
      onPull={pull}
      onClose={() => setAskPull(false)}
    />
  )

  return {
    ahead,
    behind,
    hasUpstream,
    needsRemote,
    diverged,
    fetch,
    pull,
    push,
    dialog,
  }
}

export type Sync = ReturnType<typeof useSync>
