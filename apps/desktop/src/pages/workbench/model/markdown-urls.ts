import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

/**
 * Removes what a browser removes before it reads a URL: leading and trailing
 * control characters and spaces, and tabs and line breaks inside. A backslash
 * counts as a slash, as in a browser. Without this, `java\tscript:` and
 * `\\host\a.png` would pass a check that a browser then reads differently.
 */
function normalizeUrl(url: string): string {
  return (
    url
      // oxlint-disable-next-line no-control-regex
      .replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')
      // oxlint-disable-next-line no-control-regex
      .replace(/[\u0009\u000a\u000d]/g, '')
      .replaceAll('\\', '/')
  )
}

/** The lowercase scheme of a URL, or undefined for a relative URL. */
function schemeOf(url: string): string | undefined {
  return /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1].toLowerCase()
}

/** How the preview treats the source of an image. */
export type ImageSource =
  /** `http`, `https`, or protocol-relative: it needs the network, and the user must allow it. */
  | { kind: 'remote'; url: string; host: string }
  /** A path of the document, which the host resolves to a URL. */
  | { kind: 'local'; path: string }
  /** Any other scheme, such as `data:` or `javascript:`: it never loads. */
  | { kind: 'blocked'; scheme: string }

/**
 * Sorts the source of an image. A source that has a scheme other than `http`
 * and `https` is blocked, so a `data:` or `javascript:` image never loads.
 * A source with no scheme and no leading `//` is a local path.
 */
export function classifyImageSource(source: string): ImageSource {
  const url = normalizeUrl(source)
  const scheme = schemeOf(url)
  if (scheme === 'http' || scheme === 'https' || url.startsWith('//')) {
    try {
      const host = new URL(url, 'https://base.invalid').host
      return { kind: 'remote', url, host }
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
  if (url.startsWith('#')) {
    try {
      return { kind: 'anchor', id: decodeURIComponent(url.slice(1)) }
    } catch {
      return { kind: 'anchor', id: url.slice(1) }
    }
  }
  const scheme = schemeOf(url)
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
