import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Copy,
  FileStack,
  GitCommitHorizontal,
  History,
  Loader2,
  Space,
  Sparkles,
  X,
} from 'lucide-react'
import { errorMessage, git, type Blame, type BlameOrigin } from '../lib/git'
import { copyText } from '../lib/copy'
import { setDiffPref, useDiffPrefs } from '../lib/diffPrefs'
import { basename, dirname } from '../lib/paths'
import { readFlag, writeFlag } from '../lib/prefs'
import { relativeTime } from '../lib/time'
import { useVirtualRows } from '../lib/virtual'
import { useContextMenu, type MenuItem } from './ContextMenu'
import { Toggle } from './FileHeader'
import { useTranslation } from '../i18n'

/** A file to blame, at a commit or (null) as it is on disk. */
export interface BlameTarget {
  path: string
  rev: string | null
}

/** A step of walking back through parents. */
type Step = BlameTarget & {
  /** The line to show first, counted from 1. */
  line?: number
}

interface Props {
  repo: string
  target: BlameTarget
  /** Reloads the file on disk when this changes. */
  version: unknown
  onShowCommit: (hash: string) => void
  /** Asks Copilot to explain a commit; unset to hide. */
  onExplain?: (hash: string) => void
  onClose: () => void
}

/** Matches `h-5` on the rows. */
const ROW_HEIGHT = 20
const FOLLOW_MOVES = 'blame.followMoves'

const short = (hash: string) => hash.slice(0, 7)

/** For each line, the number of the group of neighbours from one commit. */
function groupLines(blame: Blame) {
  let group = -1
  return blame.lines.map((l, i) => {
    const before = blame.lines[i - 1]
    if (
      !before ||
      blame.origins[before.origin].hash !== blame.origins[l.origin].hash
    )
      group++
    return group
  })
}

/** Width of the longest line in characters, with tabs at their widest. */
function longestLine(blame: Blame) {
  let max = 0
  for (const { text } of blame.lines)
    max = Math.max(max, text.length + (text.split('\t').length - 1) * 7)
  return max
}

/** A file with the commit that last changed each of its lines. */
export default function BlameView({
  repo,
  target,
  version,
  onShowCommit,
  onExplain,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const { ignoreWhitespace } = useDiffPrefs()
  const [followMoves, setFollowMoves] = useState(() => readFlag(FOLLOW_MOVES))
  const [steps, setSteps] = useState<Step[]>([target])
  const step = steps[steps.length - 1]
  const [loaded, setLoaded] = useState<{ step: Step; blame: Blame } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const { menu, open } = useContextMenu()
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => setSteps([target]), [target])

  // A commit never changes, so only the file on disk is loaded again.
  const diskVersion = step.rev === null ? version : null
  useEffect(() => {
    let cancelled = false
    setError(null)
    git
      .blame(repo, step.path, step.rev, ignoreWhitespace, followMoves)
      .then((blame) => !cancelled && setLoaded({ step, blame }))
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [repo, step, ignoreWhitespace, followMoves, diskVersion])

  // What's shown stays up while it reloads, but not for another step.
  const blame = loaded?.step === step ? loaded.blame : null
  const groups = useMemo(() => (blame ? groupLines(blame) : []), [blame])
  const width = useMemo(() => (blame ? longestLine(blame) : 0), [blame])
  const rows = useVirtualRows<HTMLDivElement>(
    blame?.lines.length ?? 0,
    ROW_HEIGHT,
  )

  const shown = loaded?.step
  useEffect(() => {
    const el = scroller.current
    if (!el || !shown) return
    el.scrollTop = shown.line
      ? shown.line * ROW_HEIGHT - el.clientHeight / 2
      : 0
  }, [shown])

  /** Moves on, remembering the line to come back to. */
  function blameParent(origin: BlameOrigin, line: number, original: number) {
    const { previous } = origin
    if (!previous) return
    setSteps([
      ...steps.slice(0, -1),
      { ...step, line },
      { path: previous.path, rev: previous.hash, line: original },
    ])
  }

  function menuFor(index: number): MenuItem[] {
    const line = blame!.lines[index]
    const origin = blame!.origins[line.origin]
    const { hash } = origin
    const items: MenuItem[] = []
    if (hash)
      items.push({
        label: t('blameview.show-in-history'),
        icon: GitCommitHorizontal,
        onClick: () => onShowCommit(hash),
      })
    items.push({
      label: t('blameview.blame-parent'),
      icon: History,
      disabled: !origin.previous,
      onClick: () => blameParent(origin, index + 1, line.original),
    })
    if (hash) {
      items.push({
        label: t('historypanel.copy-commit-hash'),
        icon: Copy,
        onClick: () => copyText(hash),
      })
      if (onExplain)
        items.push({
          label: t('historypanel.explain-with-copilot'),
          icon: Sparkles,
          onClick: () => onExplain(hash),
        })
    }
    return items
  }

  const dir = dirname(step.path)
  const iconButton =
    'shrink-0 rounded p-0.5 text-muted hover:bg-hover hover:text-fg'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1.5">
        {steps.length > 1 && (
          <button
            onClick={() => setSteps(steps.slice(0, -1))}
            title={t('blameview.back')}
            className={iconButton}
          >
            <ArrowLeft className="size-4" />
          </button>
        )}
        <div className="min-w-0 flex-1 truncate select-text" title={step.path}>
          <span className="text-muted">{t('blameview.blame')} </span>
          {dir && <span className="text-muted">{dir}/</span>}
          <span className="font-medium">{basename(step.path)}</span>
          <span className="ml-2 font-mono text-xs text-muted">
            {step.rev ? short(step.rev) : ''}
          </span>
        </div>
        <Toggle
          on={ignoreWhitespace}
          title={t('fileheader.ignore-whitespace')}
          onClick={() => setDiffPref('ignoreWhitespace', !ignoreWhitespace)}
        >
          <Space className="size-4" />
        </Toggle>
        <Toggle
          on={followMoves}
          title={t('blameview.follow-moves')}
          onClick={() => {
            writeFlag(FOLLOW_MOVES, !followMoves)
            setFollowMoves(!followMoves)
          }}
        >
          <FileStack className="size-4" />
        </Toggle>
        <button
          onClick={onClose}
          title={t('blameview.close')}
          className={iconButton}
        >
          <X className="size-4" />
        </button>
      </div>

      {error ? (
        <p className="p-6 whitespace-pre-wrap text-removed select-text">
          {error}
        </p>
      ) : !blame ? (
        <div className="flex justify-center p-6 text-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : blame.lines.length === 0 ? (
        <p className="p-6 text-muted">{t('blameview.empty')}</p>
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
          <div
            ref={rows.ref}
            className="font-mono text-xs"
            style={{
              // Only some rows exist at a time, so they can't size this.
              minWidth: `calc(26rem + ${width}ch)`,
              paddingTop: rows.top,
              paddingBottom: rows.bottom,
            }}
          >
            {blame.lines.slice(rows.start, rows.end).map((line, offset) => {
              const i = rows.start + offset
              const origin = blame.origins[line.origin]
              const first = groups[i] !== groups[i - 1]
              const shade = groups[i] % 2 === 0 ? 'bg-bg' : 'bg-panel'
              return (
                <div
                  key={i}
                  onContextMenu={(e) => open(e, menuFor(i))}
                  className={`group flex h-5 leading-5 ${shade}`}
                >
                  <div
                    className={`sticky left-0 z-[1] flex w-[22rem] shrink-0 items-center gap-2 border-r border-line px-2 ${shade} ${
                      first && i > 0 ? 'border-t border-t-line' : ''
                    }`}
                  >
                    {first && (
                      <>
                        {origin.hash ? (
                          <button
                            onClick={() => onShowCommit(origin.hash!)}
                            title={`${origin.subject}\n${origin.author}, ${new Date(origin.time * 1000).toLocaleString()}`}
                            className="flex min-w-0 flex-1 gap-2 text-left text-muted hover:text-fg"
                          >
                            <span className="shrink-0 text-accent">
                              {short(origin.hash)}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-sans">
                              {origin.author}
                            </span>
                            <span className="shrink-0 font-sans">
                              {relativeTime(origin.time)}
                            </span>
                          </button>
                        ) : (
                          <span className="min-w-0 flex-1 truncate font-sans text-modified">
                            {t('blameview.not-committed')}
                          </span>
                        )}
                        {origin.previous ? (
                          <button
                            onClick={() =>
                              blameParent(origin, i + 1, line.original)
                            }
                            title={t('blameview.blame-parent')}
                            className="invisible shrink-0 text-muted group-hover:visible hover:text-fg"
                          >
                            <History className="size-3.5" />
                          </button>
                        ) : (
                          <span className="size-3.5 shrink-0" />
                        )}
                      </>
                    )}
                  </div>
                  <span className="w-14 shrink-0 pr-3 text-right text-muted select-none">
                    {i + 1}
                  </span>
                  <span className="whitespace-pre select-text">
                    {line.text}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {menu}
    </div>
  )
}
