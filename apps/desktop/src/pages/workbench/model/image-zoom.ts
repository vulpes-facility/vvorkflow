/** The scales that zoom in and zoom out step through, as fractions of the actual size. */
export const ZOOM_STEPS = [
  0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 16,
] as const

/** The zoom of an image: it fits the view, or it has a fixed scale. */
export type Zoom = { kind: 'fit' } | { kind: 'scale'; scale: number }

/**
 * The scale that makes an image fit a view. It never enlarges: an image that
 * is smaller than the view stays at its actual size.
 */
export function fitScale(
  image: { width: number; height: number },
  view: { width: number; height: number },
): number {
  if (image.width <= 0 || image.height <= 0) return 1
  return Math.min(
    1,
    Math.max(view.width, 1) / image.width,
    Math.max(view.height, 1) / image.height,
  )
}

/**
 * The scale after one step. Zoom in goes to the first step above the current
 * scale, and zoom out to the last step under it. At the end of the steps the
 * scale stays.
 */
export function stepScale(scale: number, direction: 'in' | 'out'): number {
  const epsilon = 1e-6
  if (direction === 'in')
    return ZOOM_STEPS.find((step) => step > scale + epsilon) ?? scale
  return (
    [...ZOOM_STEPS].reverse().find((step) => step < scale - epsilon) ?? scale
  )
}

/**
 * The action of a key of the image viewer, or undefined when the key is not
 * one. `=` counts as `+`, because they share a key. A key with Ctrl, Meta, or
 * Alt belongs to the window and to the browser.
 */
export function zoomKeyAction(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): 'in' | 'out' | 'reset' | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined
  if (event.key === '+' || event.key === '=') return 'in'
  if (event.key === '-' || event.key === '_') return 'out'
  if (event.key === '0') return 'reset'
  return undefined
}
