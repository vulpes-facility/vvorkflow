import { Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  applyLineEnding,
  changedSpan,
  detectLineEnding,
  normalizeLineEndings,
  type LineEnding,
} from '../../model/editor-text'

/** What the owner of an editor hears about its text. */
export interface TextCallbacks {
  onDirtyChange?: (dirty: boolean) => void
  onSave?: (text: string) => void
}

/**
 * The text that an editor was given, and what differs from it: the line
 * ending to give back, and whether the content differs from the given text.
 * CodeMirror keeps LF only, so the session compares with the normalized text.
 */
export class TextSession {
  /** The callbacks of the owner. Replace them at any time. */
  callbacks: TextCallbacks = {}
  /** The line ending of the given text. */
  ending: LineEnding = '\n'
  /** The given text, with LF line endings. */
  baseline = ''
  private dirty = false

  /** Takes a new given text. It does not tell the owner about the dirty state. */
  reset(text: string) {
    this.ending = detectLineEnding(text)
    this.baseline = normalizeLineEndings(text)
  }

  /** Tells the owner when the content starts to differ from the text, and when it is equal again. */
  check(view: EditorView) {
    const { doc } = view.state
    const dirty =
      doc.length !== this.baseline.length || doc.toString() !== this.baseline
    if (dirty === this.dirty) return
    this.dirty = dirty
    this.callbacks.onDirtyChange?.(dirty)
  }

  /** Gives the content to the owner, with the line ending of the given text. */
  save(view: EditorView): boolean {
    if (!this.callbacks.onSave) return false
    this.callbacks.onSave(
      applyLineEnding(view.state.doc.toString(), this.ending),
    )
    return true
  }

  /**
   * Replaces the content with a new given text. Only the span that differs
   * changes, so the cursor and the scroll position stay where they can, and
   * the undo history does not get the change.
   */
  replace(view: EditorView, text: string) {
    this.reset(text)
    const span = changedSpan(view.state.doc.toString(), this.baseline)
    if (span) view.dispatch({ changes: span, annotations: external })
    else this.check(view)
  }
}

const external = Transaction.addToHistory.of(false)
