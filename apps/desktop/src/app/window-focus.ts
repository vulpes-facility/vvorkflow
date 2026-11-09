/**
 * Tells TanStack Query when the window gets or loses the focus, so that it
 * reads the engine again when the user comes back from another app. The
 * default listener watches only the visibility of the page, which does not
 * change when the user switches between visible windows.
 *
 * @returns The listener for `focusManager.setEventListener`, which removes
 *   its handlers when it is replaced.
 */
export function windowFocusListener(target: EventTarget) {
  return (handleFocus: (focused?: boolean) => void) => {
    const focus = () => handleFocus(true)
    const blur = () => handleFocus(false)
    target.addEventListener('focus', focus)
    target.addEventListener('blur', blur)
    return () => {
      target.removeEventListener('focus', focus)
      target.removeEventListener('blur', blur)
    }
  }
}
