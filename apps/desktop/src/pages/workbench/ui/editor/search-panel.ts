import { setSearchQuery } from '@codemirror/search'
import type { EditorView, Panel } from '@codemirror/view'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Platform } from '@/shared/lib'
import { countMatches } from './search-count'
import { SearchPanelView } from './search-panel-view'

/**
 * Makes the search panel of the editor: icon buttons and a count instead of
 * words, on the query and the commands of `@codemirror/search`.
 *
 * @returns A function for the `createPanel` option of `search`.
 */
export function createSearchPanel(platform: Platform) {
  return (view: EditorView): Panel => {
    const dom = document.createElement('div')
    dom.className = 'cm-vv-search'
    const root = createRoot(dom)
    let count = countMatches(view)
    const render = () =>
      root.render(createElement(SearchPanelView, { view, platform, count }))
    // The first render is synchronous, so that the field exists when the
    // panel mounts and takes the focus.
    flushSync(render)
    return {
      dom,
      top: true,
      mount() {
        const field = dom.querySelector<HTMLInputElement>('[main-field]')
        field?.focus()
        field?.select()
      },
      update(update) {
        const queryChanged = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setSearchQuery)),
        )
        if (update.docChanged || update.selectionSet || queryChanged) {
          count = countMatches(update.view)
          render()
        } else if (update.state.readOnly !== update.startState.readOnly) {
          render()
        }
      },
      destroy() {
        // Unmount after the current update, as React asks of a root that is in use.
        queueMicrotask(() => root.unmount())
      },
    }
  }
}
