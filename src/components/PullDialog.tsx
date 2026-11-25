import { useState } from 'react'
import { GitMerge, GitPullRequestArrow } from 'lucide-react'
import { type PullMode } from '../lib/git'
import Dialog from './Dialog'
import { useTranslation } from '../i18n'

interface Props {
  branch: string
  upstream: string
  ahead: number
  behind: number
  onPull: (mode: PullMode, remember: boolean) => void
  onClose: () => void
}

/** Asks how to pull when the branch and its upstream have both moved on. */
export default function PullDialog({
  branch,
  upstream,
  ahead,
  behind,
  onPull,
  onClose,
}: Props) {
  const { t, tp } = useTranslation()
  const [remember, setRemember] = useState(false)

  const choices = [
    {
      mode: 'merge' as const,
      icon: GitMerge,
      label: t('pulldialog.merge'),
      description: t('pulldialog.merge-desc', { upstream, branch }),
    },
    {
      mode: 'rebase' as const,
      icon: GitPullRequestArrow,
      label: t('pulldialog.rebase'),
      description: t('pulldialog.rebase-desc', {
        commits: tp('pulldialog.commits', ahead),
        upstream,
      }),
    },
  ]

  return (
    <Dialog title={t('pulldialog.branches-have-diverged')} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-muted">
          {branch} has {ahead} commit{ahead > 1 ? 's' : ''} that {upstream}{' '}
          doesn't, and {upstream} has {behind} that {branch} doesn't. How do you
          want to combine them?
        </p>
        {choices.map(({ mode, icon: Icon, label, description }) => (
          <button
            key={mode}
            onClick={() => onPull(mode, remember)}
            className="flex w-full items-start gap-3 rounded border border-line p-3 text-left hover:border-accent hover:bg-hover"
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>
              <span className="block font-medium">{label}</span>
              <span className="block text-xs text-muted">{description}</span>
            </span>
          </button>
        ))}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t('pulldialog.remember-for-this-repository')}
        </label>
      </div>
    </Dialog>
  )
}
