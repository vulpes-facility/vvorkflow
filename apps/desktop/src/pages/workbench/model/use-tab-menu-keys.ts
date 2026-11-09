import { useEffect } from 'react'

/** Opens the menu of a tab at the tab, as a right-click there would. */
function openMenu(tab: Element) {
  const trigger = tab.querySelector('[data-slot="context-menu-trigger"]')
  if (!trigger) return false
  const { left, bottom } = tab.getBoundingClientRect()
  trigger.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: left + 8,
      clientY: bottom,
    }),
  )
  return true
}

/**
 * Opens the menu of the focused editor tab with the keyboard: Shift+F10 or
 * the Menu key. The tab that has the focus is the tab element of dockview,
 * outside the menu trigger, and WebKit sends no `contextmenu` event for
 * Shift+F10, so the keys open the menu here.
 */
export function useTabMenuKeys() {
  useEffect(() => {
    function tabOf(target: EventTarget | null) {
      return target instanceof Element
        ? target.closest('.dv-tab[role="tab"]')
        : null
    }
    function onKeyDown(event: KeyboardEvent) {
      const menuKey =
        event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
      if (!menuKey || event.ctrlKey || event.metaKey || event.altKey) return
      const tab = tabOf(document.activeElement)
      if (tab && openMenu(tab)) event.preventDefault()
    }
    // A right-click on the edge of a tab, outside its trigger, opens the same menu.
    function onContextMenu(event: MouseEvent) {
      const tab = tabOf(event.target)
      if (!tab || !(event.target instanceof Element)) return
      if (event.target.closest('[data-slot="context-menu-trigger"]')) return
      if (openMenu(tab)) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, [])
}
