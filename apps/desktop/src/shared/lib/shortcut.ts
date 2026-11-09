import type { Platform } from './platform'

const macKeys: Record<string, string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
  ctrl: '⌃',
}
const pcKeys: Record<string, string> = {
  mod: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  ctrl: 'Ctrl',
}

/**
 * Splits a shortcut such as `mod+shift+p` into the keys that the platform shows.
 * `mod` is Command on macOS and Ctrl on Windows and Linux.
 *
 * @returns The keys in the platform order, for example `['⇧', '⌘', 'P']` on macOS and `['Ctrl', 'Shift', 'P']` elsewhere.
 */
export function shortcutKeys(shortcut: string, platform: Platform): string[] {
  const parts = shortcut.toLowerCase().split('+')
  const key = parts.pop() ?? ''
  const names = platform === 'macos' ? macKeys : pcKeys
  const order =
    platform === 'macos'
      ? ['ctrl', 'alt', 'shift', 'mod']
      : ['mod', 'ctrl', 'alt', 'shift']
  const modifiers = order
    .filter((modifier) => parts.includes(modifier))
    .map((modifier) => names[modifier])
  return [...new Set(modifiers), key.length === 1 ? key.toUpperCase() : key]
}

/** The shortcut as one string, for a tooltip or an accessible description. */
export function formatShortcut(shortcut: string, platform: Platform): string {
  return shortcutKeys(shortcut, platform).join(platform === 'macos' ? '' : '+')
}
