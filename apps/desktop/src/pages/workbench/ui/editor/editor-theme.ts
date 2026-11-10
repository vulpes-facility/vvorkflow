import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

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
    minWidth: 'var(--vv-editor-gutter-min-w)',
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
  // The selection of a diff is also a mark on the text, which the opaque
  // changed lines and changed text do not hide, in either nesting order.
  '.cm-vv-selected, .cm-vv-selected .cm-changedText, .cm-changedText .cm-vv-selected, .cm-vv-selected .cm-deletedText, .cm-deletedText .cm-vv-selected':
    { background: 'var(--editor-selection)' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'transparent',
    outline: 'var(--vv-hairline-w) solid var(--subtle-foreground)',
    outlineOffset: 'calc(var(--vv-hairline-w) * -1)',
    fontWeight: '700',
  },
  '.cm-nonmatchingBracket': {
    color: 'var(--editor-error)',
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
    minWidth: 'var(--vv-editor-mark-min-w)',
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
})

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
    color: 'var(--editor-error)',
    textDecoration: 'underline wavy',
  },
])

/** The theme and the syntax colors of the editor. */
export const editorTheme: Extension = [base, syntaxHighlighting(highlightStyle)]
