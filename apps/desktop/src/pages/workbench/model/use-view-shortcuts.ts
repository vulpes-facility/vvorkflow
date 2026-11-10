import { useEffect } from 'react'
import type { Platform } from '@/shared/lib'
import { isDialogKey } from './dialog-keys'
import { views, type ViewId } from './views'

/**
 * Selects a view of the side bar when the user presses its shortcut, and
 * opens or closes the side bar on `mod+B`, but not from a dialog.
 */
export function useViewShortcuts(
  platform: Platform,
  showView: (view: ViewId) => void,
  toggleSideBar: () => void,
) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = platform === 'macos' ? event.metaKey : event.ctrlKey
      if (!mod || event.altKey || isDialogKey(event)) return
      const key = event.key.toLowerCase()
      if (!event.shiftKey && key === 'b') {
        event.preventDefault()
        toggleSideBar()
        return
      }
      if (!event.shiftKey) return
      const view = views.find(
        (candidate) => candidate.shortcut === `mod+shift+${key}`,
      )
      if (!view) return
      event.preventDefault()
      showView(view.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [platform, showView, toggleSideBar])
}
