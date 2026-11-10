interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

/** The elements that hold their own run of inline text. */
const blocks = new Set([
  'p',
  'li',
  'td',
  'th',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'section',
  'div',
  'ul',
  'ol',
  'table',
  'thead',
  'tbody',
  'tr',
  'pre',
])

/**
 * A rehype plugin. It sets `dataInlineLink` on each link that is in a
 * sentence: its inline text run has prose that is not a link. The target size
 * rule of WCAG 2.2 (SC 2.5.8) leaves out only such a link.
 *
 * - The inline run of a block is its text and its inline elements, such as
 *   `em` and `code`. It does not go into a block inside the block, such as a
 *   nested list: that block has its own run.
 * - The text of another link, and the white space between links, is not
 *   prose. So `[a](/a) [b](/b)` has two links and no prose, and a row of
 *   links keeps the target size.
 * - A linked image is never in a sentence: it keeps the target size.
 *
 * It visits each node once, so the work grows in step with the document.
 * `onVisit` is for the test of that.
 */
export function markInlineLinks(options: { onVisit?: () => void } = {}) {
  return (tree: HastNode) => {
    const { onVisit } = options
    const block = (root: HastNode) => {
      const links: HastNode[] = []
      let prose = false
      // The nested blocks wait, so that a block does not go into another.
      const nested: HastNode[] = []
      const walk = (node: HastNode, inLink: boolean) => {
        onVisit?.()
        if (node.type === 'text') {
          if (!inLink && /\S/.test(node.value ?? '')) prose = true
          return
        }
        const isLink = node.tagName === 'a'
        if (isLink) links.push(node)
        for (const child of node.children ?? []) {
          if (child.type === 'element' && blocks.has(child.tagName ?? ''))
            nested.push(child)
          else walk(child, inLink || isLink)
        }
      }
      for (const child of root.children ?? []) {
        if (child.type === 'element' && blocks.has(child.tagName ?? ''))
          nested.push(child)
        else walk(child, false)
      }
      for (const link of links)
        if (prose && !hasImage(link))
          link.properties = { ...link.properties, dataInlineLink: true }
      for (const child of nested) block(child)
    }
    block(tree)
  }
}

/** True when a link has an image in it. The search stops at the first image. */
function hasImage(link: HastNode): boolean {
  const stack = [...(link.children ?? [])]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.tagName === 'img') return true
    stack.push(...(node.children ?? []))
  }
  return false
}
