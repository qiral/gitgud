import { invoke } from '@tauri-apps/api/core'
import { message } from '@tauri-apps/plugin-dialog'
import { errorMessage } from './git'

/** Opens a web page in the default browser. Goes through our own command
 *  because the opener plugin's doesn't work from inside an AppImage. */
export async function openUrl(url: string) {
  try {
    await invoke('open_url', { url })
  } catch (e) {
    await message(errorMessage(e), { kind: 'error' })
  }
}

/** Shows a file or folder in the system file manager, stripping the AppImage
 *  environment on Linux so the file manager isn't launched with bundled libs. */
export async function revealItem(path: string) {
  await invoke('reveal_item', { path })
}
