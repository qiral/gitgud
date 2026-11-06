import type { Commit, Stash } from '../lib/git'
import { relativeTime } from '../lib/time'
import CopyButton from './CopyButton'

const fullDate = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toLocaleString()

/** Subject, body, author and hash of the commit shown in the diff pane. */
export function CommitHeader({
  commit,
  message,
}: {
  commit: Commit
  /** The full message, as `git show --format=%B` prints it. */
  message: string
}) {
  const body = message.split('\n').slice(1).join('\n').trim()
  return (
    <div className="shrink-0 border-b border-line px-4 py-3">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 font-semibold break-words select-text">
          {commit.subject}
        </h2>
        <CopyButton text={commit.subject} title="Copy message" />
      </div>
      {body && (
        <p className="mt-1.5 max-h-40 overflow-auto text-sm whitespace-pre-wrap text-muted select-text">
          {body}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className="select-text" title={commit.email}>
          {commit.author}
        </span>
        <span>·</span>
        <span title={fullDate(commit.time)}>{relativeTime(commit.time)}</span>
        <span className="flex-1" />
        <CopyButton
          text={commit.hash}
          label={commit.shortHash}
          title={`Copy full hash ${commit.hash}`}
        />
      </div>
    </div>
  )
}

export function StashHeader({ stash }: { stash: Stash }) {
  return (
    <div className="shrink-0 border-b border-line px-4 py-3">
      <h2 className="font-semibold break-words select-text">{stash.message}</h2>
      <div className="mt-1 flex gap-2 text-xs text-muted">
        <span className="font-mono">stash@{`{${stash.index}}`}</span>
        {stash.branch && (
          <>
            <span>·</span>
            <span>on {stash.branch}</span>
          </>
        )}
        <span>·</span>
        <span title={fullDate(stash.time)}>{relativeTime(stash.time)}</span>
      </div>
    </div>
  )
}
