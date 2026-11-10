import { isolateHistory } from '@codemirror/commands'
import { Text, Transaction, type EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  changedSpan,
  detectLineSeparator,
  documentForm,
  type LineSeparator,
} from '../../model/editor-text.ts'
import { changeSeparator, fromDisk } from './editor-separator.ts'

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
 * - The document keeps the line breaks of the text, and a lone `\r` of a mixed text is a character of its line. So `state.sliceDoc()` is the text, byte for byte.
 * - The line separator of the state belongs to the document that the user edits. A text sets it only when it replaces the content: the first text (LF when the text has no line break), a clean text that differs, and a revert. A text that has no line break shows no separator, and the state keeps its own. A text that is only compared with the content, because it is equal to it, changes neither the document, nor the separator, nor the history.
 * - The content is dirty when it differs from the text.
 * - A new text from the disk replaces the content only while the content has no unsaved edits and no open composition. Otherwise the editor keeps the edits, takes the new text as the text of the disk, and tells the owner about the conflict until the content is equal to the text again, or the owner reverts.
 */
export class TextSession {
  /** The callbacks of the owner. Replace them at any time. */
  callbacks: TextCallbacks = {}
  /** The last text of the disk, as the owner gave it. */
  disk = ''
  /** The line separator for the first document: the one that the first text shows, or LF. */
  separator: LineSeparator = '\n'
  /**
   * Clears the undo history of the view. The owner of the session sets it,
   * because the history belongs to the extensions of the editor.
   */
  resetHistory: (view: EditorView) => void = () => {}
  private dirty = false
  private conflict = false
  /** The conflict that the owner knows. */
  private told = false

  /** Takes the first text. It tells the owner nothing. */
  init(text: string) {
    this.disk = text
    this.separator = detectLineSeparator(text) ?? '\n'
    this.dirty = false
    this.conflict = false
    this.told = false
  }

  /** The document of the first text, for a new state. */
  document(): Text {
    return Text.of(documentForm(this.disk, this.separator).split('\n'))
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
    const equal = view.state.sliceDoc() === text
    this.disk = text
    // A text that equals the content is only compared: the document, its
    // separator, and the history stay, whatever separator the text shows.
    // A conflict, if there is one, ends in `check`.
    if (!equal) {
      if (hadEdits) this.conflict = true
      // A text that replaced the content has no use for the history of the old one.
      else if (this.replaceContent(view, false)) this.resetHistory(view)
    }
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

  /**
   * Puts the text of the disk in the document, with the separator that the
   * text shows, or the one of the state when the text shows none.
   *
   * @returns Whether the content or its separator changed.
   */
  private replaceContent(view: EditorView, history: boolean): boolean {
    const separator: LineSeparator =
      detectLineSeparator(this.disk) ?? (view.state.lineBreak as LineSeparator)
    const effects =
      view.state.lineBreak === separator ? [] : [changeSeparator.of(separator)]
    const span = changedSpan(
      view.state.doc.toString(),
      documentForm(this.disk, separator),
    )
    // The separator of the old state would split a string, so give a Text.
    const changes = span && {
      from: span.from,
      to: span.to,
      insert: Text.of(span.insert.split('\n')),
    }
    if (!changes && !effects.length) return false
    view.dispatch({
      changes,
      effects,
      annotations: history
        ? [isolateHistory.of('full'), fromDisk.of(true)]
        : [external, fromDisk.of(true)],
    })
    return true
  }
}
