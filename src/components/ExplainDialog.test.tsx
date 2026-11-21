import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import ExplainDialog from './ExplainDialog'

it('shows a spinner until the explanation arrives', () => {
  const { rerender } = render(
    <ExplainDialog title="abc1234" explanation={null} onClose={() => {}} />,
  )
  expect(screen.getByRole('status')).toBeTruthy()

  rerender(
    <ExplainDialog
      title="abc1234"
      explanation="It renames x to y."
      onClose={() => {}}
    />,
  )
  expect(screen.getByText('It renames x to y.')).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
})
