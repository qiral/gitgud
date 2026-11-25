import { message } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { Copy, FileText, FolderOpen, History, UserPen } from 'lucide-react'
import type { MenuItem } from '../components/ContextMenu'
import { errorMessage } from './git'
import { absolutePath, basename } from './paths'
import { t } from '../i18n'

function fallbackCopy(text: string): boolean {
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.top = '0'
  el.style.left = '-9999px'
  el.style.opacity = '0'
  document.body.appendChild(el)
  const prev = document.activeElement as HTMLElement | null
  el.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    el.remove()
    prev?.focus?.()
  }
  return ok
}

export async function copyText(
  text: string,
  options?: { quiet?: boolean },
): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (e) {
    if (fallbackCopy(text)) return true
    if (!options?.quiet) {
      await message(t('copy.could-not-copy', { error: errorMessage(e) }), {
        title: t('copy.copy-failed'),
        kind: 'error',
      })
    }
    return false
  }
  if (fallbackCopy(text)) return true
  if (!options?.quiet) {
    await message(
      t('copy.could-not-copy', { error: 'Clipboard unavailable' }),
      {
        title: t('copy.copy-failed'),
        kind: 'error',
      },
    )
  }
  return false
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
 *  adds "Show file history" and `onBlame` adds "Blame". */
export function fileMenuItems(
  repo: string,
  path: string,
  exists = true,
  onHistory?: () => void,
  onBlame?: () => void,
): MenuItem[] {
  const full = absolutePath(repo, path)
  const history: MenuItem[] = []
  if (onHistory)
    history.push({
      label: t('copy.show-file-history'),
      icon: History,
      onClick: onHistory,
    })
  if (onBlame)
    history.push({ label: t('copy.blame'), icon: UserPen, onClick: onBlame })
  if (history.length > 0) history.push('separator')
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
