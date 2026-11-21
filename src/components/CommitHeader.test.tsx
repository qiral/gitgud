import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CommitHeader } from './CommitHeader'

const commit = {
  hash: 'abc1234def',
  shortHash: 'abc1234',
  author: 'T',
  email: 't@x',
  time: 0,
  subject: 'fix login',
  parents: [],
  refs: [],
  graph: { lane: 0, color: 0, width: 1, segments: [] },
}

it('offers Copilot to explain the commit', () => {
  const onExplain = vi.fn()
  render(
    <CommitHeader commit={commit} message="fix login" onExplain={onExplain} />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Explain with Copilot' }))
  expect(onExplain).toHaveBeenCalled()
})
