import { getSearchQuery, type SearchQuery } from '@codemirror/search'
import type { EditorState, Text } from '@codemirror/state'

/** The most matches that the panel counts. */
const countLimit = 10_000

/** The time that one step of a count may use, in milliseconds. */
const stepBudget = 8

/** What the panel shows about the matches of the query. */
export interface MatchCount {
  /** The number of matches, or undefined when the query is empty or not valid. */
  total?: number
  /** The 1-based number of the match that is selected, when one is. */
  current?: number
  /** True when there are more matches than the panel counts. */
  capped: boolean
}

/** The text of the count: `3 of 17`, `17`, `0`, or nothing for an empty query. */
export function countText({ total, current, capped }: MatchCount): string {
  if (total === undefined) return ''
  const all = capped ? `${total}+` : String(total)
  return current === undefined ? all : `${current} of ${all}`
}

/**
 * Counts the matches of the search query, off the input path.
 * A scan of the document starts only when the document or the query changes,
 * runs in steps of a few milliseconds, and keeps the list of the matches. A
 * change of the selection only looks up the selected match in that list. Until
 * a new scan ends, the count of the last scan stays.
 */
export class MatchCounter {
  private doc: Text | undefined
  private query: SearchQuery | undefined
  private starts: number[] = []
  private ends: number[] = []
  private done = false
  private capped = false
  private valid = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private destroyed = false
  private shown: MatchCount = { capped: false }

  private readonly onDone: () => void

  /** @param onDone Called when a scan ends, so that the panel shows the new count. */
  constructor(onDone: () => void) {
    this.onDone = onDone
  }

  /** Starts a new scan when the document or the query changed since the last call. */
  update(state: EditorState) {
    const query = getSearchQuery(state)
    if (state.doc === this.doc && this.query?.eq(query)) return
    this.doc = state.doc
    this.query = query
    clearTimeout(this.timer)
    this.starts = []
    this.ends = []
    this.done = false
    this.capped = false
    this.valid = query.valid
    if (!query.valid) {
      // An empty or wrong query has no matches to count.
      this.done = true
      this.shown = { capped: false }
      return
    }
    const cursor = query.getCursor(state)
    const step = () => {
      if (this.destroyed) return
      const until = performance.now() + stepBudget
      while (performance.now() < until) {
        const next = cursor.next()
        if (next.done) {
          this.finish()
          return
        }
        this.starts.push(next.value.from)
        this.ends.push(next.value.to)
        if (this.starts.length >= countLimit) {
          this.capped = true
          this.finish()
          return
        }
      }
      this.timer = setTimeout(step, 0)
    }
    this.timer = setTimeout(step, 0)
  }

  private finish() {
    this.done = true
    this.shown = { capped: false }
    this.onDone()
  }

  /**
   * The count for a selection. It looks up the selected match in the list of
   * the last scan, and does not scan the document. While a scan runs, it gives
   * the count of the scan before.
   */
  count(from: number, to: number): MatchCount {
    if (!this.done) return this.shown
    if (!this.valid) return { capped: false }
    let low = 0
    let high = this.starts.length - 1
    let current: number | undefined
    while (low <= high) {
      const middle = (low + high) >> 1
      if (this.starts[middle] < from) low = middle + 1
      else if (this.starts[middle] > from) high = middle - 1
      else {
        // Matches can share a start, such as an empty match; take the one that ends where the selection ends.
        let index = middle
        while (index > 0 && this.starts[index - 1] === from) index--
        for (; this.starts[index] === from; index++)
          if (this.ends[index] === to) {
            current = index + 1
            break
          }
        break
      }
    }
    this.shown = {
      total: this.starts.length,
      current,
      capped: this.capped,
    }
    return this.shown
  }

  /** Stops the scan. The counter then calls nothing. */
  destroy() {
    this.destroyed = true
    clearTimeout(this.timer)
  }
}
