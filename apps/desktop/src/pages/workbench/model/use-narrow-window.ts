import { useEffect } from 'react'

/**
 * The window width, in CSS pixels, at and under which the side bar closes.
 * At this width the activity bar, the narrowest side bar, and a usable editor
 * area do not fit side by side, for example at 400 % zoom (WCAG 2.2 SC 1.4.10).
 */
const narrowQuery = '(max-width: 640px)'

/**
 * Closes the side bar when the window becomes narrow, and opens it again when
 * the window becomes wide. The user can still open it in a narrow window.
 */
export function useNarrowWindow(setSideBarOpen: (open: boolean) => void) {
  useEffect(() => {
    const media = window.matchMedia(narrowQuery)
    if (media.matches) setSideBarOpen(false)
    const onChange = (event: MediaQueryListEvent) =>
      setSideBarOpen(!event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [setSideBarOpen])
}
