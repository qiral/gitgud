import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Dialog from './Dialog'

describe('Dialog', () => {
  it('closes only the topmost stacked dialog on Escape', () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()

    const { rerender } = render(
      <>
        <Dialog title="Outer" onClose={closeOuter}>
          <p>Outer body</p>
        </Dialog>
        <Dialog title="Inner" onClose={closeInner}>
          <p>Inner body</p>
        </Dialog>
      </>,
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeInner).toHaveBeenCalledTimes(1)
    expect(closeOuter).not.toHaveBeenCalled()

    rerender(
      <Dialog title="Outer" onClose={closeOuter}>
        <p>Outer body</p>
      </Dialog>,
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeOuter).toHaveBeenCalledTimes(1)
  })

  it('constrains height to the viewport with a scrollable body', () => {
    render(
      <Dialog title="Tall" onClose={() => {}}>
        <div data-testid="content">Body</div>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Tall' })
    expect(dialog.className).toContain('max-h-[calc(100vh-2rem)]')
    expect(dialog.className).toContain('flex-col')
    const body = screen.getByTestId('content').parentElement!
    expect(body.className).toContain('overflow-y-auto')
  })
})
