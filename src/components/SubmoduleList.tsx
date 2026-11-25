import { confirm } from '@tauri-apps/plugin-dialog'
import { Download, FolderOpen, Package } from 'lucide-react'
import { git, type RepoInfo, type Submodule } from '../lib/git'
import { absolutePath } from '../lib/paths'
import { useTranslation } from '../i18n'

type Act = (label: string, action: () => Promise<unknown>) => Promise<boolean>

/** Checks out the recorded commits, after asking when that moves one away
 *  from where it is. */
export function useUpdateSubmodules(repo: RepoInfo, act: Act) {
  const { t } = useTranslation()
  return async (list: Submodule[], path: string | null) => {
    if (list.some((s) => s.state === 'changed')) {
      const ok = await confirm(t('submodules.update-body'), {
        title: t('submodules.update'),
        kind: 'warning',
      })
      if (!ok) return
    }
    await act('submodules', () => git.updateSubmodules(repo.path, path))
  }
}

interface Props {
  repo: RepoInfo
  submodules: Submodule[]
  busy: boolean
  act: Act
  /** Opens a submodule as its own repository. */
  onOpen: (path: string) => void
}

/** The repository's submodules and the commits they're on. */
export default function SubmoduleList({
  repo,
  submodules,
  busy,
  act,
  onOpen,
}: Props) {
  const { t } = useTranslation()
  const update = useUpdateSubmodules(repo, act)
  if (submodules.length === 0) return null
  return (
    <section>
      <div className="flex items-center justify-between px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
        <span>
          {t('submodules.title')} ({submodules.length})
        </span>
        <button
          onClick={() => update(submodules, null)}
          disabled={busy}
          className="font-normal tracking-normal normal-case hover:text-fg disabled:opacity-40"
        >
          {t('submodules.update-all')}
        </button>
      </div>
      <ul>
        {submodules.map((s) => {
          const at = s.checkedOut ?? s.recorded
          return (
            <li
              key={s.path}
              className="group flex items-center gap-2 px-3 py-1 hover:bg-hover/60"
            >
              <Package className="size-3.5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate" title={s.path}>
                {s.path}
              </span>
              {s.state !== 'current' && (
                <button
                  onClick={() => update([s], s.path)}
                  disabled={busy}
                  title={t('submodules.update')}
                  aria-label={t('submodules.update-one', { path: s.path })}
                  className="rounded p-0.5 text-muted hover:bg-line hover:text-fg disabled:opacity-40"
                >
                  <Download className="size-3.5" />
                </button>
              )}
              {s.checkedOut && (
                <button
                  onClick={() => onOpen(absolutePath(repo.path, s.path))}
                  title={t('submodules.open')}
                  aria-label={t('submodules.open-one', { path: s.path })}
                  className="rounded p-0.5 text-muted hover:bg-line hover:text-fg"
                >
                  <FolderOpen className="size-3.5" />
                </button>
              )}
              <span
                title={
                  s.state === 'current'
                    ? at
                    : t(`submodules.${s.state}-why`, {
                        hash: s.recorded.slice(0, 7),
                      })
                }
                className={`shrink-0 font-mono text-xs ${
                  s.state === 'changed' ? 'text-modified' : 'text-muted'
                }`}
              >
                {s.state === 'missing'
                  ? t('submodules.missing')
                  : at.slice(0, 7)}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
