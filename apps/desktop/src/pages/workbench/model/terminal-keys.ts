/** Who takes a key that the user presses in a terminal. */
export type TerminalKeyTarget = 'terminal' | 'workbench' | 'copy'

/** The parts of a keyboard event that decide its target. */
interface KeyPress {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Decides who takes a key that the user presses in a terminal. A TUI needs
 * the Ctrl keys, such as Ctrl+W, so on Windows and Linux only the Ctrl+Shift
 * letters go to the workbench, as in other terminal emulators, and
 * Ctrl+Shift+C copies the selection. On macOS the Command keys go to the
 * workbench, because a terminal program never gets them. F6 and Shift+F6
 * always go to the workbench, so that the keyboard can leave the terminal
 * (WCAG 2.2 SC 2.1.2); the program gets F6 with other modifiers.
 */
export function terminalKeyTarget(
  event: KeyPress,
  mac: boolean,
): TerminalKeyTarget {
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey
  if (event.key === 'F6' && plain) return 'workbench'
  if (mac) return event.metaKey ? 'workbench' : 'terminal'
  // Only the letters: a program needs Ctrl+Shift with a symbol, such as
  // Ctrl+Shift+- for undo in readline.
  const letter = /^[a-z]$/i.test(event.key)
  if (event.ctrlKey && event.shiftKey && !event.altKey && letter)
    return event.key.toLowerCase() === 'c' ? 'copy' : 'workbench'
  return 'terminal'
}
