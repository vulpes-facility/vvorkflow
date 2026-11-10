import { history, isolateHistory, redo, undo } from '@codemirror/commands'
import {
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search'
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
        search(),
        separator.of(separatorExtension(session.separator)),
        separatorHistory(separator),
      ],
    }),
    dispatch(...specs: (TransactionSpec | Transaction)[]) {
      const transaction =
        specs[0] instanceof Transaction
          ? specs[0]
          : this.state.update(...(specs as TransactionSpec[]), {
              // Each edit is its own event of the history, so that a model can follow it.
              annotations: isolateHistory.of('full'),
            })
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

describe('a search replacement', () => {
  /** Searches and replaces in the editor, with the commands of CodeMirror. */
  function replace(
    editor: ReturnType<typeof makeEditor>,
    options: {
      search: string
      replace: string
      regexp?: boolean
      all?: boolean
    },
  ) {
    editor.view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: options.search,
          replace: options.replace,
          regexp: options.regexp,
          caseSensitive: true,
        }),
      ),
    })
    if (options.all ?? true) replaceAll(editor.editor)
    else {
      // The first command selects the match, and the second replaces it.
      replaceNext(editor.editor)
      replaceNext(editor.editor)
    }
  }

  for (const all of [true, false]) {
    const how = all ? 'replace all' : 'replace'
    it(`gives the line breaks of a CRLF file to a capture over lines (${how})`, () => {
      const editor = makeEditor('a\r\nb')
      replace(editor, { search: '(a\\nb)', replace: '<$1>', regexp: true, all })
      expect(editor.saved()).toBe('<a\r\nb>')
      editor.undo()
      expect(editor.saved()).toBe('a\r\nb')
      editor.redo()
      expect(editor.saved()).toBe('<a\r\nb>')
    })

    it(`gives the line breaks of a CRLF file to an escaped newline (${how})`, () => {
      const editor = makeEditor('a\r\nb\r\n')
      replace(editor, { search: 'b', replace: 'x\\ny', all })
      expect(editor.saved()).toBe('a\r\nx\r\ny\r\n')
      editor.undo()
      expect(editor.saved()).toBe('a\r\nb\r\n')
      editor.redo()
      expect(editor.saved()).toBe('a\r\nx\r\ny\r\n')
    })

    it(`gives one LF break to an escaped CRLF in an LF file (${how})`, () => {
      const editor = makeEditor('a\nb\n')
      replace(editor, { search: 'b', replace: 'x\\r\\ny', all })
      expect(editor.saved()).toBe('a\nx\ny\n')
      editor.undo()
      expect(editor.saved()).toBe('a\nb\n')
      editor.redo()
      expect(editor.saved()).toBe('a\nx\ny\n')
    })

    it(`keeps the lines of a capture over lines in an LF file (${how})`, () => {
      const editor = makeEditor('a\nb\n')
      replace(editor, { search: '(a\\nb)', replace: '$1$1', regexp: true, all })
      expect(editor.saved()).toBe('a\nba\nb\n')
    })
  }

  it('leaves a `\\r` at the end of a line of an LF document, which comes from the disk', () => {
    const editor = makeEditor('a\r\nb\nc')
    replace(editor, { search: 'c', replace: 'd' })
    expect(editor.saved()).toBe('a\r\nb\nd')
    editor.undo()
    expect(editor.saved()).toBe('a\r\nb\nc')
  })

  it('does not change the text that comes from the disk', () => {
    const editor = makeEditor('x')
    editor.session.applyDisk(editor.editor, 'a\r\nb\nc')
    expect(editor.saved()).toBe('a\r\nb\nc')
  })
})

describe('the invariants against a model, in a long random sequence', () => {
  type Separator = '\n' | '\r\n'

  /** The line separator that an editor must use for a text, as a plain rule. */
  function separatorOf(text: string): Separator {
    const allCrlf = /\r\n/.test(text) && !/(?<!\r)\n|\r(?!\n)/.test(text)
    return allCrlf ? '\r\n' : '\n'
  }

  interface Snapshot {
    content: string
    separator: Separator
  }

  /**
   * What the editor must show, as plain strings: the bytes of the content and
   * of the disk text, the separator for a new line break, a stack of undo and
   * redo of its own, and the conflict.
   */
  class Model {
    content: string
    separator: Separator
    disk: string
    conflict = false
    undoStack: Snapshot[] = []
    redoStack: Snapshot[] = []

    constructor(text: string) {
      this.content = text
      this.disk = text
      this.separator = separatorOf(text)
    }

    get dirty() {
      return this.content !== this.disk
    }

    private snapshot(): Snapshot {
      return { content: this.content, separator: this.separator }
    }

    /** A change of the user is one event of the history. */
    edit(content: string, separator = this.separator) {
      this.undoStack.push(this.snapshot())
      this.redoStack = []
      this.content = content
      this.separator = separator
      this.settle()
    }

    /** The conflict ends when the content is equal to the disk text. */
    settle() {
      if (!this.dirty) this.conflict = false
    }

    version(text: string, composing: boolean) {
      const hadEdits = this.dirty || composing
      this.disk = text
      if (!hadEdits) {
        // The new text replaces the content, and the change is not in the history.
        this.content = text
        this.separator = separatorOf(text)
        this.undoStack = []
        this.redoStack = []
      } else if (this.content !== text) this.conflict = true
      this.settle()
    }

    revert() {
      const separator = separatorOf(this.disk)
      if (this.content === this.disk && this.separator === separator) return
      this.edit(this.disk, separator)
    }

    undo() {
      const before = this.undoStack.pop()!
      this.redoStack.push(this.snapshot())
      this.content = before.content
      this.separator = before.separator
      this.settle()
    }

    redo() {
      const after = this.redoStack.pop()!
      this.undoStack.push(this.snapshot())
      this.content = after.content
      this.separator = after.separator
      this.settle()
    }
  }

  // A small seeded generator, so that a failure repeats.
  function random(seed: number) {
    let value = seed
    return () => {
      value = (value * 1664525 + 1013904223) % 2 ** 32
      return value / 2 ** 32
    }
  }

  const diskTexts = [
    'a\nb\nc\n',
    'a\r\nb\r\nc\r\n',
    'a\r\nb\nc\r\nd',
    'a\rb\rc',
    'abc',
    'a\r\nb',
    'ab\nab\n',
    'ab\r\nab\r\n',
    '',
  ]

  // The replacements that the search can make: the spec of the field, and the
  // bytes that it must give, with `SEP` for a line break of the document.
  const replacements: [string, string][] = [
    ['Z', 'Z'],
    ['Q\\nR', 'Q\nR'],
    ['Q\\r\\nR', 'Q\nR'],
  ]

  for (let seed = 1; seed <= 60; seed++) {
    it(`holds on sequence ${seed}`, () => {
      const next = random(seed)
      const pick = <T>(list: readonly T[]) =>
        list[Math.floor(next() * list.length)]
      const first = pick(diskTexts)
      const editor = makeEditor(first)
      const model = new Model(first)
      let composing = false

      const operations = [
        'type',
        'type',
        'type',
        'break',
        'version',
        'version',
        'save-version',
        'revert',
        'undo',
        'redo',
        'replace-all',
        'regexp-all',
        'compose',
      ] as const

      for (let step = 0; step < 50; step++) {
        const operation = pick(operations)
        if (operation === 'type' || operation === 'break') {
          const where = pick(['start', 'end', 'break'] as const)
          const { content } = model
          const at =
            where === 'start'
              ? 0
              : where === 'end'
                ? content.length
                : content.indexOf('\n') + 1 || content.length
          const insert = operation === 'type' ? 'x' : model.separator
          // A position of the document: a line break is one position.
          const from = content
            .slice(0, at)
            .split(model.separator)
            .join('\n').length
          editor.view.dispatch({
            changes: { from, insert },
            userEvent: 'input.type',
          })
          model.edit(content.slice(0, at) + insert + content.slice(at))
        } else if (operation === 'version' || operation === 'save-version') {
          const text = operation === 'version' ? pick(diskTexts) : model.content
          editor.session.applyDisk(editor.editor, text)
          model.version(text, composing)
        } else if (operation === 'revert') {
          editor.session.revert(editor.editor)
          model.revert()
        } else if (operation === 'undo') {
          if (!model.undoStack.length) continue
          expect(editor.undo()).toBe(true)
          model.undo()
        } else if (operation === 'redo') {
          if (!model.redoStack.length) continue
          expect(editor.redo()).toBe(true)
          model.redo()
        } else if (operation === 'replace-all') {
          const [spec, bytes] = pick(replacements)
          const replacement = bytes.replaceAll('\n', model.separator)
          editor.view.dispatch({
            effects: setSearchQuery.of(
              new SearchQuery({
                search: 'a',
                replace: spec,
                caseSensitive: true,
              }),
            ),
          })
          replaceAll(editor.editor)
          if (model.content.includes('a'))
            model.edit(model.content.split('a').join(replacement))
        } else if (operation === 'regexp-all') {
          // A capture over two lines.
          editor.view.dispatch({
            effects: setSearchQuery.of(
              new SearchQuery({
                search: '(a\\nb)',
                replace: '<$1>',
                regexp: true,
                caseSensitive: true,
              }),
            ),
          })
          replaceAll(editor.editor)
          const found = `a${model.separator}b`
          if (model.content.includes(found))
            model.edit(model.content.split(found).join(`<${found}>`))
        } else {
          composing = !composing
          editor.view.compositionStarted = composing
        }

        const label = `step ${step} ${operation}`
        // (a) The bytes that the editor gives are the bytes of the model.
        expect(editor.saved(), label).toBe(model.content)
        expect(editor.view.state.lineBreak, label).toBe(model.separator)
        expect(editor.session.disk, label).toBe(model.disk)
        // (b) Dirty and conflict follow only the content and the disk text.
        const heard = editor.heard()
        expect(heard.dirty ?? 'dirty:false', label).toBe(`dirty:${model.dirty}`)
        expect(heard.conflict ?? 'conflict:false', label).toBe(
          `conflict:${model.conflict}`,
        )
      }
    })
  }
})
