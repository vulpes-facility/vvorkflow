import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
  LanguageDescription,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { search, searchKeymap } from '@codemirror/search'
import {
  Compartment,
  EditorState,
  Prec,
  RangeSetBuilder,
  type Extension,
  type StateEffect,
} from '@codemirror/state'
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  ViewPlugin,
  type DecorationSet,
  type KeyBinding,
  type ViewUpdate,
} from '@codemirror/view'
import type { Platform } from '@/shared/lib'
import {
  indentUnitText,
  tabSize,
  withSeparator,
  type Indent,
  type LineSeparator,
} from '../../model/editor-text'
import { editorTheme } from './editor-theme'
import { createSearchPanel } from './search-panel'

/** The parts of an editor that change while it lives, as compartments. */
export interface Kit {
  language: Compartment
  indent: Compartment
  access: Compartment
  scheme: Compartment
  /** The line separator of the state. */
  separator: Compartment
  /** The key bindings, which follow the platform of the app. */
  keys: Compartment
  /** The search, with its panel. */
  search: Compartment
}

/** Makes the compartments of one editor, or of both sides of a diff. */
export function createKit(): Kit {
  return {
    language: new Compartment(),
    indent: new Compartment(),
    access: new Compartment(),
    scheme: new Compartment(),
    separator: new Compartment(),
    keys: new Compartment(),
    search: new Compartment(),
  }
}

const platformField = { macos: 'mac', windows: 'win', linux: 'linux' } as const

/**
 * Makes a keymap for the platform of the app, and not for the platform that
 * CodeMirror detects: `Mod-` becomes Command on macOS and Control on the
 * other platforms. A binding of another platform is left out.
 */
export function platformKeymap(
  bindings: readonly KeyBinding[],
  platform: Platform,
): KeyBinding[] {
  const prefix = platform === 'macos' ? 'Meta-' : 'Ctrl-'
  const result: KeyBinding[] = []
  for (const binding of bindings) {
    const key = binding[platformField[platform]] ?? binding.key
    if (!key) continue
    const copy: KeyBinding = { ...binding, key: key.replaceAll('Mod-', prefix) }
    delete copy.mac
    delete copy.win
    delete copy.linux
    result.push(copy)
  }
  return result
}

/** Whether the color scheme of the document is dark. */
export function isDarkScheme(): boolean {
  return document.documentElement.classList.contains('dark')
}

/** The color scheme of the document, for CodeMirror's `&dark` and `&light` rules. */
export function schemeExtension(): Extension {
  return EditorView.darkTheme.of(isDarkScheme())
}

/** The indentation of the text: the unit of a level, and the width of a tab. */
export function indentExtension(indent: Indent): Extension {
  return [
    indentUnit.of(indentUnitText(indent)),
    EditorState.tabSize.of(tabSize(indent)),
  ]
}

/**
 * The access to the content: whether it is read-only, and its name and
 * description for assistive technology. The content has a tab stop in both
 * cases, so that F6 and the Tab key reach it, also when it is read-only.
 */
export function accessExtension(options: {
  readOnly: boolean
  label: string
  describedBy: string
}): Extension {
  return [
    EditorState.readOnly.of(options.readOnly),
    EditorView.contentAttributes.of({
      'aria-label': options.label,
      'aria-describedby': options.describedBy,
      tabindex: '0',
    }),
  ]
}

/**
 * Loads the language of a file by its name.
 *
 * @returns The language, or an empty extension when no language fits the name or the language does not load.
 */
export async function loadLanguage(path: string): Promise<Extension> {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const description = LanguageDescription.matchFilename(languages, name)
  if (!description) return []
  try {
    return await description.load()
  } catch {
    return []
  }
}

const selectedMark = Decoration.mark({ class: 'cm-vv-selected' })

/**
 * Marks the text of each selected range that shows. A diff has opaque
 * backgrounds on its changed lines, which hide the selection that CodeMirror
 * draws below the lines, so each range, not only the main one, is also a mark
 * on the text, above those backgrounds.
 */
const selectionMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged)
        this.decorations = this.build(update.view)
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>()
      for (const range of view.state.selection.ranges) {
        if (range.empty) continue
        for (const visible of view.visibleRanges) {
          const from = Math.max(range.from, visible.from)
          const to = Math.min(range.to, visible.to)
          if (from < to) builder.add(from, to, selectedMark)
        }
      }
      return builder.finish()
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const activeLineMark = Decoration.line({ class: 'cm-activeLine' })

/**
 * Marks the line of each cursor. A range with text selected marks no line,
 * so that the active line never hides the selection.
 */
const activeLine = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged)
        this.decorations = this.build(update.view)
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>()
      let last = -1
      for (const range of view.state.selection.ranges) {
        if (!range.empty) continue
        const line = view.state.doc.lineAt(range.head)
        if (line.from > last) builder.add(line.from, line.from, activeLineMark)
        last = line.from
      }
      return builder.finish()
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** What the editor calls when the user presses the save key. */
export interface EditorHooks {
  save: (view: EditorView) => boolean
  /** Called on each change of the document. */
  changed: (update: ViewUpdate) => void
}

/** Clicks each collapsed region of a diff that the view shows. */
export function expandUnchanged(view: EditorView): boolean {
  const regions = view.dom.querySelectorAll<HTMLElement>('.cm-collapsedLines')
  regions.forEach((region) => region.click())
  return regions.length > 0
}

/** What differs between the editors that use the kit. */
export interface KitOptions {
  /** The editor is a side of a diff: it has the key that opens the collapsed regions. */
  diff?: boolean
  /** The line separator of the text. The default is LF. */
  separator?: LineSeparator
}

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

/** The key bindings of the platform of the app: save, and the keymaps of CodeMirror. */
function keysExtension(
  platform: Platform,
  hooks: EditorHooks,
  options: KitOptions,
): Extension {
  const save = platform === 'macos' ? 'Meta-s' : 'Ctrl-s'
  return [
    Prec.highest(
      keymap.of([
        {
          key: save,
          preventDefault: true,
          run: (view) => hooks.save(view),
        },
        ...(options.diff
          ? [
              {
                key: platform === 'macos' ? 'Meta-Alt-u' : 'Ctrl-Alt-u',
                preventDefault: true,
                run: expandUnchanged,
              },
            ]
          : []),
      ]),
    ),
    keymap.of(
      platformKeymap(
        [...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab],
        platform,
      ),
    ),
  ]
}

/**
 * The effects that make the keys and the search follow the platform of the
 * app. Dispatch them to each view of the kit when the platform changes: the
 * content, the selection, and the history stay.
 */
export function platformEffects(
  kit: Kit,
  platform: Platform,
  hooks: EditorHooks,
  options: KitOptions = {},
): StateEffect<unknown>[] {
  return [
    kit.keys.reconfigure(keysExtension(platform, hooks, options)),
    kit.search.reconfigure(
      search({ top: true, createPanel: createSearchPanel(platform) }),
    ),
  ]
}

/**
 * The extensions that both the code editor and the diff editor use.
 * Tab indents; Escape then Tab leaves the editor (WCAG 2.2 SC 2.1.2, built
 * into CodeMirror), and F6 is not bound, so that it reaches the window.
 */
export function editorExtensions(
  kit: Kit,
  platform: Platform,
  hooks: EditorHooks,
  options: KitOptions = {},
): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    rectangularSelection(),
    activeLine,
    ...(options.diff ? [selectionMarks] : []),
    kit.search.of(
      search({ top: true, createPanel: createSearchPanel(platform) }),
    ),
    kit.keys.of(keysExtension(platform, hooks, options)),
    kit.separator.of(separatorExtension(options.separator ?? '\n')),
    kit.language.of([]),
    kit.indent.of([]),
    kit.access.of([]),
    kit.scheme.of(schemeExtension()),
    editorTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) hooks.changed(update)
    }),
  ]
}
