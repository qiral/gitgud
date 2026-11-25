import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import SigningDialog from './SigningDialog'

it('signs with the chosen key', async () => {
  const saved: unknown[] = []
  mockIPC((cmd, args) => {
    if (cmd === 'signing_settings')
      return {
        enabled: false,
        format: 'openpgp',
        key: null,
        keys: [
          { format: 'openpgp', value: 'AAAA', label: 'Grace (AAAA)' },
          { format: 'ssh', value: '/h/.ssh/id.pub', label: 'id.pub' },
        ],
      }
    if (cmd === 'set_signing') saved.push(args)
  })
  const onClose = vi.fn()
  render(<SigningDialog repo={{ path: '/r', name: 'r' }} onClose={onClose} />)
  fireEvent.click(await screen.findByRole('checkbox'))
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'ssh /h/.ssh/id.pub' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(saved).toEqual([
    { repo: '/r', enabled: true, format: 'ssh', key: '/h/.ssh/id.pub' },
  ])
})
