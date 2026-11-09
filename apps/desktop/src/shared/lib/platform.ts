/** The desktop platforms that the window chrome adapts to. */
export type Platform = 'macos' | 'windows' | 'linux'

/**
 * Reads the platform from a user agent string.
 *
 * @returns `macos` for WKWebView, `windows` for WebView2, and `linux` for all other agents, such as WebKitGTK.
 */
export function detectPlatform(userAgent: string): Platform {
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'macos'
  if (/Windows/.test(userAgent)) return 'windows'
  return 'linux'
}
