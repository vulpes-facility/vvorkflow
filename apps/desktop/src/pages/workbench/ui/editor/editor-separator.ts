import { invertedEffects, isolateHistory } from '@codemirror/commands'
import {
  Annotation,
  ChangeSet,
  EditorState,
  StateEffect,
  Text,
  Transaction,
  type AnnotationType,
  type Compartment,
  type Extension,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { withSeparator, type LineSeparator } from '../../model/editor-text.ts'

/**
 * An effect that changes the line separator of the state. The kit turns it
 * into a change of the separator compartment, and the undo history keeps
 * its inverse, so that an undo of a revert brings back the line breaks with
 * the text.
 */
export const changeSeparator = StateEffect.define<LineSeparator>()

/**
 * The line separator of the state, and the paste: a pasted text gets the
 * line breaks of the document, so that a pasted `\n` does not stay inside a
 * line of a CRLF file, and a pasted `\r` is not a character of an LF file.
 */
export function separatorExtension(separator: LineSeparator): Extension {
  return [
    EditorState.lineSeparator.of(separator),
    EditorView.clipboardInputFilter.of((text, state) =>
      withSeparator(text, state.lineBreak as LineSeparator),
    ),
  ]
}

/**
 * Marks a transaction that carries the text of the disk. Its text is the
 * text as the disk has it, so it can have a `\r` in a line of an LF
 * document, and the guard of the separator lets it through.
 */
export const fromDisk = Annotation.define<boolean>()

/**
 * Whether a text that a transaction inserts has a line break inside a line:
 * a `\r` or a `\n`. It is a rule of a CRLF document only: there, a line never
 * holds either of them.
 */
function hasForeignBreak(text: Text): boolean {
  return text.toJSON().some((line) => /[\r\n]/.test(line))
}

/** The same text, with a real line for each line break that is in it. */
function splitBreaks(text: Text): Text {
  return Text.of(text.toString().replace(/\r\n?/g, '\n').split('\n'))
}

/** The annotations that the guard keeps when it makes a transaction again. */
const kept: AnnotationType<unknown>[] = [
  Transaction.userEvent,
  Transaction.addToHistory,
  Transaction.remote,
  isolateHistory,
]

/**
 * A guard on the transactions of a document with the CRLF separator, which is
 * a file with only CRLF line breaks. A line of such a document never holds a
 * `\r` or a `\n`. A command such as replace gives text with the line breaks of
 * the search, which are LF, so a `\n` would stay inside a line, and the save
 * would not have the CRLF. The guard turns each `\r\n` pair, each lone `\n`, and
 * each lone `\r` of the inserted text into one line break of the document.\
 * In a document with the `\n` separator, which is an LF file or a mixed file,
 * a `\r` is an ordinary character, so the guard does nothing: the text that a
 * command moves or copies keeps its bytes, and an escaped `\r\n` in a
 * replacement gives the bytes that the user wrote.\
 * It also leaves alone the text of the disk (`fromDisk`), which can have a `\r`
 * in a line while the old state is still CRLF, and the text that an undo or a
 * redo puts back, which is a text that the document had.
 */
function separatorGuard(): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    if (
      !transaction.docChanged ||
      transaction.annotation(fromDisk) ||
      transaction.isUserEvent('undo') ||
      transaction.isUserEvent('redo') ||
      transaction.startState.lineBreak !== '\r\n'
    )
      return transaction
    // The fixes are in the coordinates of the document after the transaction.
    const fixes: { from: number; to: number; insert: Text }[] = []
    transaction.changes.iterChanges((_a, _b, from, to, inserted) => {
      if (hasForeignBreak(inserted))
        fixes.push({ from, to, insert: splitBreaks(inserted) })
    })
    if (!fixes.length) return transaction
    const fix = ChangeSet.of(fixes, transaction.newDoc.length)
    return [
      {
        changes: transaction.changes.compose(fix),
        selection: transaction.selection?.map(fix),
        effects: transaction.effects,
        scrollIntoView: transaction.scrollIntoView,
        annotations: kept.flatMap((type) => {
          const value = transaction.annotation(type)
          return value === undefined ? [] : [type.of(value)]
        }),
      },
    ]
  })
}

/**
 * Turns {@link changeSeparator} into a change of the compartment of the
 * separator, and keeps its inverse in the undo history.
 *
 * @param separator The compartment that holds the separator of the state.
 */
export function separatorHistory(separator: Compartment): Extension {
  return [
    separatorGuard(),
    EditorState.transactionExtender.of((transaction) => {
      const change = transaction.effects.find((effect) =>
        effect.is(changeSeparator),
      )
      return change
        ? { effects: separator.reconfigure(separatorExtension(change.value)) }
        : null
    }),
    invertedEffects.of((transaction) =>
      transaction.effects.flatMap((effect) =>
        effect.is(changeSeparator) &&
        effect.value !== transaction.startState.lineBreak
          ? [
              changeSeparator.of(
                transaction.startState.lineBreak as LineSeparator,
              ),
            ]
          : [],
      ),
    ),
  ]
}
