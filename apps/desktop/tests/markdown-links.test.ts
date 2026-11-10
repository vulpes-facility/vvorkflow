import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { markInlineLinks } from '../src/pages/workbench/model/markdown-links.ts'

interface Node {
  tagName?: string
  properties?: Record<string, unknown>
  children?: Node[]
}

/** The links of a text, with their inline mark. */
function links(text: string): boolean[] {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype)
  const tree = processor.runSync(processor.parse(text)) as Node
  markInlineLinks()(tree as never)
  const result: boolean[] = []
  const walk = (node: Node) => {
    if (node.tagName === 'a')
      result.push(Boolean(node.properties?.dataInlineLink))
    node.children?.forEach(walk)
  }
  walk(tree)
  return result
}

describe('markInlineLinks', () => {
  it('marks a link in a sentence', () => {
    expect(links('Read the [docs](https://a.example) first.')).toEqual([true])
    expect(links('Read **the [docs](https://a.example)** first.')).toEqual([
      true,
    ])
    expect(links('Read `code` and [docs](https://a.example)')).toEqual([true])
  })
  it('does not mark a link that stands alone in its block', () => {
    expect(links('[docs](https://a.example)')).toEqual([false])
    expect(links('- [docs](https://a.example)')).toEqual([false])
    expect(links('| a |\n| - |\n| [docs](https://a.example) |')).toEqual([
      false,
    ])
    expect(links('https://a.example')).toEqual([false])
  })
  it('does not count the text of another link as prose', () => {
    expect(links('[a](/a) [b](/b)')).toEqual([false, false])
    expect(links('[a](/a)\n[b](/b)')).toEqual([false, false])
    expect(links('[a](/a), [b](/b)')).toEqual([true, true])
    expect(links('[a](/a) and [b](/b)')).toEqual([true, true])
  })
  it('does not count the text of a nested block as prose', () => {
    expect(
      links('- [a](/a)\n  - nested prose and [b](/b)\n  - [c](/c)'),
    ).toEqual([false, true, false])
  })
  it('keeps the target size of a linked image, also in a sentence', () => {
    expect(links('[![alt](./a.png)](https://a.example)')).toEqual([false])
    expect(links('See [![alt](./a.png)](https://a.example) here')).toEqual([
      false,
    ])
  })
})

/** A paragraph of `count` links with prose between them, as a hast tree. */
function paragraph(count: number): Node & { type: string } {
  const children: Node[] = []
  for (let index = 0; index < count; index++) {
    children.push({ type: 'text', value: ' text ' } as never)
    children.push({
      type: 'element',
      tagName: 'a',
      properties: {},
      children: [{ type: 'text', value: 'link' } as never],
    } as never)
  }
  return {
    type: 'root',
    children: [{ type: 'element', tagName: 'p', children } as never],
  }
}

describe('the work of markInlineLinks', () => {
  /** The number of nodes that the plugin visits for a paragraph of `count` links. */
  function visits(count: number): number {
    let total = 0
    markInlineLinks({ onVisit: () => total++ })(paragraph(count) as never)
    return total
  }

  it('grows in step with the number of links', () => {
    const ratio = visits(10_000) / visits(1_000)
    // Linear work gives 10. A scan of the block for each link gives 100.
    expect(ratio).toBeGreaterThan(9)
    expect(ratio).toBeLessThan(11)
  })
})
