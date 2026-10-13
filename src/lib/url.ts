/** "my-app" from https://github.com/me/my-app.git or git@host:me/my-app.git */
export function repoNameFromUrl(url: string) {
  const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? ''
  return last.replace(/\.git$/, '')
}

/**
 * Where to create a personal access token on a Git host, or null when the
 * server type is unknown. `host` is what the user typed, e.g. "gitlab.com".
 */
export function tokenPageUrl(host: string, kind: 'gitlab' | 'gitea' | 'other') {
  let base = host.trim().replace(/\/+$/, '')
  if (!base) return null
  if (!/^[a-z]+:\/\//i.test(base)) base = `https://${base}`
  if (kind === 'gitlab')
    // GitLab fills in the form from these parameters.
    return `${base}/-/user_settings/personal_access_tokens?name=GitGud&scopes=read_api,write_repository`
  if (kind === 'gitea') return `${base}/user/settings/applications`
  return null
}

/** A guess at the server type from its address, to preselect it. */
export function guessHostKind(host: string): 'gitlab' | 'gitea' | null {
  const h = host.toLowerCase()
  if (h.includes('gitlab')) return 'gitlab'
  if (/codeberg|gitea|forgejo/.test(h)) return 'gitea'
  return null
}
