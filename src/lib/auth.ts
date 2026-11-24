import type { Translate } from '../i18n'

/** Something wrong with the GitHub sign-in that the user should know about. */
export type SignInProblem =
  { kind: 'expired' } | { kind: 'scopes'; scopes: string[] }

export function authMessage(problem: SignInProblem, t: Translate) {
  return problem.kind === 'expired'
    ? t('auth.expired')
    : t('auth.missing-scopes', { scopes: problem.scopes.join(', ') })
}
