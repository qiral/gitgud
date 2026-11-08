import { useEffect, useRef, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleArrowUp,
  ChevronDown,
  Download,
  FolderGit2,
  FolderOpen,
  GitMerge,
  GitBranch,
  Loader2,
  LogOut,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  SunMoon,
  Trash2,
} from 'lucide-react'
import GithubIcon from './GithubIcon'
import { useUpdates } from '../lib/updates'
import { readTheme, setTheme, THEMES, type ThemeInfo } from '../lib/prefs'
import PullDialog from './PullDialog'
import PromptDialog from './PromptDialog'
import { useContextMenu, type MenuItem } from './ContextMenu'
import {
  git,
  type Account,
  type Branch,
  type PullMode,
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
  onManageHosts: () => void
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
  onManageHosts,
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
  const [askPull, setAskPull] = useState(false)

  async function pull(mode: PullMode | null = null, remember = false) {
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
        onClick={() => pull()}
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
      <UpdateButton />
      <ThemeMenu />
      {askPull && status?.branch && status.upstream && (
        <PullDialog
          branch={status.branch}
          upstream={status.upstream}
          ahead={ahead}
          behind={behind}
          onPull={pull}
          onClose={() => setAskPull(false)}
        />
      )}
      <AccountMenu
        account={account}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
        onManageHosts={onManageHosts}
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
  /** Tints the button so where you are (repo, branch) stands out. */
  emphasis?: boolean
}

function ToolbarButton({
  label,
  value,
  icon,
  onClick,
  disabled,
  title,
  trailing,
  emphasis,
}: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex min-w-36 items-center gap-3 border-r border-line px-4 text-left disabled:opacity-50 disabled:hover:bg-transparent ${
        emphasis ? 'bg-accent/[0.07] hover:bg-accent/15' : 'hover:bg-hover'
      }`}
    >
      <span className={emphasis ? 'text-accent' : 'text-muted'}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-xs text-muted">{label}</span>
        <span
          className={`truncate ${emphasis ? 'font-semibold text-fg' : 'font-medium'}`}
        >
          {value}
        </span>
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
        emphasis
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

/** Shows up once a newer release is out, and stays until it's installed. */
function UpdateButton() {
  const { update, openCard } = useUpdates()
  if (!update) return null
  return (
    <button
      onClick={openCard}
      title={`GitGud ${update.version} is available`}
      className="flex items-center gap-2 border-r border-line bg-accent/10 px-3 font-medium text-accent hover:bg-accent/20"
    >
      <CircleArrowUp className="size-4" />
      Update
    </button>
  )
}

function Swatch({ theme }: { theme: ThemeInfo }) {
  const [bg, panel, accent] = theme.swatch
  return (
    <span
      className="flex size-4 shrink-0 overflow-hidden rounded-full border border-line"
      aria-hidden
    >
      <span className="w-1/3" style={{ background: panel }} />
      <span className="w-1/3" style={{ background: bg }} />
      <span className="w-1/3" style={{ background: accent }} />
    </span>
  )
}

function ThemeMenu() {
  const [open, setOpen] = useState(false)
  const [theme, setChoice] = useState(readTheme)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  const choose = (id: string) => {
    setTheme(id)
    setChoice(id)
    setOpen(false)
  }
  const row =
    'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover'
  const groups = [
    { label: 'Light', list: THEMES.filter((t) => !t.dark) },
    { label: 'Dark', list: THEMES.filter((t) => t.dark) },
  ]

  return (
    <div ref={ref} className="relative flex border-r border-line">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Theme"
        className="flex items-center px-3 text-muted hover:bg-hover hover:text-fg"
      >
        <Palette className="size-4" />
      </button>
      {open && (
        <div className="absolute top-full right-1 z-10 mt-1 max-h-[70vh] w-56 overflow-auto rounded-md border border-line bg-panel py-1 shadow-lg">
          <button onClick={() => choose('system')} className={row}>
            <SunMoon className="size-4 text-muted" />
            <span className="flex-1">Match system</span>
            {theme === 'system' && <Check className="size-4 text-accent" />}
          </button>
          {groups.map((g) => (
            <div key={g.label} className="mt-1 border-t border-line pt-1">
              <div className="px-3 py-1 text-xs text-muted">{g.label}</div>
              {g.list.map((t) => (
                <button key={t.id} onClick={() => choose(t.id)} className={row}>
                  <Swatch theme={t} />
                  <span className="flex-1">{t.label}</span>
                  {theme === t.id && <Check className="size-4 text-accent" />}
                </button>
              ))}
            </div>
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
  onManageHosts,
}: Pick<Props, 'account' | 'onSignIn' | 'onSignOut' | 'onManageHosts'>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))
  const updates = useUpdates()

  const item =
    'flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover'
  function choose(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <div ref={ref} className="relative flex">
      {account ? (
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
      ) : (
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 px-4 hover:bg-hover"
        >
          <GithubIcon className="size-4" />
          Sign in
          <ChevronDown className="size-3 text-muted" />
        </button>
      )}
      {open && (
        <div className="absolute top-full right-1 z-10 mt-1 w-56 overflow-hidden rounded-md border border-line bg-panel shadow-lg">
          {account ? (
            <div className="border-b border-line px-3 py-2">
              <div className="truncate font-medium">
                {account.name ?? account.login}
              </div>
              <div className="truncate text-xs text-muted">
                @{account.login}
              </div>
            </div>
          ) : (
            <button onClick={() => choose(onSignIn)} className={item}>
              <GithubIcon className="size-4" />
              Sign in to GitHub
            </button>
          )}
          <button onClick={() => choose(onManageHosts)} className={item}>
            <Server className="size-4" />
            Other Git hosts…
          </button>
          {account && (
            <button onClick={() => choose(onSignOut)} className={item}>
              <LogOut className="size-4" />
              Sign out of GitHub
            </button>
          )}
          <button
            onClick={() =>
              choose(() =>
                updates.update ? updates.openCard() : updates.check(true),
              )
            }
            className={`${item} border-t border-line`}
          >
            {updates.status === 'checking' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CircleArrowUp className="size-4" />
            )}
            <span className="flex-1">
              {updates.update
                ? `Update to ${updates.update.version}`
                : 'Check for updates'}
            </span>
            {updates.version && (
              <span className="text-xs text-muted">v{updates.version}</span>
            )}
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
  const [renaming, setRenaming] = useState<Branch | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const { menu, open: openMenu } = useContextMenu()
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

  async function remove(b: Branch) {
    const remote = b.upstream
      ? `\n\nThe remote branch ${b.upstream} is not deleted.`
      : ''
    const ok = await confirm(`Delete the branch ${b.name}?${remote}`, {
      title: 'Delete branch',
      kind: 'warning',
      okLabel: 'Delete',
    })
    if (!ok) return
    let notMerged = false
    await act('branch', async () => {
      notMerged = (await git.deleteBranch(repo.path, b.name)).notMerged
    })
    if (!notMerged) return
    const force = await confirm(
      `${b.name} has commits that aren't merged into ${status?.branch ?? 'the current branch'} or its upstream. ` +
        'Deleting it anyway loses those commits.',
      {
        title: 'Delete unmerged branch',
        kind: 'warning',
        okLabel: 'Delete anyway',
      },
    )
    if (force)
      await act('branch', () => git.deleteBranch(repo.path, b.name, true))
  }

  function menuFor(b: Branch): MenuItem[] {
    const items: MenuItem[] = []
    if (!b.current)
      items.push({
        label: 'Switch to branch',
        icon: GitBranch,
        onClick: () => switchTo(b.name),
      })
    if (!b.current && status?.branch)
      items.push({
        label: `Merge into ${status.branch}…`,
        icon: GitMerge,
        onClick: () => mergeIn(b.name),
      })
    if (items.length > 0) items.push('separator')
    items.push(
      {
        label: 'Rename…',
        icon: Pencil,
        onClick: () => {
          setOpen(false)
          setRenaming(b)
        },
      },
      {
        label: 'Delete…',
        icon: Trash2,
        danger: true,
        disabled: b.current,
        onClick: () => remove(b),
      },
    )
    return items
  }

  const query = newName.trim().toLowerCase()
  const shown = query
    ? branches.filter((b) => b.name.toLowerCase().includes(query))
    : branches

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    // Enter on an existing branch's exact name switches to it instead.
    const existing = branches.find((b) => b.name === name)
    if (existing) {
      if (!existing.current) await switchTo(name)
      setNewName('')
      return
    }
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
        emphasis
        icon={<GitBranch className="size-4" />}
        trailing={<ChevronDown className="size-4 text-muted" />}
      />
      {open && (
        <div className="absolute top-full left-0 z-10 mt-1 w-80 overflow-hidden rounded-md border border-line bg-panel shadow-lg">
          <form
            onSubmit={create}
            className="flex gap-1 border-b border-line p-2"
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Filter or create a branch"
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
            {shown.length === 0 && (
              <li className="px-3 py-1.5 text-muted">
                No branch matches. Press Enter to create “{newName.trim()}”.
              </li>
            )}
            {shown.map((b) => (
              <li
                key={b.name}
                onContextMenu={(e) => openMenu(e, menuFor(b))}
                className="group flex hover:bg-hover"
              >
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
                    className="invisible flex items-center gap-1 rounded px-1.5 text-xs text-muted group-hover:visible hover:bg-line hover:text-fg"
                  >
                    <GitMerge className="size-3.5" />
                    Merge
                  </button>
                )}
                <button
                  onClick={(e) => openMenu(e, menuFor(b))}
                  title="More"
                  className="invisible mr-1 rounded px-1 text-muted group-hover:visible hover:bg-line hover:text-fg"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {menu}
      {renaming && (
        <PromptDialog
          title="Rename branch"
          label="New name"
          initial={renaming.name}
          submitLabel="Rename"
          description={
            renaming.upstream
              ? `The remote branch ${renaming.upstream} keeps its name; this only renames your local branch.`
              : undefined
          }
          onSubmit={(name) =>
            act('branch', () =>
              git.renameBranch(repo.path, renaming.name, name),
            )
          }
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  )
}
