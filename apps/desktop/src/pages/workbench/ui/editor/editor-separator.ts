import { invertedEffects } from '@codemirror/commands'
import {
  EditorState,
  StateEffect,
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
 * Turns {@link changeSeparator} into a change of the compartment of the
 * separator, and keeps its inverse in the undo history.
 *
 * @param separator The compartment that holds the separator of the state.
 */
export function separatorHistory(separator: Compartment): Extension {
  return [
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
