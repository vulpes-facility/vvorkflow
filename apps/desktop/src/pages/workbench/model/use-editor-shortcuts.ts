import type { DockviewApi } from 'dockview-react'
import { useEffect } from 'react'
import type { Platform } from '@/shared/lib'

/**
 * Closes the active tab of the editor area on `mod+W`. It is the keyboard way
 * to close a tab, because the close icon of a tab is a pointer target only.
 */
export function useEditorShortcuts(
  platform: Platform,
  editor: () => DockviewApi | undefined,
) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = platform === 'macos' ? event.metaKey : event.ctrlKey
      if (
        !mod ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== 'w'
      )
        return
      const panel = editor()?.activePanel
      if (!panel) return
      event.preventDefault()
      panel.api.close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [platform, editor])
}
