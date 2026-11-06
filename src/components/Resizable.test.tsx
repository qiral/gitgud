import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useResizable } from './Resizable'

function Panel() {
  const { width, handle } = useResizable({
    key: 'test',
    initial: 300,
    min: 200,
    max: 400,
  })
  return (
    <div data-testid="panel" style={{ width }}>
      {handle}
    </div>
  )
}

describe('useResizable', () => {
  it('resizes with the keyboard, clamps and remembers', () => {
    const { unmount } = render(<Panel />)
    const handle = screen.getByRole('separator')
    const width = () => screen.getByTestId('panel').style.width

    expect(width()).toBe('300px')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(width()).toBe('316px')
    for (let i = 0; i < 20; i++)
      fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(width()).toBe('400px')

    unmount()
    render(<Panel />)
    expect(width()).toBe('400px')

    fireEvent.doubleClick(screen.getByRole('separator'))
    expect(width()).toBe('300px')
  })
})
