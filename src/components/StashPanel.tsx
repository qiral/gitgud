import { confirm } from '@tauri-apps/plugin-dialog'
import { ArchiveRestore, Trash2, Upload } from 'lucide-react'
import { git, type RepoInfo, type Stash } from '../lib/git'
import { relativeTime } from '../lib/time'
import type { Selection } from './RepoView'
import { useTranslation } from '../i18n'

interface Props {
  repo: RepoInfo
  stashes: Stash[]
  selection: Selection | null
  onSelect: (s: Selection) => void
  busy: boolean
  act: (label: string, action: () => Promise<unknown>) => Promise<boolean>
}

export default function StashPanel({
  repo,
  stashes,
  selection,
  onSelect,
  busy,
  act,
}: Props) {
  const { t } = useTranslation()
  if (stashes.length === 0)
    return (
      <div className="p-6 text-center text-muted">
        <p>{t('stashpanel.no-stashes')}</p>
        <p className="mt-1 text-xs">
          {t(
            'stashpanel.stash-your-changes-from-the-changes-tab-to-set-them-aside-for-later',
          )}
        </p>
      </div>
    )

  async function drop(stash: Stash) {
    const ok = await confirm(
      t('stashpanel.delete-stash-body', { message: stash.message }),
      { title: t('stashpanel.delete-stash'), kind: 'warning' },
    )
    if (ok) act('stash', () => git.stashDrop(repo.path, stash.index))
  }

  return (
    <ul className="min-h-0 flex-1 overflow-auto">
      {stashes.map((s) => {
        const selected =
          selection?.kind === 'stash' && selection.stash.index === s.index
        return (
          <li
            key={s.index}
            onClick={() => onSelect({ kind: 'stash', stash: s })}
            className={`group cursor-default border-b border-line px-3 py-2 ${
              selected ? 'bg-hover' : 'hover:bg-hover/60'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate font-medium"
                title={s.message}
              >
                {s.message}
              </span>
              <span className="invisible flex gap-0.5 group-hover:visible">
                <RowButton
                  title={t('stashpanel.apply-keep-the-stash')}
                  disabled={busy}
                  onClick={() =>
                    act('stash', () => git.stashApply(repo.path, s.index))
                  }
                >
                  <ArchiveRestore className="size-3.5" />
                </RowButton>
                <RowButton
                  title={t('stashpanel.pop-apply-and-delete')}
                  disabled={busy}
                  onClick={() =>
                    act('stash', () => git.stashPop(repo.path, s.index))
                  }
                >
                  <Upload className="size-3.5" />
                </RowButton>
                <RowButton
                  title={t('stashpanel.delete')}
                  disabled={busy}
                  onClick={() => drop(s)}
                >
                  <Trash2 className="size-3.5" />
                </RowButton>
              </span>
            </div>
            <div className="mt-0.5 flex gap-2 text-xs text-muted">
              {s.branch && <span className="truncate">on {s.branch}</span>}
              {s.branch && <span>·</span>}
              <span className="shrink-0">{relativeTime(s.time)}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function RowButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="rounded p-0.5 text-muted hover:bg-line hover:text-fg disabled:opacity-40"
    >
      {children}
    </button>
  )
}
