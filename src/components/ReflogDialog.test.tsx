import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import ReflogDialog from './ReflogDialog'

const entry = (hash: string, subject: string) => ({
  hash,
  shortHash: hash.slice(0, 7),
  time: 0,
  action: 'reset: moving to HEAD~1',
  subject,
})

it('lists a branch and recovers deleted stashes', async () => {
  const calls: unknown[] = []
  mockIPC((cmd, args) => {
    if (cmd === 'lost_stashes') return [entry('feedbee1', 'On main: wip')]
    calls.push(args)
    return [entry('abcdef12', 'lost work')]
  })
  const onReset = vi.fn()
  const onRecover = vi.fn(async () => true)
  render(
    <ReflogDialog
      repo={{ path: '/r', name: 'r' }}
      branches={[{ name: 'main', current: true, upstream: null }]}
      onShow={() => {}}
      onCreateBranch={() => {}}
      onReset={onReset}
      onRecover={onRecover}
      onClose={() => {}}
    />,
  )
  expect(await screen.findByText('lost work')).toBeTruthy()
  const source = screen.getByRole('combobox')
  fireEvent.change(source, { target: { value: 'branch:main' } })
  await waitFor(() =>
    expect(calls).toEqual([
      { repo: '/r', branch: null },
      { repo: '/r', branch: 'main' },
    ]),
  )
  fireEvent.click(await screen.findByTitle(/Reset/))
  expect(onReset).toHaveBeenCalled()

  fireEvent.change(source, { target: { value: 'stashes' } })
  fireEvent.click(await screen.findByTitle('Recover this stash'))
  await waitFor(() => expect(screen.queryByText('On main: wip')).toBeNull())
  expect(onRecover).toHaveBeenCalledWith('feedbee1')
})
