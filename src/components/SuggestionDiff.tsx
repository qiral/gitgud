import { Check, X } from 'lucide-react'
import { diffLines, type DiffLine } from '../lib/diff'
import { useTranslation } from '../i18n'

const STYLE: Record<DiffLine['kind'], [string, string]> = {
  add: ['+', 'bg-added-bg'],
  remove: ['-', 'bg-removed-bg'],
  context: ['', ''],
}

const lines = (text: string) =>
  text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/)

interface Props {
  label: string
  /** What the suggestion would replace. */
  before: string
  after: string
  onAccept: () => void
  onReject: () => void
}

/** A Copilot suggestion shown as a diff against what it would replace. */
export default function SuggestionDiff({
  label,
  before,
  after,
  onAccept,
  onReject,
}: Props) {
  const { t } = useTranslation()
  return (
    <div className="overflow-hidden rounded border border-line">
      <div className="flex items-center gap-2 bg-panel px-2 py-1 font-sans text-xs">
        <span className="flex-1 font-semibold text-muted">{label}</span>
        <button
          onClick={onAccept}
          className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 font-medium text-on-accent hover:opacity-90"
        >
          <Check className="size-3.5" />
          {t('suggestiondiff.accept')}
        </button>
        <button
          onClick={onReject}
          className="flex items-center gap-1 rounded border border-line px-2 py-0.5 hover:bg-hover"
        >
          <X className="size-3.5" />
          {t('suggestiondiff.reject')}
        </button>
      </div>
      <div className="max-h-60 overflow-auto code-text">
        {diffLines(lines(before), lines(after)).map((line, i) => (
          <div
            key={i}
            data-kind={line.kind}
            className={`flex ${STYLE[line.kind][1]}`}
          >
            <span className="w-5 shrink-0 text-center text-muted select-none">
              {STYLE[line.kind][0]}
            </span>
            <span className="whitespace-pre-wrap select-text">
              {line.text || ' '}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
