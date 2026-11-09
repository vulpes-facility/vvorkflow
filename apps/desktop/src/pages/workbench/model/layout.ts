import { create } from 'zustand'
import type { ViewId } from './views'

interface LayoutState {
  view: ViewId
  showView: (view: ViewId) => void
}

/** The layout of the workbench that the user changes: the view of the side bar. */
export const useLayout = create<LayoutState>((set) => ({
  view: 'explorer',
  showView: (view) => set({ view }),
}))
