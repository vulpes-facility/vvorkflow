import { useEffect } from 'react'
import type { Platform } from '@/shared/lib'
import { views, type ViewId } from './views'

/** Selects a view of the side bar when the user presses its shortcut. */
export function useViewShortcuts(
  platform: Platform,
  showView: (view: ViewId) => void,
) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = platform === 'macos' ? event.metaKey : event.ctrlKey
      if (!mod || !event.shiftKey || event.altKey) return
      const view = views.find(
        (candidate) =>
          candidate.shortcut === `mod+shift+${event.key.toLowerCase()}`,
      )
      if (!view) return
      event.preventDefault()
      showView(view.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [platform, showView])
}
