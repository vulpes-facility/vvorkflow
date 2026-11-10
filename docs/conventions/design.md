# Design

The design source is the code: the tokens, the components, and the stories of `apps/desktop`.\
There is no separate design file.

## Tokens

1. Write each raw design value only in `apps/desktop/src/app/styles/tokens.css`, as a primitive `--vv-*`.
2. Give each primitive its role with a semantic variable, in both the light theme (`:root`) and the dark theme (`.dark`).\
   A semantic variable MUST refer to one primitive with `var(--vv-*)`.
3. Use the semantic variables only through the Tailwind utilities of `src/app/styles/index.css`, for example `bg-editor` and `text-muted-foreground`.\
   Do not write a raw color in a component, and do not use an arbitrary color class.
4. Map each third-party theme, such as dockview, to the semantic variables, as `src/app/styles/dockview-theme.css` does.
5. The app icon is the exception to rule 1, because an icon file cannot read `tokens.css`.\
   Its source, `apps/desktop/src-tauri/icons/icon.svg`, keeps the sRGB values of the tokens that it uses.\
   After a change to it, run `pnpm --filter @vvorkflow/desktop tauri icon src-tauri/icons/icon.svg -o src-tauri/icons`, and keep only the desktop sizes.
6. `apps/desktop/tests/design-tokens.test.ts` checks these rules in part:\
   the structure of `tokens.css` (rules 1 and 2), raw color values and Tailwind palette colors in `src/` (rule 3), and the contrast rules below.\
   It does not check raw sizes or opacity modifiers such as `bg-primary/80`, so check those in review.\
   When you add a semantic color, add its pairs to that test.

## Accessibility

The app MUST conform to WCAG 2.2 Level AA.

1. Text MUST have a contrast of 4.5:1 or more against each surface that it is on, also in the hover and pressed states.\
   Give a state its own opaque semantic color, such as `--primary-hover`, and not a color with alpha, so that the test can check it.\
   Icons, focus indicators, and control boundaries MUST have 3:1 or more.\
   `--subtle-foreground` is for icons only, because it meets 3:1 and not 4.5:1.\
   A hairline that only divides two regions is decoration and MAY be fainter.\
   When a hairline is also a control, such as the separator of the side bar, a grip with the `--grip` color identifies the control.
2. Each pointer target MUST be 24 by 24 CSS pixels or more.\
   This is why a list row is 24 px high.\
   Keep the root font size at the default 16 px, because the Tailwind sizes are in rem.\
   `pnpm screens` measures each target of each screen.\
   Mark a target that is not a control, such as the close icon of a tab, with `data-pointer-target`.
3. Each control MUST work with the keyboard, and MUST show the focus with the opaque `--ring` color.\
   Do not put an opacity modifier on a focus color, such as `ring-ring/50`.\
   When a change removes the focused element, hides it, or makes it inert, move the focus to a visible control, as `useFocusRescue` does for the side bar and its views.\
   A composite control, such as a tree, has one tab stop, and the arrow keys move in it.\
   A view that holds one turns off the focus of its scroll area (`contentFocusable`).\
   F6 and Shift+F6 move the focus between the regions of the window, in this order: the activity bar, the side bar, the tabs of the editor area, the content of the editor area, and the status bar (`useRegionShortcuts`).
4. Each control without visible text MUST have an accessible name.\
   When a control has visible text, its accessible name MUST contain that text.
5. Do not show a meaning with color alone.\
   For example, a git status has a color and a shape.
6. Each action that uses a drag MUST also have a way that does not use a drag, for example a context menu item or a command.\
   A tab moves with the items of its menu: split right, and move to the next or the previous group.\
   Shift+F10 or the Menu key opens the menu of the focused tab (`useTabMenuKeys`).\
   The side bar width changes with the menu of its header row, or with the arrow keys on the separator.
7. A control that is inside a tab or a row, such as the close icon of a tab, is a pointer target only.\
   Give its action a keyboard shortcut or a menu item, so that interactive controls do not nest.\
   In a terminal on Windows and Linux, the program takes the Ctrl shortcuts, so press F6 first (see [Terminal](#terminal)).
8. The window MUST reflow at 320 CSS pixels wide, as at 400 % zoom, with no horizontal scroll.\
   At `--vv-narrow-max-w` (640 px) and less the side bar closes by itself.\
   There the activity bar and `mod+B` open it as a drawer under the header row and over the editor area.\
   The editor area and the status bar are inert until Escape or the activity bar closes the drawer, and the header row with the window buttons stays usable.\
   In a wider window the side bar cannot make the editor area narrower than `--vv-editor-min-w`.\
   The Welcome tab lays out by the width of the editor area, and the status bar items wrap to more rows.\
   The editor content and the terminal are two-dimensional content, which the criterion leaves out.
9. Respect `prefers-reduced-motion`.\
   Only menus, popovers, and the command palette move, for 120 to 160 ms.
10. `pnpm screens` checks each screen story with axe-core, for the rules of WCAG 2.0, 2.1, and 2.2 at Level A and AA.\
    It also measures each pointer target, and finds horizontal scroll in the page and in each scroll area.\
    A screen MUST pass all of these checks.

## Shell

The shell follows value 5 of the [core values](../core-values.md).

1. The activity bar and the side bar take the full window height.\
   Their top row is a strip with the height, the background, and the bottom border of the title bar, and no vertical border.\
   So the strip and the title bar stay separate elements but look like one header row across the window.\
   The strip holds the mark of vvorkflow, and on macOS also the system window buttons before it.\
   The view title of the side bar is in the row below the strip, at the height of the editor tabs.
2. On macOS the window has an overlay title bar, and the system window buttons are in the top-left corner.\
   On Windows and Linux the window has no decorations, and the title bar holds the window buttons of the platform.\
   `src-tauri/tauri.macos.conf.json` repeats the whole window object of `tauri.conf.json`, because Tauri merges the platform file as a JSON Merge Patch, which replaces an array and does not merge it.
3. The title bar and the top strip of the activity bar and the side bar drag the window (`data-tauri-drag-region`).
4. When the side bar is closed on macOS, the window buttons reach into the title bar, so the title bar content starts after them.
5. Actions open from context menus, as value 5 says.\
   A menu shows only the actions that apply now, and hides the others.\
   When an action takes away the element that opened the menu, the focus goes to the element that is active after it.
6. A question to the user, such as the name of a new project, is a modal dialog over a scrim (`--scrim`).\
   The dialog keeps the focus and its keys: the shortcuts of the window do nothing while the focus is in a dialog (`isDialogKey`).\
   Escape closes it, and the focus goes back to the control that opened it.\
   A dialog starts empty each time it opens.
7. Do not write a description under a title, an item, or an empty state.\
   The name, the icon, and the data, such as a path, are sufficient.\
   An error shows as a warning icon, with its message in a tooltip on hover and on keyboard focus, and in an alert for assistive technology.\
   The owner asked for this rule on 2026-11-09.

## Explorer

The Explorer follows value 4 of the [core values](../core-values.md).

1. The tree shows each repository, then its worktrees, then the folders and the files of each worktree.\
   A worktree shows its branch and its path, and the current worktree has a heavier font.
2. The tree follows the [tree pattern of WAI-ARIA](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/).\
   Its items are one flat list with `aria-level`, `aria-setsize`, and `aria-posinset`, so that the name of an item is only the text of its own row.
3. A git status has a color, a shape (`GitStatusMark`), and a name for screen readers, and no letter.\
   There are three colors: green for a new file (added or untracked), amber for a change, and red for a deletion or a conflict.\
   The shape tells them apart: a plus for a new file, a dot for a change, a minus for a deletion, and a warning for a conflict.\
   An ignored file has the muted color, its name is in italics, and it has no shape.\
   A folder and a worktree show the most important status in them, in this order: conflict, deleted, modified, added, and untracked.\
   A folder that git reports as a whole, such as an ignored or an untracked folder, and each path in it, have the status of that folder.
4. The Explorer reads a folder only when the user opens it, and each folder above it is open (`buildTree`).\
   So a large folder, such as `node_modules`, costs nothing until the user opens it.\
   The stories serve sample data through the same `ExplorerSource` as the engine.
5. Each level moves in by `--vv-tree-indent`, through the `tree-inset` utility.\
   An empty folder has no expanded state.\
   When an update takes away the focused row, the focus and the selection move to its next sibling, its previous sibling, or its nearest visible ancestor, in this order.

## Terminal

A terminal is a tab of the editor area (value 5 of the [core values](../core-values.md)).\
An agent runs its real TUI in it (value 3).

1. The terminal is xterm.js with its DOM renderer.\
   It reads its theme from the color tokens with `readColorToken`, which converts the OKLCH values to sRGB, and it follows the color scheme.\
   It opens after its font loads, so that the cells have the right width.
2. Each ANSI color MUST have a contrast of 4.5:1 or more against `--terminal`, except black in the dark theme, and white and bright white in the light theme.\
   A program also uses those as backgrounds.\
   The terminal raises the contrast of each color to 4.5:1 at run time (`minimumContrastRatio`), so the colors that a program picks also meet SC 1.4.3.\
   A selection has its own opaque background and foreground.
3. The program takes the keys of the terminal, also Tab and Escape.\
   `terminalKeyTarget` decides the exceptions:
   - On macOS, the Command shortcuts go to the workbench.
   - On Windows and Linux, the Ctrl+Shift letters go to the workbench, as in other terminal emulators, and Ctrl+Shift+C copies the selection.
     The other Ctrl shortcuts, such as Ctrl+W, go to the program.
   - F6 and Shift+F6 always go to the workbench, so that the keyboard can leave the terminal (SC 2.1.2).
4. While a terminal has the focus, the status bar shows that F6 leaves it.\
   The input of the terminal tells the same in its accessible description.
5. The cursor does not blink (SC 2.2.2).
6. The input of the terminal is invisible and takes the keys and the IME.\
   The screen capture leaves it out of the target size check, because the pointer target is the whole terminal.

Known gaps:

- The terminal does not expose its output to assistive technology yet.\
  The screen reader mode of xterm.js comes with a setting.
- Paste with Ctrl+Shift+V relies on the paste of the webview.

## Editor

The code editor and the diff editor are tabs of the editor area (value 5 of the [core values](../core-values.md)).\
Both are CodeMirror 6, in `apps/desktop/src/pages/workbench/ui/editor/`.

1. The theme reads only CSS variables, so the color scheme changes it with no rebuild.\
   The syntax colors are the `--syntax-*` tokens, and each one MUST have 4.5:1 on each surface of the editor: the editor, the active line, the selection, a search match, and a changed line (`design-tokens.test.ts`).\
   The font and the size come from `--vv-font-mono`, `--vv-editor-font-size`, and `--vv-editor-line-height`.
2. The active line shows only while the selection is empty, so that it never hides a selection.\
   A selection and a search match have opaque colors.\
   The changed lines and the changed text of a diff are opaque too, and they hide the selection that CodeMirror draws below the lines.\
   So in a diff each selected range, not only the main one, is also a mark on the text (`cm-vv-selected`), which has the selection color above those backgrounds, in each nesting order.\
   An error in the code, such as an invalid token or a bracket with no pair, has `--editor-error`, which has 4.5:1 on each surface of the editor.
3. A search match has a fill and an outline, and the current match has a heavier outline, so that color is not the only sign.
4. The search panel is our own, on the query and the commands of `@codemirror/search` (`search-panel-view.tsx`).\
   It has icon buttons and a count, and no words:
   - The first row has the find field, the count of matches as data (`3 of 17`, `17`, or `0`; a polite live region), previous and next match, three toggles (match case, whole word, regular expression), and close.
   - A disclosure button at the start of the first row shows the second row, with the replace field, replace, and replace all.\
     A read-only editor has neither the button nor the row.
   - Each button is 24 by 24 pixels or more, has an accessible name, and has a tooltip with its name and its shortcut.\
     A pressed toggle has `aria-pressed`, a surface, and a border.
   - A regular expression that does not compile shows `aria-invalid` on the field and an `ErrorMark` with the message.
   - Enter and Shift+Enter move to the next and the previous match, Escape closes the panel and gives the focus back to the editor, and `mod+F` opens it with the selection as the query.\
     The rows wrap at 320 CSS pixels.
5. The diff shows `original` at the left and the editable text at the right when the editor is wider than `--vv-narrow-max-w` (640 CSS pixels), and one unified column when it is not.\
   The width of the editor decides, and not the width of the window (`ResizeObserver`).\
   A changed line has a tint and a mark in the gutter, a plus for an added line and a minus for a removed line, and a removed text has a strike.\
   Unchanged lines far from a change collapse.\
   `mod+Alt+U` opens the collapsed regions that show, because a region opens by a click only.\
   The merge view is the scroll area of the wide diff: it takes the height of its host.\
   Its rules are in `src/app/styles/editor.css`, scoped to `data-diff-host`, because the theme of an editor cannot reach the elements around it.
6. The keyboard can always leave (SC 2.1.2).\
   Tab indents, and Escape then Tab moves the focus on, as CodeMirror documents.\
   F6 and Shift+F6 are not bound, so they reach the window.\
   The content has the path as its accessible name, and a description that tells both ways out.\
   A read-only content keeps a tab stop.
7. The content keeps the line breaks of the text, byte for byte (`onSave` gets `state.sliceDoc()`).
   - A text with only LF, or with no line break, uses `\n` as the line separator of the state.
   - A text with only CRLF uses `\r\n`.
   - A mixed text, also with a lone `\r`, uses `\n`, and each `\r` stays in the document as a character at the end of its line, which shows as a control character.
   - A new line, and a pasted text, get the separator of the state.
   - In a document with the `\n` separator (an LF file or a mixed file), a `\r` is an ordinary character, always, and a `\n` cannot be inside a line.\
     So text that a command moves or copies keeps its bytes, and an escaped `\r\n` in a replacement gives exactly the bytes `\r\n`, as the user wrote them.
   - In a document with the `\r\n` separator (a file with only CRLF), a line never holds a `\r` or a `\n`.\
     A guard on each transaction (`separatorGuard`) turns, in the inserted text, each `\r\n` pair, each lone `\n`, and each lone `\r` into one real line break of the document, so that a replacement of the search cannot put a raw `\n` in a line.\
     The text of the disk (`fromDisk`), and an undo or a redo, pass as they are.
   - A text with no final line break keeps none.\
     The editor detects tabs or spaces and the width from the text, and uses 2 spaces when the text shows none.
8. A new `version` never discards unsaved edits.
   - While the content has no unsaved edits and no IME composition is open, the editor replaces only the span that differs, so the cursor and the scroll position stay where they can.\
     The replace is not in the undo history, and it clears the history, because the history of an old text does not belong to the new one.\
     A text that equals the content changes nothing, and the history stays.
   - Otherwise the editor keeps the content, takes the new `text` as the text of the disk, and calls `onConflictChange(true)` when the content differs from it.\
     The conflict ends, with `onConflictChange(false)`, when the content is equal to the text again, as it is after a save, or after `revert()` of the handle.
   - `onSave` always gets the content, and the owner decides whether to write it over the disk.
   - Two rules hold on each path that sets the document, the separator, the dirty state, or the conflict (mount, a new version, a composition, `revert()`, undo and redo, the layout switch, and a new `original`):
     what `onSave` gives is byte for byte the content that the user sees and typed, and a disk update never changes it;
     `dirty` and `conflict` follow only the saved content and the bytes of the disk text.\
     `tests/text-session.test.ts` checks both in a long random sequence.
   - `revert()` is one event of the undo history, apart from the typing before it, and it brings back the line breaks with the text on an undo.
   - A new `original` of the diff never touches the edits.
   - Each `version` is processed once, also when the platform or the layout changes in the same render.
   - The editor shows one file.\
     The owner gives another file a new editor (a `key`).
   - mod+S does nothing while an IME composition is open, because the composed text is not in the document yet.
9. A hidden panel is detached from the document and loses its scroll positions.\
   The editor ignores a width of 0, and puts the scroll positions back when it has a size again.
10. The key bindings follow the `platform` prop and not the user agent: `mod` is Command on macOS and Control elsewhere.

Known gaps:

- The layout switch of the diff keeps the content, the cursor, the focus (not from another control, also when the search is open), and the search, and waits for the end of an IME composition.\
  It does not keep the undo history.
- A text with a `\r` in a line, from a mixed text, shows a control character at the end of that line.
- In the wide diff, F6 lands on the original side first.
- The editor has no auto-closing of brackets, no folding, and no autocomplete.

## Markdown preview and media viewer

The Markdown preview and the media viewer are components for tabs of the editor area.\
A later change connects them to the files of the Explorer.\
They get their data through props, and they make no request to the engine.\
The only loads that they allow are the URLs that the host gives (`resolveImage` and `src`), and the remote images that the user allowed.

1. The preview uses `react-markdown` with `remark-gfm`: tables, task lists, strikethrough, autolinks, and footnotes.\
   The preview removes raw HTML (`skipHtml`), and MUST NOT use `rehype-raw`.
2. A source or a target that has a scheme other than `http`, `https`, and (for a link) `mailto` is blocked, also when the scheme has a tab, capitals, a space, or percent escapes.\
   A remote image has one canonical URL (`//host` gets `https`), and the preview loads exactly that URL.\
   A form with two readings, such as `https:name.png` or a URL with a password, is blocked.\
   A blocked link is plain text, and a blocked image is a placeholder.\
   `classifyImageSource` and `classifyLinkTarget` decide this, and Vitest and `e2e/markdown-preview.spec.ts` test it.
3. A remote image makes no request until the user allows it.\
   Its place is a placeholder of one line with an icon and the host name.\
   One icon button at the top allows the images of the document, and only when the document has a remote image.
4. A link never navigates by itself: it calls `onOpenLink`.\
   It has the role `link` and is in the tab order, but it has no `href`, so the browser has no destination to follow: a click with a modifier key, a middle click, and a drag and drop of the link or of an image cannot navigate or open a window.\
   The destination is the data `data-href` and the tooltip of the link, and a context menu (right click, Shift+F10, or the Menu key) has "Copy link address".\
   A decode is only a probe for the scheme and the host checks: the URL that loads keeps its path and its query as the document wrote them.\
   A footnote link scrolls the preview and moves the focus, and does not change the URL of the window.\
   Each preview prefixes its footnote ids, so that two previews do not share an id.
5. A task list shows a shape (a checked or an empty square) and a name, and has no input.
6. The preview is a focusable scroll region with a readable measure (`--vv-measure`) and selectable text.\
   A table and a code block scroll inside themselves.
7. The image viewer fits the view and never enlarges.\
   Its buttons and the keys `+`, `-`, and `0` zoom, and its pixel size shows as data.\
   A transparent image sits on a checkerboard of two surface colors (`checkerboard`).
8. A video and an audio file use the native controls, with no autoplay and `preload="metadata"`.\
   A tab that is not active pauses, remembers the position, and removes the source (`load()` frees the decoder).\
   The tab that is active again restores the source and the position, paused.
9. A file that does not decode shows the `ErrorMark`, not a broken image.\
   The kind and the source are the identity of the player and of its error state.\
   When the viewer had the focus, it moves to the error icon.
10. Only a link in a run of text that has prose has `data-inline-link`, so that the target size check leaves it out (SC 2.5.8, inline).\
    The text of other links and the space between links is not prose.\
    A link that stands alone, a row of links, and a linked image have a target of 24 by 24 CSS pixels or more, and a linked image shrinks to the width of the preview.

Known gaps:

- A code block has no syntax highlighting.
- The WebKit build of Playwright on Linux does not always report VP9 support, so the video tests skip there when `canPlayType` says no.

## Stories and screens

1. Keep the stories in `apps/desktop/stories/` and their sample data in `apps/desktop/fixtures/`.\
   Do not put sample data in `src/`.\
   A fixture MAY draw system UI that the app does not render, such as the macOS window buttons, in the colors of that system.\
   Those colors are not design tokens of vvorkflow, so they stay in the fixture and outside `tokens.css`.
2. Give each screen a story under `Screens/`, and add its id to `apps/desktop/e2e/screens.spec.ts`.\
   Test the keyboard behavior of the shell in `apps/desktop/e2e/workbench.spec.ts`.
3. `pnpm --filter @vvorkflow/desktop screens` writes a screenshot of each screen to `apps/desktop/screens/`, in Chromium and in WebKit.\
   Chromium stands for WebView2 and Android.\
   WebKit stands for WKWebView and WebKitGTK.\
   Check a design change in both engines before a pull request.
