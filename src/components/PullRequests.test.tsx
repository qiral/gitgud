import { expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  CreatePullRequestDialog,
  draftFromCommits,
  splitReply,
  titleFromBranch,
} from './PullRequests'
import type { PullTarget } from '../lib/git'

it('drafts a title and description from the commits', () => {
  expect(titleFromBranch('feature/login-page')).toBe('Login page')
  expect(titleFromBranch('fix_typo')).toBe('Fix typo')
  expect(draftFromCommits('x', ['Add login\n\nWith a form.\n'])).toEqual({
    title: 'Add login',
    body: 'With a form.',
  })
  expect(draftFromCommits('feature/login', ['One\n\nbody', 'Two'])).toEqual({
    title: 'Login',
    body: '- One\n- Two',
  })
  expect(splitReply('# Add login\n\n- form\n- tests')).toEqual({
    title: 'Add login',
    body: '- form\n- tests',
  })
})

const target: PullTarget = {
  baseRepo: 'qiral/gitgud',
  headRepo: 'me/gitgud',
  branch: 'feature/login',
  defaultBase: 'main',
  existing: null,
}

function setup(unpushed: number) {
  const calls: [string, unknown][] = []
  mockIPC((cmd, args) => {
    calls.push([cmd, args])
    if (cmd === 'github_branches') return ['dev', 'main']
    if (cmd === 'github_compare')
      return { mergeBase: 'abc1234', commits: ['Add login\n\nWith a form.'] }
    if (cmd === 'copilot_pull_request') return 'Login, at last\n\n- a form'
    if (cmd === 'github_create_pull_request')
      return {
        number: 9,
        title: 'Login, at last',
        state: 'open',
        draft: true,
        url: 'https://github.com/qiral/gitgud/pull/9',
      }
  })
  const pushed: string[] = []
  const created: number[] = []
  render(
    <CreatePullRequestDialog
      repo={{ path: '/r', name: 'r' }}
      target={target}
      unpushed={unpushed}
      push={async () => {
        pushed.push('push')
        return true
      }}
      ask={(task) => task()}
      onClose={() => {}}
      onCreated={(pr) => created.push(pr.number)}
    />,
  )
  return { calls, pushed, created }
}

it('creates a draft pull request into the parent repository', async () => {
  const { calls, pushed, created } = setup(0)
  await waitFor(() =>
    expect(screen.getByDisplayValue('Add login')).toBeTruthy(),
  )
  expect(screen.getByText('of qiral/gitgud')).toBeTruthy()
  expect(calls).toContainEqual([
    'github_compare',
    {
      baseRepo: 'qiral/gitgud',
      base: 'main',
      headRepo: 'me/gitgud',
      branch: 'feature/login',
    },
  ])

  fireEvent.click(screen.getByText('Write with Copilot'))
  await waitFor(() =>
    expect(screen.getByDisplayValue('Login, at last')).toBeTruthy(),
  )
  expect(calls).toContainEqual([
    'copilot_pull_request',
    {
      repo: '/r',
      mergeBase: 'abc1234',
      commits: ['Add login\n\nWith a form.'],
    },
  ])

  fireEvent.click(screen.getByLabelText('Create as draft'))
  fireEvent.click(screen.getByRole('button', { name: 'Create pull request' }))
  await waitFor(() => expect(created).toEqual([9]))
  expect(pushed).toEqual([])
  expect(calls).toContainEqual([
    'github_create_pull_request',
    {
      repo: '/r',
      base: 'main',
      title: 'Login, at last',
      body: '- a form',
      draft: true,
    },
  ])
})

it('pushes unpushed commits first', async () => {
  const { pushed, created } = setup(2)
  await waitFor(() =>
    expect(screen.getByDisplayValue('Add login')).toBeTruthy(),
  )
  expect(screen.getByText(/2 more not pushed yet/)).toBeTruthy()
  fireEvent.click(
    screen.getByRole('button', { name: 'Push and create pull request' }),
  )
  await waitFor(() => expect(created).toEqual([9]))
  expect(pushed).toEqual(['push'])
})
