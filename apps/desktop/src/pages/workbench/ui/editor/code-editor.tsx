import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useId, useRef } from 'react'
import type { Platform } from '@/shared/lib'
import { detectIndent, normalizeLineEndings } from '../../model/editor-text'
import {
  accessExtension,
  createKit,
  editorExtensions,
  indentExtension,
  loadLanguage,
  schemeExtension,
  type Kit,
} from './editor-kit'
import { keepScroll } from './keep-scroll'
import { TextSession } from './text-session'

/** The props of the code editor. */
export interface CodeEditorProps {
  /** The path of the file, relative to its worktree, such as `src/app.ts`. Its name picks the language. */
  path: string
  /** The text of the file. The editor reads it when it mounts, and again when `version` changes. */
  text: string
  /** A value that changes when `text` comes new from the disk. The editor then replaces its content, and keeps the cursor and the scroll position where it can. */
  version: string
  /** When true, the content takes no input. The editor still takes the focus and the selection. */
  readOnly?: boolean
  platform: Platform
  /** Called when the content first differs from `text`, and when it is equal to it again. */
  onDirtyChange?: (dirty: boolean) => void
  /** Called on mod+S with the content, in the line endings of `text`. */
  onSave?: (text: string) => void
}

/** The words that tell the way out of the editor. */
export const editorHint =
  'The editor takes the Tab key. Press Escape, then Tab, to move to the next control. Press F6 to move the focus out of the editor.'

/**
 * A code editor on CodeMirror 6, for one file.
 *
 * - It shows the text with the language of the file name, line numbers, bracket matching, undo, multiple selections, and search with `mod+F`.
 * - It keeps the line ending of the text, and the indentation that the text uses (2 spaces when it shows none).
 * - The keyboard can leave it: F6 and Shift+F6 reach the window, and Escape then Tab moves the focus on.
 */
export function CodeEditor({
  path,
  text,
  version,
  readOnly = false,
  platform,
  onDirtyChange,
  onSave,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const hint = useId()
  const view = useRef<EditorView | null>(null)
  const kit = useRef<Kit | null>(null)
  const session = useRef(new TextSession())
  const latest = useRef({ path, text, readOnly })

  useEffect(() => {
    latest.current = { path, text, readOnly }
    session.current.callbacks = { onDirtyChange, onSave }
  })

  // Make the view. A new platform changes the keys, so it makes a new view.
  useEffect(() => {
    const element = host.current
    if (!element) return
    const { text: first } = latest.current
    const current = session.current
    const parts = createKit()
    current.reset(first)
    const created = new EditorView({
      parent: element,
      state: EditorState.create({
        doc: current.baseline,
        extensions: editorExtensions(parts, platform, {
          save: (target) => !latest.current.readOnly && current.save(target),
          changed: (update) => current.check(update.view),
        }),
      }),
    })
    view.current = created
    kit.current = parts
    // The scheme changes the class of the root: CodeMirror needs its flag.
    const scheme = new MutationObserver(() =>
      created.dispatch({
        effects: parts.scheme.reconfigure(schemeExtension()),
      }),
    )
    scheme.observe(document.documentElement, { attributeFilter: ['class'] })
    const stopScroll = keepScroll(element, () => created.requestMeasure())

    return () => {
      stopScroll()
      scheme.disconnect()
      created.destroy()
      view.current = null
      kit.current = null
    }
  }, [platform, hint])

  // The name, the access, and the language follow the props.
  useEffect(() => {
    const current = view.current
    const parts = kit.current
    if (!current || !parts) return
    current.dispatch({
      effects: parts.access.reconfigure(
        accessExtension({ readOnly, label: path, describedBy: hint }),
      ),
    })
  }, [path, readOnly, hint, platform])

  useEffect(() => {
    let stale = false
    void loadLanguage(path).then((language) => {
      const current = view.current
      const parts = kit.current
      if (stale || !current || !parts) return
      current.dispatch({ effects: parts.language.reconfigure(language) })
    })
    return () => {
      stale = true
    }
  }, [path, platform])

  // A new version of the text from the disk replaces the content.
  useEffect(() => {
    const current = view.current
    const parts = kit.current
    if (!current || !parts) return
    const next = latest.current.text
    session.current.replace(current, next)
    current.dispatch({
      effects: parts.indent.reconfigure(
        indentExtension(detectIndent(normalizeLineEndings(next))),
      ),
    })
  }, [version, platform])

  return (
    <div className="h-full min-h-0 bg-editor">
      <div ref={host} className="h-full" />
      <p id={hint} hidden>
        {editorHint}
      </p>
    </div>
  )
}
