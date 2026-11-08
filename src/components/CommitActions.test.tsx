import { expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { ResetDialog } from './CommitActions'
import type { Commit } from '../lib/git'

const commit: Commit = {
  hash: 'abc123',
  shortHash: 'abc123',
  author: 'Ada',
  email: 'ada@example.com',
  time: 0,
  subject: 'good state',
  parents: [],
  refs: [],
  graph: { lane: 0, color: 0, width: 1, segments: [] },
}

it('resets with the chosen mode', async () => {
  const calls: unknown[] = []
  mockIPC((cmd, args) => {
    if (cmd === 'reset') calls.push(args)
  })
  let closed = false
  render(
    <ResetDialog
      repo="/r"
      branch="main"
      commit={commit}
      dirty={false}
      act={async (_, action) => {
        await action()
        return true
      }}
      onClose={() => (closed = true)}
    />,
  )
  fireEvent.click(screen.getByLabelText(/Soft/))
  fireEvent.click(screen.getByRole('button', { name: 'Reset main' }))
  await waitFor(() => expect(closed).toBe(true))
  expect(calls).toEqual([{ repo: '/r', hash: 'abc123', mode: 'soft' }])
})
