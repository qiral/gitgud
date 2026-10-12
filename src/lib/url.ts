/** "my-app" from https://github.com/me/my-app.git or git@host:me/my-app.git */
export function repoNameFromUrl(url: string) {
  const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? ''
  return last.replace(/\.git$/, '')
}
