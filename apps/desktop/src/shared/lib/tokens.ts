/**
 * Reads a pixel length from a design token of tokens.css, such as `--vv-sidebar-w`.
 *
 * @returns The length in pixels, or `fallback` when the token is missing or is not a pixel length.
 */
export function readPixelToken(
  name: `--vv-${string}`,
  fallback: number,
): number {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value)
  return match ? Number(match[1]) : fallback
}

/**
 * Reads a design token of tokens.css as text, such as a font stack.
 *
 * @returns The value, or `fallback` when the token is missing.
 */
export function readToken(name: `--vv-${string}`, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

let canvas: CanvasRenderingContext2D | null | undefined

/**
 * Reads a color token of tokens.css as an sRGB hex color, for an API that
 * cannot read every CSS color, such as the theme of the terminal. The tokens
 * are in OKLCH, so a canvas converts them.
 *
 * @returns The color, or undefined when the token is missing.
 */
export function readColorToken(name: `--${string}`): string | undefined {
  if (typeof document === 'undefined') return undefined
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  if (!value) return undefined
  canvas ??= document
    .createElement('canvas')
    .getContext('2d', { willReadFrequently: true })
  if (!canvas) return undefined
  canvas.clearRect(0, 0, 1, 1)
  canvas.fillStyle = value
  canvas.fillRect(0, 0, 1, 1)
  const [red, green, blue] = canvas.getImageData(0, 0, 1, 1).data
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}
