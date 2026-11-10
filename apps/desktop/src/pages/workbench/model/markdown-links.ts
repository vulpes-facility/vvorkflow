interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

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
])

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

/**
 * A rehype plugin. It sets `dataInlineLink` on each link that is in a
 * sentence: its block has text other than the text of the link. The target
 * size rule of WCAG 2.2 (SC 2.5.8) leaves out only such a link. A link that
 * stands alone in its block, such as the only content of a paragraph, a list
 * item, or a table cell, and a linked image, has no mark, so that the preview
 * gives it a target of 24 by 24 CSS pixels.
 */
export function markInlineLinks() {
  return (tree: HastNode) => {
    const walk = (node: HastNode, block: HastNode | undefined) => {
      const here = node.tagName && blocks.has(node.tagName) ? node : block
      if (node.type === 'element' && node.tagName === 'a' && here) {
        const around = textOf(here).replace(/\s+/g, '')
        const own = textOf(node).replace(/\s+/g, '')
        if (around.length > own.length)
          node.properties = { ...node.properties, dataInlineLink: true }
      }
      node.children?.forEach((child) => walk(child, here))
    }
    walk(tree, undefined)
  }
}
