import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CommandPalette, { type Command } from './CommandPalette'

function setup(start?: string) {
  const ran: string[] = []
  const commands: Command[] = [
    { id: 'push', group: 'Remote', label: 'Push', run: () => ran.push('push') },
    {
      id: 'pull',
      group: 'Remote',
      label: 'Pull',
      disabled: true,
      run: () => ran.push('pull'),
    },
    {
      id: 'switch',
      group: 'Branch',
      label: 'Switch branch…',
      page: {
        placeholder: 'Switch to branch',
        items: () =>
          ['main', 'feature/login'].map((b) => ({
            id: b,
            group: 'Branches',
            label: b,
            run: () => ran.push(`switch ${b}`),
          })),
      },
    },
  ]
  const onClose = vi.fn()
  render(
    <CommandPalette
      commands={commands}
      start={commands.find((c) => c.id === start)}
      onClose={onClose}
    />,
  )
  return { ran, onClose }
}

it('runs the best match on Enter and closes', () => {
  const { ran, onClose } = setup()
  const input = screen.getByRole('combobox')
  fireEvent.change(input, { target: { value: 'psh' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(ran).toEqual(['push'])
  expect(onClose).toHaveBeenCalled()
})

it('skips disabled commands', () => {
  const { ran, onClose } = setup()
  const input = screen.getByRole('combobox')
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(ran).toEqual([])
  expect(onClose).not.toHaveBeenCalled()
})

it('opens a page, searches it and goes back with Backspace', () => {
  const { ran } = setup()
  const input = () => screen.getByRole('combobox')
  fireEvent.click(screen.getByText('Switch branch…'))
  expect(screen.getByText('feature/login')).toBeTruthy()
  fireEvent.keyDown(input(), { key: 'Backspace' })
  expect(screen.getByText('Push')).toBeTruthy()

  fireEvent.click(screen.getByText('Switch branch…'))
  fireEvent.change(input(), { target: { value: 'login' } })
  fireEvent.keyDown(input(), { key: 'Enter' })
  expect(ran).toEqual(['switch feature/login'])
})

it('can start on a page', () => {
  setup('switch')
  expect(screen.getByPlaceholderText('Switch to branch')).toBeTruthy()
  expect(screen.getByText('main')).toBeTruthy()
})
