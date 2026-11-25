import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useResizable } from './Resizable'

function Panel({
  initial = 300,
  min = 200,
  max = 600,
  keepForRest,
  withContainer = false,
}: {
  initial?: number
  min?: number
  max?: number
  keepForRest?: number
  withContainer?: boolean
}) {
  const { width, handle, containerRef } = useResizable({
    key: 'test',
    initial,
    min,
    max,
    keepForRest,
  })
  return (
    <div ref={withContainer ? containerRef : undefined} data-testid="container">
      <div data-testid="panel" style={{ width }}>
        {handle}
      </div>
    </div>
  )
}

const originalInnerWidth = window.innerWidth

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: originalInnerWidth,
  })
  localStorage.clear()
})

describe('useResizable', () => {
  it('resizes with the keyboard, clamps and remembers', () => {
    const { unmount } = render(<Panel max={400} />)
    const handle = screen.getByRole('separator')
    const width = () => screen.getByTestId('panel').style.width

    expect(width()).toBe('300px')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(width()).toBe('316px')
    for (let i = 0; i < 20; i++)
      fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(width()).toBe('400px')

    unmount()
    render(<Panel max={400} />)
    expect(width()).toBe('400px')

    fireEvent.doubleClick(screen.getByRole('separator'))
    expect(width()).toBe('300px')
  })

  it('re-clamps when the window shrinks and restores preferred width when it grows back', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1200,
    })
    render(<Panel initial={500} min={200} max={600} />)
    const width = () => screen.getByTestId('panel').style.width
    expect(width()).toBe('500px')

    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: 700,
      })
      window.dispatchEvent(new Event('resize'))
    })
    // 700 - 360 = 340
    expect(width()).toBe('340px')

    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: 1200,
      })
      window.dispatchEvent(new Event('resize'))
    })
    expect(width()).toBe('500px')
  })

  it('clamps against container width when containerRef is attached', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1200,
    })
    render(
      <Panel
        initial={400}
        min={160}
        max={700}
        keepForRest={240}
        withContainer
      />,
    )
    const container = screen.getByTestId('container')
    Object.defineProperty(container, 'clientWidth', {
      configurable: true,
      value: 460,
    })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    // 460 - 240 = 220
    expect(screen.getByTestId('panel').style.width).toBe('220px')
  })
})
