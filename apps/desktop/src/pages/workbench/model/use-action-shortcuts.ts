import { useEffect } from 'react'
import type { Platform } from '@/shared/lib'
import { isDialogKey } from './dialog-keys'

interface Actions {
  onNewProject?: () => void
  onNewTerminal?: () => void
  onOpenFolder?: () => void
  onOpenSettings?: () => void
}

/**
 * Runs the actions on the shortcuts that the interface shows: `mod+N`,
 * `mod+O`, and `mod+Shift+T` on the Welcome tab, and `mod+,` on the settings
 * button. `mod+Shift+T` also works in a terminal, which gives the workbench
 * the Ctrl+Shift letters. A shortcut
 * works only when its action has a handler, as only those actions show, and
 * not from a dialog.
 */
export function useActionShortcuts(
  platform: Platform,
  { onNewProject, onNewTerminal, onOpenFolder, onOpenSettings }: Actions,
) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = platform === 'macos' ? event.metaKey : event.ctrlKey
      if (!mod || event.altKey || isDialogKey(event)) return
      const actions: Record<string, (() => void) | undefined> = event.shiftKey
        ? { t: onNewTerminal }
        : { n: onNewProject, o: onOpenFolder, ',': onOpenSettings }
      const action = actions[event.key.toLowerCase()]
      if (!action) return
      event.preventDefault()
      action()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [platform, onNewProject, onNewTerminal, onOpenFolder, onOpenSettings])
}
