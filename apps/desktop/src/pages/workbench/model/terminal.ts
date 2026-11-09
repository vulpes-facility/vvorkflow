/**
 * A terminal session of the engine, such as an agent that runs its TUI in a
 * worktree. The front end does not know if the engine is local or remote.
 */
export interface TerminalSession {
  id: string
  /** The title of the tab, for example the agent and the branch. */
  title: string
  /**
   * Calls `onData` with each chunk of the output of the process.
   *
   * @returns A function that stops the calls.
   */
  subscribe: (onData: (data: string) => void) => () => void
  /** Sends the input of the user to the process. */
  write?: (data: string) => void
  /** Tells the process the new size of the terminal. */
  resize?: (columns: number, rows: number) => void
}
