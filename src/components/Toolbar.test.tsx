import { expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CopilotMenu } from './Toolbar'
import { setCopilotAction } from '../lib/copilotPrefs'

it('turns single Copilot actions off and on', () => {
  render(<CopilotMenu />)
  fireEvent.click(screen.getByRole('button', { name: 'Copilot' }))
  const review = screen.getByRole('menuitemcheckbox', {
    name: 'Review staged changes',
  })
  expect(review.getAttribute('aria-checked')).toBe('true')

  fireEvent.click(review)
  expect(
    screen
      .getByRole('menuitemcheckbox', { name: 'Review staged changes' })
      .getAttribute('aria-checked'),
  ).toBe('false')
  expect(localStorage.getItem('gitgud.copilot.off.review')).toBe('1')
  expect(
    screen
      .getByRole('menuitemcheckbox', { name: 'Commit messages' })
      .getAttribute('aria-checked'),
  ).toBe('true')
  setCopilotAction('review', true)
})
