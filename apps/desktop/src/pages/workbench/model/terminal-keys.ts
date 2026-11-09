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
 * workbench, because a terminal program never gets them. F6 always goes to
 * the workbench, so that the keyboard can leave the terminal
 * (WCAG 2.2 SC 2.1.2).
 */
export function terminalKeyTarget(
  event: KeyPress,
  mac: boolean,
): TerminalKeyTarget {
  if (event.key === 'F6') return 'workbench'
  if (mac) return event.metaKey ? 'workbench' : 'terminal'
  const letter = event.key.length === 1
  if (event.ctrlKey && event.shiftKey && !event.altKey && letter)
    return event.key.toLowerCase() === 'c' ? 'copy' : 'workbench'
  return 'terminal'
}
