import { createContext } from 'react'

/**
 * The actions of a terminal session, for the tab of a terminal: dockview
 * renders a tab outside the page component, so the tab reads them here.
 */
export const TerminalActions = createContext<{
  /** Ends a session. Without it, a tab has no Kill action. */
  kill?: (id: string) => void
}>({})
