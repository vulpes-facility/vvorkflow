/** The separator of the lines of a text file: LF or CRLF. */
export type LineSeparator = '\n' | '\r\n'

/**
 * Finds the line separator for a text. The editor splits a text into lines
 * with this separator, and gives the text back with it, so that a save is
 * byte for byte the same as the text.
 *
 * - A text that has only CRLF line endings uses `\r\n`.
 * - A text that has only LF line endings, no line ending, or a mix of endings uses `\n`.
 *   In a mix, each `\r` stays in the document as a character at the end of its line, so that no ending changes.
 */
export function detectLineSeparator(text: string): LineSeparator {
  let crlf = 0
  let lf = 0
  let cr = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === 10) lf++
    else if (code === 13) {
      if (text.charCodeAt(index + 1) === 10) {
        crlf++
        index++
      } else cr++
    }
  }
  return crlf > 0 && lf === 0 && cr === 0 ? '\r\n' : '\n'
}

/**
 * Gives the text in the form of the document: one `\n` for each line break.
 * A CRLF break is two characters in the text and one position in the document.
 */
export function documentForm(text: string, separator: LineSeparator): string {
  return separator === '\r\n' ? text.replaceAll('\r\n', '\n') : text
}

/** Changes each line ending of a text, also a lone CR, to the separator. Use it for a text that comes from outside, such as a paste. */
export function withSeparator(text: string, separator: LineSeparator): string {
  return text.replace(/\r\n?|\n/g, separator)
}

/** The indentation of a file: a tab, or a number of spaces. */
export type Indent = { unit: '\t' } | { unit: ' '; width: number }

/** The indentation that a file gets when its text shows none: 2 spaces. */
export const defaultIndent: Indent = { unit: ' ', width: 2 }

const widths = [2, 3, 4, 8]

/**
 * Finds the indentation of a text from the leading whitespace of its lines.
 * Tabs win when more lines start with a tab than with 2 or more spaces. The
 * width of spaces is the most common step between a line and the line before
 * it that starts with fewer spaces.
 *
 * @returns The indentation, or {@link defaultIndent} when the text has no clear indentation.
 */
export function detectIndent(text: string): Indent {
  let tabs = 0
  let spaces = 0
  const steps = new Map<number, number>()
  let previous = 0
  // A large file shows its indentation in its first lines.
  const lines = text.split(/\r\n|\n|\r/, 2000)
  let inComment = false
  for (const line of lines) {
    if (line.trim() === '') continue
    const lead = /^[ \t]*/.exec(line)![0]
    // The continuation lines of a block comment start with one extra space.
    const starts = line.slice(lead.length)
    if (inComment) {
      if (starts.includes('*/')) inComment = false
      continue
    }
    if (starts.startsWith('/*') && !starts.includes('*/')) inComment = true
    if (lead.startsWith('\t')) {
      tabs++
      previous = 0
      continue
    }
    const count = lead.length
    if (count >= 2) spaces++
    const step = Math.abs(count - previous)
    if (count > 0 && step > 0 && lead[0] === ' ')
      steps.set(step, (steps.get(step) ?? 0) + 1)
    previous = count
  }
  if (tabs > spaces) return { unit: '\t' }
  let best = 0
  let bestCount = 0
  for (const width of widths) {
    const count = steps.get(width) ?? 0
    if (count > bestCount) {
      best = width
      bestCount = count
    }
  }
  return best ? { unit: ' ', width: best } : defaultIndent
}

/** The text of one indent level, for CodeMirror's `indentUnit`. */
export function indentUnitText(indent: Indent): string {
  return indent.unit === '\t' ? '\t' : ' '.repeat(indent.width)
}

/** The tab size to show: 4 columns for a tab, the width for spaces. */
export function tabSize(indent: Indent): number {
  return indent.unit === '\t' ? 4 : indent.width
}

/** The span of a text that differs from another text. */
export interface ChangedSpan {
  from: number
  /** The end of the span in the old text. */
  to: number
  /** The text that replaces the span. */
  insert: string
}

/**
 * Finds the one span that turns `previous` into `next`, by the common start
 * and the common end of both texts. A replace of only this span keeps the
 * cursor and the scroll position where the text did not change.
 *
 * @returns The span, or undefined when the texts are equal.
 */
export function changedSpan(
  previous: string,
  next: string,
): ChangedSpan | undefined {
  if (previous === next) return undefined
  const limit = Math.min(previous.length, next.length)
  let start = 0
  while (start < limit && previous[start] === next[start]) start++
  let end = 0
  while (
    end < limit - start &&
    previous[previous.length - 1 - end] === next[next.length - 1 - end]
  )
    end++
  return {
    from: start,
    to: previous.length - end,
    insert: next.slice(start, next.length - end),
  }
}
