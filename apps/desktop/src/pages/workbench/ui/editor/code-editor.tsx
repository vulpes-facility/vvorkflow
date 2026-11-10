import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react'
import type { Platform } from '@/shared/lib'
import { detectIndent } from '../../model/editor-text'
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

/** What the owner of an editor can ask of it. */
export interface EditorHandle {
  /** Replaces the content with the last `text` of the props, and ends the conflict. The change is in the undo history. */
  revert(): void
}

/** The props of the code editor. */
export interface CodeEditorProps {
  /** The path of the file, relative to its worktree, such as `src/app.ts`. Its name picks the language. */
  path: string
  /**
   * The text of the file, as it is on the disk. The editor reads it when it mounts, and again when `version` changes.
   * The content keeps the line breaks of the text, byte for byte: LF, CRLF, or a mix.
   */
  text: string
  /**
   * A value that changes when `text` comes new from the disk.
   * While the content has no unsaved edits, the editor then replaces its content, and keeps the cursor and the scroll position where it can.
   * While the content has unsaved edits, or an IME composition is open, the editor keeps the content, takes the new `text` as the text of the disk, and calls `onConflictChange(true)`.
   */
  version: string
  /** When true, the content takes no input. The editor still takes the focus and the selection. */
  readOnly?: boolean
  platform: Platform
  /** Called when the content first differs from `text`, and when it is equal to it again. */
  onDirtyChange?: (dirty: boolean) => void
  /**
   * Called with true when a new `text` comes while the content has unsaved edits, and the content differs from it.
   * Called with false when the content is equal to the text again, or after `revert()`.
   */
  onConflictChange?: (conflict: boolean) => void
  /** Called on mod+S with the content, byte for byte with the line breaks of `text`. It is not called while an IME composition is open. */
  onSave?: (text: string) => void
  /** The handle of the editor. */
  ref?: Ref<EditorHandle>
}

/** The words that tell the way out of the editor. */
export const editorHint =
  'The editor takes the Tab key. Press Escape, then Tab, to move to the next control. Press F6 to move the focus out of the editor.'

/**
 * A code editor on CodeMirror 6, for one file.
 *
 * - It shows the text with the language of the file name, line numbers, bracket matching, undo, multiple selections, and search with `mod+F`.
 * - It keeps the line breaks of the text, and the indentation that the text uses (2 spaces when it shows none).
 * - The keyboard can leave it: F6 and Shift+F6 reach the window, and Escape then Tab moves the focus on.
 * - A new `text` from the disk never discards unsaved edits (see `version`).
 */
export function CodeEditor({
  path,
  text,
  version,
  readOnly = false,
  platform,
  onDirtyChange,
  onConflictChange,
  onSave,
  ref,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const hint = useId()
  const view = useRef<EditorView | null>(null)
  const [parts] = useState(createKit)
  const [textSession] = useState(() => new TextSession())
  const kit = useRef<Kit>(parts)
  const session = useRef(textSession)
  const applied = useRef(version)
  const latest = useRef({ path, text, version, readOnly, platform })
  const hooks = useRef({
    save: (target: EditorView) =>
      !latest.current.readOnly && session.current.save(target),
    changed: (update: { view: EditorView }) =>
      session.current.check(update.view),
  })

  useEffect(() => {
    latest.current = { path, text, version, readOnly, platform }
    session.current.callbacks = { onDirtyChange, onConflictChange, onSave }
  })

  useImperativeHandle(ref, () => ({
    revert() {
      if (view.current) session.current.revert(view.current)
    },
  }))

  // Make the view once. A new platform reconfigures it, and does not make it again.
  useEffect(() => {
    const element = host.current
    if (!element) return
    const first = latest.current
    const current = session.current
    const parts = kit.current
    current.init(first.text)
    applied.current = first.version
    const created = new EditorView({
      parent: element,
      state: EditorState.create({
        doc: current.document(),
        extensions: editorExtensions(parts, first.platform, hooks.current, {
          separator: current.separator,
        }),
      }),
    })
    view.current = created

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
    }
  }, [])

  // The platform changes the keys. The content, the selection, and the history stay.
  useEffect(() => {
    view.current?.dispatch({
      effects: platformEffects(kit.current, platform, hooks.current),
    })
  }, [platform])

  // The name and the access follow the props.
  useEffect(() => {
    view.current?.dispatch({
      effects: kit.current.access.reconfigure(
        accessExtension({ readOnly, label: path, describedBy: hint }),
      ),
    })
  }, [path, readOnly, hint])

  useEffect(() => {
    let stale = false
    void loadLanguage(path).then((language) => {
      const current = view.current
      if (stale || !current) return
      current.dispatch({ effects: kit.current.language.reconfigure(language) })
    })
    return () => {
      stale = true
    }
  }, [path])

  // A new version of the text from the disk: process each one once.
  useEffect(() => {
    const current = view.current
    if (!current || applied.current === version) return
    applied.current = version
    const next = latest.current.text
    session.current.applyDisk(current, next)
    current.dispatch({
      effects: kit.current.indent.reconfigure(
        indentExtension(detectIndent(next)),
      ),
    })
  }, [version])

  // The indentation of the first text.
  useEffect(() => {
    view.current?.dispatch({
      effects: kit.current.indent.reconfigure(
        indentExtension(detectIndent(latest.current.text)),
      ),
    })
  }, [])

  return (
    <div className="h-full min-h-0 bg-editor">
      <div ref={host} className="h-full" />
      <p id={hint} hidden>
        {editorHint}
      </p>
    </div>
  )
}
