import { useEffect, useRef, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  CircleArrowUp,
  Copy,
  Download,
  FileDiff,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitBranchPlus,
  GitMerge,
  Globe,
  History,
  Keyboard,
  LogIn,
  LogOut,
  Palette,
  RefreshCw,
  Search,
  Server,
  Undo2,
} from 'lucide-react'
import {
  git,
  type Branch,
  type RepoInfo,
  type Status,
  type Undoable,
} from '../lib/git'
import { copyText } from '../lib/copy'
import { readTheme, setTheme, THEMES } from '../lib/prefs'
import { isTyping, matches } from '../lib/shortcuts'
import { useUpdates } from '../lib/updates'
import CommandPalette, { type Command } from './CommandPalette'
import ShortcutsDialog from './ShortcutsDialog'
import PromptDialog from './PromptDialog'
import type { Sync } from './SyncActions'
import { useTranslation } from '../i18n'

type Act = (label: string, action: () => Promise<unknown>) => Promise<boolean>
export type Tab = 'changes' | 'history' | 'stashes'

interface Options {
  repo: RepoInfo
  /** Turns a description into a branch name with Copilot. */
  suggestBranchName?: (description: string) => Promise<string | null>
  status: Status | null
  branches: Branch[]
  remoteBranches: string[]
  recents: RepoInfo[]
  signedIn: boolean
  sync: Sync
  busy: boolean
  act: Act
  showTab: (tab: Tab) => void
  searchHistory: () => void
  onOpenOther: () => void
  onOpenRecent: (path: string) => void
  onClone: () => void
  onStash: () => void
  onSignIn: () => void
  onSignOut: () => void
  onManageHosts: () => void
  onManageRemotes: () => void
  undoable: Undoable | null
  onUndo: (id: number) => void
  onReflog: () => void
  /** More commands from other features, e.g. pull requests. */
  extra?: Command[]
}

/**
 * Every action as a command: listed in the command palette (Ctrl+K / Cmd+K)
 * and run by its shortcut anywhere in the repository view. Render `ui` once.
 */
export function useRepoCommands(o: Options) {
  const { t, tp } = useTranslation()
  const [palette, setPalette] = useState<Command | 'root' | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  const [newBranch, setNewBranch] = useState(false)
  const updates = useUpdates()
  const current = o.status?.branch ?? null
  const others = o.branches.filter((b) => !b.current)

  async function mergeIn(name: string) {
    const ok = await confirm(
      t('toolbar.merge-branch-confirm', { name, branch: current }),
      { title: t('toolbar.merge-branch'), kind: 'info' },
    )
    if (ok) await o.act('merge', () => git.merge(o.repo.path, name))
  }

  const { sync } = o
  const pushLabel = sync.needsRemote
    ? t('repocommands.publish-to-github')
    : !sync.hasUpstream
      ? t('toolbar.publish-branch')
      : sync.diverged
        ? t('repocommands.force-push')
        : t('toolbar.push')

  const commands: Command[] = [
    // Repository
    {
      id: 'open',
      group: t('repocommands.group-repository'),
      label: t('toolbar.open-local-repository'),
      icon: FolderOpen,
      shortcut: 'mod+o',
      run: o.onOpenOther,
    },
    {
      id: 'clone',
      group: t('repocommands.group-repository'),
      label: t('repocommands.clone-repository'),
      icon: Download,
      shortcut: 'mod+shift+o',
      run: o.onClone,
    },
    {
      id: 'recent',
      group: t('repocommands.group-repository'),
      label: t('repocommands.open-recent-repository'),
      icon: FolderGit2,
      disabled: o.recents.every((r) => r.path === o.repo.path),
      page: {
        placeholder: t('repocommands.pick-a-repository'),
        items: () =>
          o.recents
            .filter((r) => r.path !== o.repo.path)
            .map((r) => ({
              id: `recent:${r.path}`,
              group: t('toolbar.recent'),
              label: r.name,
              detail: r.path,
              icon: FolderGit2,
              run: () => o.onOpenRecent(r.path),
            })),
      },
    },
    {
      id: 'reveal',
      group: t('repocommands.group-repository'),
      label: t('repocommands.show-repository-in-folder'),
      icon: FolderOpen,
      run: () => revealItemInDir(o.repo.path).catch(() => {}),
    },
    {
      id: 'copyPath',
      group: t('repocommands.group-repository'),
      label: t('repocommands.copy-repository-path'),
      icon: Copy,
      run: () => copyText(o.repo.path),
    },

    // Remote
    {
      id: 'fetch',
      group: t('repocommands.group-remote'),
      label: t('toolbar.fetch'),
      icon: RefreshCw,
      shortcut: 'mod+shift+t',
      disabled: o.busy,
      run: sync.fetch,
    },
    {
      id: 'pull',
      group: t('repocommands.group-remote'),
      label: t('toolbar.pull'),
      detail: sync.behind > 0 ? tp('toolbar.behind', sync.behind) : undefined,
      icon: ArrowDown,
      shortcut: 'mod+shift+p',
      disabled: o.busy || !sync.hasUpstream,
      run: () => sync.pull(),
    },
    {
      id: 'push',
      group: t('repocommands.group-remote'),
      label: pushLabel,
      detail: sync.ahead > 0 ? tp('toolbar.ahead', sync.ahead) : undefined,
      keywords: 'push publish',
      icon: ArrowUp,
      shortcut: 'mod+p',
      disabled: o.busy || !current,
      run: sync.push,
    },
    {
      id: 'remotes',
      group: t('repocommands.group-remote'),
      label: t('repocommands.manage-remotes'),
      keywords: 'origin upstream fork url',
      icon: Globe,
      run: o.onManageRemotes,
    },
    ...(o.extra ?? []),

    // Branch
    {
      id: 'newBranch',
      group: t('repocommands.group-branch'),
      label: t('repocommands.new-branch'),
      icon: GitBranchPlus,
      shortcut: 'mod+shift+n',
      keywords: 'create',
      run: () => setNewBranch(true),
    },
    {
      id: 'switch',
      group: t('repocommands.group-branch'),
      label: t('repocommands.switch-branch'),
      icon: GitBranch,
      shortcut: 'mod+b',
      keywords: 'checkout',
      disabled: others.length === 0,
      page: {
        placeholder: t('repocommands.switch-to-branch'),
        items: () =>
          others.map((b) => ({
            id: `switch:${b.name}`,
            group: t('repocommands.group-branches'),
            label: b.name,
            detail: b.upstream ?? undefined,
            icon: GitBranch,
            run: () =>
              o.act('switch', () => git.switchBranch(o.repo.path, b.name)),
          })),
      },
    },
    {
      id: 'merge',
      group: t('repocommands.group-branch'),
      label: current
        ? t('toolbar.merge-into-branch', { branch: current })
        : t('repocommands.merge-branch'),
      icon: GitMerge,
      shortcut: 'mod+shift+m',
      disabled: !current || others.length + o.remoteBranches.length === 0,
      page: {
        placeholder: t('repocommands.branch-to-merge-into', {
          branch: current,
        }),
        items: () => [
          ...others.map((b) => ({
            id: `merge:${b.name}`,
            group: t('repocommands.group-branches'),
            label: b.name,
            icon: GitMerge,
            run: () => mergeIn(b.name),
          })),
          ...o.remoteBranches.map((name) => ({
            id: `merge:remote:${name}`,
            group: t('repocommands.group-remote-branches'),
            label: name,
            icon: Globe,
            run: () => mergeIn(name),
          })),
        ],
      },
    },
    {
      id: 'stash',
      group: t('repocommands.group-branch'),
      label: t('repocommands.stash-changes'),
      icon: Archive,
      shortcut: 'mod+shift+s',
      disabled: !o.status?.files.length,
      run: o.onStash,
    },

    {
      id: 'undo',
      group: t('repocommands.group-branch'),
      label: t('undo.undo-last'),
      detail: o.undoable ? t(`undo.done-${o.undoable.kind}`) : undefined,
      icon: Undo2,
      disabled: o.busy || !o.undoable,
      run: () => o.undoable && o.onUndo(o.undoable.id),
    },
    {
      id: 'reflog',
      group: t('repocommands.group-branch'),
      label: t('repocommands.reflog'),
      keywords: 'lost recover deleted stash undo',
      icon: History,
      run: o.onReflog,
    },

    // View
    {
      id: 'changes',
      group: t('repocommands.group-view'),
      label: t('repocommands.show-changes'),
      icon: FileDiff,
      shortcut: 'mod+1',
      run: () => o.showTab('changes'),
    },
    {
      id: 'history',
      group: t('repocommands.group-view'),
      label: t('repocommands.show-history'),
      icon: History,
      shortcut: 'mod+2',
      run: () => o.showTab('history'),
    },
    {
      id: 'stashes',
      group: t('repocommands.group-view'),
      label: t('repocommands.show-stashes'),
      icon: Archive,
      shortcut: 'mod+3',
      run: () => o.showTab('stashes'),
    },
    {
      id: 'search',
      group: t('repocommands.group-view'),
      label: t('repocommands.search-history'),
      icon: Search,
      shortcut: 'mod+f',
      keywords: 'find commit',
      run: o.searchHistory,
    },
    {
      id: 'theme',
      group: t('repocommands.group-view'),
      label: t('repocommands.change-theme'),
      icon: Palette,
      page: {
        placeholder: t('repocommands.pick-a-theme'),
        items: () => {
          const now = readTheme()
          return [
            { id: 'system', label: t('toolbar.match-system'), dark: null },
            ...THEMES,
          ].map((th) => ({
            id: `theme:${th.id}`,
            group: t('repocommands.group-themes'),
            label: th.label,
            detail:
              th.id === now
                ? t('repocommands.current')
                : th.dark === null
                  ? undefined
                  : th.dark
                    ? t('repocommands.dark')
                    : t('repocommands.light'),
            icon: Palette,
            run: () => setTheme(th.id),
          }))
        },
      },
    },
    {
      id: 'palette',
      group: t('repocommands.group-view'),
      label: t('toolbar.command-palette'),
      icon: Search,
      shortcut: 'mod+k',
      run: () => setPalette('root'),
    },
    {
      id: 'shortcuts',
      group: t('repocommands.group-view'),
      label: t('shortcutsdialog.keyboard-shortcuts'),
      icon: Keyboard,
      shortcut: 'f1',
      run: () => setShowKeys(true),
    },

    // Account
    o.signedIn
      ? {
          id: 'signOut',
          group: t('repocommands.group-account'),
          label: t('repocommands.sign-out-of-github'),
          icon: LogOut,
          run: o.onSignOut,
        }
      : {
          id: 'signIn',
          group: t('repocommands.group-account'),
          label: t('repocommands.sign-in-to-github'),
          icon: LogIn,
          run: o.onSignIn,
        },
    {
      id: 'hosts',
      group: t('repocommands.group-account'),
      label: t('toolbar.other-git-hosts'),
      icon: Server,
      keywords: 'gitlab gitea forgejo token',
      run: o.onManageHosts,
    },
    {
      id: 'updates',
      group: t('repocommands.group-account'),
      label: updates.update
        ? t('app.update-to', { version: updates.update.version })
        : t('app.check-for-updates'),
      icon: CircleArrowUp,
      run: () => (updates.update ? updates.openCard() : updates.check(true)),
    },
  ]

  // Read in the key handler so it always sees the latest commands.
  const latest = useRef(commands)
  latest.current = commands

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat) return
      const command = latest.current.find(
        (c) => c.shortcut && matches(e, c.shortcut),
      )
      if (!command) return
      // Dialogs and the palette itself keep their keys, but the palette
      // shortcut still closes the palette.
      const modal = document.querySelector('[aria-modal="true"]')
      if (modal) {
        if (
          command.id === 'palette' &&
          modal.hasAttribute('data-command-palette')
        ) {
          e.preventDefault()
          setPalette(null)
        }
        return
      }
      // Typed characters belong to whatever field is focused.
      if (isTyping(e) && !e.ctrlKey && !e.metaKey && e.key.length === 1) return
      e.preventDefault()
      if (command.disabled) return
      if (command.page) setPalette(command)
      else command.run?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const listed = commands.filter((c) => c.id !== 'palette')
  const ui = (
    <>
      {palette && (
        <CommandPalette
          // A new palette each time, so it starts on the right page.
          key={palette === 'root' ? 'root' : palette.id}
          commands={listed}
          start={palette === 'root' ? undefined : palette}
          onClose={() => setPalette(null)}
        />
      )}
      {showKeys && (
        <ShortcutsDialog
          commands={commands}
          onClose={() => setShowKeys(false)}
        />
      )}
      {newBranch && (
        <PromptDialog
          title={t('repocommands.new-branch-title')}
          label={t('repocommands.name')}
          description={
            current
              ? t('repocommands.new-branch-description', { branch: current })
              : undefined
          }
          submitLabel={t('repocommands.create-branch')}
          onSuggest={o.suggestBranchName}
          onSubmit={(name) =>
            o.act('branch', () => git.createBranch(o.repo.path, name))
          }
          onClose={() => setNewBranch(false)}
        />
      )}
    </>
  )

  return { commands, ui, openPalette: () => setPalette('root') }
}
