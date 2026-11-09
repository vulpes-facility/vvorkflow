import { useEffect } from 'react'
import type { Platform } from '@/shared/lib'

interface StartActions {
  onNewProject?: () => void
  onOpenFolder?: () => void
}

/**
 * Runs the start actions on `mod+N` and `mod+O`, the shortcuts that the
 * Welcome tab shows. A shortcut works only when its action has a handler, as
 * the Welcome tab shows only those actions.
 */
export function useStartShortcuts(
  platform: Platform,
  { onNewProject, onOpenFolder }: StartActions,
) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = platform === 'macos' ? event.metaKey : event.ctrlKey
      if (!mod || event.shiftKey || event.altKey) return
      const action = { n: onNewProject, o: onOpenFolder }[
        event.key.toLowerCase()
      ]
      if (!action) return
      event.preventDefault()
      action()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [platform, onNewProject, onOpenFolder])
}
