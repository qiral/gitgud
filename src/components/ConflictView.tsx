import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import {
  errorMessage,
  git,
  type ConflictPart,
  type FileChange,
  type RepoInfo,
} from '../lib/git'

interface Props {
  repo: RepoInfo
  file: FileChange
  /** Changes whenever the repo is refreshed, so the file is re-read. */
  version: unknown
  act: (label: string, action: () => Promise<unknown>) => Promise<boolean>
}

/** Resolve a conflicted file block by block, or take one side entirely. */
export default function ConflictView({ repo, file, version, act }: Props) {
  const [parts, setParts] = useState<ConflictPart[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    git
      .conflictParts(repo.path, file.path)
      .then((p) => {
        if (cancelled) return
        setParts(p)
        setLoadError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setParts(null)
        setLoadError(errorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [repo.path, file.path, version])

  const conflicts = parts?.filter((p) => p.kind === 'conflict').length ?? 0

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-medium" title={file.path}>
          {file.path}
          <span className="ml-2 font-normal text-muted">
            {parts
              ? conflicts > 0
                ? `${conflicts} conflict${conflicts > 1 ? 's' : ''} left`
                : 'No conflicts left'
              : ''}
          </span>
        </span>
        <Button
          onClick={() =>
            act('resolve', () => git.resolveFile(repo.path, file.path, 'ours'))
          }
        >
          Use ours for the whole file
        </Button>
        <Button
          onClick={() =>
            act('resolve', () =>
              git.resolveFile(repo.path, file.path, 'theirs'),
            )
          }
        >
          Use theirs for the whole file
        </Button>
        <Button
          primary
          disabled={!parts || conflicts > 0}
          onClick={() =>
            act('resolve', () => git.markResolved(repo.path, file.path))
          }
        >
          <Check className="size-3.5" /> Mark as resolved
        </Button>
      </div>

      {loadError ? (
        <p className="p-6 text-muted">
          This file can't be shown here ({loadError}). It was probably deleted
          on one side; pick the version to keep with the buttons above.
        </p>
      ) : !parts ? (
        <div className="flex justify-center p-8 text-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="font-mono text-xs leading-5">
          {parts.map((part, i) =>
            part.kind === 'text' ? (
              <Lines key={i} lines={part.lines} className="text-muted" />
            ) : (
              <ConflictBlock
                key={i}
                part={part}
                onChoose={(choice) =>
                  act('resolve', () =>
                    git.resolveBlock(
                      repo.path,
                      file.path,
                      conflictIndex(parts, i),
                      choice,
                    ),
                  )
                }
              />
            ),
          )}
        </div>
      )}
    </div>
  )
}

/** Position of parts[i] among the conflicts only, as the backend counts. */
function conflictIndex(parts: ConflictPart[], i: number) {
  return parts.slice(0, i).filter((p) => p.kind === 'conflict').length
}

function ConflictBlock({
  part,
  onChoose,
}: {
  part: Extract<ConflictPart, { kind: 'conflict' }>
  onChoose: (choice: 'ours' | 'theirs' | 'both') => void
}) {
  return (
    <div className="my-2 overflow-hidden border-y border-line">
      <div className="flex items-center gap-2 bg-panel px-3 py-1.5 font-sans">
        <span className="flex-1 font-medium">Conflict</span>
        <Button onClick={() => onChoose('ours')}>Use ours</Button>
        <Button onClick={() => onChoose('theirs')}>Use theirs</Button>
        <Button onClick={() => onChoose('both')}>Use both</Button>
      </div>
      <Side label={`Ours (${part.oursLabel})`} tone="ours" lines={part.ours} />
      {part.base && <Side label="Original" tone="base" lines={part.base} />}
      <Side
        label={`Theirs (${part.theirsLabel})`}
        tone="theirs"
        lines={part.theirs}
      />
    </div>
  )
}

const TONE = {
  ours: 'border-accent bg-accent/10',
  base: 'border-line bg-panel',
  theirs: 'border-modified bg-modified/10',
}

function Side({
  label,
  tone,
  lines,
}: {
  label: string
  tone: keyof typeof TONE
  lines: string[]
}) {
  return (
    <div className={`border-l-4 ${TONE[tone]}`}>
      <div className="px-3 pt-1 font-sans text-[11px] font-semibold text-muted">
        {label}
      </div>
      {lines.length > 0 ? (
        <Lines lines={lines} />
      ) : (
        <div className="px-3 pb-1 text-muted italic">(nothing)</div>
      )}
    </div>
  )
}

function Lines({
  lines,
  className = '',
}: {
  lines: string[]
  className?: string
}) {
  return (
    <pre className={`px-3 whitespace-pre select-text ${className}`}>
      {lines.map((l) => l.replace(/\r?\n$/, '')).join('\n')}
    </pre>
  )
}

function Button({
  primary,
  disabled,
  onClick,
  children,
}: {
  primary?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium disabled:opacity-40 ${
        primary
          ? 'bg-accent text-on-accent hover:opacity-90'
          : 'border border-line text-fg hover:bg-hover'
      }`}
    >
      {children}
    </button>
  )
}
