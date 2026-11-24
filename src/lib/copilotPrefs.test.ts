import { expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  COPILOT_ACTIONS,
  setCopilotAction,
  useCopilotPrefs,
} from './copilotPrefs'

it('starts with every Copilot action on', () => {
  const { result } = renderHook(() => useCopilotPrefs())
  for (const action of COPILOT_ACTIONS)
    expect(result.current[action]).toBe(true)
})

it('turns a single action off and back on, and remembers it', () => {
  const { result } = renderHook(() => useCopilotPrefs())
  act(() => setCopilotAction('review', false))
  expect(result.current.review).toBe(false)
  expect(result.current.commitMessage).toBe(true)
  expect(localStorage.getItem('gitgud.copilot.off.review')).toBe('1')

  act(() => setCopilotAction('review', true))
  expect(result.current.review).toBe(true)
})
