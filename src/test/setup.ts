import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { clearMocks } from '@tauri-apps/api/mocks'

// jsdom has no matchMedia; src/lib/prefs.ts reads the OS theme through it.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList

// jsdom has no ResizeObserver either; virtual lists only need it to exist.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
  clearMocks()
  localStorage.clear()
})
