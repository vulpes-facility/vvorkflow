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
5. `apps/desktop/tests/design-tokens.test.ts` checks these rules in part:\
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
   When a change hides the focused element or makes it inert, move the focus to a visible control, as `useFocusRescue` does for the side bar.
4. Each control without visible text MUST have an accessible name.\
   When a control has visible text, its accessible name MUST contain that text.
5. Do not show a meaning with color alone.\
   For example, a git status has a color and a letter.
6. Each action that uses a drag MUST also have a way that does not use a drag, for example a context menu item or a command.
7. A control that is inside a tab or a row, such as the close icon of a tab, is a pointer target only.\
   Give its action a keyboard shortcut or a menu item, so that interactive controls do not nest.
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

Known gaps, to close with the context menus of the editor area:

- A tab moves to another group only by a drag.
- The side bar width changes only by a drag or with the arrow keys on the separator.

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
