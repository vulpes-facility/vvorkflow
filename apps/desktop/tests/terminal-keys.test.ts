import { describe, expect, it } from 'vitest'
import { terminalKeyTarget } from '../src/pages/workbench/model/terminal-keys.ts'

const key = (
  key: string,
  modifiers: Partial<
    Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>
  > = {},
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
})

describe('terminalKeyTarget', () => {
  it('gives the Ctrl keys to the program on Windows and Linux', () => {
    expect(terminalKeyTarget(key('w', { ctrlKey: true }), false)).toBe(
      'terminal',
    )
    expect(terminalKeyTarget(key('b', { ctrlKey: true }), false)).toBe(
      'terminal',
    )
    expect(terminalKeyTarget(key('Tab'), false)).toBe('terminal')
    expect(terminalKeyTarget(key('Escape'), false)).toBe('terminal')
  })

  it('gives the Ctrl+Shift letters to the workbench, and copies on Ctrl+Shift+C', () => {
    const shifted = { ctrlKey: true, shiftKey: true }
    expect(terminalKeyTarget(key('F', shifted), false)).toBe('workbench')
    expect(terminalKeyTarget(key('C', shifted), false)).toBe('copy')
    expect(
      terminalKeyTarget(key('F', { ...shifted, altKey: true }), false),
    ).toBe('terminal')
  })

  it('gives the Command keys to the workbench on macOS, and the Ctrl keys to the program', () => {
    expect(terminalKeyTarget(key('w', { metaKey: true }), true)).toBe(
      'workbench',
    )
    expect(terminalKeyTarget(key('w', { ctrlKey: true }), true)).toBe(
      'terminal',
    )
  })

  it('always gives F6 to the workbench, so that the keyboard can leave', () => {
    for (const mac of [true, false]) {
      expect(terminalKeyTarget(key('F6'), mac)).toBe('workbench')
      expect(terminalKeyTarget(key('F6', { shiftKey: true }), mac)).toBe(
        'workbench',
      )
    }
  })
})
