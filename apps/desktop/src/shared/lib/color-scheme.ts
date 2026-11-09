import { useSyncExternalStore } from 'react'

/** The two color schemes of the design tokens. */
export type ColorScheme = 'light' | 'dark'

const query = '(prefers-color-scheme: dark)'

function subscribe(onChange: () => void) {
  const media = window.matchMedia(query)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function getSnapshot(): ColorScheme {
  return window.matchMedia(query).matches ? 'dark' : 'light'
}

/**
 * Follows the color scheme of the operating system.
 *
 * @returns The current scheme. The component renders again when the system scheme changes.
 */
export function useSystemColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'dark')
}

/**
 * Applies a color scheme to the document: the `dark` class selects the dark tokens.
 */
export function applyColorScheme(root: HTMLElement, scheme: ColorScheme) {
  root.classList.toggle('dark', scheme === 'dark')
}
