import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import CopilotSetupDialog from './CopilotSetupDialog'

it('downloads the CLI and reports back', async () => {
  const calls: string[] = []
  mockIPC(
    (cmd) => {
      calls.push(cmd)
    },
    { shouldMockEvents: true },
  )
  const onInstalled = vi.fn()
  render(<CopilotSetupDialog onInstalled={onInstalled} onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Download' }))
  await waitFor(() => expect(onInstalled).toHaveBeenCalled())
  expect(calls).toContain('copilot_install')
})

it('shows why the download failed', async () => {
  mockIPC(
    (cmd) => {
      if (cmd === 'copilot_install')
        throw 'Downloaded Copilot CLI failed verification'
    },
    { shouldMockEvents: true },
  )
  const onInstalled = vi.fn()
  render(<CopilotSetupDialog onInstalled={onInstalled} onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Download' }))
  expect(
    await screen.findByText('Downloaded Copilot CLI failed verification'),
  ).toBeTruthy()
  expect(onInstalled).not.toHaveBeenCalled()
})
