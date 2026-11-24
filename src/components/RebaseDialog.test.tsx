import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import RebaseDialog from './RebaseDialog'
import type { Commit } from '../lib/git'

const from: Commit = {
  hash: 'aaaaaaa1',
  shortHash: 'aaaaaaa',
  author: 'Ada',
  email: 'ada@example.com',
  time: 0,
  subject: 'add login',
  parents: [],
  refs: [],
  graph: { lane: 0, color: 0, width: 1, segments: [] },
}
const plan = {
  pushed: false,
  commits: [
    {
      hash: 'aaaaaaa1',
      shortHash: 'aaaaaaa',
      subject: 'add login',
      message: 'add login',
    },
    {
      hash: 'bbbbbbb2',
      shortHash: 'bbbbbbb',
      subject: 'fix typo',
      message: 'fix typo',
    },
  ],
}
const act = async (_: string, action: () => Promise<unknown>) => {
  await action()
  return true
}

it('lets Copilot write the message for commits squashed together', async () => {
  const calls: [string, unknown][] = []
  mockIPC((cmd, args) => {
    calls.push([cmd, args])
    if (cmd === 'rebase_plan') return plan
    if (cmd === 'rebase_start') return { stopped: false }
  })
  const suggest = vi.fn(async () => 'add login, typo fixed')
  render(
    <RebaseDialog
      repo={{ path: '/r', name: 'r' }}
      from={from}
      onClose={() => {}}
      act={act}
      suggestSquashMessage={suggest}
    />,
  )
  const selects = await screen.findAllByRole('combobox')
  expect(
    screen.queryByRole('button', {
      name: 'Write the combined message with Copilot',
    }),
  ).toBeNull()
  fireEvent.change(selects[1], { target: { value: 'squash' } })

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Write the combined message with Copilot',
    }),
  )
  const combined = (await screen.findByDisplayValue(
    'add login, typo fixed',
  )) as HTMLTextAreaElement
  expect(suggest).toHaveBeenCalledWith(['aaaaaaa1', 'bbbbbbb2'])

  fireEvent.change(combined, { target: { value: 'add login, typo fixed' } })
  fireEvent.click(screen.getByText(/Rewrite 2 commits/))
  await waitFor(() =>
    expect(calls).toContainEqual([
      'rebase_start',
      {
        repo: '/r',
        from: 'aaaaaaa1',
        items: [
          {
            hash: 'aaaaaaa1',
            action: 'pick',
            message: 'add login, typo fixed',
          },
          { hash: 'bbbbbbb2', action: 'squash' },
        ],
      },
    ]),
  )
})

it("keeps git's combined message when the field is left empty", async () => {
  const calls: [string, unknown][] = []
  mockIPC((cmd, args) => {
    calls.push([cmd, args])
    if (cmd === 'rebase_plan') return plan
    if (cmd === 'rebase_start') return { stopped: false }
  })
  render(
    <RebaseDialog
      repo={{ path: '/r', name: 'r' }}
      from={from}
      onClose={() => {}}
      act={act}
    />,
  )
  const selects = await screen.findAllByRole('combobox')
  fireEvent.change(selects[1], { target: { value: 'fixup' } })
  fireEvent.click(screen.getByText(/Rewrite 2 commits/))
  await waitFor(() =>
    expect(calls).toContainEqual([
      'rebase_start',
      {
        repo: '/r',
        from: 'aaaaaaa1',
        items: [
          { hash: 'aaaaaaa1', action: 'pick' },
          { hash: 'bbbbbbb2', action: 'fixup' },
        ],
      },
    ]),
  )
})

it('waits for Copilot before rewriting, and leaves rewords alone', async () => {
  mockIPC((cmd) => {
    if (cmd === 'rebase_plan') return plan
  })
  let finish: (m: string) => void = () => {}
  render(
    <RebaseDialog
      repo={{ path: '/r', name: 'r' }}
      from={from}
      onClose={() => {}}
      act={act}
      suggestSquashMessage={() => new Promise((r) => (finish = r))}
    />,
  )
  const selects = await screen.findAllByRole('combobox')
  fireEvent.change(selects[1], { target: { value: 'squash' } })
  const write = screen.getByRole('button', {
    name: 'Write the combined message with Copilot',
  })
  fireEvent.click(write)
  const rewrite = screen.getByText(/Rewrite 2 commits/).closest('button')!
  expect(rewrite.disabled).toBe(true)
  finish('combined')
  await waitFor(() => expect(rewrite.disabled).toBe(false))

  fireEvent.change(selects[0], { target: { value: 'reword' } })
  expect(
    screen.queryByRole('button', {
      name: 'Write the combined message with Copilot',
    }),
  ).toBeNull()
})
