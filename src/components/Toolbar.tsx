import { useEffect, useRef, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleArrowUp,
  Command,
  ChevronDown,
  Download,
  ExternalLink,
  FolderGit2,
  FolderOpen,
  GitCompareArrows,
  GitMerge,
  GitBranch,
  Globe,
  Link2,
  Loader2,
  LogOut,
  MoreHorizontal,
  Languages,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
} from 'lucide-react'
import GithubIcon from './GithubIcon'
import { useUpdates } from '../lib/updates'
import type { Sync } from './SyncActions'
import { shortcutKeys } from '../lib/shortcuts'
import PromptDialog from './PromptDialog'
import ChoiceDialog from './ChoiceDialog'
import { useContextMenu, type MenuItem } from './ContextMenu'
import {
  git,
  type Account,
  type Branch,
  type RepoInfo,
  type Status,
} from '../lib/git'
import { useTranslation } from '../i18n'
import {
  COPILOT_ACTIONS,
  setCopilotAction,
  useCopilotPrefs,
  type CopilotAction,
} from '../lib/copilotPrefs'

interface Props {
  repo: RepoInfo
  status: Status | null
  branches: Branch[]
  remoteBranches: string[]
  account: Account | null
  busy: string | null
  onOpenOther: () => void
  recents: RepoInfo[]
  onOpenRecent: (path: string) => void
  onClone: () => void
  onSignIn: () => void
  onSignOut: () => void
  onManageHosts: () => void
  onManageRemotes: () => void
  sync: Sync
  onPalette: () => void
  onAppearance: () => void
  /** Compares the current branch with another. */
  onCompare?: (branch: string) => void
  /** The pull request button, when the branch can have one. */
  pullRequest?: React.ReactNode
  act: (label: string, action: () => Promise<unknown>) => Promise<boolean>
  /** Asks Copilot what a branch would bring into the current one; unset to
   *  hide. */
  onSummarizeBranch?: (name: string) => void
}

export default function Toolbar({
  repo,
  status,
  branches,
  remoteBranches,
  account,
  busy,
  onOpenOther,
  recents,
  onOpenRecent,
  onClone,
  onSignIn,
  onSignOut,
  onManageHosts,
  onManageRemotes,
  sync,
  onPalette,
  onAppearance,
  onCompare,
  pullRequest,
  act,
  onSummarizeBranch,
}: Props) {
  const { t: tx, tp: txp } = useTranslation()
  const { ahead, behind, hasUpstream, needsRemote, diverged } = sync

  return (
    <header className="flex h-12 shrink-0 items-stretch border-b border-line">
      <RepoMenu
        repo={repo}
        recents={recents}
        onOpenRecent={onOpenRecent}
        onOpenOther={onOpenOther}
        onClone={onClone}
        onManageRemotes={onManageRemotes}
      />
      <BranchMenu
        repo={repo}
        status={status}
        branches={branches}
        remoteBranches={remoteBranches}
        act={act}
        onSummarizeBranch={onSummarizeBranch}
        onCompare={onCompare}
      />

      <div className="flex-1" />

      <ToolbarButton
        onClick={sync.fetch}
        disabled={busy !== null}
        label={tx('toolbar.fetch')}
        value={tx('toolbar.all-remotes')}
        icon={<Spin active={busy === 'fetch'} icon={RefreshCw} />}
      />
      <ToolbarButton
        onClick={() => sync.pull()}
        disabled={busy !== null || !hasUpstream}
        label={tx('toolbar.pull')}
        value={
          behind > 0 ? txp('toolbar.behind', behind) : tx('toolbar.up-to-date')
        }
        icon={<Spin active={busy === 'pull'} icon={ArrowDown} />}
      />
      {needsRemote ? (
        <ToolbarButton
          onClick={sync.push}
          disabled={busy !== null || !status?.branch}
          label={tx('toolbar.publish')}
          value={tx('toolbar.to-github')}
          icon={<GithubIcon className="size-4" />}
        />
      ) : diverged ? (
        <ToolbarButton
          onClick={sync.push}
          disabled={busy !== null}
          label={tx('toolbar.force-push')}
          value={tx('toolbar.ahead-behind', { ahead, behind })}
          title={tx(
            'toolbar.your-branch-and-its-upstream-have-different-histories',
          )}
          icon={<Spin active={busy === 'push'} icon={ArrowUp} />}
        />
      ) : (
        <ToolbarButton
          onClick={sync.push}
          disabled={busy !== null || !status?.branch}
          label={
            hasUpstream ? tx('toolbar.push') : tx('toolbar.publish-branch')
          }
          value={
            hasUpstream
              ? ahead > 0
                ? txp('toolbar.ahead', ahead)
                : tx('toolbar.up-to-date')
              : (sync.publishTo ?? tx('toolbar.choose-remote'))
          }
          icon={<Spin active={busy === 'push'} icon={ArrowUp} />}
        />
      )}
      {pullRequest}
      <UpdateButton />
      <button
        onClick={onPalette}
        title={tx('toolbar.commands', {
          keys: shortcutKeys('mod+k').join('+'),
        })}
        aria-label={tx('toolbar.command-palette')}
        className="flex items-center border-r border-line px-3 text-muted hover:bg-hover hover:text-fg"
      >
        <Command className="size-4" />
      </button>
      <button
        onClick={onAppearance}
        title={`${tx('appearance.title')} (${shortcutKeys('mod+,').join('+')})`}
        aria-label={tx('appearance.title')}
        className="flex items-center border-r border-line px-3 text-muted hover:bg-hover hover:text-fg"
      >
        <Palette className="size-4" />
      </button>
      <LanguageMenu />
      <CopilotMenu />
      {sync.dialog}
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
  onManageRemotes,
}: Pick<
  Props,
  | 'repo'
  | 'recents'
  | 'onOpenRecent'
  | 'onOpenOther'
  | 'onClone'
  | 'onManageRemotes'
>) {
  const { t: tx } = useTranslation()
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
        label={tx('toolbar.repository')}
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
              <div className="px-3 py-1 text-xs text-muted">
                {tx('toolbar.recent')}
              </div>
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
            tx('toolbar.open-local-repository'),
            <FolderOpen className="size-4" />,
            onOpenOther,
          )}
          {item(
            tx('toolbar.clone-repository'),
            <Download className="size-4" />,
            onClone,
          )}
          {item(
            tx('toolbar.manage-remotes'),
            <Globe className="size-4" />,
            onManageRemotes,
          )}
        </div>
      )}
    </div>
  )
}

/** Shows up once a newer release is out, and stays until it's installed. */
function UpdateButton() {
  const { t: tx } = useTranslation()
  const { update, openCard } = useUpdates()
  if (!update) return null
  return (
    <button
      onClick={openCard}
      title={tx('toolbar.update-available', { version: update.version })}
      className="flex items-center gap-2 border-r border-line bg-accent/10 px-3 font-medium text-accent hover:bg-accent/20"
    >
      <CircleArrowUp className="size-4" />
      {tx('toolbar.update')}
    </button>
  )
}

/** Language picker: each language is shown by its own name; the choice
 *  persists and applies without a restart. Only languages with a locale file
 *  are listed, and the menu hides until there are two to pick from. */
function LanguageMenu() {
  const { locale, setLocale, languages, t: tx } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))
  if (languages.length < 2) return null

  const row =
    'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover'

  return (
    <div ref={ref} className="relative flex border-r border-line">
      <button
        onClick={() => setOpen((o) => !o)}
        title={tx('toolbar.language')}
        aria-label={tx('toolbar.language')}
        className="flex items-center px-3 text-muted hover:bg-hover hover:text-fg"
      >
        <Languages className="size-4" />
      </button>
      {open && (
        <div className="absolute top-full right-1 z-10 mt-1 max-h-[70vh] w-56 overflow-auto rounded-md border border-line bg-panel py-1 shadow-lg">
          <div className="px-3 py-1 text-xs text-muted">
            {tx('toolbar.language')}
          </div>
          {languages.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setLocale(l.code)
                setOpen(false)
              }}
              className={row}
            >
              <span className="flex-1">{l.name}</span>
              {locale === l.code && <Check className="size-4 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const COPILOT_LABELS: Record<CopilotAction, string> = {
  commitMessage: 'copilotmenu.commit-messages',
  stashMessage: 'copilotmenu.stash-messages',
  review: 'copilotmenu.review-staged-changes',
  explain: 'copilotmenu.explain-changes',
  gitErrors: 'copilotmenu.explain-git-errors',
  conflicts: 'copilotmenu.conflict-help',
  branchName: 'copilotmenu.branch-names',
  releaseNotes: 'copilotmenu.release-notes',
  branchSummary: 'copilotmenu.branch-summaries',
  squashMessage: 'copilotmenu.squash-messages',
  pullRequest: 'copilotmenu.pull-request-descriptions',
}

/** Turns single Copilot actions on and off. */
export function CopilotMenu() {
  const { t: tx } = useTranslation()
  const prefs = useCopilotPrefs()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  return (
    <div ref={ref} className="relative flex border-r border-line">
      <button
        onClick={() => setOpen((o) => !o)}
        title={tx('copilotmenu.copilot')}
        aria-label={tx('copilotmenu.copilot')}
        className="flex items-center px-3 text-muted hover:bg-hover hover:text-fg"
      >
        <Sparkles className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-1 z-10 mt-1 w-64 rounded-md border border-line bg-panel py-1 shadow-lg"
        >
          <div className="px-3 py-1 text-xs text-muted">
            {tx('copilotmenu.copilot')}
          </div>
          {COPILOT_ACTIONS.map((action) => (
            <button
              key={action}
              role="menuitemcheckbox"
              aria-checked={prefs[action]}
              onClick={() => setCopilotAction(action, !prefs[action])}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
            >
              <span className="flex-1">{tx(COPILOT_LABELS[action])}</span>
              {prefs[action] && <Check className="size-4 text-accent" />}
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
  onManageHosts,
}: Pick<Props, 'account' | 'onSignIn' | 'onSignOut' | 'onManageHosts'>) {
  const { t: tx } = useTranslation()
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
          {tx('toolbar.sign-in')}
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
              {tx('toolbar.sign-in-to-github')}
            </button>
          )}
          <button onClick={() => choose(onManageHosts)} className={item}>
            <Server className="size-4" />
            {tx('toolbar.other-git-hosts')}
          </button>
          {account && (
            <button
              onClick={() => choose(() => openUrl(GITHUB_ACCESS_URL))}
              className={item}
            >
              <ExternalLink className="size-4" />
              {tx('toolbar.manage-access-on-github')}
            </button>
          )}
          {account && (
            <button onClick={() => choose(onSignOut)} className={item}>
              <LogOut className="size-4" />
              {tx('toolbar.sign-out-of-github')}
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
                ? tx('toolbar.update-to', { version: updates.update.version })
                : tx('toolbar.check-for-updates')}
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

/** The branch's upstream, else a remote branch of the same name. */
function suggestUpstream(b: Branch, remoteBranches: string[]) {
  const find = (want: (name: string) => boolean) => remoteBranches.find(want)
  return (
    find((r) => r === b.upstream) ??
    find((r) => r === `origin/${b.name}`) ??
    find((r) => r.endsWith(`/${b.name}`)) ??
    ''
  )
}

export function BranchMenu({
  repo,
  status,
  branches,
  remoteBranches,
  act,
  onSummarizeBranch,
  onCompare,
}: Pick<
  Props,
  | 'repo'
  | 'status'
  | 'branches'
  | 'remoteBranches'
  | 'act'
  | 'onSummarizeBranch'
  | 'onCompare'
>) {
  const { t: tx } = useTranslation()
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<Branch | null>(null)
  const [tracking, setTracking] = useState<Branch | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const { menu, open: openMenu } = useContextMenu()
  useClickOutside(ref, open, () => setOpen(false))

  async function mergeIn(name: string) {
    const ok = await confirm(
      tx('toolbar.merge-branch-confirm', { name, branch: status?.branch }),
      {
        title: tx('toolbar.merge-branch'),
        kind: 'info',
      },
    )
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
      ? tx('toolbar.remote-not-deleted', { upstream: b.upstream })
      : ''
    const ok = await confirm(
      tx('toolbar.delete-branch-body', { name: b.name }) + remote,
      {
        title: tx('toolbar.delete-branch'),
        kind: 'warning',
        okLabel: tx('toolbar.delete'),
      },
    )
    if (!ok) return
    let notMerged = false
    await act('branch', async () => {
      notMerged = (await git.deleteBranch(repo.path, b.name)).notMerged
    })
    if (!notMerged) return
    const force = await confirm(
      tx('toolbar.delete-unmerged-body', {
        name: b.name,
        branch: status?.branch ?? tx('toolbar.the-current-branch'),
      }),
      {
        title: tx('toolbar.delete-unmerged-branch'),
        kind: 'warning',
        okLabel: tx('toolbar.delete-anyway'),
      },
    )
    if (force)
      await act('branch', () => git.deleteBranch(repo.path, b.name, true))
  }

  function menuFor(b: Branch): MenuItem[] {
    const items: MenuItem[] = []
    if (!b.current)
      items.push({
        label: tx('toolbar.switch-to-branch'),
        icon: GitBranch,
        onClick: () => switchTo(b.name),
      })
    if (!b.current && status?.branch)
      items.push({
        label: tx('toolbar.merge-into-branch', { branch: status.branch }),
        icon: GitMerge,
        onClick: () => mergeIn(b.name),
      })
    if (!b.current && onCompare)
      items.push({
        label: tx('compare.with', {
          name: status?.branch ?? tx('toolbar.detached-head'),
        }),
        icon: GitCompareArrows,
        onClick: () => {
          setOpen(false)
          onCompare(b.name)
        },
      })
    if (!b.current && onSummarizeBranch)
      items.push({
        label: tx('toolbar.summarize-with-copilot'),
        icon: Sparkles,
        onClick: () => {
          setOpen(false)
          onSummarizeBranch(b.name)
        },
      })
    if (items.length > 0) items.push('separator')
    items.push(
      {
        label: tx('toolbar.rename-2'),
        icon: Pencil,
        onClick: () => {
          setOpen(false)
          setRenaming(b)
        },
      },
      {
        label: tx('toolbar.set-upstream'),
        icon: Link2,
        disabled: remoteBranches.length === 0 && !b.upstream,
        onClick: () => {
          setOpen(false)
          setTracking(b)
        },
      },
      {
        label: tx('toolbar.delete-2'),
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
        label={tx('toolbar.current-branch')}
        value={status?.branch ?? tx('toolbar.detached-head')}
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
              placeholder={tx('toolbar.filter-or-create-a-branch')}
              className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 outline-none focus:border-accent"
            />
            <button
              type="submit"
              title={tx('toolbar.create-branch')}
              className="rounded px-2 text-muted hover:bg-hover hover:text-fg"
            >
              <Plus className="size-4" />
            </button>
          </form>
          <ul className="max-h-80 overflow-auto py-1">
            {shown.length === 0 && (
              <li className="px-3 py-1.5 text-muted">
                {tx('toolbar.no-branch-matches', { name: newName.trim() })}
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
                    title={tx('toolbar.merge-into', {
                      name: b.name,
                      branch: status.branch,
                    })}
                    className="invisible flex items-center gap-1 rounded px-1.5 text-xs text-muted group-hover:visible hover:bg-line hover:text-fg"
                  >
                    <GitMerge className="size-3.5" />
                    {tx('toolbar.merge')}
                  </button>
                )}
                <button
                  onClick={(e) => openMenu(e, menuFor(b))}
                  title={tx('toolbar.more')}
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
      {tracking && (
        <ChoiceDialog
          title={tx('toolbar.set-upstream-title')}
          label={tx('toolbar.upstream-of', { name: tracking.name })}
          options={[
            { value: '', label: tx('toolbar.no-upstream') },
            ...remoteBranches.map((name) => ({ value: name, label: name })),
          ]}
          initial={suggestUpstream(tracking, remoteBranches)}
          current={tracking.upstream ?? ''}
          submitLabel={tx('toolbar.save')}
          onSubmit={(upstream) =>
            act('branch', () =>
              git.setUpstream(repo.path, tracking.name, upstream || null),
            )
          }
          onClose={() => setTracking(null)}
        />
      )}
      {renaming && (
        <PromptDialog
          title={tx('toolbar.rename-branch')}
          label={tx('toolbar.new-name')}
          initial={renaming.name}
          submitLabel={tx('toolbar.rename')}
          description={
            renaming.upstream
              ? tx('toolbar.rename-keeps-remote', {
                  upstream: renaming.upstream,
                })
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

/** Where GitGud's access can be revoked on GitHub; GitGud itself can't
 *  revoke tokens without a client secret. */
const GITHUB_ACCESS_URL =
  'https://github.com/settings/connections/applications/Ov23li9VaKu4azd6eO0H'
