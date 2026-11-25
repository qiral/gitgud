import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useContextMenu } from './ContextMenu'

function Host() {
  const { menu, open } = useContextMenu()
  const items = Array.from({ length: 20 }, (_, i) => ({
    label: `Action ${i + 1}`,
    onClick: () => {},
  }))
  return (
    <div>
      <button onContextMenu={(e) => open(e, items)}>Target</button>
      {menu}
    </div>
  )
}

describe('ContextMenu', () => {
  it('constrains menu height to the viewport and allows scrolling', () => {
    render(<Host />)
    fireEvent.contextMenu(screen.getByText('Target'))
    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('max-h-[calc(100vh-8px)]')
    expect(menu.className).toContain('overflow-y-auto')
  })
})
