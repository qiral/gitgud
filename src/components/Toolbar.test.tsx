import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { BranchMenu, CopilotMenu } from './Toolbar'
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

it('summarizes what another branch would bring in', () => {
  const onSummarizeBranch = vi.fn()
  render(
    <BranchMenu
      repo={{ path: '/r', name: 'r' }}
      status={null}
      branches={[
        { name: 'main', current: true, upstream: null },
        { name: 'feature/login', current: false, upstream: null },
      ]}
      remoteBranches={[]}
      onOpenRecent={() => {}}
      act={async () => true}
      onSummarizeBranch={onSummarizeBranch}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Current branch/ }))
  fireEvent.contextMenu(screen.getByText('feature/login'))
  fireEvent.click(screen.getByText('Summarize with Copilot'))
  expect(onSummarizeBranch).toHaveBeenCalledWith('feature/login')

  fireEvent.click(screen.getByRole('button', { name: /Current branch/ }))
  fireEvent.contextMenu(screen.getByText('main'))
  expect(screen.queryByText('Summarize with Copilot')).toBeNull()
})
