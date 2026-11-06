import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import UpdateNotice from './UpdateNotice'
import { UpdatesProvider, useUpdates } from '../lib/updates'

const updater = vi.hoisted(() => ({ check: vi.fn() }))
const process = vi.hoisted(() => ({ relaunch: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => updater)
vi.mock('@tauri-apps/plugin-process', () => process)
vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => Promise.resolve('0.6.1'),
}))

/** A stand-in for the menu's "Check for updates". */
function CheckButton() {
  const { check } = useUpdates()
  return <button onClick={() => check(true)}>check now</button>
}

function renderNotice(autoCheck = true) {
  return render(
    <UpdatesProvider autoCheck={autoCheck}>
      <CheckButton />
      <UpdateNotice />
    </UpdatesProvider>,
  )
}

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
  renderNotice()
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
  renderNotice()

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
  renderNotice()

  fireEvent.click(await screen.findByText('Update and restart'))
  expect(await screen.findByText(/signature verification failed/)).toBeTruthy()
  expect(screen.getByText('Download it manually')).toBeTruthy()
  expect(process.relaunch).not.toHaveBeenCalled()
})

it('can be dismissed', async () => {
  updater.check.mockResolvedValue(fakeUpdate(async () => {}))
  renderNotice()
  fireEvent.click(await screen.findByTitle('Later'))
  expect(screen.queryByText(/is available/)).toBeNull()
})

it('does not check by itself when auto checks are off', () => {
  renderNotice(false)
  expect(updater.check).not.toHaveBeenCalled()
})

it('says so when a manual check finds nothing new', async () => {
  updater.check.mockResolvedValue(null)
  renderNotice(false)
  fireEvent.click(screen.getByText('check now'))
  expect(await screen.findByText("You're up to date")).toBeTruthy()
  expect(await screen.findByText('GitGud 0.6.1 is the latest.')).toBeTruthy()
})

it('reports a failed manual check but stays quiet on automatic ones', async () => {
  updater.check.mockRejectedValue('offline')
  renderNotice()
  await waitFor(() => expect(updater.check).toHaveBeenCalled())
  expect(screen.queryByText("Couldn't check for updates")).toBeNull()

  fireEvent.click(screen.getByText('check now'))
  expect(await screen.findByText("Couldn't check for updates")).toBeTruthy()
  expect(screen.getByText(/offline/)).toBeTruthy()
})

it('opens the card again on a manual check after it was dismissed', async () => {
  updater.check.mockResolvedValue(fakeUpdate(async () => {}))
  renderNotice()
  fireEvent.click(await screen.findByTitle('Later'))
  expect(screen.queryByText(/is available/)).toBeNull()
  fireEvent.click(screen.getByText('check now'))
  expect(await screen.findByText(/is available/)).toBeTruthy()
})
