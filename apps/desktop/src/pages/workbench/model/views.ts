import { Files, Search, type LucideIcon } from 'lucide-react'

/** One view of the side bar, which the activity bar selects. */
export interface Activity {
  id: string
  label: string
  icon: LucideIcon
  /** The keyboard shortcut, for example `mod+shift+e`. */
  shortcut?: string
}

/** The views of the side bar, in the order of the activity bar. */
export const views = [
  { id: 'explorer', label: 'Explorer', icon: Files, shortcut: 'mod+shift+e' },
  { id: 'search', label: 'Search', icon: Search, shortcut: 'mod+shift+f' },
] as const satisfies readonly Activity[]

export type ViewId = (typeof views)[number]['id']
