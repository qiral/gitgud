import { useEffect, useState } from 'react'
import { git } from '../lib/git'
import { isImage } from '../lib/paths'
import { readFlag, writeFlag } from '../lib/prefs'
import DiffView from './DiffView'
import ImageDiff from './ImageDiff'
import { useTranslation } from '../i18n'

/** A version of a file: "worktree", "index" or a commit. */
export interface Sides {
  before: string
  after: string
}

interface Props extends React.ComponentProps<typeof DiffView> {
  repo: string
  path: string
  /** The path before the change, when it was another one. */
  oldPath?: string
  sides: Sides
}

/** One file's diff, with the rest of the file at hand: hidden lines can be
 *  shown, and pictures are compared as pictures. */
export default function FileDiffView({
  repo,
  path,
  oldPath,
  sides,
  ...view
}: Props) {
  const { t } = useTranslation()
  const image = isImage(path)
  // SVGs are both; the choice is remembered.
  const text = /\.svg$/i.test(path)
  const [asText, setAsText] = useState(() => readFlag('diff.svgAsText'))
  useEffect(() => setAsText(readFlag('diff.svgAsText')), [path])

  const diff = (
    <DiffView
      {...view}
      path={path}
      loadFile={() => git.fileText(repo, path, sides.after)}
    />
  )
  if (!image) return diff

  return (
    <div>
      {text && (
        <div className="flex gap-1 border-b border-line px-3 py-1.5">
          {[false, true].map((code) => (
            <button
              key={String(code)}
              aria-pressed={asText === code}
              onClick={() => {
                writeFlag('diff.svgAsText', code)
                setAsText(code)
              }}
              className={`rounded px-2 py-0.5 text-xs ${
                asText === code
                  ? 'bg-hover font-medium text-fg'
                  : 'text-muted hover:text-fg'
              }`}
            >
              {t(code ? 'imagediff.code' : 'imagediff.image')}
            </button>
          ))}
        </div>
      )}
      {text && asText ? (
        diff
      ) : (
        <ImageDiff
          repo={repo}
          path={path}
          oldPath={oldPath}
          sides={sides}
          version={view.diff}
        />
      )}
    </div>
  )
}
