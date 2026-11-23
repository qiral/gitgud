import { useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import {
  git,
  type PullMode,
  type Remote,
  type RepoInfo,
  type Status,
} from '../lib/git'
import { defaultRemote, readPrune } from '../lib/remotes'
import ChoiceDialog from './ChoiceDialog'
import PullDialog from './PullDialog'
import { useTranslation } from '../i18n'

type Act = (label: string, action: () => Promise<unknown>) => Promise<boolean>

/**
 * Fetch, pull and push for the toolbar buttons and the command palette.
 * Render `dialog` once; it asks how to pull when the branches diverged.
 */
export function useSync(
  repo: RepoInfo,
  status: Status | null,
  remotes: Remote[],
  act: Act,
  onPublish: () => void,
) {
  const { t } = useTranslation()
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  const hasUpstream = Boolean(status?.upstream)
  // Without any remote, "push" means creating the repository on GitHub first.
  const needsRemote = !hasUpstream && remotes.length === 0
  // After editing pushed history, a normal push is rejected.
  const diverged = hasUpstream && ahead > 0 && behind > 0
  const [askPull, setAskPull] = useState(false)
  const [askRemote, setAskRemote] = useState(false)
  // Where a branch without an upstream goes, if there's no doubt about it.
  const publishTo = remotes.length === 1 ? remotes[0].name : null

  const fetch = () =>
    act('fetch', () => git.fetch(repo.path, null, readPrune()))

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
      t('toolbar.diverged', { upstream: status?.upstream, ahead, behind }) +
        t('toolbar.force-push-body'),
      {
        title: t('toolbar.force-push'),
        kind: 'warning',
        okLabel: t('toolbar.force-push'),
      },
    )
    if (ok) act('push', () => git.pushForce(repo.path))
  }

  /** Pushes, publishes the branch, publishes the repo or force pushes,
   *  whichever the branch needs. */
  function push() {
    if (!status?.branch) return
    if (needsRemote) onPublish()
    else if (diverged) forcePush()
    else if (!hasUpstream && publishTo === null) setAskRemote(true)
    else act('push', () => git.push(repo.path))
  }

  const pullDialog = askPull && status?.branch && status.upstream && (
    <PullDialog
      branch={status.branch}
      upstream={status.upstream}
      ahead={ahead}
      behind={behind}
      onPull={pull}
      onClose={() => setAskPull(false)}
    />
  )
  const remoteDialog = askRemote && status?.branch && (
    <ChoiceDialog
      title={t('toolbar.publish-branch')}
      label={t('syncactions.publish-to', { branch: status.branch })}
      options={remotes.map((r) => ({ value: r.name, label: r.name }))}
      initial={defaultRemote(remotes)?.name ?? ''}
      submitLabel={t('toolbar.publish-branch')}
      onSubmit={(remote) => act('push', () => git.push(repo.path, remote))}
      onClose={() => setAskRemote(false)}
    />
  )
  const dialog = (
    <>
      {pullDialog}
      {remoteDialog}
    </>
  )

  return {
    ahead,
    behind,
    hasUpstream,
    needsRemote,
    publishTo,
    diverged,
    fetch,
    pull,
    push,
    dialog,
  }
}

export type Sync = ReturnType<typeof useSync>
