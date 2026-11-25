import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import BlameView from './BlameView'

const origin = (hash: string | null, author: string, previous: unknown) => ({
  hash,
  author,
  time: 0,
  subject: `by ${author}`,
  path: 'a.ts',
  previous,
})

const NOW = {
  origins: [
    origin('1111111aaa', 'Ada', { hash: '2222222bbb', path: 'old.ts' }),
    origin(null, 'Not Committed Yet', null),
  ],
  lines: [
    { origin: 0, original: 1, text: 'first' },
    { origin: 0, original: 2, text: 'second' },
    { origin: 1, original: 3, text: 'third' },
  ],
}
const BEFORE = {
  origins: [origin('3333333ccc', 'Grace', null)],
  lines: [{ origin: 0, original: 1, text: 'older' }],
}

function setup() {
  const calls: unknown[] = []
  mockIPC((cmd, args) => {
    if (cmd !== 'blame') return
    calls.push(args)
    return (args as { rev: string | null }).rev ? BEFORE : NOW
  })
  const onShowCommit = vi.fn()
  render(
    <BlameView
      repo="/r"
      target={TARGET}
      version={1}
      onShowCommit={onShowCommit}
      onClose={() => {}}
    />,
  )
  return { calls, onShowCommit }
}
const TARGET = { path: 'a.ts', rev: null }

it('names each commit once per group and links to it', async () => {
  const { onShowCommit } = setup()
  expect(await screen.findByText('second')).toBeTruthy()
  expect(screen.getAllByText('Ada')).toHaveLength(1)
  expect(screen.getByText('Not committed yet')).toBeTruthy()
  fireEvent.click(screen.getByText('1111111'))
  expect(onShowCommit).toHaveBeenCalledWith('1111111aaa')
})

it('walks back to the parent and returns', async () => {
  const { calls } = setup()
  await screen.findByText('second')
  // From any line of the group, not just the first.
  fireEvent.contextMenu(screen.getByText('second'))
  fireEvent.click(screen.getByRole('menuitem', { name: /parent/ }))
  expect(await screen.findByText('older')).toBeTruthy()
  expect(calls[calls.length - 1]).toMatchObject({
    path: 'old.ts',
    rev: '2222222bbb',
  })

  fireEvent.click(screen.getByTitle('Back'))
  expect(await screen.findByText('second')).toBeTruthy()
})

it('shows why a file cannot be blamed', async () => {
  mockIPC(() => {
    throw 'a.ts is a binary file'
  })
  render(
    <BlameView
      repo="/r"
      target={TARGET}
      version={1}
      onShowCommit={() => {}}
      onClose={() => {}}
    />,
  )
  expect(await screen.findByText('a.ts is a binary file')).toBeTruthy()
})

it('uses a responsive sticky gutter width instead of a fixed 22rem', async () => {
  setup()
  const hashBtn = await screen.findByText('1111111')
  const gutter = hashBtn.closest('.sticky')!
  expect(gutter.className).toContain('w-(--blame-gutter)')
})
