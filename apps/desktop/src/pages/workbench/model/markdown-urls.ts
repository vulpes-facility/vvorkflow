import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

/**
 * Removes what a browser removes before it reads a URL: leading and trailing
 * control characters and spaces, and tabs and line breaks inside. A backslash
 * before the query or the fragment counts as a slash, as in a browser for
 * `http` and `https`; the query and the fragment keep theirs. Without this,
 * `java\tscript:` and `\\host\a.png` would pass a check that a browser then
 * reads differently.
 */
function normalizeUrl(url: string): string {
  const trimmed = url
    // oxlint-disable-next-line no-control-regex
    .replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0009\u000a\u000d]/g, '')
  const end = trimmed.search(/[?#]/)
  const split = end === -1 ? trimmed.length : end
  return trimmed.slice(0, split).replaceAll('\\', '/') + trimmed.slice(split)
}

/**
 * A decoded copy of a URL, once, for the checks only: `java%09script:` shows
 * its scheme there. The Markdown parser escapes spaces, tabs, and backslashes
 * of a destination, so a hostile form arrives escaped. The URL that loads
 * never comes from this copy, because a decode changes a valid URL
 * (`a%23b` is not `a#b`). A text that does not decode stays as it is.
 */
function probeOf(url: string): string {
  try {
    return normalizeUrl(decodeURIComponent(url))
  } catch {
    return normalizeUrl(url)
  }
}

/** The lowercase scheme of a URL, or undefined for a relative URL. */
function schemeOf(url: string): string | undefined {
  return /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1].toLowerCase()
}

/** How the preview treats the source of an image. */
export type ImageSource =
  /**
   * `http`, `https`, or protocol-relative: it needs the network, and the user
   * must allow it. `url` is canonical: the preview loads exactly this URL, and
   * `host` is the host of this URL.
   */
  | { kind: 'remote'; url: string; host: string }
  /** A path of the document, which the host resolves to a URL. */
  | { kind: 'local'; path: string }
  /** Any other scheme, or a form that has two readings: it never loads. */
  | { kind: 'blocked'; scheme: string }

/**
 * Sorts the source of an image.
 *
 * - A remote source has the form `http://host/…`, `https://host/…`, or
 *   `//host/…`. The preview makes it canonical once, with the URL parser, and
 *   loads only that URL. A protocol-relative source gets `https`, because the
 *   scheme of the page is not the scheme of the document.
 * - A form with two readings is blocked: a scheme with no `//` (such as
 *   `https:picture.png`, which a browser reads as a path of the page), and a
 *   source with a user name or a password.
 * - A source with another scheme, such as `data:` or `javascript:`, is
 *   blocked.
 * - A source with no scheme and no leading `//` is a local path.
 */
export function classifyImageSource(source: string): ImageSource {
  const url = normalizeUrl(source)
  const probe = probeOf(source)
  const scheme = schemeOf(url)
  const isRemote = (value: string) =>
    /^https?:\/\//i.test(value) || value.startsWith('//')
  // A scheme, or a remote form, that shows only after a decode is hidden.
  if (schemeOf(probe) !== scheme || isRemote(probe) !== isRemote(url))
    return { kind: 'blocked', scheme: schemeOf(probe) ?? 'https' }
  if (isRemote(url)) {
    try {
      const absolute = (value: string) =>
        new URL(value.startsWith('//') ? `https:${value}` : value)
      const parsed = absolute(url)
      if (
        parsed.username ||
        parsed.password ||
        !parsed.host ||
        absolute(probe).host !== parsed.host
      )
        return { kind: 'blocked', scheme: parsed.protocol.slice(0, -1) }
      // The path and the query stay as the document wrote them.
      return { kind: 'remote', url: parsed.href, host: parsed.host }
    } catch {
      return { kind: 'blocked', scheme: scheme ?? 'https' }
    }
  }
  if (scheme) return { kind: 'blocked', scheme }
  return { kind: 'local', path: source }
}

/** How the preview treats the target of a link. */
export type LinkTarget =
  /** `#id`: the preview scrolls to the id inside itself. */
  | { kind: 'anchor'; id: string }
  /** `http`, `https`, `mailto`, or a relative path: the host decides what it does. */
  | { kind: 'open'; url: string }
  /** Any other scheme, such as `javascript:`, `vbscript:`, or `data:`: it is not a link. */
  | { kind: 'blocked' }

/** Sorts the target of a link. Only the schemes `http`, `https`, and `mailto` open. */
export function classifyLinkTarget(href: string): LinkTarget {
  const url = normalizeUrl(href)
  const scheme = schemeOf(url)
  if (schemeOf(probeOf(href)) !== scheme) return { kind: 'blocked' }
  if (url.startsWith('#')) {
    // The fragment decodes once.
    try {
      return { kind: 'anchor', id: decodeURIComponent(url.slice(1)) }
    } catch {
      return { kind: 'anchor', id: url.slice(1) }
    }
  }
  if (scheme === undefined || ['http', 'https', 'mailto'].includes(scheme))
    return { kind: 'open', url: href }
  return { kind: 'blocked' }
}

interface HastNode {
  type: string
  tagName?: string
  properties?: { src?: unknown }
  children?: HastNode[]
}

/**
 * Counts the remote images that a Markdown text shows, with the same parser
 * and the same rules as the preview: inline images, reference-style images,
 * and no raw HTML. The preview shows its control to allow them only when the
 * count is more than zero.
 */
export function countRemoteImages(text: string): number {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype)
  const tree = processor.runSync(processor.parse(text)) as HastNode
  let count = 0
  const walk = (node: HastNode) => {
    if (node.type === 'element' && node.tagName === 'img') {
      const { src } = node.properties ?? {}
      if (typeof src === 'string' && classifyImageSource(src).kind === 'remote')
        count++
    }
    node.children?.forEach(walk)
  }
  walk(tree)
  return count
}
