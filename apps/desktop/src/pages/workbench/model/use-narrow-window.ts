import { useEffect, useSyncExternalStore } from 'react'
import { readPixelToken } from '@/shared/lib'

/**
 * The media query of a narrow window, from the `--vv-narrow-max-w` token. At
 * this width the activity bar, the narrowest side bar, and a usable editor
 * area do not fit side by side, for example at 400 % zoom (WCAG 2.2
 * SC 1.4.10).
 */
function narrowQuery() {
  return `(max-width: ${readPixelToken('--vv-narrow-max-w', 640)}px)`
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(narrowQuery())
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function getSnapshot() {
  return window.matchMedia(narrowQuery()).matches
}

/**
 * Tells whether the window is narrow. The side bar closes when the window
 * becomes narrow, and opens again when it becomes wide.
 *
 * @returns `true` while the window is as wide as `--vv-narrow-max-w` or narrower.
 */
export function useNarrowWindow(
  setSideBarOpen: (open: boolean) => void,
): boolean {
  const narrow = useSyncExternalStore(subscribe, getSnapshot, () => false)
  useEffect(() => setSideBarOpen(!narrow), [narrow, setSideBarOpen])
  return narrow
}
