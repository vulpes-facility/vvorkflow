import { describe, expect, it } from 'vitest'
import {
  applyLineEnding,
  changedSpan,
  defaultIndent,
  detectIndent,
  detectLineEnding,
  indentUnitText,
  normalizeLineEndings,
  tabSize,
} from '../src/pages/workbench/model/editor-text.ts'

describe('line endings', () => {
  it('detects CRLF and LF', () => {
    expect(detectLineEnding('a\r\nb\r\nc')).toBe('\r\n')
    expect(detectLineEnding('a\nb\nc')).toBe('\n')
  })

  it('takes LF for a text with no line break, and for a tie', () => {
    expect(detectLineEnding('abc')).toBe('\n')
    expect(detectLineEnding('')).toBe('\n')
    expect(detectLineEnding('a\r\nb\nc')).toBe('\n')
  })

  it('takes the most common ending of a mixed text', () => {
    expect(detectLineEnding('a\r\nb\r\nc\nd')).toBe('\r\n')
  })

  it('round-trips a CRLF text', () => {
    const text = 'a\r\n\r\nb\r\n'
    expect(applyLineEnding(normalizeLineEndings(text), '\r\n')).toBe(text)
  })

  it('normalizes a lone CR', () => {
    expect(normalizeLineEndings('a\rb\r\nc\nd')).toBe('a\nb\nc\nd')
  })
})

describe('indentation', () => {
  it('detects 2 spaces', () => {
    expect(detectIndent('a {\n  b {\n    c\n  }\n}\n')).toEqual({
      unit: ' ',
      width: 2,
    })
  })

  it('detects 4 spaces', () => {
    expect(detectIndent('def f():\n    if x:\n        y\n    z\n')).toEqual({
      unit: ' ',
      width: 4,
    })
  })

  it('detects tabs', () => {
    expect(detectIndent('a {\n\tb {\n\t\tc\n\t}\n}\n')).toEqual({ unit: '\t' })
  })

  it('ignores the continuation lines of a block comment', () => {
    expect(
      detectIndent('/**\n * Doc.\n */\nfunction f() {\n    return 1\n}\n'),
    ).toEqual({ unit: ' ', width: 4 })
  })

  it('uses the default for a text with no indentation', () => {
    expect(detectIndent('a\nb\n')).toEqual(defaultIndent)
    expect(detectIndent('')).toEqual(defaultIndent)
    expect(defaultIndent).toEqual({ unit: ' ', width: 2 })
  })

  it('gives the unit text and the tab size', () => {
    expect(indentUnitText({ unit: '\t' })).toBe('\t')
    expect(indentUnitText({ unit: ' ', width: 4 })).toBe('    ')
    expect(tabSize({ unit: '\t' })).toBe(4)
    expect(tabSize({ unit: ' ', width: 3 })).toBe(3)
  })
})

describe('changedSpan', () => {
  it('returns nothing for equal texts', () => {
    expect(changedSpan('abc', 'abc')).toBeUndefined()
  })

  it('finds the span between the common start and end', () => {
    expect(changedSpan('hello world', 'hello brave world')).toEqual({
      from: 6,
      to: 6,
      insert: 'brave ',
    })
    expect(changedSpan('abcdef', 'abXef')).toEqual({
      from: 2,
      to: 4,
      insert: 'X',
    })
  })

  it('does not count the same character twice', () => {
    expect(changedSpan('aa', 'aaa')).toEqual({ from: 2, to: 2, insert: 'a' })
    expect(changedSpan('aaa', 'a')).toEqual({ from: 1, to: 3, insert: '' })
  })

  it('handles an empty text on either side', () => {
    expect(changedSpan('', 'abc')).toEqual({ from: 0, to: 0, insert: 'abc' })
    expect(changedSpan('abc', '')).toEqual({ from: 0, to: 3, insert: '' })
  })
})
