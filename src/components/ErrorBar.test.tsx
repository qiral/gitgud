import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ErrorBar from './ErrorBar'

it('shows the error and offers Copilot to explain it', () => {
  const onExplain = vi.fn()
  const onDismiss = vi.fn()
  render(
    <ErrorBar
      error="error: failed to push some refs"
      onExplain={onExplain}
      onDismiss={onDismiss}
    />,
  )
  expect(screen.getByText('error: failed to push some refs')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Explain with Copilot' }))
  expect(onExplain).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(onDismiss).toHaveBeenCalled()
})

it('has no Copilot button for errors it cannot explain', () => {
  render(<ErrorBar error="Copilot failed: boom" onDismiss={() => {}} />)
  expect(
    screen.queryByRole('button', { name: 'Explain with Copilot' }),
  ).toBeNull()
})
