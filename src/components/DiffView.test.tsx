import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import DiffView from './DiffView'
import { setDiffPref } from '../lib/diffPrefs'

const DIFF = `diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -10,2 +10,3 @@
 ten
+ten and a half
 eleven
`

/** Clicks the line-number cell of the row showing `text`, like a user would. */
function clickLine(text: string, shift = false) {
  const row = screen.getByText(text).closest('tr')!
  fireEvent.click(row.querySelector('td')!, { shiftKey: shift })
}

/** Answers the native "Discard …?" dialog, which confirm() shows through
 *  the dialog plugin's message command. Returns whether it was asked. */
function answerConfirm(yes: boolean) {
  const asked = { value: false }
  mockIPC((cmd) => {
    if (cmd !== 'plugin:dialog|message') return
    asked.value = true
    return yes ? 'Ok' : 'Cancel'
  })
  return asked
}

function setup(staged = false) {
  const onApply = vi.fn().mockResolvedValue(true)
  render(<DiffView diff={DIFF} actions={{ staged, onApply }} />)
  return onApply
}

describe('DiffView', () => {
  it('stages the selected lines by their index in the diff text', async () => {
    const onApply = setup()
    clickLine('two')
    clickLine('ten and a half')
    expect(screen.getByText('2 lines selected')).toBeTruthy()
    fireEvent.click(screen.getByText('Stage lines'))
    await waitFor(() => expect(onApply).toHaveBeenCalled())
    const [lines, action] = onApply.mock.calls[0]
    expect(action).toBe('stage')
    expect([...lines].sort((a, b) => a - b)).toEqual([6, 11])
    // Applied lines are deselected.
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull())
  })

  it('selects a range with shift, skipping context lines', () => {
    setup()
    clickLine('two')
    clickLine('ten and a half', true)
    expect(screen.getByText('3 lines selected')).toBeTruthy()
  })

  it('stages or discards a whole hunk', async () => {
    answerConfirm(true)
    const onApply = setup()
    fireEvent.click(screen.getAllByText('Stage hunk')[1])
    await waitFor(() => expect(onApply).toHaveBeenLastCalledWith([11], 'stage'))
    fireEvent.click(screen.getAllByText('Discard hunk')[0])
    await waitFor(() =>
      expect(onApply).toHaveBeenLastCalledWith([6, 7], 'discard'),
    )
  })

  it('does not discard when the confirmation is declined', async () => {
    const asked = answerConfirm(false)
    const onApply = setup()
    fireEvent.click(screen.getAllByText('Discard hunk')[0])
    await waitFor(() => expect(asked.value).toBe(true))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('offers unstage instead of stage and discard for staged diffs', () => {
    setup(true)
    clickLine('TWO')
    expect(screen.getByText('Unstage lines')).toBeTruthy()
    expect(screen.queryByText('Discard lines')).toBeNull()
  })

  it('lets lines of new files be picked, but not binary files', () => {
    const newFile =
      'diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1 @@\n+hello\n'
    const onApply = vi.fn()
    const { rerender } = render(
      <DiffView diff={newFile} actions={{ staged: false, onApply }} />,
    )
    clickLine('hello')
    expect(screen.getByText('1 line selected')).toBeTruthy()

    const binary =
      'diff --git a/b b/b\nindex 1..2 100644\nBinary files a/b and b/b differ\n'
    rerender(<DiffView diff={binary} actions={{ staged: false, onApply }} />)
    expect(screen.queryByText(/Stage/)).toBeNull()
  })
})

describe('DiffView options', () => {
  afterEach(() => {
    setDiffPref('split', false)
    setDiffPref('ignoreWhitespace', false)
  })

  it('shows removals and additions side by side and still stages lines', async () => {
    setDiffPref('split', true)
    const onApply = setup()
    const row = screen.getByText('two').closest('tr')!
    // The old and new versions share one row.
    expect(row.textContent).toContain('TWO')
    clickLine('two')
    // The right half's line number cell selects the addition.
    fireEvent.click(row.querySelectorAll('td')[3])
    fireEvent.click(screen.getByText('Stage lines'))
    await waitFor(() => expect(onApply).toHaveBeenCalled())
    expect([...onApply.mock.calls[0][0]].sort((a, b) => a - b)).toEqual([6, 7])
  })

  it('highlights the changed words of a line', () => {
    render(
      <DiffView
        diff={
          'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-let count = 1\n+let total = 1\n'
        }
      />,
    )
    expect(screen.getByText('count').className).toContain('bg-removed')
    expect(screen.getByText('total').className).toContain('bg-added')
  })

  it('pauses line staging while whitespace is ignored', () => {
    setDiffPref('ignoreWhitespace', true)
    setup()
    expect(screen.getByText(/can't be selected while whitespace/)).toBeTruthy()
    expect(screen.queryByText('Stage hunk')).toBeNull()
    fireEvent.click(screen.getByText('Show whitespace changes'))
    expect(screen.getAllByText('Stage hunk')).toHaveLength(2)
  })

  it('says so when only whitespace changed', () => {
    setDiffPref('ignoreWhitespace', true)
    render(<DiffView diff="" />)
    expect(screen.getByText('Only whitespace changed.')).toBeTruthy()
  })
})
