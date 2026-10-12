import { expect, it } from 'vitest'
import { repoNameFromUrl } from './url'

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
