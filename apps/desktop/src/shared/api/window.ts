import { getCurrentWindow } from '@tauri-apps/api/window'

/** The controls of the native window, for the custom title bar. */
export interface WindowControls {
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  /**
   * Calls `listener` with the maximized state now, and again after each resize.
   *
   * @returns A function that stops the calls.
   */
  watchMaximized: (listener: (maximized: boolean) => void) => () => void
}

/** Whether the web UI runs in a Tauri window, and not in a browser. */
export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window
}

/**
 * Makes the controls of the current Tauri window.
 *
 * @returns The controls, or `undefined` when the web UI runs in a browser.
 */
export function currentWindowControls(): WindowControls | undefined {
  if (!isTauri()) return undefined
  const window = getCurrentWindow()
  return {
    minimize: () => void window.minimize(),
    toggleMaximize: () => void window.toggleMaximize(),
    close: () => void window.close(),
    watchMaximized: (listener) => {
      let stopped = false
      const update = () =>
        void window.isMaximized().then((maximized) => {
          if (!stopped) listener(maximized)
        })
      update()
      const unlisten = window.onResized(update)
      return () => {
        stopped = true
        void unlisten.then((stop) => stop())
      }
    },
  }
}
