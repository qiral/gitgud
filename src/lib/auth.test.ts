import { expect, it } from 'vitest'
import { authMessage } from './auth'
import { translate, type Translate } from '../i18n'

const t: Translate = (key, vars) => translate(null, key, vars)

it('says when the sign-in expired, or lacks permissions', () => {
  expect(authMessage({ kind: 'expired' }, t)).toBe(
    'Your GitHub sign-in expired or was revoked. Sign in again to keep using GitHub and Copilot.',
  )
  expect(authMessage({ kind: 'scopes', scopes: ['workflow'] }, t)).toBe(
    'Your GitHub sign-in is missing permissions (workflow). Sign out and sign in again to grant them.',
  )
})
