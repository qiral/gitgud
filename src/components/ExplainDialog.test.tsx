import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import ExplainDialog from './ExplainDialog'

it('shows a spinner until the explanation arrives', () => {
  const { rerender } = render(
    <ExplainDialog
      title="Explain abc1234"
      explanation={null}
      onClose={() => {}}
    />,
  )
  expect(screen.getByRole('status')).toBeTruthy()

  rerender(
    <ExplainDialog
      title="Explain abc1234"
      explanation="It renames x to y."
      onClose={() => {}}
    />,
  )
  expect(screen.getByText('It renames x to y.')).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
})

it('uses the title as given and offers to copy the answer', () => {
  render(
    <ExplainDialog
      title="Review of staged changes"
      explanation="Nothing stood out."
      onClose={() => {}}
    />,
  )
  expect(screen.getByText('Review of staged changes')).toBeTruthy()
  expect(screen.getByTitle('Copy')).toBeTruthy()
})
