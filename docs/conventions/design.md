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

## Explorer

The Explorer follows value 3 of the [core values](../core-values.md).

1. The tree shows each repository, then its worktrees, then the folders and the files of each worktree.\
   A worktree shows its branch and its path, and the current worktree has a heavier font.
2. The tree follows the [tree pattern of WAI-ARIA](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/).\
   Its items are one flat list with `aria-level`, `aria-setsize`, and `aria-posinset`, so that the name of an item is only the text of its own row.
3. A git status has a color, a shape (`GitStatusMark`), and a name for screen readers, and no letter.\
   There are three colors: green for a new file (added or untracked), amber for a change, and red for a deletion or a conflict.\
   The shape tells them apart: a plus for a new file, a dot for a change, a minus for a deletion, and a warning for a conflict.\
   An ignored file has the muted color, its name is in italics, and it has no shape.\
   A folder and a worktree show the most important status in them, in this order: conflict, deleted, modified, added, and untracked.\
   A folder shows ignored only when all of its files are ignored.
4. Each level moves in by `--vv-tree-indent`, through the `tree-inset` utility.\
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
