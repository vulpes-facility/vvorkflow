import { getSearchQuery } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'

/** The most matches that the panel counts. */
const countLimit = 10_000

/** What the panel shows about the matches of the query. */
export interface MatchCount {
  /** The number of matches, or undefined when the query is empty or not valid. */
  total?: number
  /** The 1-based number of the match that is selected, when one is. */
  current?: number
  /** True when there are more matches than the panel counts. */
  capped: boolean
}

/**
 * Counts the matches of the query in the document.
 *
 * @returns The total, and the number of the selected match.
 */
export function countMatches(view: EditorView): MatchCount {
  const query = getSearchQuery(view.state)
  if (!query.valid) return { capped: false }
  const { from, to } = view.state.selection.main
  const cursor = query.getCursor(view.state)
  let total = 0
  let current: number | undefined
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    total++
    if (step.value.from === from && step.value.to === to) current = total
    if (total >= countLimit) return { total, current, capped: true }
  }
  return { total, current, capped: false }
}

/** The text of the count: `3 of 17`, `17`, `0`, or nothing for an empty query. */
export function countText({ total, current, capped }: MatchCount): string {
  if (total === undefined) return ''
  const all = capped ? `${total}+` : String(total)
  return current === undefined ? all : `${current} of ${all}`
}
