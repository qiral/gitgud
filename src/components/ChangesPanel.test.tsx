import { expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import ChangesPanel from './ChangesPanel'

const repo = { path: '/r', name: 'r' }
const act = async (_: string, action: () => Promise<unknown>) => {
  await action()
  return true
}

it('amends the last commit with its message filled in', async () => {
  const calls: [string, unknown][] = []
  mockIPC((cmd, args) => {
    calls.push([cmd, args])
    if (cmd === 'last_commit') return { message: 'frist', pushed: false }
  })
  render(
    <ChangesPanel
      repo={repo}
      files={[]}
      merging={null}
      rebasing={null}
      hasCommits
      selection={null}
      onSelect={() => {}}
      busy={false}
      onStash={() => {}}
      act={act}
    />,
  )
  const box = screen.getByPlaceholderText(
    'Commit message',
  ) as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: 'half typed' } })
  fireEvent.click(screen.getByLabelText('Amend last commit'))
  await waitFor(() => expect(box.value).toBe('frist'))

  // Nothing staged is fine when amending: it only fixes the message.
  fireEvent.change(box, { target: { value: 'first' } })
  fireEvent.click(screen.getByRole('button', { name: 'Amend last commit' }))
  await waitFor(() =>
    expect(calls).toContainEqual(['amend', { repo: '/r', message: 'first' }]),
  )
})

it('puts the draft back when amending is turned off', async () => {
  mockIPC((cmd) => {
    if (cmd === 'last_commit') return { message: 'old', pushed: false }
  })
  render(
    <ChangesPanel
      repo={repo}
      files={[]}
      merging={null}
      rebasing={null}
      hasCommits
      selection={null}
      onSelect={() => {}}
      busy={false}
      onStash={() => {}}
      act={act}
    />,
  )
  const box = screen.getByPlaceholderText(
    'Commit message',
  ) as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: 'draft' } })
  const toggle = screen.getByLabelText('Amend last commit')
  fireEvent.click(toggle)
  await waitFor(() => expect(box.value).toBe('old'))
  fireEvent.click(toggle)
  expect(box.value).toBe('draft')
})
