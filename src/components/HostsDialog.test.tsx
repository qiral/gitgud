import { expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import HostsDialog from './HostsDialog'

const GITLAB = { url: 'https://gitlab.com/', kind: 'gitlab', login: 'ada' }

it('adds a host, guessing its type from the address', async () => {
  const calls: unknown[] = []
  mockIPC((cmd, args) => {
    if (cmd === 'hosts_list') return []
    if (cmd === 'host_add') {
      calls.push(args)
      return GITLAB
    }
  })
  render(<HostsDialog onClose={() => {}} />)

  fireEvent.change(await screen.findByPlaceholderText('gitlab.com'), {
    target: { value: 'gitlab.com' },
  })
  fireEvent.change(screen.getByLabelText(/Personal access token/), {
    target: { value: 'glpat-x' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(await screen.findByText('@ada')).toBeTruthy()
  expect(calls).toEqual([
    { url: 'gitlab.com', kind: 'gitlab', username: '', token: 'glpat-x' },
  ])
})

it('asks for a username on unknown servers and shows errors', async () => {
  mockIPC((cmd) => {
    if (cmd === 'hosts_list') return []
    if (cmd === 'host_add') throw 'git.example.com rejected the token'
  })
  render(<HostsDialog onClose={() => {}} />)

  fireEvent.change(await screen.findByPlaceholderText('gitlab.com'), {
    target: { value: 'git.example.com' },
  })
  fireEvent.change(screen.getByLabelText('Type'), {
    target: { value: 'other' },
  })
  fireEvent.change(screen.getByLabelText(/Personal access token/), {
    target: { value: 'secret' },
  })
  const signIn = screen.getByRole('button', { name: 'Sign in' })
  expect((signIn as HTMLButtonElement).disabled).toBe(true)

  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: 'me' },
  })
  fireEvent.click(signIn)
  expect(await screen.findByText(/rejected the token/)).toBeTruthy()
})

it('removes a host', async () => {
  const removed: unknown[] = []
  mockIPC((cmd, args) => {
    if (cmd === 'hosts_list') return [GITLAB]
    if (cmd === 'host_remove') removed.push(args)
  })
  render(<HostsDialog onClose={() => {}} />)

  fireEvent.click(await screen.findByTitle('Sign out of this host'))
  await waitFor(() => expect(screen.queryByText('@ada')).toBeNull())
  expect(removed).toEqual([{ url: 'https://gitlab.com/' }])
})
