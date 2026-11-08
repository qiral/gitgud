import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PromptDialog from './PromptDialog'

it('submits the trimmed value and closes once done', async () => {
  const onSubmit = vi.fn().mockResolvedValue(true)
  const onClose = vi.fn()
  render(
    <PromptDialog
      title="Rename branch"
      label="New name"
      initial="old"
      submitLabel="Rename"
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  )
  const button = screen.getByRole('button', { name: 'Rename' })
  // Unchanged or empty names can't be submitted.
  expect((button as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('New name'), {
    target: { value: '  new-name ' },
  })
  fireEvent.click(button)
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(onSubmit).toHaveBeenCalledWith('new-name')
})

it('stays open when the action fails', async () => {
  const onSubmit = vi.fn().mockResolvedValue(false)
  const onClose = vi.fn()
  render(
    <PromptDialog
      title="Create tag"
      label="Tag name"
      submitLabel="Create tag"
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  )
  fireEvent.change(screen.getByLabelText('Tag name'), {
    target: { value: 'v1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create tag' }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  expect(onClose).not.toHaveBeenCalled()
})
