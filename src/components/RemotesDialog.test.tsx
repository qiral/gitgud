import { expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import RemotesDialog from './RemotesDialog'

const ORIGIN = {
  name: 'origin',
  url: 'https://github.com/me/app.git',
  pushUrl: null,
}

function setup(handle: (cmd: string) => unknown = () => null) {
  const calls: [string, unknown][] = []
  mockIPC((cmd, args) => {
    calls.push([cmd, args])
    return handle(cmd)
  })
  render(
    <RemotesDialog
      repo={{ path: '/r', name: 'r' }}
      remotes={[ORIGIN]}
      signedIn
      onChanged={async () => {}}
      onClose={() => {}}
    />,
  )
  return calls
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

it('adds a remote and fetches it', async () => {
  const calls = setup()
  type('Name', ' fork ')
  type('URL', 'https://example.com/f.git')
  fireEvent.click(screen.getByRole('button', { name: 'Add remote' }))
  await waitFor(() =>
    expect(calls).toContainEqual([
      'fetch',
      { repo: '/r', remote: 'fork', prune: true },
    ]),
  )
  expect(calls).toContainEqual([
    'add_remote',
    { repo: '/r', name: 'fork', url: 'https://example.com/f.git' },
  ])
})

it('offers the parent of a fork as upstream', async () => {
  const calls = setup((cmd) =>
    cmd === 'github_parent'
      ? { fullName: 'them/app', url: 'https://github.com/them/app.git' }
      : null,
  )
  fireEvent.click(await screen.findByText(/Add them\/app/))
  await waitFor(() =>
    expect(calls).toContainEqual([
      'add_remote',
      { repo: '/r', name: 'upstream', url: 'https://github.com/them/app.git' },
    ]),
  )
})

it('only sends what was edited, and keeps the form when it fails', async () => {
  const calls = setup((cmd) => {
    if (cmd === 'rename_remote') throw 'that name is taken'
    return null
  })
  fireEvent.click(screen.getByTitle('Edit origin'))
  const save = screen.getByRole('button', { name: 'Save' })
  expect((save as HTMLButtonElement).disabled).toBe(true)
  type('Name', 'mine')
  fireEvent.click(save)
  expect(await screen.findByText('that name is taken')).toBeTruthy()
  expect(screen.getByDisplayValue('mine')).toBeTruthy()
  expect(calls.some(([cmd]) => cmd === 'set_remote_url')).toBe(false)
})
