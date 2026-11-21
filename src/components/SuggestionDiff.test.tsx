import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import SuggestionDiff from './SuggestionDiff'

it('shows the change as a diff and reports the choice', () => {
  const onAccept = vi.fn()
  const onReject = vi.fn()
  render(
    <SuggestionDiff
      label="Copilot's message"
      before="fix stuff"
      after="trim username"
      onAccept={onAccept}
      onReject={onReject}
    />,
  )
  expect(screen.getByText('fix stuff').closest('[data-kind]')).toHaveProperty(
    'dataset.kind',
    'remove',
  )
  expect(
    screen.getByText('trim username').closest('[data-kind]'),
  ).toHaveProperty('dataset.kind', 'add')

  fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
  expect(onAccept).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
  expect(onReject).toHaveBeenCalled()
})
