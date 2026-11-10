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
  })
  it('does not mark a link that stands alone in its block', () => {
    expect(links('[docs](https://a.example)')).toEqual([false])
    expect(links('- [docs](https://a.example)')).toEqual([false])
    expect(links('| a |\n| - |\n| [docs](https://a.example) |')).toEqual([
      false,
    ])
    expect(links('[![alt](./a.png)](https://a.example)')).toEqual([false])
    expect(links('https://a.example')).toEqual([false])
  })
  it('judges each link of a block with several links', () => {
    expect(links('[a](https://a.example) [b](https://b.example)')).toEqual([
      true,
      true,
    ])
  })
})
