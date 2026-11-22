import { message } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { Copy, FileText, FolderOpen, History } from 'lucide-react'
import type { MenuItem } from '../components/ContextMenu'
import { errorMessage } from './git'
import { absolutePath, basename } from './paths'
import { t } from '../i18n'

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch (e) {
    await message(t('copy.could-not-copy', { error: errorMessage(e) }), {
      title: t('copy.copy-failed'),
      kind: 'error',
    })
  }
}

async function reveal(path: string) {
  try {
    await revealItemInDir(path)
  } catch (e) {
    await message(errorMessage(e), {
      title: t('copy.could-not-show-file'),
      kind: 'error',
    })
  }
}

/** Copy and reveal actions for a file in the repo. `exists` hides "Show in
 *  folder" for files that aren't on disk, like deleted ones; `onHistory`
 *  adds "Show file history". */
export function fileMenuItems(
  repo: string,
  path: string,
  exists = true,
  onHistory?: () => void,
): MenuItem[] {
  const full = absolutePath(repo, path)
  const history: MenuItem[] = onHistory
    ? [
        {
          label: t('copy.show-file-history'),
          icon: History,
          onClick: onHistory,
        },
        'separator',
      ]
    : []
  return [
    ...history,
    {
      label: t('copy.copy-file-name'),
      icon: FileText,
      onClick: () => copyText(basename(path)),
    },
    {
      label: t('copy.copy-relative-path'),
      icon: Copy,
      onClick: () => copyText(path),
    },
    {
      label: t('copy.copy-full-path'),
      icon: Copy,
      onClick: () => copyText(full),
    },
    ...(exists
      ? ([
          'separator',
          {
            label: t('copy.show-in-folder'),
            icon: FolderOpen,
            onClick: () => reveal(full),
          },
        ] as MenuItem[])
      : []),
  ]
}
