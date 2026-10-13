import { expect, it } from 'vitest'
import { guessHostKind, repoNameFromUrl, tokenPageUrl } from './url'

it.each([
  ['https://github.com/me/my-app.git', 'my-app'],
  ['https://github.com/me/my-app', 'my-app'],
  ['https://github.com/me/my-app/', 'my-app'],
  ['  git@github.com:me/my-app.git ', 'my-app'],
  ['git@host:my-app', 'my-app'],
  ['', ''],
])('repoNameFromUrl(%j) is %j', (url, name) => {
  expect(repoNameFromUrl(url)).toBe(name)
})

it('links to the token page of known server types', () => {
  expect(tokenPageUrl('gitlab.com/', 'gitlab')).toBe(
    'https://gitlab.com/-/user_settings/personal_access_tokens?name=GitGud&scopes=read_api,write_repository',
  )
  expect(tokenPageUrl('https://codeberg.org', 'gitea')).toBe(
    'https://codeberg.org/user/settings/applications',
  )
  expect(tokenPageUrl('git.example.com', 'other')).toBeNull()
  expect(tokenPageUrl('  ', 'gitlab')).toBeNull()
})

it.each([
  ['gitlab.com', 'gitlab'],
  ['https://gitlab.example.org', 'gitlab'],
  ['codeberg.org', 'gitea'],
  ['git.example.com', null],
])('guessHostKind(%j) is %j', (host, kind) => {
  expect(guessHostKind(host)).toBe(kind)
})
