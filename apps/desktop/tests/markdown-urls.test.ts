import { describe, expect, it } from 'vitest'
import {
  classifyImageSource,
  classifyLinkTarget,
  countRemoteImages,
} from '../src/pages/workbench/model/markdown-urls.ts'

describe('classifyImageSource', () => {
  it.each([
    'https://example.com/a.png',
    'HTTP://example.com/a.png',
    '//example.com/a.png',
    '\\\\example.com/a.png',
    '  https://example.com/a.png',
    'ht\ttps://example.com/a.png',
  ])('treats %j as remote', (source) => {
    expect(classifyImageSource(source).kind).toBe('remote')
  })

  it('gives the canonical URL and its host', () => {
    expect(classifyImageSource('https://cdn.example.com:8443/a.png')).toEqual({
      kind: 'remote',
      url: 'https://cdn.example.com:8443/a.png',
      host: 'cdn.example.com:8443',
    })
    expect(classifyImageSource('HTTPS://CDN.Example.com/A b.png')).toEqual({
      kind: 'remote',
      url: 'https://cdn.example.com/A%20b.png',
      host: 'cdn.example.com',
    })
  })

  it('gives protocol-relative and backslash forms the https scheme', () => {
    expect(classifyImageSource('//cdn.example.com/a.png')).toMatchObject({
      url: 'https://cdn.example.com/a.png',
    })
    expect(classifyImageSource('\\\\cdn.example.com\\a.png')).toMatchObject({
      url: 'https://cdn.example.com/a.png',
      host: 'cdn.example.com',
    })
    // Extra slashes: the host is what the browser loads.
    expect(
      classifyImageSource('https:////cdn.example.com/a.png'),
    ).toMatchObject({
      host: 'cdn.example.com',
    })
  })

  it.each([
    'https:picture.png',
    'HTTP:picture.png',
    'https:/picture.png',
    'https:./picture.png',
    'http:picture.png',
    'https://user:pass@example.com/a.png',
    'https://user@example.com/a.png',
    'https://',
  ])('blocks the form with two readings %j', (source) => {
    expect(classifyImageSource(source).kind).toBe('blocked')
  })

  it.each([
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    ' \u0001javascript:alert(1)',
    'vbscript:msgbox',
    'file:///etc/passwd',
    'blob:https://example.com/id',
    'ftp://example.com/a.png',
    'java%09script:alert(1)',
    'JAVA%0ASCRIPT:alert(1)',
    '%20%20javascript:alert(1)',
    '%20%20https://example.com/a.png',
    '%5C%5Cexample.com%5Ca.png',
    '%68ttps://example.com/a.png',
    '%2F%2Fexample.com/a.png',
  ])('blocks %j', (source) => {
    expect(classifyImageSource(source).kind).toBe('blocked')
  })

  it.each(['a.png', './img/a.png', '../a.png', '/abs/a.png', 'a b.png'])(
    'treats %j as local',
    (source) => {
      expect(classifyImageSource(source)).toEqual({
        kind: 'local',
        path: source,
      })
    },
  )
})

describe('the URL that loads', () => {
  it.each([
    'https://cdn.example.com/a%23b.png',
    'https://cdn.example.com/a%2Fb.png',
    'https://cdn.example.com/a%25b.png',
    'https://cdn.example.com/a.png?sig=x%3Fy%26z%23w%2F%25',
    'https://cdn.example.com/a.png?x=1%261&y=%3F',
    'https://cdn.example.com/a.png?path=a\\b',
    '//cdn.example.com/a%23b.png?q=%26',
  ])('keeps the path and the query of %j', (source) => {
    const result = classifyImageSource(source)
    expect(result.kind).toBe('remote')
    expect((result as { url: string }).url).toBe(
      source.startsWith('//') ? `https:${source}` : source,
    )
  })
})

describe('classifyLinkTarget', () => {
  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' java\nscript:alert(1)',
    'vbscript:x',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'java%09script:alert(1)',
    '%20javascript:alert(1)',
    '%68ttp://example.com',
    'JAVASCRIPT%3Aalert(1)',
  ])('blocks %j', (href) => {
    expect(classifyLinkTarget(href)).toEqual({ kind: 'blocked' })
  })

  it.each([
    'https://a.example/x',
    'http://a.example',
    'mailto:a@b.c',
    './b.md',
  ])('opens %j', (href) => {
    expect(classifyLinkTarget(href)).toEqual({ kind: 'open', url: href })
  })

  it('decodes an anchor', () => {
    expect(classifyLinkTarget('#user-content-fn-1')).toEqual({
      kind: 'anchor',
      id: 'user-content-fn-1',
    })
    expect(classifyLinkTarget('#a%20b')).toEqual({ kind: 'anchor', id: 'a b' })
    // The fragment decodes once: `%2523` is `%23`, not `#`.
    expect(classifyLinkTarget('#a%2523b')).toEqual({
      kind: 'anchor',
      id: 'a%23b',
    })
  })
})

describe('countRemoteImages', () => {
  it('counts inline and reference-style remote images', () => {
    const text = [
      '![a](https://example.com/a.png)',
      '![b][ref]',
      '![c](./local.png)',
      '![d](data:image/png;base64,AAAA)',
      '[ref]: //cdn.example.com/b.png',
    ].join('\n\n')
    expect(countRemoteImages(text)).toBe(2)
  })

  it('does not count raw HTML, which the preview removes', () => {
    expect(countRemoteImages('<img src="https://example.com/a.png">')).toBe(0)
  })
})
