import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { copyText } from './copy'
import CopyButton from '../components/CopyButton'

const origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const origExecCommand = document.execCommand

function setClipboard(writeText: ((s: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  })
}

afterEach(() => {
  if (origClipboard) {
    Object.defineProperty(navigator, 'clipboard', origClipboard)
  } else {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
  }
  document.execCommand = origExecCommand
})

describe('copyText', () => {
  it('uses navigator.clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)
    expect(await copyText('abc123')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('abc123')
  })

  it('falls back to execCommand when clipboard.writeText rejects', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('NotAllowedError')))
    const exec = vi.fn().mockReturnValue(true)
    document.execCommand = exec
    const dialogs: string[] = []
    mockIPC((cmd) => {
      if (cmd === 'plugin:dialog|message') dialogs.push(cmd)
    })

    expect(await copyText('fallback-value')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    expect(dialogs).toHaveLength(0)
  })

  it('reports error and returns false when both clipboard and fallback fail', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('NotAllowedError')))
    document.execCommand = vi.fn().mockReturnValue(false)
    const dialogs: unknown[] = []
    mockIPC((cmd, args) => {
      if (cmd === 'plugin:dialog|message') {
        dialogs.push(args)
        return 'Ok'
      }
    })

    expect(await copyText('nope')).toBe(false)
    expect(dialogs).toHaveLength(1)
  })

  it('suppresses the error dialog when quiet is set', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('NotAllowedError')))
    document.execCommand = vi.fn().mockReturnValue(false)
    const dialogs: unknown[] = []
    mockIPC((cmd) => {
      if (cmd === 'plugin:dialog|message') dialogs.push(cmd)
    })

    expect(await copyText('code', { quiet: true })).toBe(false)
    expect(dialogs).toHaveLength(0)
  })
})

describe('CopyButton', () => {
  it('does not show the copied checkmark when copyText fails', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('blocked')))
    document.execCommand = vi.fn().mockReturnValue(false)
    mockIPC((cmd) => {
      if (cmd === 'plugin:dialog|message') return 'Ok'
    })

    render(<CopyButton text="abc" title="Copy hash" />)
    const btn = screen.getByTitle('Copy hash')
    fireEvent.click(btn)
    await waitFor(() => expect(btn.getAttribute('title')).toBe('Copy hash'))
  })

  it('shows the copied state when fallback copy succeeds', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('blocked')))
    document.execCommand = vi.fn().mockReturnValue(true)

    render(<CopyButton text="abc" title="Copy hash" />)
    fireEvent.click(screen.getByTitle('Copy hash'))
    await waitFor(() => expect(screen.getByTitle('Copied')).toBeTruthy())
  })
})
