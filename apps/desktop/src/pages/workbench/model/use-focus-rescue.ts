import { useEffect, useRef, type RefObject } from 'react'

/**
 * Keeps the keyboard focus on a visible control when the side bar opens or
 * closes (WCAG 2.2 SC 2.4.3). When the change hides the focused element, or
 * makes it inert, the focus moves into the drawer while the drawer is open,
 * and to the active tab of the activity bar in all other cases.
 */
export function useFocusRescue(
  root: RefObject<HTMLElement | null>,
  sideBarOpen: boolean,
  drawer: boolean,
) {
  const lastFocused = useRef<HTMLElement | null>(null)
  useEffect(() => {
    function onFocusIn(event: FocusEvent) {
      if (event.target instanceof HTMLElement)
        lastFocused.current = event.target
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  useEffect(() => {
    const container = root.current
    const last = lastFocused.current
    if (!container || !last || (!container.contains(last) && last.isConnected))
      return
    const lost =
      !last.isConnected ||
      last.closest('[hidden], [inert]') !== null ||
      document.activeElement === document.body
    if (!lost) return
    const target = drawer
      ? container.querySelector<HTMLElement>(
          '[data-drawer] [role="tabpanel"] [tabindex="0"]',
        )
      : container.querySelector<HTMLElement>('nav [role="tab"][tabindex="0"]')
    target?.focus()
  }, [root, sideBarOpen, drawer])
}
