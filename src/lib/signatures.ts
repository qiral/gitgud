import { useEffect, useState } from 'react'
import { git, type Signature } from './git'

/** Checked signatures by commit, null for unsigned ones. Checking starts a
 *  program per signed commit, so it's only done once, for what's on screen. */
const checked = new Map<string, Map<string, Signature | null>>()

/** A repository's checks start over, e.g. after its keys changed. */
export const forgetSignatures = (repo: string) => checked.delete(repo)

/** Signatures of `hashes`, filled in a moment after they're shown. */
export function useSignatures(repo: string, hashes: string[]) {
  const [, update] = useState(0)
  let known = checked.get(repo)
  if (!known) checked.set(repo, (known = new Map()))
  const key = hashes.filter((h) => !known.has(h)).join(' ')

  useEffect(() => {
    if (!key) return
    let cancelled = false
    // Rows scrolled past quickly aren't worth checking.
    const timer = setTimeout(async () => {
      const ask = key.split(' ')
      const found = await git.signatures(repo, ask).catch(() => null)
      const into = checked.get(repo)
      if (!into) return
      // Not found out, e.g. gpg is missing: shown without a badge.
      for (const h of ask) into.set(h, found?.[h] ?? null)
      if (!cancelled) update((n) => n + 1)
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [repo, key])

  return known
}
