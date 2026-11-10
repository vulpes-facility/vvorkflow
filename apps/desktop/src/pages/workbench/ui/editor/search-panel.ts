import { openSearchPanel, setSearchQuery } from '@codemirror/search'
import type { EditorView, Panel } from '@codemirror/view'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Platform } from '@/shared/lib'
import { MatchCounter } from './search-count'
import { SearchPanelView } from './search-panel-view'

/** The views that open their search panel without the focus. */
const quiet = new WeakSet<EditorView>()

/**
 * Opens the search panel and does not give it the focus, for a panel that
 * comes back after a rebuild of the view, when the focus was elsewhere.
 */
export function openSearchPanelQuietly(view: EditorView) {
  quiet.add(view)
  try {
    openSearchPanel(view)
  } finally {
    quiet.delete(view)
  }
}

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
    let destroyed = false
    const render = () => {
      if (destroyed) return
      const { from, to } = view.state.selection.main
      root.render(
        createElement(SearchPanelView, {
          view,
          platform,
          count: counter.count(from, to),
        }),
      )
    }
    const counter = new MatchCounter(render)
    counter.update(view.state)
    // The first render is synchronous, so that the field exists when the
    // panel mounts and takes the focus.
    flushSync(render)
    return {
      dom,
      top: true,
      mount() {
        if (quiet.has(view)) return
        const field = dom.querySelector<HTMLInputElement>('[main-field]')
        field?.focus()
        field?.select()
      },
      update(update) {
        // A control of the replace row goes away when the editor becomes
        // read-only. Move the focus to the find field before it does.
        if (update.state.readOnly && !update.startState.readOnly) {
          const active = dom.ownerDocument.activeElement
          if (
            active &&
            dom.contains(active) &&
            active.closest('[data-replace-row], [data-replace-toggle]')
          )
            dom.querySelector<HTMLInputElement>('[main-field]')?.focus()
        }
        const queryChanged = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setSearchQuery)),
        )
        if (update.docChanged || queryChanged) counter.update(update.state)
        if (
          update.docChanged ||
          update.selectionSet ||
          queryChanged ||
          update.state.readOnly !== update.startState.readOnly
        )
          render()
      },
      destroy() {
        destroyed = true
        counter.destroy()
        // Unmount after the current update, as React asks of a root that is in use.
        queueMicrotask(() => root.unmount())
      },
    }
  }
}
