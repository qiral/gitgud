import { Columns2, MoreHorizontal, Space, Sparkles } from 'lucide-react'
import type { FileStatus } from '../lib/diff'
import { fileMenuItems } from '../lib/copy'
import { basename, dirname } from '../lib/paths'
import { useContextMenu } from './ContextMenu'
import CopyButton from './CopyButton'
import { setDiffPref, useDiffPrefs } from '../lib/diffPrefs'
import { useTranslation } from '../i18n'

export const STATUS_STYLE: Record<FileStatus, [string, string]> = {
  added: ['A', 'text-added'],
  deleted: ['D', 'text-removed'],
  modified: ['M', 'text-modified'],
  renamed: ['R', 'text-accent'],
  copied: ['C', 'text-accent'],
}

/** Line counts like "+12 −3"; nothing for a file without text changes. */
export function LineCounts({ add, del }: { add: number; del: number }) {
  if (add === 0 && del === 0) return null
  return (
    <span className="shrink-0 font-mono text-xs">
      {add > 0 && <span className="text-added">+{add}</span>}
      {add > 0 && del > 0 && ' '}
      {del > 0 && <span className="text-removed">−{del}</span>}
    </span>
  )
}

interface Props {
  repo: string
  path: string
  oldPath?: string
  additions: number
  deletions: number
  /** Whether the file is on disk, so it can be shown in its folder. */
  exists: boolean
  /** Opens the file's history; unset to leave it out of the menu. */
  onHistory?: (path: string) => void
  /** Asks Copilot to explain the diff; unset to hide the button. */
  onExplain?: () => void
}

/** The bar above a diff naming the file, with ways to copy its path. */
export default function FileHeader({
  repo,
  path,
  oldPath,
  additions,
  deletions,
  exists,
  onHistory,
  onExplain,
}: Props) {
  const { t } = useTranslation()
  const { menu, open } = useContextMenu()
  const prefs = useDiffPrefs()
  const items = () =>
    fileMenuItems(repo, path, exists, onHistory && (() => onHistory(path)))
  const dir = dirname(path)

  return (
    <div
      onContextMenu={(e) => open(e, items())}
      className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1.5"
    >
      <div className="min-w-0 flex-1 truncate select-text" title={path}>
        {oldPath && oldPath !== path && (
          <span className="text-muted">{oldPath} → </span>
        )}
        {dir && <span className="text-muted">{dir}/</span>}
        <span className="font-medium">{basename(path)}</span>
      </div>
      <LineCounts add={additions} del={deletions} />
      <Toggle
        on={prefs.ignoreWhitespace}
        title={t('fileheader.ignore-whitespace')}
        onClick={() => setDiffPref('ignoreWhitespace', !prefs.ignoreWhitespace)}
      >
        <Space className="size-4" />
      </Toggle>
      <Toggle
        on={prefs.split}
        title={t('fileheader.side-by-side')}
        onClick={() => setDiffPref('split', !prefs.split)}
      >
        <Columns2 className="size-4" />
      </Toggle>
      <CopyButton text={path} title={t('fileheader.copy-path')} />
      {onExplain && (
        <button
          title={t('fileheader.explain-with-copilot')}
          onClick={onExplain}
          className="shrink-0 rounded p-0.5 text-muted hover:bg-hover hover:text-fg"
        >
          <Sparkles className="size-4" />
        </button>
      )}
      <button
        title={t('fileheader.more')}
        onClick={(e) => open(e, items())}
        className="shrink-0 rounded p-0.5 text-muted hover:bg-hover hover:text-fg"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {menu}
    </div>
  )
}

/** An icon button that stays highlighted while its setting is on. */
function Toggle({
  on,
  title,
  onClick,
  children,
}: {
  on: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`shrink-0 rounded p-0.5 hover:bg-hover ${
        on ? 'bg-hover text-accent' : 'text-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}
