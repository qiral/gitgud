import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useCopilot } from './copilot'
import { COPILOT_MISSING } from './git'

function Harness({
  task,
  onResult,
  setError,
  signedIn = true,
  onSignIn = () => {},
}: {
  task: () => Promise<string>
  onResult: (r: string | null) => void
  setError: (e: string | null) => void
  signedIn?: boolean
  onSignIn?: () => void
}) {
  const ai = useCopilot(setError, signedIn, onSignIn)
  return (
    <>
      {ai.dialog}
      <button onClick={async () => onResult(await ai.run(task))}>Ask</button>
    </>
  )
}

it('offers the download when the CLI is missing, then asks again', async () => {
  mockIPC(() => {}, { shouldMockEvents: true })
  const task = vi
    .fn()
    .mockRejectedValueOnce(COPILOT_MISSING)
    .mockResolvedValueOnce('answer')
  const onResult = vi.fn()
  render(<Harness task={task} onResult={onResult} setError={() => {}} />)

  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
  await waitFor(() => expect(onResult).toHaveBeenCalledWith('answer'))
  expect(task).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('Set up GitHub Copilot')).toBeNull()
})

it('reports other errors without the setup dialog', async () => {
  const setError = vi.fn()
  const onResult = vi.fn()
  render(
    <Harness
      task={() => Promise.reject('Copilot failed: no plan')}
      onResult={onResult}
      setError={setError}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(null))
  expect(setError).toHaveBeenLastCalledWith('Copilot failed: no plan')
  expect(screen.queryByText('Set up GitHub Copilot')).toBeNull()
})

it('asks to sign in first instead of calling Copilot', async () => {
  const task = vi.fn(async () => 'answer')
  const onSignIn = vi.fn()
  const onResult = vi.fn()
  render(
    <Harness
      task={task}
      onResult={onResult}
      setError={() => {}}
      signedIn={false}
      onSignIn={onSignIn}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(null))
  expect(onSignIn).toHaveBeenCalled()
  expect(task).not.toHaveBeenCalled()
})
