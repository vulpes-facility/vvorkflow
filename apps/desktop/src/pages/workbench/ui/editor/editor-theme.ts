import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Prec, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

const hitArea = 'var(--vv-row-h)'

/**
 * The look of the editor, from the semantic variables of the tokens. It reads
 * CSS variables only, so the color scheme changes it with no rebuild.
 */
const base = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--foreground)',
    backgroundColor: 'var(--editor)',
    fontSize: 'var(--vv-editor-font-size)',
  },
  // The keyboard focus: an inset ring of the opaque ring color.
  '&.cm-focused': {
    outline: 'var(--vv-focus-w) solid var(--ring)',
    outlineOffset: 'calc(var(--vv-focus-w) * -1)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--vv-font-mono)',
    lineHeight: 'var(--vv-editor-line-height)',
  },
  '.cm-content': {
    caretColor: 'var(--foreground)',
    padding: 'var(--vv-space-1) 0',
  },
  '.cm-line': { padding: '0 var(--vv-space-3) 0 var(--vv-space-2)' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--foreground)',
    borderLeftWidth: 'var(--vv-focus-w)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--editor)',
    color: 'var(--muted-foreground)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '3ch',
    padding: '0 var(--vv-space-2) 0 var(--vv-space-3)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
  },
  '.cm-activeLine:not(.cm-changedLine, .cm-inlineChangedLine)': {
    backgroundColor: 'var(--editor-active-line)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--editor-selection) !important',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--editor-selection)',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'transparent',
    outline: 'var(--vv-hairline-w) solid var(--subtle-foreground)',
    outlineOffset: 'calc(var(--vv-hairline-w) * -1)',
    fontWeight: '700',
  },
  '.cm-nonmatchingBracket': {
    color: 'var(--destructive)',
    textDecoration: 'underline wavy',
  },
  '.cm-specialChar': { color: 'var(--muted-foreground)' },

  // Search: a match has a fill and an outline, and the current match has a
  // heavier outline, so that color is not the only sign.
  '.cm-searchMatch': {
    backgroundColor: 'var(--editor-match)',
    outline: 'var(--vv-hairline-w) solid var(--subtle-foreground)',
    outlineOffset: 'calc(var(--vv-hairline-w) * -1)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--editor-match-current)',
    outline: 'var(--vv-focus-w) solid var(--ring)',
    outlineOffset: 'calc(var(--vv-hairline-w) * -1)',
    fontWeight: '700',
  },
  '.cm-panels': {
    backgroundColor: 'var(--chrome)',
    color: 'var(--chrome-foreground)',
  },
  '.cm-panels-top': {
    borderBottom: 'var(--vv-hairline-w) solid var(--hairline)',
  },
  '.cm-panel.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--vv-space-1)',
    padding:
      'var(--vv-space-1) var(--vv-space-9) var(--vv-space-1) var(--vv-space-2)',
    fontFamily: 'var(--vv-font-sans)',
    fontSize: 'var(--vv-text-ui)',
    '& br': { display: 'none' },
    '& input, & button, & label': { margin: '0' },
    '& label': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--vv-space-1)',
      minHeight: hitArea,
      fontSize: 'var(--vv-text-ui)',
      whiteSpace: 'nowrap',
    },
  },
  '.cm-panel.cm-search .cm-textfield': {
    boxSizing: 'border-box',
    minWidth: '0',
    width: 'var(--vv-editor-search-field-w)',
    maxWidth: '100%',
    height: hitArea,
    padding: '0 var(--vv-space-1h)',
    color: 'var(--foreground)',
    backgroundColor: 'var(--editor)',
    border: 'var(--vv-hairline-w) solid var(--input)',
    borderRadius: 'var(--radius-md)',
    font: 'inherit',
  },
  '.cm-panel.cm-search .cm-button': {
    boxSizing: 'border-box',
    minWidth: hitArea,
    height: hitArea,
    padding: '0 var(--vv-space-2)',
    color: 'var(--secondary-foreground)',
    backgroundColor: 'var(--secondary)',
    backgroundImage: 'none',
    border: 'var(--vv-hairline-w) solid var(--input)',
    borderRadius: 'var(--radius-md)',
    font: 'inherit',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search .cm-button:hover': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-foreground)',
  },
  '.cm-panel.cm-search [name=close]': {
    position: 'absolute',
    top: 'var(--vv-space-1)',
    right: 'var(--vv-space-1h)',
    width: hitArea,
    minWidth: hitArea,
    height: hitArea,
    padding: '0',
    color: 'var(--chrome-foreground)',
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: 'var(--vv-text-lg)',
    lineHeight: '1',
  },
  '.cm-panel.cm-search [name=close]:hover': {
    backgroundColor: 'var(--hover)',
  },
  '.cm-panel.cm-search input[type=checkbox]': {
    appearance: 'none',
    boxSizing: 'border-box',
    display: 'inline-grid',
    placeContent: 'center',
    width: hitArea,
    height: hitArea,
    border: 'var(--vv-hairline-w) solid var(--input)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--editor)',
    color: 'var(--foreground)',
  },
  // A checked box shows a check mark, a shape, and not only a fill.
  '.cm-panel.cm-search input[type=checkbox]:checked::after': {
    content: '"✓"',
    fontSize: 'var(--vv-text-sm)',
    fontWeight: '700',
  },
  '.cm-panel.cm-search input[type=checkbox]:checked': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-panel.cm-search :focus-visible': {
    outline: 'var(--vv-focus-w) solid var(--ring)',
    outlineOffset: 'var(--vv-hairline-w)',
  },

  // The diff: tinted lines with a mark in the gutter, and the text that changed.
  '&.cm-merge-b .cm-changedLine, &.cm-merge-b .cm-inlineChangedLine': {
    backgroundColor: 'var(--editor-inserted)',
  },
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
    backgroundColor: 'var(--editor-deleted)',
  },
  '&.cm-merge-b .cm-changedText, &.cm-merge-b .cm-inlineChangedText': {
    background: 'var(--editor-inserted-text)',
  },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText':
    {
      background: 'var(--editor-deleted-text)',
      textDecoration: 'line-through',
    },
  // A removed line has a strike, so that the lines of a removed block, which share one mark, are not told by color alone.
  '.cm-deletedChunk .cm-deletedLine': { textDecoration: 'line-through' },
  '.cm-deletedChunk': { paddingLeft: 'var(--vv-space-2)' },
  '.cm-changeGutter': {
    width: 'auto',
    minWidth: '2ch',
    padding: '0 var(--vv-space-1) 0 var(--vv-space-2)',
  },
  '.cm-changeGutter .cm-gutterElement': {
    textAlign: 'center',
    fontWeight: '700',
  },
  '&.cm-merge-b .cm-changedLineGutter, .cm-inlineChangedLineGutter': {
    background: 'transparent',
    color: 'var(--git-added)',
  },
  '&.cm-merge-b .cm-changedLineGutter::before, .cm-inlineChangedLineGutter::before':
    { content: '"+"' },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
    background: 'transparent',
    color: 'var(--git-deleted)',
  },
  '&.cm-merge-a .cm-changedLineGutter::before, .cm-deletedLineGutter::before': {
    content: '"−"',
  },
  '.cm-collapsedLines': {
    background: 'var(--hover)',
    color: 'var(--muted-foreground)',
    padding: 'var(--vv-focus-w) var(--vv-space-3)',
    fontFamily: 'var(--vv-font-sans)',
    fontSize: 'var(--vv-text-ui)',
    lineHeight: 'var(--vv-leading-ui)',
  },
  '.cm-collapsedLines:hover': { color: 'var(--foreground)' },
  '.cm-mergeView': { height: '100%' },
  '.cm-mergeViewEditors': { minHeight: '100%' },
  '.cm-mergeViewEditor + .cm-mergeViewEditor': {
    borderLeft: 'var(--vv-hairline-w) solid var(--hairline)',
  },
})

/**
 * The native selection shows above the opaque lines of a diff, which hide
 * the selection layer. It has the same color as the layer, so that the two
 * look like one.
 */
const nativeSelection = Prec.highest(
  EditorView.theme({
    // More specific than the rule of CodeMirror that hides the native selection.
    '&.cm-editor .cm-line': {
      '& ::selection, &::selection': {
        backgroundColor: 'var(--editor-selection) !important',
      },
    },
  }),
)

const highlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.modifier,
      tags.self,
      tags.tagName,
    ],
    color: 'var(--syntax-keyword)',
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.monospace],
    color: 'var(--syntax-string)',
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom, tags.unit],
    color: 'var(--syntax-number)',
  },
  {
    tag: [tags.comment, tags.meta, tags.quote],
    color: 'var(--syntax-comment)',
    fontStyle: 'italic',
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.function(tags.variableName)),
      tags.attributeName,
    ],
    color: 'var(--syntax-function)',
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.labelName],
    color: 'var(--syntax-type)',
  },
  { tag: tags.heading, color: 'var(--syntax-keyword)', fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  {
    tag: [tags.link, tags.url],
    color: 'var(--syntax-keyword)',
    textDecoration: 'underline',
  },
  {
    tag: tags.invalid,
    color: 'var(--destructive)',
    textDecoration: 'underline wavy',
  },
])

/** The theme and the syntax colors of the editor. */
export const editorTheme: Extension = [
  base,
  nativeSelection,
  syntaxHighlighting(highlightStyle),
]
