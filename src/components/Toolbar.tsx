import { useEffect, useRef, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  FolderGit2,
  FolderOpen,
  GitMerge,
  GitBranch,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Sun,
} from 'lucide-react'
import GithubIcon from './GithubIcon'
import { readTheme, setTheme, type Theme } from '../lib/prefs'
import {
  git,
  type Account,
  type Branch,
  type RepoInfo,
  type Status,
} from '../lib/git'

interface Props {
  repo: RepoInfo
  status: Status | null
  branches: Branch[]
  originUrl: string | null
  account: Account | null
  busy: string | null
  onOpenOther: () => void
  recents: RepoInfo[]
  onOpenRecent: (path: string) => void
  onClone: () => void
  onSignIn: () => void
  onSignOut: () => void
  onPublish: () => void
  act: (label: string, action: () => Promise<unknown>) => Promise<boolean>
}

export default function Toolbar({
  repo,
  status,
  branches,
  originUrl,
  account,
  busy,
  onOpenOther,
  recents,
  onOpenRecent,
  onClone,
  onSignIn,
  onSignOut,
  onPublish,
  act,
}: Props) {
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  const hasUpstream = Boolean(status?.upstream)
  // Without any remote, "push" means creating the repository on GitHub first.
  const needsRemote = !hasUpstream && originUrl === null
  // After editing pushed history, a normal push is rejected.
  const diverged = hasUpstream && ahead > 0 && behind > 0

  async function forcePush() {
    const ok = await confirm(
      `Your branch and ${status?.upstream} have diverged (${ahead} ahead, ${behind} behind).\n\n` +
        'Force pushing replaces the remote branch with yours. Do this after editing history you already pushed. ' +
        'If someone else pushed to this branch, Pull instead, or their commits will be lost.',
      { title: 'Force push', kind: 'warning', okLabel: 'Force push' },
    )
    if (ok) act('push', () => git.pushForce(repo.path))
  }

  return (
    <header className="flex h-12 shrink-0 items-stretch border-b border-line">
      <RepoMenu
        repo={repo}
        recents={recents}
        onOpenRecent={onOpenRecent}
        onOpenOther={onOpenOther}
        onClone={onClone}
      />
      <BranchMenu repo={repo} status={status} branches={branches} act={act} />

      <div className="flex-1" />

      <ToolbarButton
        onClick={() => act('fetch', () => git.fetch(repo.path))}
        disabled={busy !== null}
        label="Fetch"
        value="All remotes"
        icon={<Spin active={busy === 'fetch'} icon={RefreshCw} />}
      />
      <ToolbarButton
        onClick={() => act('pull', () => git.pull(repo.path))}
        disabled={busy !== null || !hasUpstream}
        label="Pull"
        value={behind > 0 ? `${behind} behind` : 'Up to date'}
        icon={<Spin active={busy === 'pull'} icon={ArrowDown} />}
      />
      {needsRemote ? (
        <ToolbarButton
          onClick={onPublish}
          disabled={busy !== null || !status?.branch}
          label="Publish"
          value="to GitHub"
          icon={<GithubIcon className="size-4" />}
        />
      ) : diverged ? (
        <ToolbarButton
          onClick={forcePush}
          disabled={busy !== null}
          label="Force push"
          value={`${ahead} ahead, ${behind} behind`}
          title="Your branch and its upstream have different histories"
          icon={<Spin active={busy === 'push'} icon={ArrowUp} />}
        />
      ) : (
        <ToolbarButton
          onClick={() => act('push', () => git.push(repo.path))}
          disabled={busy !== null || !status?.branch}
          label={hasUpstream ? 'Push' : 'Publish branch'}
          value={
            hasUpstream
              ? ahead > 0
                ? `${ahead} ahead`
                : 'Up to date'
              : 'origin'
          }
          icon={<Spin active={busy === 'push'} icon={ArrowUp} />}
        />
      )}
      <ThemeMenu />
      <AccountMenu
        account={account}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
      />
    </header>
  )
}

function Spin({
  active,
  icon: Icon,
}: {
  active: boolean
  icon: typeof ArrowUp
}) {
  return active ? (
    <Loader2 className="size-4 animate-spin" />
  ) : (
    <Icon className="size-4" />
  )
}

interface ToolbarButtonProps {
  label: string
  value: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  trailing?: React.ReactNode
}

function ToolbarButton({
  label,
  value,
  icon,
  onClick,
  disabled,
  title,
  trailing,
}: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex min-w-36 items-center gap-3 border-r border-line px-4 text-left hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="text-muted">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-xs text-muted">{label}</span>
        <span className="truncate font-medium">{value}</span>
      </span>
      {trailing}
    </button>
  )
}

function RepoMenu({
  repo,
  recents,
  onOpenRecent,
  onOpenOther,
  onClone,
}: Pick<
  Props,
  'repo' | 'recents' | 'onOpenRecent' | 'onOpenOther' | 'onClone'
>) {
  const others = recents.filter((r) => r.path !== repo.path)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  const item = (label: string, icon: React.ReactNode, action: () => void) => (
    <button
      onClick={() => {
        setOpen(false)
        action()
      }}
      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover"
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div ref={ref} className="relative flex">
      <ToolbarButton
        onClick={() => setOpen((o) => !o)}
        label="Repository"
        value={repo.name}
        icon={<FolderGit2 className="size-4" />}
        title={repo.path}
        trailing={<ChevronDown className="size-4 text-muted" />}
      />
      {open && (
        <div className="absolute top-full left-0 z-10 mt-1 w-72 overflow-hidden rounded-md border border-line bg-panel shadow-lg">
          {others.length > 0 && (
            <div className="border-b border-line py-1">
              <div className="px-3 py-1 text-xs text-muted">Recent</div>
              {others.map((r) => (
                <button
                  key={r.path}
                  onClick={() => {
                    setOpen(false)
                    onOpenRecent(r.path)
                  }}
                  title={r.path}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
                >
                  <FolderGit2 className="size-4 shrink-0 text-muted" />
                  <span className="truncate">{r.name}</span>
                </button>
              ))}
            </div>
          )}
          {item(
            'Open local repository…',
            <FolderOpen className="size-4" />,
            onOpenOther,
          )}
          {item('Clone repository…', <Download className="size-4" />, onClone)}
        </div>
      )}
    </div>
  )
}

const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

function ThemeMenu() {
  const [open, setOpen] = useState(false)
  const [theme, setChoice] = useState(readTheme)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))
  const Current = themes.find((t) => t.value === theme)!.icon

  return (
    <div ref={ref} className="relative flex border-r border-line">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Theme"
        className="flex items-center px-3 text-muted hover:bg-hover hover:text-fg"
      >
        <Current className="size-4" />
      </button>
      {open && (
        <div className="absolute top-full right-1 z-10 mt-1 w-36 overflow-hidden rounded-md border border-line bg-panel py-1 shadow-lg">
          {themes.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => {
                setTheme(value)
                setChoice(value)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
            >
              <Icon className="size-4 text-muted" />
              <span className="flex-1">{label}</span>
              {theme === value && <Check className="size-4 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AccountMenu({
  account,
  onSignIn,
  onSignOut,
}: Pick<Props, 'account' | 'onSignIn' | 'onSignOut'>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  if (!account)
    return (
      <button
        onClick={onSignIn}
        className="flex items-center gap-2 px-4 hover:bg-hover"
      >
        <GithubIcon className="size-4" />
        Sign in
      </button>
    )

  return (
    <div ref={ref} className="relative flex">
      <button
        onClick={() => setOpen((o) => !o)}
        title={account.login}
        className="flex items-center px-3 hover:bg-hover"
      >
        <img
          src={account.avatarUrl}
          alt=""
          className="size-7 rounded-full border border-line"
        />
      </button>
      {open && (
        <div className="absolute top-full right-1 z-10 mt-1 w-56 overflow-hidden rounded-md border border-line bg-panel shadow-lg">
          <div className="border-b border-line px-3 py-2">
            <div className="truncate font-medium">
              {account.name ?? account.login}
            </div>
            <div className="truncate text-xs text-muted">@{account.login}</div>
          </div>
          <button
            onClick={() => {
              setOpen(false)
              onSignOut()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onOutside: () => void,
) {
  useEffect(() => {
    if (!active) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOutside()
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [ref, active, onOutside])
}

function BranchMenu({
  repo,
  status,
  branches,
  act,
}: Pick<Props, 'repo' | 'status' | 'branches' | 'act'>) {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  async function mergeIn(name: string) {
    const ok = await confirm(`Merge ${name} into ${status?.branch}?`, {
      title: 'Merge branch',
      kind: 'info',
    })
    if (!ok) return
    setOpen(false)
    await act('merge', () => git.merge(repo.path, name))
  }

  async function switchTo(name: string) {
    setOpen(false)
    await act('switch', () => git.switchBranch(repo.path, name))
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    if (await act('branch', () => git.createBranch(repo.path, name))) {
      setNewName('')
      setOpen(false)
    }
  }

  return (
    <div ref={ref} className="relative flex">
      <ToolbarButton
        onClick={() => setOpen((o) => !o)}
        label="Current branch"
        value={status?.branch ?? 'Detached HEAD'}
        icon={<GitBranch className="size-4" />}
        trailing={<ChevronDown className="size-4 text-muted" />}
      />
      {open && (
        <div className="absolute top-full left-0 z-10 mt-1 w-72 overflow-hidden rounded-md border border-line bg-panel shadow-lg">
          <form
            onSubmit={create}
            className="flex gap-1 border-b border-line p-2"
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New branch name"
              className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 outline-none focus:border-accent"
            />
            <button
              type="submit"
              title="Create branch"
              className="rounded px-2 text-muted hover:bg-hover hover:text-fg"
            >
              <Plus className="size-4" />
            </button>
          </form>
          <ul className="max-h-80 overflow-auto py-1">
            {branches.map((b) => (
              <li key={b.name} className="group flex hover:bg-hover">
                <button
                  onClick={() => !b.current && switchTo(b.name)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
                >
                  <span className="w-4 shrink-0">
                    {b.current && <Check className="size-4 text-accent" />}
                  </span>
                  <span className="truncate">{b.name}</span>
                </button>
                {!b.current && status?.branch && (
                  <button
                    onClick={() => mergeIn(b.name)}
                    title={`Merge ${b.name} into ${status.branch}`}
                    className="invisible mr-1 flex items-center gap-1 rounded px-1.5 text-xs text-muted group-hover:visible hover:bg-line hover:text-fg"
                  >
                    <GitMerge className="size-3.5" />
                    Merge
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
