import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import type { Signature, SignatureFormat } from '../lib/git'
import { useTranslation } from '../i18n'

const FORMATS: Record<SignatureFormat, string> = {
  openpgp: 'GPG',
  ssh: 'SSH',
  x509: 'X.509',
}

const LOOKS = {
  verified: { icon: ShieldCheck, color: 'text-added' },
  unknown: { icon: ShieldQuestion, color: 'text-muted' },
  bad: { icon: ShieldAlert, color: 'text-removed' },
}

/** Says a commit is signed, and whether the signature is good. */
export default function SignatureBadge({
  signature,
  label = false,
}: {
  signature: Signature
  /** With its name next to the icon. */
  label?: boolean
}) {
  const { t } = useTranslation()
  const { icon: Icon, color } = LOOKS[signature.state]
  const name = t(`signing.${signature.state}`)
  const title = [
    `${name} (${FORMATS[signature.format]})`,
    signature.signer,
    signature.key,
    signature.state === 'verified' ? null : t(`signing.${signature.state}-why`),
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <span
      title={title}
      aria-label={name}
      role="img"
      className={`flex shrink-0 items-center gap-1 ${color}`}
    >
      <Icon className="size-3.5" />
      {label && name}
    </span>
  )
}
