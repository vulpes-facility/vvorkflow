/** The screen of a session: the size of its terminal, and the bytes that draw it. */
export interface TerminalScreen {
  columns: number
  rows: number
  data: Uint8Array
}

/**
 * The terminal of the web UI, as a session sees it. The session calls one
 * method at a time, and waits for the promise of a call before the next
 * one, so that the terminal gets each byte in its order.
 */
export interface TerminalSink {
  /**
   * Sets the terminal to the size, resets it, and writes the data.
   *
   * @returns A promise that settles when the terminal took the data.
   */
  screen: (screen: TerminalScreen) => Promise<void>
  /**
   * Writes the next bytes of the program.
   *
   * @returns A promise that settles when the terminal took the bytes.
   */
  output: (data: Uint8Array) => Promise<void>
  /** Sets the terminal to the new size of the session. */
  resized: (columns: number, rows: number) => void
}

/**
 * A terminal session of the engine, such as an agent that runs its TUI in a
 * worktree. The front end does not know if the engine is local or remote.
 * The session continues in the engine when no terminal is attached.
 */
export interface TerminalSession {
  id: string
  /** The title of the tab until the program sets one: the name of the shell, or of the agent and the branch. */
  title: string
  /** The folder where the shell started, as data for a list of sessions. */
  folder?: string
  /**
   * Attaches a terminal: the sink gets the screen of the session, and then
   * its output.
   *
   * @returns A function that detaches the terminal. After it, the sink gets
   *   no call.
   */
  attach: (sink: TerminalSink) => () => void
  /** Sends input bytes of the user to the program, in the order of the calls. */
  write: (data: Uint8Array) => void
  /**
   * Asks for a new size of the session. The terminal takes the size only
   * when the session tells it, with `resized` or with a screen.
   */
  resize: (columns: number, rows: number) => void
}

/** The time that a hidden terminal tab keeps its terminal: 5 minutes. */
export const HIDDEN_TERMINAL_TIME = 5 * 60 * 1000

/** The size of a session until its terminal proposes one. */
export const DEFAULT_TERMINAL_SIZE = { columns: 80, rows: 24 }

/** The sizes that a session accepts. */
const LIMITS = { columns: [2, 500], rows: [1, 200] } as const

/**
 * Puts a proposed size in the limits of a session.
 *
 * @returns The size as whole numbers in the limits, or `undefined` for a
 *   size that is not a number, as a terminal with no room proposes it.
 */
export function sessionSize(
  columns: number | undefined,
  rows: number | undefined,
): { columns: number; rows: number } | undefined {
  if (!Number.isFinite(columns) || !Number.isFinite(rows)) return undefined
  const clamp = (value: number, [low, high]: readonly [number, number]) =>
    Math.min(high, Math.max(low, Math.floor(value)))
  return {
    columns: clamp(columns as number, LIMITS.columns),
    rows: clamp(rows as number, LIMITS.rows),
  }
}

/**
 * The bytes of binary input of a terminal, such as an old mouse report:
 * each character of the text is one byte.
 */
export function binaryInput(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff)
}
