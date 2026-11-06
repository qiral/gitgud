import { message } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { Copy, FileText, FolderOpen } from 'lucide-react'
import type { MenuItem } from '../components/ContextMenu'
import { errorMessage } from './git'
import { absolutePath, basename } from './paths'

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch (e) {
    await message(`Could not copy to the clipboard: ${errorMessage(e)}`, {
      title: 'Copy failed',
      kind: 'error',
    })
  }
}

async function reveal(path: string) {
  try {
    await revealItemInDir(path)
  } catch (e) {
    await message(errorMessage(e), {
      title: 'Could not show file',
      kind: 'error',
    })
  }
}

/** Copy and reveal actions for a file in the repo. `exists` hides "Show in
 *  folder" for files that aren't on disk, like deleted ones. */
export function fileMenuItems(
  repo: string,
  path: string,
  exists = true,
): MenuItem[] {
  const full = absolutePath(repo, path)
  return [
    {
      label: 'Copy file name',
      icon: FileText,
      onClick: () => copyText(basename(path)),
    },
    { label: 'Copy relative path', icon: Copy, onClick: () => copyText(path) },
    { label: 'Copy full path', icon: Copy, onClick: () => copyText(full) },
    ...(exists
      ? ([
          'separator',
          {
            label: 'Show in folder',
            icon: FolderOpen,
            onClick: () => reveal(full),
          },
        ] as MenuItem[])
      : []),
  ]
}
