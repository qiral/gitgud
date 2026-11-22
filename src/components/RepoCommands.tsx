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
  History,
  Keyboard,
  LogIn,
  LogOut,
  Palette,
  RefreshCw,
  Search,
  Server,
} from 'lucide-react'
import { git, type Branch, type RepoInfo, type Status } from '../lib/git'
import { copyText } from '../lib/copy'
import { readTheme, setTheme, THEMES } from '../lib/prefs'
import { isTyping, matches } from '../lib/shortcuts'
import { useUpdates } from '../lib/updates'
import CommandPalette, { type Command } from './CommandPalette'
import ShortcutsDialog from './ShortcutsDialog'
import PromptDialog from './PromptDialog'
import type { Sync } from './SyncActions'

type Act = (label: string, action: () => Promise<unknown>) => Promise<boolean>
export type Tab = 'changes' | 'history' | 'stashes'

interface Options {
  repo: RepoInfo
  status: Status | null
  branches: Branch[]
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
  /** More commands from other features, e.g. pull requests. */
  extra?: Command[]
}

/**
 * Every action as a command: listed in the command palette (Ctrl+K / Cmd+K)
 * and run by its shortcut anywhere in the repository view. Render `ui` once.
 */
export function useRepoCommands(o: Options) {
  const [palette, setPalette] = useState<Command | 'root' | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  const [newBranch, setNewBranch] = useState(false)
  const updates = useUpdates()
  const current = o.status?.branch ?? null
  const others = o.branches.filter((b) => !b.current)

  async function mergeIn(name: string) {
    const ok = await confirm(`Merge ${name} into ${current}?`, {
      title: 'Merge branch',
      kind: 'info',
    })
    if (ok) await o.act('merge', () => git.merge(o.repo.path, name))
  }

  const { sync } = o
  const pushLabel = sync.needsRemote
    ? 'Publish to GitHub'
    : !sync.hasUpstream
      ? 'Publish branch'
      : sync.diverged
        ? 'Force push…'
        : 'Push'

  const commands: Command[] = [
    // Repository
    {
      id: 'open',
      group: 'Repository',
      label: 'Open local repository…',
      icon: FolderOpen,
      shortcut: 'mod+o',
      run: o.onOpenOther,
    },
    {
      id: 'clone',
      group: 'Repository',
      label: 'Clone repository…',
      icon: Download,
      shortcut: 'mod+shift+o',
      run: o.onClone,
    },
    {
      id: 'recent',
      group: 'Repository',
      label: 'Open recent repository…',
      icon: FolderGit2,
      disabled: o.recents.every((r) => r.path === o.repo.path),
      page: {
        placeholder: 'Pick a repository',
        items: () =>
          o.recents
            .filter((r) => r.path !== o.repo.path)
            .map((r) => ({
              id: `recent:${r.path}`,
              group: 'Recent',
              label: r.name,
              detail: r.path,
              icon: FolderGit2,
              run: () => o.onOpenRecent(r.path),
            })),
      },
    },
    {
      id: 'reveal',
      group: 'Repository',
      label: 'Show repository in folder',
      icon: FolderOpen,
      run: () => revealItemInDir(o.repo.path).catch(() => {}),
    },
    {
      id: 'copyPath',
      group: 'Repository',
      label: 'Copy repository path',
      icon: Copy,
      run: () => copyText(o.repo.path),
    },

    // Remote
    {
      id: 'fetch',
      group: 'Remote',
      label: 'Fetch',
      icon: RefreshCw,
      shortcut: 'mod+shift+t',
      disabled: o.busy,
      run: sync.fetch,
    },
    {
      id: 'pull',
      group: 'Remote',
      label: 'Pull',
      detail: sync.behind > 0 ? `${sync.behind} behind` : undefined,
      icon: ArrowDown,
      shortcut: 'mod+shift+p',
      disabled: o.busy || !sync.hasUpstream,
      run: () => sync.pull(),
    },
    {
      id: 'push',
      group: 'Remote',
      label: pushLabel,
      detail: sync.ahead > 0 ? `${sync.ahead} ahead` : undefined,
      keywords: 'push publish',
      icon: ArrowUp,
      shortcut: 'mod+p',
      disabled: o.busy || !current,
      run: sync.push,
    },
    ...(o.extra ?? []),

    // Branch
    {
      id: 'newBranch',
      group: 'Branch',
      label: 'New branch…',
      icon: GitBranchPlus,
      shortcut: 'mod+shift+n',
      keywords: 'create',
      run: () => setNewBranch(true),
    },
    {
      id: 'switch',
      group: 'Branch',
      label: 'Switch branch…',
      icon: GitBranch,
      shortcut: 'mod+b',
      keywords: 'checkout',
      disabled: others.length === 0,
      page: {
        placeholder: 'Switch to branch',
        items: () =>
          others.map((b) => ({
            id: `switch:${b.name}`,
            group: 'Branches',
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
      group: 'Branch',
      label: current ? `Merge into ${current}…` : 'Merge branch…',
      icon: GitMerge,
      shortcut: 'mod+shift+m',
      disabled: !current || others.length === 0,
      page: {
        placeholder: `Branch to merge into ${current}`,
        items: () =>
          others.map((b) => ({
            id: `merge:${b.name}`,
            group: 'Branches',
            label: b.name,
            icon: GitMerge,
            run: () => mergeIn(b.name),
          })),
      },
    },
    {
      id: 'stash',
      group: 'Branch',
      label: 'Stash changes…',
      icon: Archive,
      shortcut: 'mod+shift+s',
      disabled: !o.status?.files.length,
      run: o.onStash,
    },

    // View
    {
      id: 'changes',
      group: 'View',
      label: 'Show changes',
      icon: FileDiff,
      shortcut: 'mod+1',
      run: () => o.showTab('changes'),
    },
    {
      id: 'history',
      group: 'View',
      label: 'Show history',
      icon: History,
      shortcut: 'mod+2',
      run: () => o.showTab('history'),
    },
    {
      id: 'stashes',
      group: 'View',
      label: 'Show stashes',
      icon: Archive,
      shortcut: 'mod+3',
      run: () => o.showTab('stashes'),
    },
    {
      id: 'search',
      group: 'View',
      label: 'Search history',
      icon: Search,
      shortcut: 'mod+f',
      keywords: 'find commit',
      run: o.searchHistory,
    },
    {
      id: 'theme',
      group: 'View',
      label: 'Change theme…',
      icon: Palette,
      page: {
        placeholder: 'Pick a theme',
        items: () => {
          const now = readTheme()
          return [
            { id: 'system', label: 'Match system', dark: null },
            ...THEMES,
          ].map((t) => ({
            id: `theme:${t.id}`,
            group: 'Themes',
            label: t.label,
            detail:
              t.id === now
                ? 'current'
                : t.dark === null
                  ? undefined
                  : t.dark
                    ? 'dark'
                    : 'light',
            icon: Palette,
            run: () => setTheme(t.id),
          }))
        },
      },
    },
    {
      id: 'palette',
      group: 'View',
      label: 'Command palette',
      icon: Search,
      shortcut: 'mod+k',
      run: () => setPalette('root'),
    },
    {
      id: 'shortcuts',
      group: 'View',
      label: 'Keyboard shortcuts',
      icon: Keyboard,
      shortcut: 'f1',
      run: () => setShowKeys(true),
    },

    // Account
    o.signedIn
      ? {
          id: 'signOut',
          group: 'Account',
          label: 'Sign out of GitHub',
          icon: LogOut,
          run: o.onSignOut,
        }
      : {
          id: 'signIn',
          group: 'Account',
          label: 'Sign in to GitHub…',
          icon: LogIn,
          run: o.onSignIn,
        },
    {
      id: 'hosts',
      group: 'Account',
      label: 'Other Git hosts…',
      icon: Server,
      keywords: 'gitlab gitea forgejo token',
      run: o.onManageHosts,
    },
    {
      id: 'updates',
      group: 'Account',
      label: updates.update
        ? `Update to ${updates.update.version}`
        : 'Check for updates',
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
          modal.getAttribute('aria-label') === 'Command palette'
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
          title="New branch"
          label="Name"
          description={
            current ? `Starts from ${current} and switches to it.` : undefined
          }
          submitLabel="Create branch"
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
