import { isolateHistory } from '@codemirror/commands'
import { Text, Transaction, type EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  changedSpan,
  detectLineSeparator,
  documentForm,
  type LineSeparator,
} from '../../model/editor-text.ts'
import { changeSeparator } from './editor-separator.ts'

/** What the owner of an editor hears about its text. */
export interface TextCallbacks {
  onDirtyChange?: (dirty: boolean) => void
  onConflictChange?: (conflict: boolean) => void
  onSave?: (text: string) => void
}

/** A change that comes from the disk, and not from the user, is not in the undo history. */
const external = Transaction.addToHistory.of(false)

/**
 * The text that an editor was given, and how the content differs from it.
 *
 * - The document keeps the line breaks of the text: `separator` is the line separator of the state, and a lone `\r` of a mixed text is a character of its line. So `state.sliceDoc()` is the text, byte for byte.
 * - The content is dirty when it differs from the text.
 * - A new text from the disk replaces the content only while the content has no unsaved edits and no open composition. Otherwise the editor keeps the edits, takes the new text as the text of the disk, and tells the owner about the conflict until the content is equal to the text again, or the owner reverts.
 */
export class TextSession {
  /** The callbacks of the owner. Replace them at any time. */
  callbacks: TextCallbacks = {}
  /** The last text of the disk, as the owner gave it. */
  disk = ''
  /** The last text of the disk, in the form of the document. */
  baseline = ''
  /** The line separator of the last text of the disk. */
  separator: LineSeparator = '\n'
  private dirty = false
  private conflict = false
  /** The conflict that the owner knows. */
  private told = false

  /** Takes the first text. It tells the owner nothing. */
  init(text: string) {
    this.take(text)
    this.dirty = false
    this.conflict = false
    this.told = false
  }

  private take(text: string) {
    this.disk = text
    this.separator = detectLineSeparator(text)
    this.baseline = documentForm(text, this.separator)
  }

  /** The document of the text, for a new state. */
  document(): Text {
    return Text.of(this.baseline.split('\n'))
  }

  /**
   * Whether the content, as `save` gives it, differs from the bytes of the
   * disk text. Dirty and conflict are decided on these two strings only, and
   * never on the form of the document or on the separator.
   */
  private differs(state: EditorState): boolean {
    const { doc, lineBreak } = state
    // The length of the saved text, with no string built.
    const length = doc.length + (doc.lines - 1) * (lineBreak.length - 1)
    return length !== this.disk.length || state.sliceDoc() !== this.disk
  }

  /** Tells the owner when the dirty state or the conflict changes. */
  check(view: EditorView) {
    const dirty = this.differs(view.state)
    if (dirty !== this.dirty) {
      this.dirty = dirty
      this.callbacks.onDirtyChange?.(dirty)
    }
    // The conflict ends when the content is equal to the text again.
    if (!dirty) this.conflict = false
    if (this.conflict !== this.told) {
      this.told = this.conflict
      this.callbacks.onConflictChange?.(this.conflict)
    }
  }

  /**
   * Gives the content to the owner, byte for byte with the line breaks of
   * the text. It does nothing while a composition is open, because the
   * composed text is not in the document yet.
   *
   * @returns Whether the key was used.
   */
  save(view: EditorView): boolean {
    if (!this.callbacks.onSave) return false
    if (view.compositionStarted) return true
    this.callbacks.onSave(view.state.sliceDoc())
    return true
  }

  /**
   * Takes a new text from the disk.
   * With no unsaved edits and no composition, the content is the old text, so
   * the editor replaces the document, and its separator, with the new text.
   * It changes only the span that differs, so the cursor and the scroll
   * position stay where they can, and the change is not in the undo history.
   * With unsaved edits or a composition, it keeps the document and its
   * separator, so that the bytes that the user typed never change, and tells
   * the owner about the conflict when the content differs from the new text.
   */
  applyDisk(view: EditorView, text: string) {
    const hadEdits =
      view.state.sliceDoc() !== this.disk || view.compositionStarted
    this.take(text)
    if (!hadEdits) this.replaceContent(view, false)
    else if (view.state.sliceDoc() !== text) this.conflict = true
    this.check(view)
  }

  /**
   * Replaces the content with the last text of the disk, and ends the
   * conflict. The change, with the change of the separator, is one event of
   * the undo history, apart from the typing before it.
   */
  revert(view: EditorView) {
    this.replaceContent(view, true)
    this.check(view)
  }

  private replaceContent(view: EditorView, history: boolean) {
    const effects =
      view.state.lineBreak === this.separator
        ? []
        : [changeSeparator.of(this.separator)]
    const span = changedSpan(view.state.doc.toString(), this.baseline)
    // The separator of the old state would split a string, so give a Text.
    const changes = span && {
      from: span.from,
      to: span.to,
      insert: Text.of(span.insert.split('\n')),
    }
    if (changes || effects.length)
      view.dispatch({
        changes,
        effects,
        annotations: history ? [isolateHistory.of('full')] : [external],
      })
  }
}
