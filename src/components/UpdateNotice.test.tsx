import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import UpdateNotice from './UpdateNotice'

const updater = vi.hoisted(() => ({ check: vi.fn() }))
const process = vi.hoisted(() => ({ relaunch: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => updater)
vi.mock('@tauri-apps/plugin-process', () => process)

type Progress = (e: { event: string; data: Record<string, number> }) => void

function fakeUpdate(install: (onEvent: Progress) => Promise<void>) {
  return {
    version: '0.6.0',
    currentVersion: '0.5.0',
    downloadAndInstall: vi.fn(install),
  }
}

beforeEach(() => {
  updater.check.mockReset()
  process.relaunch.mockReset()
})

it('stays hidden when there is no update', async () => {
  updater.check.mockResolvedValue(null)
  render(<UpdateNotice enabled />)
  await waitFor(() => expect(updater.check).toHaveBeenCalled())
  expect(screen.queryByText(/is available/)).toBeNull()
})

it('installs the update and restarts', async () => {
  const update = fakeUpdate(async (onEvent) => {
    onEvent({ event: 'Started', data: { contentLength: 100 } })
    onEvent({ event: 'Progress', data: { chunkLength: 100 } })
    onEvent({ event: 'Finished', data: {} })
  })
  updater.check.mockResolvedValue(update)
  render(<UpdateNotice enabled />)

  expect(await screen.findByText('GitGud 0.6.0 is available')).toBeTruthy()
  fireEvent.click(screen.getByText('Update and restart'))
  await waitFor(() => expect(process.relaunch).toHaveBeenCalled())
  expect(update.downloadAndInstall).toHaveBeenCalledOnce()
})

it('shows the error and a manual download link when installing fails', async () => {
  updater.check.mockResolvedValue(
    fakeUpdate(async () => {
      throw 'signature verification failed'
    }),
  )
  render(<UpdateNotice enabled />)

  fireEvent.click(await screen.findByText('Update and restart'))
  expect(await screen.findByText(/signature verification failed/)).toBeTruthy()
  expect(screen.getByText('Download it manually')).toBeTruthy()
  expect(process.relaunch).not.toHaveBeenCalled()
})

it('can be dismissed', async () => {
  updater.check.mockResolvedValue(fakeUpdate(async () => {}))
  render(<UpdateNotice enabled />)
  fireEvent.click(await screen.findByTitle('Later'))
  expect(screen.queryByText(/is available/)).toBeNull()
})

it('does not check when disabled', () => {
  render(<UpdateNotice enabled={false} />)
  expect(updater.check).not.toHaveBeenCalled()
})
