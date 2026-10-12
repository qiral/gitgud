import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { emit } from '@tauri-apps/api/event'
import CloneDialog from './CloneDialog'

beforeEach(() => {
  // Skips asking Tauri for the home directory.
  localStorage.setItem('gitgud.cloneDir', '/home/me/code')
})

function renderDialog() {
  const onCloned = vi.fn()
  render(
    <CloneDialog
      account={null}
      onAccountChange={() => {}}
      onClose={() => {}}
      onCloned={onCloned}
    />,
  )
  fireEvent.click(screen.getByText('URL'))
  fireEvent.change(screen.getByPlaceholderText(/github\.com\/user/), {
    target: { value: 'https://github.com/me/my-app.git' },
  })
  return onCloned
}

it('clones into the chosen folder and reports progress', async () => {
  const calls: unknown[] = []
  let finish = () => {}
  mockIPC(
    (cmd, args) => {
      if (cmd !== 'clone_repo') return
      calls.push(args)
      return new Promise((resolve) => {
        finish = () => resolve({ path: '/home/me/code/my-app', name: 'my-app' })
      })
    },
    { shouldMockEvents: true },
  )
  const onCloned = renderDialog()
  expect(screen.getByDisplayValue('my-app')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0]).toEqual({
    url: 'https://github.com/me/my-app.git',
    parent: '/home/me/code',
    name: 'my-app',
  })

  await emit('clone-progress', { phase: 'Receiving objects', percent: 42 })
  expect(await screen.findByText('Receiving objects')).toBeTruthy()
  expect(screen.getByText('42%')).toBeTruthy()

  finish()
  await waitFor(() =>
    expect(onCloned).toHaveBeenCalledWith({
      path: '/home/me/code/my-app',
      name: 'my-app',
    }),
  )
})

it('cancels without showing an error and can clone again', async () => {
  let fail = (_: string) => {}
  let cancels = 0
  mockIPC(
    (cmd) => {
      if (cmd === 'clone_repo')
        return new Promise((_, reject) => {
          fail = reject
        })
      if (cmd === 'cancel_clone') {
        cancels++
        // The backend kills git, so the running clone fails.
        fail('Clone cancelled')
      }
    },
    { shouldMockEvents: true },
  )
  renderDialog()
  fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull(),
  )
  expect(cancels).toBe(1)
  expect(screen.queryByText('Clone cancelled')).toBeNull()
  const clone = screen.getByRole('button', { name: 'Clone' })
  expect((clone as HTMLButtonElement).disabled).toBe(false)
})

it('shows git errors', async () => {
  mockIPC(
    (cmd) => {
      if (cmd === 'clone_repo') throw 'fatal: repository not found'
    },
    { shouldMockEvents: true },
  )
  renderDialog()
  fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
  expect(await screen.findByText('fatal: repository not found')).toBeTruthy()
})
