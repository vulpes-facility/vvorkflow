import { useEffect, useRef, type RefObject } from 'react'

function isUsable(element: HTMLElement) {
  return element.isConnected && element.closest('[hidden], [inert]') === null
}

/** The state of the side bar that decides which controls it shows. */
export interface SideBarState {
  sideBarOpen: boolean
  drawer: boolean
  /** The id of the view that the side bar shows. */
  view: string
  /** False while the view holds its own tab stop, such as a tree. */
  contentFocusable: boolean
}

/**
 * Keeps the keyboard focus on a visible control when the side bar opens,
 * closes, shows another view, or replaces the controls of its view
 * (WCAG 2.2 SC 2.4.3). When the change removes the focused element, hides it,
 * or makes it inert, the focus moves to the tab stop of the side bar while the
 * side bar is open, and to the active tab of the activity bar while it is
 * closed. When the focus is elsewhere, the change leaves it there.
 */
export function useFocusRescue(
  root: RefObject<HTMLElement | null>,
  { sideBarOpen, drawer, view, contentFocusable }: SideBarState,
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
    const lost = !isUsable(last) || document.activeElement === document.body
    if (!lost) return
    const target = sideBarOpen
      ? [
          ...container.querySelectorAll<HTMLElement>(
            '[role="tabpanel"] [tabindex="0"]',
          ),
        ].find(isUsable)
      : container.querySelector<HTMLElement>('nav [role="tab"][tabindex="0"]')
    target?.focus()
  }, [root, sideBarOpen, drawer, view, contentFocusable])
}
