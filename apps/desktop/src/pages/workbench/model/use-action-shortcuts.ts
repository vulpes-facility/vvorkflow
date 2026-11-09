import { useEffect } from 'react'
import type { Platform } from '@/shared/lib'

interface Actions {
  onNewProject?: () => void
  onOpenFolder?: () => void
  onOpenSettings?: () => void
}

/**
 * Runs the actions on the shortcuts that the interface shows: `mod+N` and
 * `mod+O` on the Welcome tab, and `mod+,` on the settings button. A shortcut
 * works only when its action has a handler, as only those actions show.
 */
export function useActionShortcuts(
  platform: Platform,
  { onNewProject, onOpenFolder, onOpenSettings }: Actions,
) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = platform === 'macos' ? event.metaKey : event.ctrlKey
      if (!mod || event.shiftKey || event.altKey) return
      const actions: Record<string, (() => void) | undefined> = {
        n: onNewProject,
        o: onOpenFolder,
        ',': onOpenSettings,
      }
      const action = actions[event.key.toLowerCase()]
      if (!action) return
      event.preventDefault()
      action()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [platform, onNewProject, onOpenFolder, onOpenSettings])
}
