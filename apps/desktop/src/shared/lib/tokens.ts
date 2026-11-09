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
