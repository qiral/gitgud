import { useEffect, useMemo, useRef, useState } from 'react'
import { splitDiff } from '../lib/diff'
import { fileMenuItems } from '../lib/copy'
import { basename, dirname } from '../lib/paths'
import { useContextMenu } from './ContextMenu'
import DiffView from './DiffView'
import FileHeader, { LineCounts, STATUS_STYLE } from './FileHeader'
import { useResizable } from './Resizable'

interface Props {
  repo: string
  /** A patch touching any number of files, e.g. from `git show`. */
  patch: string
  /** Shown above the file list, e.g. the commit's message and author. */
  header: React.ReactNode
}

/**
 * A commit or stash: the files it changed on the left and the selected
 * file's diff on the right.
 */
export default function PatchView({ repo, patch, header }: Props) {
  const { files } = useMemo(() => splitDiff(patch), [patch])
  const [selected, setSelected] = useState(0)
  const { menu, open } = useContextMenu()
  const diffPane = useRef<HTMLDivElement>(null)
  const list = useResizable({
    key: 'commitFiles',
    initial: 288,
    min: 160,
    max: 700,
  })

  // Another commit has other files; start again from the first one.
  useEffect(() => setSelected(0), [patch])
  useEffect(() => {
    if (diffPane.current) diffPane.current.scrollTop = 0
  }, [patch, selected])

  const file = files[Math.min(selected, files.length - 1)]
  const exists = (status: string) => status !== 'deleted'

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    setSelected((s) => Math.max(0, Math.min(files.length - 1, s + step)))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      {files.length === 0 ? (
        <p className="p-6 text-muted">No file changes in this commit.</p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div
            style={{ width: list.width }}
            className="relative flex shrink-0 flex-col border-r border-line"
          >
            {list.handle}
            <div className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
              {files.length} changed file{files.length > 1 ? 's' : ''}
            </div>
            <ul
              tabIndex={0}
              onKeyDown={onKeyDown}
              className="min-h-0 flex-1 overflow-auto outline-none"
            >
              {files.map((f, i) => {
                const [letter, color] = STATUS_STYLE[f.status]
                return (
                  <li
                    key={`${i}:${f.path}`}
                    onClick={() => setSelected(i)}
                    onContextMenu={(e) =>
                      open(e, fileMenuItems(repo, f.path, exists(f.status)))
                    }
                    title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                    className={`flex cursor-default items-center gap-2 px-3 py-1 ${
                      file === f ? 'bg-hover' : 'hover:bg-hover/60'
                    }`}
                  >
                    <span
                      className={`w-3 text-center font-mono text-xs font-bold ${color}`}
                    >
                      {letter}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <span>{basename(f.path)}</span>
                      <span className="ml-1.5 text-xs text-muted">
                        {dirname(f.path)}
                      </span>
                    </span>
                    <LineCounts add={f.additions} del={f.deletions} />
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <FileHeader
              repo={repo}
              path={file.path}
              oldPath={file.oldPath}
              additions={file.additions}
              deletions={file.deletions}
              exists={exists(file.status)}
            />
            <div ref={diffPane} className="min-h-0 flex-1 overflow-auto">
              <DiffView diff={file.diff} />
            </div>
          </div>
        </div>
      )}
      {menu}
    </div>
  )
}
