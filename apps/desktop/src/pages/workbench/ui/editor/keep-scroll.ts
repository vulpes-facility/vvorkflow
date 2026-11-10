/**
 * Keeps the scroll positions of a host that dockview detaches while its panel
 * is hidden. A detached scroll area loses its position and has no size, so
 * this saves each position while the host is visible, and puts it back when
 * the host has a size again.
 *
 * @returns A function that stops it.
 */
export function keepScroll(host: HTMLElement, onShown?: () => void) {
  const saved = new Map<Element, { top: number; left: number }>()
  let visible = host.clientWidth > 0
  const onScroll = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLElement) || host.clientWidth === 0) return
    saved.set(target, { top: target.scrollTop, left: target.scrollLeft })
  }
  // A scroll event does not bubble, so listen in the capture phase.
  host.addEventListener('scroll', onScroll, true)
  const observer = new ResizeObserver(() => {
    const shown = host.clientWidth > 0 && host.clientHeight > 0
    if (shown && !visible) {
      for (const [element, position] of saved) {
        if (!host.contains(element)) {
          saved.delete(element)
          continue
        }
        element.scrollTop = position.top
        element.scrollLeft = position.left
      }
      onShown?.()
    }
    visible = shown
  })
  observer.observe(host)
  return () => {
    host.removeEventListener('scroll', onScroll, true)
    observer.disconnect()
  }
}
