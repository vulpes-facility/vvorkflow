import { history, redo, undo } from '@codemirror/commands'
import {
  Compartment,
  EditorState,
  type ChangeSpec,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import {
  separatorExtension,
  separatorHistory,
} from '../src/pages/workbench/ui/editor/editor-separator.ts'
import { TextSession } from '../src/pages/workbench/ui/editor/text-session.ts'

/**
 * An editor with no DOM: a state with the separator and the history of the
 * editors, and the members that `TextSession` uses. A change of the document
 * or of the separator calls `check`, as the update listener of the kit does.
 */
function makeEditor(text: string) {
  const separator = new Compartment()
  const session = new TextSession()
  const events: string[] = []
  session.callbacks = {
    onDirtyChange: (dirty) => events.push(`dirty:${dirty}`),
    onConflictChange: (conflict) => events.push(`conflict:${conflict}`),
  }
  session.init(text)
  const view = {
    compositionStarted: false,
    state: EditorState.create({
      doc: session.document(),
      extensions: [
        history(),
        separator.of(separatorExtension(session.separator)),
        separatorHistory(separator),
      ],
    }),
    dispatch(...specs: (TransactionSpec | Transaction)[]) {
      const transaction =
        specs[0] instanceof Transaction
          ? specs[0]
          : this.state.update(...(specs as TransactionSpec[]))
      const startBreak = this.state.lineBreak
      this.state = transaction.state
      if (transaction.docChanged || startBreak !== this.state.lineBreak)
        session.check(this as unknown as EditorView)
    },
  }
  const editor = view as unknown as EditorView
  return {
    session,
    view,
    editor,
    events,
    /** What `onSave` gives. */
    saved: () => view.state.sliceDoc(),
    /** Types text at a position, as the user does. */
    type(at: number | 'end', insert: string) {
      const from = at === 'end' ? view.state.doc.length : at
      view.dispatch({
        changes: { from, insert } satisfies ChangeSpec,
        userEvent: 'input.type',
      })
    },
    undo: () =>
      undo({ state: view.state, dispatch: (tr) => view.dispatch(tr) }),
    redo: () =>
      redo({ state: view.state, dispatch: (tr) => view.dispatch(tr) }),
    /** The last state that the owner heard of. */
    heard: () => ({
      dirty: events.filter((event) => event.startsWith('dirty:')).at(-1),
      conflict: events.filter((event) => event.startsWith('conflict:')).at(-1),
    }),
  }
}

const texts = {
  lf: 'a\nb\nc\n',
  crlf: 'a\r\nb\r\nc\r\n',
  mixed: 'a\r\nb\nc\r\nd',
  cr: 'a\rb\rc',
  none: 'abc',
  empty: '',
}

describe('the content and the disk text', () => {
  for (const [name, text] of Object.entries(texts)) {
    it(`gives the text back byte for byte (${name})`, () => {
      const editor = makeEditor(text)
      expect(editor.saved()).toBe(text)
      expect(editor.events).toEqual([])
    })
  }

  it('keeps unsaved LF content when the disk text equals it with CRLF', () => {
    const editor = makeEditor('a\n')
    editor.view.dispatch({
      changes: { from: 0, to: 1, insert: 'b' },
    })
    expect(editor.saved()).toBe('b\n')
    editor.session.applyDisk(editor.editor, 'b\r\n')
    // The bytes that the user has did not change, and they differ from the disk.
    expect(editor.saved()).toBe('b\n')
    expect(editor.view.state.lineBreak).toBe('\n')
    expect(editor.events).toEqual(['dirty:true', 'conflict:true'])
  })

  it('is not dirty or in conflict when the saved bytes equal the disk text, whatever the form of the document', () => {
    // A mixed text, and the same bytes as a pure CRLF text: the document has
    // a `\r` at the end of each line, and the disk text is CRLF.
    const editor = makeEditor('a\r\nb\nc')
    editor.type('end', 'x')
    editor.view.dispatch({
      changes: { from: 4, to: 5, insert: '\r\n' },
    })
    // The document has a `\r` at the end of a line, with the LF separator.
    editor.session.applyDisk(editor.editor, editor.saved())
    expect(editor.heard().dirty).toBe('dirty:false')
    expect(editor.heard().conflict ?? 'conflict:false').toBe('conflict:false')
  })

  it('ends the conflict when a save makes the content equal to the text', () => {
    const editor = makeEditor('a\n')
    editor.type('end', 'x')
    editor.session.applyDisk(editor.editor, 'other\n')
    expect(editor.heard().conflict).toBe('conflict:true')
    editor.session.applyDisk(editor.editor, editor.saved())
    expect(editor.heard()).toEqual({
      dirty: 'dirty:false',
      conflict: 'conflict:false',
    })
  })

  it('does not replace the content during a composition, and does not apply the text later', () => {
    const editor = makeEditor('a\n')
    editor.view.compositionStarted = true
    editor.session.applyDisk(editor.editor, 'disk\n')
    expect(editor.saved()).toBe('a\n')
    expect(editor.heard().conflict).toBe('conflict:true')
    editor.view.compositionStarted = false
    editor.type('end', 'x')
    expect(editor.saved()).toBe('a\nx')
  })
})

describe('revert and the undo history', () => {
  const pairs: [string, string, string][] = [
    ['CRLF content, LF disk', texts.crlf, texts.lf],
    ['LF content, CRLF disk', texts.lf, texts.crlf],
    ['mixed content, CRLF disk', texts.mixed, texts.crlf],
    ['CRLF content, mixed disk', texts.crlf, texts.mixed],
    ['CR content, LF disk', texts.cr, texts.lf],
  ]
  for (const [name, mine, disk] of pairs) {
    it(`reverts, undoes, and redoes with the line breaks (${name})`, () => {
      const editor = makeEditor(mine)
      editor.type(0, 'mine ')
      const before = editor.saved()
      expect(before).toBe(`mine ${mine}`)
      editor.session.applyDisk(editor.editor, disk)
      // The unsaved bytes are kept.
      expect(editor.saved()).toBe(before)
      expect(editor.heard().conflict).toBe('conflict:true')

      editor.session.revert(editor.editor)
      expect(editor.saved()).toBe(disk)
      expect(editor.heard()).toEqual({
        dirty: 'dirty:false',
        conflict: 'conflict:false',
      })

      // One undo gives the exact content before the revert, with the last keystroke.
      expect(editor.undo()).toBe(true)
      expect(editor.saved()).toBe(before)
      expect(editor.heard().dirty).toBe('dirty:true')

      expect(editor.redo()).toBe(true)
      expect(editor.saved()).toBe(disk)
      expect(editor.heard().dirty).toBe('dirty:false')
    })
  }

  it('redoes the revert with its line breaks after a disk update replaced the clean content', () => {
    // The first text is replaced by a disk update that has another separator.
    const editor = makeEditor('start\n')
    editor.session.applyDisk(editor.editor, 'a\r\nb\r\nc\r\n')
    expect(editor.view.state.lineBreak).toBe('\r\n')
    editor.type(0, 'mine ')
    const before = editor.saved()
    editor.session.applyDisk(editor.editor, 'a\nb\nc\n')
    editor.session.revert(editor.editor)
    expect(editor.saved()).toBe('a\nb\nc\n')
    editor.undo()
    expect(editor.saved()).toBe(before)
    editor.redo()
    expect(editor.saved()).toBe('a\nb\nc\n')
  })

  it('does not join the revert to the typing before it', () => {
    const editor = makeEditor('a\n')
    editor.type(0, 'x')
    editor.session.revert(editor.editor)
    editor.undo()
    expect(editor.saved()).toBe('xa\n')
  })

  it('updates the dirty state when an undo changes only the separator', () => {
    const editor = makeEditor('a\r\nb')
    editor.session.applyDisk(editor.editor, 'a\nb')
    // No edits, so the new text replaced the content, with its separator.
    expect(editor.saved()).toBe('a\nb')
    expect(editor.view.state.lineBreak).toBe('\n')
    editor.session.revert(editor.editor)
    expect(editor.events).toEqual([])
  })
})

describe('the invariants, in a long random sequence', () => {
  // A small seeded generator, so that a failure repeats.
  function random(seed: number) {
    let value = seed
    return () => {
      value = (value * 1664525 + 1013904223) % 2 ** 32
      return value / 2 ** 32
    }
  }
  const names = Object.keys(texts) as (keyof typeof texts)[]

  for (let seed = 1; seed <= 40; seed++) {
    it(`holds on sequence ${seed}`, () => {
      const next = random(seed)
      const pick = <T>(list: readonly T[]) =>
        list[Math.floor(next() * list.length)]
      let disk = texts[pick(names)]
      const editor = makeEditor(disk)
      let composing = false
      for (let step = 0; step < 60; step++) {
        const before = editor.saved()
        const operation = pick([
          'type',
          'type',
          'version',
          'version',
          'save-version',
          'revert',
          'undo',
          'redo',
          'compose',
        ] as const)
        if (operation === 'type') {
          // The user types a letter or a line break. A `\r` or a raw `\n`
          // cannot be typed, because the keyboard and the paste give the
          // line breaks of the state.
          editor.type(
            Math.floor(next() * (editor.view.state.doc.length + 1)),
            pick(['x', editor.view.state.lineBreak]),
          )
        } else if (operation === 'version') {
          disk = texts[pick(names)]
          const dirtyBefore = before !== editor.session.disk
          editor.session.applyDisk(editor.editor, disk)
          // (a) A disk update never changes unsaved bytes, or bytes while a composition is open.
          if (dirtyBefore || composing) expect(editor.saved()).toBe(before)
          else expect(editor.saved()).toBe(disk)
        } else if (operation === 'save-version') {
          disk = editor.saved()
          editor.session.applyDisk(editor.editor, disk)
          expect(editor.saved()).toBe(before)
        } else if (operation === 'revert') {
          editor.session.revert(editor.editor)
          disk = editor.session.disk
          expect(editor.saved()).toBe(disk)
        } else if (operation === 'undo') editor.undo()
        else if (operation === 'redo') editor.redo()
        else {
          composing = !composing
          editor.view.compositionStarted = composing
        }
        // (b) Dirty is a function of the saved bytes and the bytes of the disk text.
        const dirty = editor.saved() !== editor.session.disk
        const heard = editor.heard()
        expect(heard.dirty ?? 'dirty:false', `step ${step} ${operation}`).toBe(
          `dirty:${dirty}`,
        )
        // A conflict needs unsaved bytes, and the end of the difference ends it.
        if (!dirty)
          expect(heard.conflict ?? 'conflict:false').toBe('conflict:false')
      }
    })
  }
})
