import { expect, it, vi } from 'vitest'
import { windowFocusListener } from '../src/app/window-focus.ts'

it('tells the focus of the window, and stops when it is replaced', () => {
  const window = new EventTarget()
  const handleFocus = vi.fn()
  const stop = windowFocusListener(window)(handleFocus)

  window.dispatchEvent(new Event('blur'))
  window.dispatchEvent(new Event('focus'))
  expect(handleFocus.mock.calls).toEqual([[false], [true]])

  stop()
  window.dispatchEvent(new Event('focus'))
  expect(handleFocus).toHaveBeenCalledTimes(2)
})
