import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { errorMessage, git } from '../lib/git'
import type { Sides } from './FileDiffView'
import { useTranslation } from '../i18n'

type Mode = 'side-by-side' | 'swipe'

/** Shows through the see-through parts of a picture. */
const CHECKERED = {
  backgroundImage:
    'conic-gradient(var(--app-hover) 25%, transparent 0 50%, var(--app-hover) 0 75%, transparent 0)',
  backgroundSize: '16px 16px',
}

interface Props {
  repo: string
  path: string
  oldPath?: string
  sides: Sides
  /** Loads the pictures again whenever it changes. */
  version: string
}

/** A picture before and after a change. */
export default function ImageDiff({
  repo,
  path,
  oldPath,
  sides,
  version,
}: Props) {
  const { t } = useTranslation()
  const [images, setImages] = useState<
    { before: string | null; after: string | null } | string | null
  >(null)
  const [mode, setMode] = useState<Mode>('side-by-side')

  useEffect(() => {
    let cancelled = false
    setImages(null)
    Promise.all([
      git.fileImage(repo, oldPath ?? path, sides.before),
      git.fileImage(repo, path, sides.after),
    ])
      .then(([before, after]) => !cancelled && setImages({ before, after }))
      .catch((e) => !cancelled && setImages(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [repo, path, oldPath, sides.before, sides.after, version])

  if (images === null)
    return (
      <div className="flex justify-center p-6 text-muted">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  if (typeof images === 'string')
    return <p className="p-6 text-muted select-text">{images}</p>

  const { before, after } = images
  if (!before || !after) {
    const only = after ?? before
    return only ? (
      <div className="p-4">
        <Picture
          src={only}
          label={t(after ? 'imagediff.added' : 'imagediff.deleted')}
          color={after ? 'text-added' : 'text-removed'}
        />
      </div>
    ) : (
      <p className="p-6 text-muted">{t('imagediff.nothing')}</p>
    )
  }

  return (
    <div className="space-y-3 p-4">
      <div role="group" className="flex justify-center gap-1">
        {(['side-by-side', 'swipe'] as const).map((m) => (
          <button
            key={m}
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={`rounded px-2 py-0.5 text-xs ${
              mode === m
                ? 'bg-hover font-medium text-fg'
                : 'text-muted hover:text-fg'
            }`}
          >
            {t(`imagediff.${m}`)}
          </button>
        ))}
      </div>
      {mode === 'swipe' ? (
        <Swipe before={before} after={after} />
      ) : (
        <div className="grid grid-cols-2 items-start gap-4">
          <Picture
            src={before}
            label={t('imagediff.before')}
            color="text-removed"
          />
          <Picture
            src={after}
            label={t('imagediff.after')}
            color="text-added"
          />
        </div>
      )}
    </div>
  )
}

/** Bytes in a base64 data: URL. */
const bytes = (url: string) => {
  const data = url.slice(url.indexOf(',') + 1)
  return (data.length / 4) * 3 - (/=*$/.exec(data)?.[0].length ?? 0)
}

function size(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function Picture({
  src,
  label,
  color,
}: {
  src: string
  label: string
  color: string
}) {
  const { t } = useTranslation()
  const [pixels, setPixels] = useState('')
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    setPixels('')
    setBroken(false)
  }, [src])
  return (
    <figure className="flex min-w-0 flex-col items-center gap-2">
      <figcaption className="text-xs text-muted">
        <span className={`font-medium ${color}`}>{label}</span>
        {pixels && ` · ${pixels}`} · {size(bytes(src))}
      </figcaption>
      {broken ? (
        <p className="text-muted">{t('imagediff.broken')}</p>
      ) : (
        <img
          src={src}
          alt={label}
          draggable={false}
          onError={() => setBroken(true)}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget
            if (w && h) setPixels(`${w} × ${h}`)
          }}
          style={CHECKERED}
          className="max-h-[60vh] max-w-full border border-line"
        />
      )}
    </figure>
  )
}

/** Both pictures on top of each other with a divider to drag. */
function Swipe({ before, after }: { before: string; after: string }) {
  const { t } = useTranslation()
  const [at, setAt] = useState(50)
  const layer =
    'absolute inset-0 m-auto max-h-full max-w-full object-contain select-none'
  return (
    <div className="mx-auto max-w-3xl space-y-2">
      <div
        className="relative h-[55vh] overflow-hidden border border-line"
        style={CHECKERED}
      >
        <img
          src={before}
          alt={t('imagediff.before')}
          draggable={false}
          className={`${layer} size-full`}
          style={{ clipPath: `inset(0 ${100 - at}% 0 0)` }}
        />
        <img
          src={after}
          alt={t('imagediff.after')}
          draggable={false}
          className={`${layer} size-full`}
          style={{ clipPath: `inset(0 0 0 ${at}%)` }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent"
          style={{ left: `${at}%` }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={at}
        aria-label={t('imagediff.swipe')}
        onChange={(e) => setAt(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </div>
  )
}
