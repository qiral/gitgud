/** Paths inside a repo always use forward slashes, as git prints them. */
export function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function dirname(path: string) {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/** The absolute path of a file in the repo, using the separator the repo's
 *  own path uses, so it comes out with backslashes on Windows. */
export function absolutePath(repo: string, path: string) {
  const windows = repo.includes('\\') && !repo.includes('/')
  const sep = windows ? '\\' : '/'
  const root = repo.replace(/[\\/]+$/, '')
  return root + sep + (windows ? path.replace(/\//g, '\\') : path)
}
