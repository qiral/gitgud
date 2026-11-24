import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AuthNotice from './AuthNotice'

it('offers to sign in again, or to dismiss the notice', () => {
  const onSignIn = vi.fn()
  const onDismiss = vi.fn()
  render(
    <AuthNotice
      message="Your GitHub sign-in expired."
      onSignIn={onSignIn}
      onDismiss={onDismiss}
    />,
  )
  expect(screen.getByRole('status').textContent).toContain(
    'Your GitHub sign-in expired.',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(onSignIn).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(onDismiss).toHaveBeenCalled()
})
