import { expect, it } from 'vitest'
import { defaultRemote, maskUrl, readPrune, writePrune } from './remotes'

const remote = (name: string) => ({ name, url: 'u', pushUrl: null })

it('picks the remote a branch belongs to, then origin, then the first', () => {
  const list = [remote('me'), remote('me/fork'), remote('origin')]
  expect(defaultRemote(list, 'me/main')?.name).toBe('me')
  expect(defaultRemote(list, 'me/fork/main')?.name).toBe('me/fork')
  expect(defaultRemote(list, 'gone/main')?.name).toBe('origin')
  expect(defaultRemote(list.slice(0, 2))?.name).toBe('me')
  expect(defaultRemote([])).toBeNull()
})

it('hides passwords in URLs', () => {
  expect(maskUrl('https://me:secret@host/r.git')).toBe('https://***@host/r.git')
  expect(maskUrl('https://host/r.git')).toBe('https://host/r.git')
  expect(maskUrl('ssh://git@host:22/r.git')).toBe('ssh://git@host:22/r.git')
  expect(maskUrl('git@host:r.git')).toBe('git@host:r.git')
})

it('prunes unless told not to', () => {
  expect(readPrune()).toBe(true)
  writePrune(false)
  expect(readPrune()).toBe(false)
})
