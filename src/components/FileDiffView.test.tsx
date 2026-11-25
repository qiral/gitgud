import { expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import FileDiffView from './FileDiffView'

const sides = { before: 'index', after: 'worktree' }

function images(has: Record<string, string | null>) {
  const asked: unknown[] = []
  mockIPC((cmd, args) => {
    if (cmd !== 'file_image') return null
    asked.push(args)
    return has[(args as { at: string }).at]
  })
  return asked
}

it('compares pictures', async () => {
  const asked = images({
    index: 'data:image/png;base64,AAAA',
    worktree: 'data:image/png;base64,AAA=',
  })
  render(
    <FileDiffView
      repo="/r"
      path="new.png"
      oldPath="old.png"
      sides={sides}
      diff="Binary files differ"
    />,
  )
  expect(await screen.findByAltText('Before')).toBeTruthy()
  expect(screen.getByText(/3 B/)).toBeTruthy()
  expect(screen.getByText(/2 B/)).toBeTruthy()
  expect(asked).toEqual([
    { repo: '/r', path: 'old.png', at: 'index' },
    { repo: '/r', path: 'new.png', at: 'worktree' },
  ])
  fireEvent.click(screen.getByText('Swipe'))
  expect(screen.getByRole('slider')).toBeTruthy()
})

it('shows an SVG as a picture or as code', async () => {
  images({ index: null, worktree: 'data:image/svg+xml;base64,AAAA' })
  render(
    <FileDiffView
      repo="/r"
      path="a.svg"
      sides={sides}
      diff={'diff --git a/a.svg b/a.svg\n@@ -0,0 +1 @@\n+<svg/>\n'}
    />,
  )
  expect(await screen.findByAltText('Added')).toBeTruthy()
  fireEvent.click(screen.getByText('Code'))
  expect(screen.getByRole('table').textContent).toContain('<svg/>')
  expect(screen.queryByAltText('Added')).toBeNull()
})
