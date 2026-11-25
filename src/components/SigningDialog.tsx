import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  errorMessage,
  git,
  type RepoInfo,
  type SignatureFormat,
  type SigningSettings,
} from '../lib/git'
import { forgetSignatures } from '../lib/signatures'
import Dialog from './Dialog'
import { useTranslation } from '../i18n'

/** A key and its format as one option of the list. */
const option = (format: SignatureFormat, value: string | null) =>
  `${format} ${value ?? ''}`

/** Turns commit signing on or off for a repository and picks the key. */
export default function SigningDialog({
  repo,
  onClose,
}: {
  repo: RepoInfo
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<SigningSettings | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    git
      .signingSettings(repo.path)
      .then((s) => {
        if (cancelled) return
        setSettings(s)
        setEnabled(s.enabled)
        setPicked(option(s.format, s.key))
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [repo.path])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const at = picked.indexOf(' ')
      await git.setSigning(
        repo.path,
        enabled,
        picked.slice(0, at) as SignatureFormat,
        picked.slice(at + 1) || null,
      )
      forgetSignatures(repo.path)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const groups = settings
    ? (['openpgp', 'ssh'] as const).map((format) => ({
        label: t(`signing.keys-${format}`),
        list: [
          // Only gpg can pick a key by itself.
          ...(format === 'openpgp'
            ? [{ value: option(format, null), label: t('signing.by-email') }]
            : []),
          ...settings.keys
            .filter((k) => k.format === format)
            .map((k) => ({ value: option(format, k.value), label: k.label })),
        ],
      }))
    : []
  const listed = groups.some((g) => g.list.some((k) => k.value === picked))
  // SSH without a key has nothing to sign with.
  const incomplete = enabled && picked === option('ssh', null)

  return (
    <Dialog title={t('signing.title')} onClose={onClose}>
      {!settings ? (
        error ? (
          <p className="text-removed select-text">{error}</p>
        ) : (
          <div className="flex justify-center p-4 text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )
      ) : (
        <form onSubmit={save} className="space-y-3">
          <label className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {t('signing.enable')}
          </label>
          <label className="block">
            <span className="mb-1 block text-muted">{t('signing.key')}</span>
            <select
              value={picked}
              disabled={!enabled}
              onChange={(e) => setPicked(e.target.value)}
              className="w-full rounded border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent disabled:opacity-40"
            >
              {/* Set by hand, e.g. an X.509 certificate or a subkey. */}
              {!listed && (
                <option value={picked}>
                  {settings.key ?? t('signing.choose-key')}
                </option>
              )}
              {groups
                .filter((g) => g.list.length > 0)
                .map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.list.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </select>
          </label>
          <p className="text-xs text-muted">{t('signing.hint')}</p>
          {error && (
            <p className="whitespace-pre-wrap text-removed select-text">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || incomplete}
            className="flex w-full items-center justify-center gap-2 rounded bg-accent py-2 font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('toolbar.save')}
          </button>
        </form>
      )}
    </Dialog>
  )
}
