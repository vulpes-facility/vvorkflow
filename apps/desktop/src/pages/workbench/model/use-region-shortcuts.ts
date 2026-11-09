import type { DockviewApi } from 'dockview-react'
import { useEffect, type RefObject } from 'react'

/** Finds the elements of one region of the window. */
type Region = (root: HTMLElement, editor: DockviewApi | undefined) => Element[]

const select =
  (selector: string): Region =>
  (root) => [...root.querySelectorAll(selector)]

/** The regions that F6 moves between, in their order in the window. */
const regions: Region[] = [
  select('[data-region="activity-bar"]'),
  // The side bar, while it is open, docked or as a drawer.
  select('[data-region="side-bar"]'),
  // The tabs of the active group of the editor area.
  select('.dv-active-group .dv-tabs-container'),
  // The content of the active tab. Dockview can draw a panel outside its
  // group, so ask dockview for it.
  (_root, editor) => {
    const content = editor?.activePanel?.view.content.element
    return content ? [content] : []
  },
  // The status bar, when it has a control.
  select('[data-region="status-bar"]'),
]

const focusable =
  '[tabindex], button:not([disabled]), a[href], input:not([disabled]), textarea'

function isUsable(element: HTMLElement) {
  return (
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden' &&
    element.closest('[hidden], [inert]') === null
  )
}

/** The first control of a region that the Tab key reaches. */
function tabStop(region: Element) {
  return [...region.querySelectorAll<HTMLElement>(focusable)].find(
    (element) => element.tabIndex >= 0 && isUsable(element),
  )
}

/**
 * Moves the focus to the next region of the window on F6, and to the
 * previous one on Shift+F6. Each region gets the focus at its tab stop. It is
 * also the way out of a terminal, which takes the Tab key
 * (WCAG 2.2 SC 2.1.2).
 */
export function useRegionShortcuts(
  root: RefObject<HTMLElement | null>,
  editor: () => DockviewApi | undefined,
) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'F6' || event.ctrlKey || event.metaKey || event.altKey)
        return
      const container = root.current
      if (!container) return
      const found = regions.map((region) => region(container, editor()))
      const targets = found.map((elements) =>
        elements.map(tabStop).find(Boolean),
      )
      const active = document.activeElement
      const current = found.findIndex((elements) =>
        elements.some((element) => element.contains(active)),
      )
      const step = event.shiftKey ? -1 : 1
      const count = regions.length
      const start = current === -1 ? (step === 1 ? -1 : count) : current
      for (let offset = 1; offset <= count; offset++) {
        const target = targets[(start + step * offset + count * 2) % count]
        if (!target) continue
        event.preventDefault()
        target.focus()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [root, editor])
}
