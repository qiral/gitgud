import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import HistoryPanel from './HistoryPanel'
import type { Commit } from '../lib/git'

const commit = (hash: string, subject: string): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  author: 'Ada',
  email: 'ada@example.com',
  time: 0,
  subject,
  parents: [],
  refs: [],
  graph: { lane: 0, color: 0, width: 1, segments: [] },
})

const all = [commit('aaaaaaa1', 'first'), commit('bbbbbbb2', 'second')]

it('searches as you type and shows only the results', () => {
  const onFilter = vi.fn()
  const { rerender } = render(
    <HistoryPanel
      repoPath="/r"
      commits={all}
      selection={null}
      onSelect={() => {}}
      onFilter={onFilter}
    />,
  )
  fireEvent.change(screen.getByLabelText('Search commits'), {
    target: { value: ' sec ' },
  })
  expect(onFilter).toHaveBeenLastCalledWith({ kind: 'search', query: 'sec' })

  const filter = { kind: 'search', query: 'sec' } as const
  rerender(
    <HistoryPanel
      repoPath="/r"
      commits={all}
      selection={null}
      onSelect={() => {}}
      filter={filter}
      onFilter={onFilter}
      filtered={[all[1]]}
    />,
  )
  expect(screen.getByText('second')).toBeTruthy()
  expect(screen.queryByText('first')).toBeNull()

  rerender(
    <HistoryPanel
      repoPath="/r"
      commits={all}
      selection={null}
      onSelect={() => {}}
      filter={filter}
      onFilter={onFilter}
      filtered={[]}
    />,
  )
  expect(screen.getByText('No commits match')).toBeTruthy()
})

it('shows which file it is the history of, and clears it', () => {
  const onFilter = vi.fn()
  render(
    <HistoryPanel
      repoPath="/r"
      commits={all}
      selection={null}
      onSelect={() => {}}
      filter={{ kind: 'file', path: 'src/main.rs' }}
      onFilter={onFilter}
      filtered={[all[0]]}
    />,
  )
  expect(screen.getByText('src/main.rs')).toBeTruthy()
  fireEvent.click(screen.getByTitle('Show all commits'))
  expect(onFilter).toHaveBeenCalledWith(null)
})
