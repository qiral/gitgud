import { expect, it, vi } from 'vitest'
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

const stagedFile = {
  path: 'a.txt',
  origPath: null,
  index: 'M',
  worktree: '.',
  untracked: false,
  conflicted: false,
}

function renderWithCopilot(
  onGenerateMessage: () => Promise<string | null>,
  files = [stagedFile],
) {
  render(
    <ChangesPanel
      repo={repo}
      files={files}
      merging={null}
      rebasing={null}
      hasCommits
      selection={null}
      onSelect={() => {}}
      busy={false}
      onStash={() => {}}
      onGenerateMessage={onGenerateMessage}
      act={act}
    />,
  )
  return {
    box: screen.getByPlaceholderText('Commit message') as HTMLTextAreaElement,
    button: screen.getByRole('button', {
      name: 'Generate commit message with Copilot',
    }) as HTMLButtonElement,
  }
}

it('fills the message box from Copilot, one request at a time', async () => {
  let finish: (m: string) => void = () => {}
  const generate = vi.fn(
    () => new Promise<string | null>((resolve) => (finish = resolve)),
  )
  const { box, button } = renderWithCopilot(generate)
  fireEvent.click(button)
  fireEvent.click(button)
  expect(generate).toHaveBeenCalledTimes(1)
  expect(button.disabled).toBe(true)
  finish('fix: thing')
  await waitFor(() => expect(box.value).toBe('fix: thing'))
  expect(button.disabled).toBe(false)
})

it('keeps the message when Copilot fails', async () => {
  const generate = vi.fn(async () => null)
  const { box, button } = renderWithCopilot(generate)
  fireEvent.change(box, { target: { value: 'typed' } })
  fireEvent.click(button)
  await waitFor(() => expect(generate).toHaveBeenCalled())
  expect(box.value).toBe('typed')
})

it('has nothing to generate from without staged files', () => {
  const { button } = renderWithCopilot(async () => 'x', [])
  expect(button.disabled).toBe(true)
})

it("shows Copilot's message as a diff when something is typed", async () => {
  const { box, button } = renderWithCopilot(async () => 'trim username')
  fireEvent.change(box, { target: { value: 'fix stuff' } })
  fireEvent.click(button)
  fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
  expect(
    (screen.getByPlaceholderText('Commit message') as HTMLTextAreaElement)
      .value,
  ).toBe('fix stuff')

  fireEvent.click(button)
  fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
  expect(
    (screen.getByPlaceholderText('Commit message') as HTMLTextAreaElement)
      .value,
  ).toBe('trim username')
})

it('adds an untracked file to .gitignore from its menu', async () => {
  const calls: [string, unknown][] = []
  mockIPC((cmd, args) => {
    calls.push([cmd, args])
  })
  const file = {
    path: 'logs/today.log',
    origPath: null,
    index: '?',
    worktree: '?',
    untracked: true,
    conflicted: false,
  }
  render(
    <ChangesPanel
      repo={repo}
      files={[file]}
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
  const row = screen.getByText('today.log')
  fireEvent.contextMenu(row)
  expect(screen.getByText('Ignore file')).toBeTruthy()
  expect(screen.getByText('Ignore folder logs/')).toBeTruthy()
  fireEvent.click(screen.getByText('Ignore all .log files'))
  await waitFor(() =>
    expect(calls).toContainEqual([
      'ignore',
      { repo: '/r', path: 'logs/today.log', kind: 'extension' },
    ]),
  )
})
