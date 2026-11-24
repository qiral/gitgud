import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import StashDialog from './StashDialog'

it('lets Copilot label the stash', async () => {
  const onSuggest = vi.fn(async () => 'WIP: debounce history search')
  render(
    <StashDialog
      repo={{ path: '/r', name: 'r' }}
      onClose={() => {}}
      act={async () => true}
      onSuggest={onSuggest}
    />,
  )
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(
    screen.getByRole('button', { name: 'Write the message with Copilot' }),
  )
  expect(
    await screen.findByDisplayValue('WIP: debounce history search'),
  ).toBeTruthy()
  await waitFor(() => expect(onSuggest).toHaveBeenCalledWith(false))
})
