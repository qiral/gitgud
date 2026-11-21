import { expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import ConflictView from './ConflictView'

const repo = { path: '/r', name: 'r' }
const file = {
  path: 'a.rs',
  origPath: null,
  index: 'U',
  worktree: 'U',
  untracked: false,
  conflicted: true,
}
const act = async (_: string, action: () => Promise<unknown>) => {
  await action()
  return true
}
const PARTS = [
  { kind: 'text', lines: ['fn main() {\n'] },
  {
    kind: 'conflict',
    oursLabel: 'HEAD',
    ours: ['a();\n'],
    base: null,
    theirsLabel: 'feature',
    theirs: ['b();\n'],
  },
]

it('applies a Copilot suggestion to its block', async () => {
  const calls: [string, unknown][] = []
  mockIPC((cmd, args) => {
    calls.push([cmd, args])
    if (cmd === 'conflict_parts') return PARTS
  })
  render(
    <ConflictView
      repo={repo}
      file={file}
      version={1}
      act={act}
      onAsk={async () => 'a();\nb();'}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ask Copilot' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
  await waitFor(() =>
    expect(calls).toContainEqual([
      'resolve_block_text',
      { repo: '/r', path: 'a.rs', index: 0, text: 'a();\nb();' },
    ]),
  )
})

const block = (ours: string, theirs: string) => ({
  kind: 'conflict',
  oursLabel: 'HEAD',
  ours: [ours],
  base: null,
  theirsLabel: 'feature',
  theirs: [theirs],
})
const TWO = [block('a();\n', 'b();\n'), block('c();\n', 'd();\n')]
// After block 0 was resolved, the old block 1 is now block 0.
const ONE_LEFT = [{ kind: 'text', lines: ['a();\n'] }, TWO[1]]

it('keeps a late suggestion with the block it was asked for', async () => {
  let parts: unknown[] = TWO
  const calls: [string, unknown][] = []
  mockIPC((cmd, args) => {
    calls.push([cmd, args])
    if (cmd === 'conflict_parts') return parts
  })
  let answer: (s: string) => void = () => {}
  const props = {
    repo,
    file,
    act,
    onAsk: () => new Promise<string | null>((r) => (answer = r)),
  }
  const { rerender } = render(<ConflictView {...props} version={1} />)
  const asks = await screen.findAllByRole('button', { name: 'Ask Copilot' })
  fireEvent.click(asks[1])

  parts = ONE_LEFT
  rerender(<ConflictView {...props} version={2} />)
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Ask Copilot' })).toHaveLength(
      1,
    ),
  )
  answer('c();\nd();')
  fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
  await waitFor(() =>
    expect(calls).toContainEqual([
      'resolve_block_text',
      { repo: '/r', path: 'a.rs', index: 0, text: 'c();\nd();' },
    ]),
  )
})

it('keeps the suggestion when the window regains focus', async () => {
  mockIPC((cmd) => {
    if (cmd === 'conflict_parts') return PARTS
  })
  const props = { repo, file, act, onAsk: async () => 'merged();' }
  const { rerender } = render(<ConflictView {...props} version={1} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ask Copilot' }))
  expect(await screen.findByText('merged();')).toBeTruthy()

  rerender(<ConflictView {...props} version={2} />)
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.getByText('merged();')).toBeTruthy()
})

it('drops a suggestion once its block is gone', async () => {
  let parts: unknown[] = PARTS
  mockIPC((cmd) => {
    if (cmd === 'conflict_parts') return parts
  })
  const props = { repo, file, act, onAsk: async () => 'merged();' }
  const { rerender } = render(<ConflictView {...props} version={1} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ask Copilot' }))
  expect(await screen.findByText('merged();')).toBeTruthy()

  parts = [{ kind: 'text', lines: ['fn main() {\n', 'a();\n'] }]
  rerender(<ConflictView {...props} version={2} />)
  await waitFor(() => expect(screen.queryByText('merged();')).toBeNull())
})

it("doesn't show one file's suggestion on another", async () => {
  mockIPC((cmd) => {
    if (cmd === 'conflict_parts') return PARTS
  })
  const props = { repo, act, version: 1, onAsk: async () => 'merged();' }
  const { rerender } = render(<ConflictView {...props} file={file} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ask Copilot' }))
  expect(await screen.findByText('merged();')).toBeTruthy()

  rerender(<ConflictView {...props} file={{ ...file, path: 'b.rs' }} />)
  await waitFor(() => expect(screen.queryByText('merged();')).toBeNull())
})
