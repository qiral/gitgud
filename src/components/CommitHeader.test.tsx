import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { CommitHeader, StashHeader } from './CommitHeader'

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
    <CommitHeader
      repo="/r"
      commit={commit}
      message="fix login"
      onExplain={onExplain}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Explain with Copilot' }))
  expect(onExplain).toHaveBeenCalled()
})

it('says whether the signature is good', async () => {
  mockIPC((cmd) =>
    cmd === 'signatures'
      ? {
          [commit.hash]: {
            state: 'verified',
            format: 'ssh',
            signer: 't@x',
            key: 'SHA256:k',
          },
        }
      : null,
  )
  render(<CommitHeader repo="/signed" commit={commit} message="fix login" />)
  const badge = await screen.findByRole('img', { name: 'Verified' })
  expect(badge.title).toBe('Verified (SSH)\nt@x\nSHA256:k')
})

it('offers Copilot to explain a stash', () => {
  const onExplain = vi.fn()
  render(
    <StashHeader
      stash={{ index: 0, message: 'WIP on main', branch: 'main', time: 0 }}
      onExplain={onExplain}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Explain with Copilot' }))
  expect(onExplain).toHaveBeenCalled()
})
