import {
  getSearchQuery,
  openSearchPanel,
  searchPanelOpen,
  setSearchQuery,
  type SearchQuery,
} from '@codemirror/search'
import {
  getOriginalDoc,
  MergeView,
  unifiedMergeView,
  updateOriginalDoc,
} from '@codemirror/merge'
import {
  ChangeSet,
  EditorState,
  Text,
  type EditorSelection,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { readPixelToken } from '@/shared/lib'
import {
  changedSpan,
  detectIndent,
  withSeparator,
  type LineSeparator,
} from '../../model/editor-text'
import { editorHint, type CodeEditorProps } from './code-editor'
import {
  accessExtension,
  createKit,
  editorExtensions,
  indentExtension,
  loadLanguage,
  platformEffects,
  schemeExtension,
  type Kit,
} from './editor-kit'
import { keepScroll } from './keep-scroll'
import { TextSession } from './text-session'

/** The props of the diff editor. */
export interface DiffEditorProps extends CodeEditorProps {
  /** The text to compare with, for example the committed version. It is read-only, and a new value never changes the edits. */
  original: string
}

/** The two layouts of the diff. */
type Layout = 'wide' | 'narrow'

/** The views that one layout holds. */
interface Handle {
  layout: Layout
  /** The editable view. */
  main: EditorView
  /** The read-only view of the original: the left side of the wide layout. */
  original?: EditorView
  destroy: () => void
}

/** The control of the editor that has the focus. */
type FocusRole = 'main' | 'original' | 'search'

/** What a layout switch carries to the next layout. */
interface Carry {
  doc: Text
  selection: EditorSelection
  /** The line separator of the content, which can differ from the one of the disk text during a conflict. */
  separator: LineSeparator
  search?: { query: SearchQuery }
  focus?: FocusRole
}

/** The text of the original, as lines. The original is only shown, so each line ending is a line break. */
function originalText(value: string) {
  return Text.of(withSeparator(value, '\n').split('\n'))
}

/** The layout for the width of the editor, from the breakpoint `--vv-narrow-max-w`. */
function layoutFor(width: number): Layout {
  return width <= readPixelToken('--vv-narrow-max-w', 640) ? 'narrow' : 'wide'
}

/**
 * A diff editor on CodeMirror 6: `original` at the left and the editable text
 * at the right when the editor is wider than `--vv-narrow-max-w`, and one
 * unified column when it is not.
 *
 * - A changed line has a tint and a mark in the gutter, a plus or a minus, so that color is not the only sign.
 * - Unchanged lines far from a change collapse; `mod+Alt+U` opens the collapsed regions that show.
 * - The layout switch keeps the content, the cursor, the focus, the unsaved edits, and the search. It waits for the end of an IME composition. It does not keep the undo history.
 * - The text follows the same contract as `CodeEditor`: a new `text` never discards unsaved edits.
 */
export function DiffEditor({
  path,
  text,
  version,
  original,
  readOnly = false,
  platform,
  onDirtyChange,
  onConflictChange,
  onSave,
  ref,
}: DiffEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const hint = useId()
  const [layout, setLayout] = useState<Layout>()
  const handle = useRef<Handle | null>(null)
  const [parts] = useState(createKit)
  const [textSession] = useState(() => new TextSession(parts))
  const kit = useRef<Kit>(parts)
  const session = useRef(textSession)
  const carry = useRef<Carry | null>(null)
  const applied = useRef(version)
  const latest = useRef({
    path,
    text,
    version,
    original,
    readOnly,
    platform,
  })
  // Save from either side gives the editable text, and only its changes are edits.
  const hooks = useRef({
    save: () =>
      !latest.current.readOnly &&
      handle.current !== null &&
      session.current.save(handle.current.main),
    changed: (update: { view: EditorView }) => {
      if (update.view === handle.current?.main)
        session.current.check(update.view)
    },
  })

  useEffect(() => {
    latest.current = { path, text, version, original, readOnly, platform }
    session.current.callbacks = { onDirtyChange, onConflictChange, onSave }
  })

  useImperativeHandle(ref, () => ({
    revert() {
      if (handle.current) session.current.revert(handle.current.main)
    },
  }))

  // Choose the layout from the width of the editor. A hidden panel has no
  // width, so a width of 0 changes nothing. While an IME composition is open,
  // a rebuild would destroy the input, so the switch waits until it ends.
  useEffect(() => {
    const element = area.current
    if (!element) return
    let wanted: Layout | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = () => {
      timer = undefined
      if (!wanted) return
      if (handle.current?.main.compositionStarted) {
        timer = setTimeout(settle, 50)
        return
      }
      setLayout(wanted)
    }
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      if (width <= 0) return
      wanted = layoutFor(width)
      if (timer === undefined) settle()
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [])

  // Make the views of the layout.
  useEffect(() => {
    const element = host.current
    if (!element || !layout) return
    const parts = kit.current
    const current = session.current
    const first = latest.current
    const kept = carry.current
    carry.current = null
    // A first build takes the text. A rebuild keeps the content, and the
    // version effect below takes a text that came in the same render.
    if (!kept) {
      current.init(first.text)
      applied.current = first.version
    }
    const separator = kept?.separator ?? current.separator
    const doc = kept?.doc ?? current.document()
    const selection = kept?.selection
    const options = { diff: true, separator }
    const originalDoc = originalText(first.original)

    let made: Handle
    if (layout === 'wide') {
      const merge = new MergeView({
        parent: element,
        a: {
          doc: originalDoc,
          extensions: editorExtensions(parts, first.platform, hooks.current, {
            diff: true,
          }),
        },
        b: {
          doc,
          selection,
          extensions: editorExtensions(
            parts,
            first.platform,
            hooks.current,
            options,
          ),
        },
        gutter: true,
        highlightChanges: true,
        collapseUnchanged: { margin: 3, minSize: 4 },
      })
      made = {
        layout,
        main: merge.b,
        original: merge.a,
        destroy: () => merge.destroy(),
      }
    } else {
      const main = new EditorView({
        parent: element,
        state: EditorState.create({
          doc,
          selection,
          extensions: [
            editorExtensions(parts, first.platform, hooks.current, options),
            unifiedMergeView({
              original: originalDoc,
              mergeControls: false,
              gutter: true,
              highlightChanges: true,
              collapseUnchanged: { margin: 3, minSize: 4 },
            }),
          ],
        }),
      })
      made = { layout, main, destroy: () => main.destroy() }
    }
    handle.current = made
    const views = [made.main, made.original].filter(
      (view): view is EditorView => view !== undefined,
    )
    for (const view of views) {
      view.dispatch({
        effects: parts.indent.reconfigure(
          indentExtension(detectIndent(first.text)),
        ),
      })
    }

    if (kept) {
      // The search panel, and then the focus, in the new layout. React does
      // not allow a synchronous render inside an effect, and the panel needs
      // one, so this runs right after the effect.
      queueMicrotask(() => {
        if (handle.current !== made) return
        if (kept.search) {
          openSearchPanel(made.main)
          made.main.dispatch({ effects: setSearchQuery.of(kept.search.query) })
        }
        if (kept.focus === 'main') made.main.focus()
        else if (kept.focus === 'original') (made.original ?? made.main).focus()
        if (selection)
          made.main.dispatch({
            effects: EditorView.scrollIntoView(selection.main.head, {
              y: 'center',
            }),
          })
      })
    }

    // The scheme changes the class of the root: CodeMirror needs its flag.
    const scheme = new MutationObserver(() => {
      for (const view of views)
        view.dispatch({ effects: parts.scheme.reconfigure(schemeExtension()) })
    })
    scheme.observe(document.documentElement, { attributeFilter: ['class'] })
    const stopScroll = keepScroll(element, () => {
      for (const view of views) view.requestMeasure()
    })

    return () => {
      stopScroll()
      scheme.disconnect()
      // Remember which control of the editor has the focus. The editor gives
      // it back only when it had it, and never takes it from another region.
      const active = document.activeElement
      let focus: FocusRole | undefined
      if (active && element.contains(active)) {
        if (made.main.dom.contains(active))
          focus = active.closest('.cm-panels') ? 'search' : 'main'
        else if (made.original?.dom.contains(active)) focus = 'original'
      }
      const state = made.main.state
      carry.current = {
        doc: state.doc,
        selection: state.selection,
        separator: state.lineBreak as LineSeparator,
        search: searchPanelOpen(state)
          ? { query: getSearchQuery(state) }
          : undefined,
        focus,
      }
      made.destroy()
      handle.current = null
    }
  }, [layout])

  // The platform changes the keys. The content, the selection, and the history stay.
  useEffect(() => {
    const made = handle.current
    if (!made) return
    for (const view of [made.main, made.original])
      view?.dispatch({
        effects: platformEffects(kit.current, platform, hooks.current, {
          diff: true,
        }),
      })
  }, [platform, layout])

  // The name and the access follow the props.
  useEffect(() => {
    const made = handle.current
    if (!made) return
    made.main.dispatch({
      effects: kit.current.access.reconfigure(
        accessExtension({ readOnly, label: path, describedBy: hint }),
      ),
    })
    // The original side is always read-only, and its name follows the path.
    made.original?.dispatch({
      effects: kit.current.access.reconfigure(
        accessExtension({
          readOnly: true,
          label: `${path} (original, read-only)`,
          describedBy: hint,
        }),
      ),
    })
  }, [path, readOnly, hint, layout])

  useEffect(() => {
    let stale = false
    void loadLanguage(path).then((language) => {
      const made = handle.current
      if (stale || !made) return
      for (const view of [made.main, made.original])
        view?.dispatch({ effects: kit.current.language.reconfigure(language) })
    })
    return () => {
      stale = true
    }
  }, [path, layout])

  // A new version of the text from the disk: process each one once. A layout
  // switch in the same render does not lose it, because the version is
  // advanced only here, after the snapshot is processed.
  useEffect(() => {
    const made = handle.current
    if (!made || applied.current === version) return
    applied.current = version
    const next = latest.current.text
    session.current.applyDisk(made.main, next)
    const indent = indentExtension(detectIndent(next))
    for (const view of [made.main, made.original])
      view?.dispatch({ effects: kit.current.indent.reconfigure(indent) })
  }, [version, layout])

  // A new original replaces the left side, and never touches the edits.
  useEffect(() => {
    const made = handle.current
    if (!made) return
    const next = originalText(original)
    if (made.original) {
      const span = changedSpan(
        made.original.state.doc.toString(),
        next.toString(),
      )
      if (span)
        made.original.dispatch({
          changes: {
            from: span.from,
            to: span.to,
            insert: Text.of(span.insert.split('\n')),
          },
        })
      return
    }
    const old = getOriginalDoc(made.main.state)
    const span = changedSpan(old.toString(), next.toString())
    if (span)
      made.main.dispatch({
        effects: updateOriginalDoc.of({
          doc: next,
          changes: ChangeSet.of(
            {
              from: span.from,
              to: span.to,
              insert: Text.of(span.insert.split('\n')),
            },
            old.length,
          ),
        }),
      })
  }, [original, layout])

  return (
    <div ref={area} className="h-full min-h-0 bg-editor">
      <div ref={host} data-diff-host className="h-full" />
      <p id={hint} hidden>
        {editorHint}
      </p>
    </div>
  )
}
