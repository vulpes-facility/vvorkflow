import { create } from 'zustand'
import type { ViewId } from './views'

interface LayoutState {
  view: ViewId
  /** Whether the side bar is open. A closed side bar takes no width. */
  sideBarOpen: boolean
  showView: (view: ViewId) => void
  setSideBarOpen: (open: boolean) => void
  /**
   * Selects a view from the activity bar. Selecting the view that is already
   * open closes the side bar; any other selection opens it.
   */
  selectView: (view: ViewId) => void
  toggleSideBar: () => void
}

/** The layout of the workbench that the user changes: the side bar and its view. */
export const useLayout = create<LayoutState>((set, get) => ({
  view: 'explorer',
  sideBarOpen: true,
  showView: (view) => set({ view, sideBarOpen: true }),
  setSideBarOpen: (sideBarOpen) => set({ sideBarOpen }),
  selectView: (view) => {
    const { view: current, sideBarOpen } = get()
    set(
      view === current && sideBarOpen
        ? { sideBarOpen: false }
        : { view, sideBarOpen: true },
    )
  },
  toggleSideBar: () => set({ sideBarOpen: !get().sideBarOpen }),
}))
