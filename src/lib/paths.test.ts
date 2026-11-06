import { describe, expect, it } from 'vitest'
import { absolutePath, basename, dirname } from './paths'

describe('paths', () => {
  it('splits a repo path into folder and name', () => {
    expect(basename('src/lib/git.ts')).toBe('git.ts')
    expect(dirname('src/lib/git.ts')).toBe('src/lib')
    expect(basename('README.md')).toBe('README.md')
    expect(dirname('README.md')).toBe('')
  })

  it('joins with the separator the repo path uses', () => {
    expect(absolutePath('/home/me/repo', 'src/a.ts')).toBe(
      '/home/me/repo/src/a.ts',
    )
    expect(absolutePath('/home/me/repo/', 'a.ts')).toBe('/home/me/repo/a.ts')
    expect(absolutePath('C:\\code\\repo', 'src/a.ts')).toBe(
      'C:\\code\\repo\\src\\a.ts',
    )
  })
})
