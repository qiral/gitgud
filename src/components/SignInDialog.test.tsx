import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import SignInDialog from './SignInDialog'

const CODE = {
  deviceCode: 'dev-123',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  // Poll right away so the test doesn't wait.
  interval: 0,
}
const ACCOUNT = { login: 'octocat', name: null, avatarUrl: 'https://a/1' }

it('shows the code, polls until approved, then reports the account', async () => {
  const polls: unknown[] = []
  mockIPC((cmd, args) => {
    if (cmd === 'github_start_sign_in') return CODE
    if (cmd === 'github_poll_sign_in') {
      polls.push(args)
      return polls.length < 3
        ? { state: 'pending', interval: 0 }
        : { state: 'done', account: ACCOUNT }
    }
  })
  const onSignedIn = vi.fn()
  render(<SignInDialog onClose={() => {}} onSignedIn={onSignedIn} />)

  expect(await screen.findByText('ABCD-1234')).toBeTruthy()
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(ACCOUNT))
  expect(polls).toHaveLength(3)
  expect(polls[0]).toEqual({ deviceCode: 'dev-123', interval: 0 })
})

it('shows why sign-in failed and can start over', async () => {
  let starts = 0
  mockIPC((cmd) => {
    if (cmd === 'github_start_sign_in') {
      starts++
      return CODE
    }
    if (cmd === 'github_poll_sign_in')
      // What the backend returned for the avatar_url bug fixed in v0.5.0.
      throw 'GitHub request failed: json: missing field `avatarUrl`'
  })
  render(<SignInDialog onClose={() => {}} onSignedIn={() => {}} />)

  expect(await screen.findByText(/missing field/)).toBeTruthy()
  fireEvent.click(screen.getByText('Try again'))
  await screen.findByText('ABCD-1234')
  expect(starts).toBe(2)
})
