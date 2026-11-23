import { afterEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import UndoToast from './UndoToast'

afterEach(() => {
  vi.useRealTimers()
})

it('offers each action once, for a while', () => {
  vi.useFakeTimers()
  const onUndo = vi.fn()
  const toast = (undoable: { id: number; kind: 'commit' | 'reset' } | null) => (
    <UndoToast undoable={undoable} disabled={false} onUndo={onUndo} />
  )
  const { rerender } = render(toast(null))
  expect(screen.queryByRole('status')).toBeNull()

  rerender(toast({ id: 2, kind: 'reset' }))
  fireEvent.click(screen.getByText('Undo'))
  expect(onUndo).toHaveBeenCalledWith(2)

  // The one before it isn't news.
  rerender(toast({ id: 1, kind: 'commit' }))
  expect(screen.queryByRole('status')).toBeNull()

  rerender(toast({ id: 3, kind: 'commit' }))
  expect(screen.getByText('Committed')).toBeTruthy()
  // Not offered for a moment, e.g. during a merge: the time still runs out.
  rerender(toast(null))
  act(() => void vi.advanceTimersByTime(10_001))
  rerender(toast({ id: 3, kind: 'commit' }))
  expect(screen.queryByRole('status')).toBeNull()
})
