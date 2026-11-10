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
import { useEffect, useId, useRef, useState } from 'react'
import {
  changedSpan,
  detectIndent,
  normalizeLineEndings,
} from '../../model/editor-text'
import {
  accessExtension,
  createKit,
  editorExtensions,
  indentExtension,
  loadLanguage,
  schemeExtension,
  type Kit,
} from './editor-kit'
import { editorHint, type CodeEditorProps } from './code-editor'
import { keepScroll } from './keep-scroll'
import { TextSession } from './text-session'

/** The props of the diff editor. */
export interface DiffEditorProps extends CodeEditorProps {
  /** The text to compare with, for example the committed version. It is read-only. */
  original: string
}

/** The width of the editor, in CSS pixels, at and under which the diff is one column. */
export const diffNarrowMaxWidth = 640

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

/** What a layout switch carries to the next layout. */
interface Carry {
  path: string
  doc: string
  selection: EditorSelection
}

function textOf(value: string) {
  return Text.of(normalizeLineEndings(value).split('\n'))
}

/**
 * A diff editor on CodeMirror 6: `original` at the left and the editable text
 * at the right when the editor is wider than 640 CSS pixels, and one unified
 * column when it is not.
 *
 * - A changed line has a tint and a mark in the gutter, a plus or a minus, so that color is not the only sign.
 * - Unchanged lines far from a change collapse; `mod+Alt+U` opens the collapsed regions that show.
 * - The layout switch keeps the content, the cursor, and the unsaved edits. It does not keep the undo history.
 */
export function DiffEditor({
  path,
  text,
  version,
  original,
  readOnly = false,
  platform,
  onDirtyChange,
  onSave,
}: DiffEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const hint = useId()
  const [layout, setLayout] = useState<Layout>()
  const handle = useRef<Handle | null>(null)
  const kit = useRef<Kit>(createKit())
  const session = useRef(new TextSession())
  const carry = useRef<Carry | null>(null)
  const applied = useRef(version)
  const latest = useRef({ path, text, original, readOnly, version })

  useEffect(() => {
    latest.current = { path, text, original, readOnly, version }
    session.current.callbacks = { onDirtyChange, onSave }
  })

  // Choose the layout from the width of the editor. A hidden panel has no
  // width, so a width of 0 changes nothing.
  useEffect(() => {
    const element = area.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      if (width > 0) setLayout(width <= diffNarrowMaxWidth ? 'narrow' : 'wide')
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Make the views of the layout.
  useEffect(() => {
    const element = host.current
    if (!element || !layout) return
    const parts = kit.current
    const current = session.current
    const first = latest.current
    // The text that the owner edits is the main view. Save from either side
    // saves it, and a change of the original side is not an edit.
    const hooks = {
      save: () =>
        !latest.current.readOnly &&
        handle.current !== null &&
        current.save(handle.current.main),
      changed: (update: { view: EditorView }) => {
        if (update.view === handle.current?.main) current.check(update.view)
      },
    }
    applied.current = first.version
    const kept = carry.current?.path === first.path ? carry.current : null
    carry.current = null
    if (!kept) current.reset(first.text)
    const doc = kept?.doc ?? current.baseline
    const selection = kept?.selection
    const originalDoc = normalizeLineEndings(first.original)
    const sideExtensions = (diff: boolean) =>
      editorExtensions(parts, platform, hooks, { diff })

    let made: Handle
    if (layout === 'wide') {
      const merge = new MergeView({
        parent: element,
        a: {
          doc: originalDoc,
          extensions: sideExtensions(true),
        },
        b: {
          doc,
          selection,
          extensions: sideExtensions(true),
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
            sideExtensions(true),
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
    for (const view of [made.main, made.original]) {
      view?.dispatch({
        effects: parts.indent.reconfigure(
          indentExtension(detectIndent(current.baseline)),
        ),
      })
    }
    const views = [made.main, made.original].filter(
      (view): view is EditorView => view !== undefined,
    )
    if (kept && selection)
      made.main.dispatch({
        effects: EditorView.scrollIntoView(selection.main.head, {
          y: 'center',
        }),
      })

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
      carry.current = {
        path: latest.current.path,
        doc: made.main.state.doc.toString(),
        selection: made.main.state.selection,
      }
      made.destroy()
      handle.current = null
    }
  }, [layout, platform, hint])

  // The name, the access, and the language follow the props.
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
  }, [path, readOnly, hint, layout, platform])

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
  }, [path, layout, platform])

  // A new version of the text from the disk replaces the content. A layout
  // switch is not a new version: it keeps the unsaved edits.
  useEffect(() => {
    const made = handle.current
    if (!made || applied.current === version) return
    applied.current = version
    const next = latest.current.text
    session.current.replace(made.main, next)
    const indent = indentExtension(detectIndent(normalizeLineEndings(next)))
    for (const view of [made.main, made.original])
      view?.dispatch({ effects: kit.current.indent.reconfigure(indent) })
  }, [version])

  // A new original replaces the left side.
  useEffect(() => {
    const made = handle.current
    if (!made) return
    const next = normalizeLineEndings(original)
    if (made.original) {
      const span = changedSpan(made.original.state.doc.toString(), next)
      if (span) made.original.dispatch({ changes: span })
      return
    }
    const old = getOriginalDoc(made.main.state)
    const span = changedSpan(old.toString(), next)
    if (span)
      made.main.dispatch({
        effects: updateOriginalDoc.of({
          doc: textOf(next),
          changes: ChangeSet.of(span, old.length),
        }),
      })
  }, [original, layout, platform])

  return (
    <div ref={area} className="h-full min-h-0 bg-editor">
      <div ref={host} className="h-full" />
      <p id={hint} hidden>
        {editorHint}
      </p>
    </div>
  )
}
