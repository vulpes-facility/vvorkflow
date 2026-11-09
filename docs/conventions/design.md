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
5. `apps/desktop/tests/design-tokens.test.ts` checks rules 1 to 3 and the contrast rules below.\
   When you add a semantic color, add its pairs to that test.

## Accessibility

The app MUST conform to WCAG 2.2 Level AA.

1. Text MUST have a contrast of 4.5:1 or more against each surface that it is on.\
   Icons, focus indicators, and control boundaries MUST have 3:1 or more.\
   `--subtle-foreground` is for icons only, because it meets 3:1 and not 4.5:1.
2. Each pointer target MUST be 24 by 24 CSS pixels or more.\
   This is why a list row is 24 px high.
3. Each control MUST work with the keyboard, and MUST show the focus with the `--ring` color.
4. Each control without visible text MUST have an accessible name.\
   When a control has visible text, its accessible name MUST contain that text.
5. Do not show a meaning with color alone.\
   For example, a git status has a color and a letter.
6. Each action that uses a drag MUST also have a way that does not use a drag, for example a context menu item or a command.
7. A control that is inside a tab or a row, such as the close icon of a tab, is a pointer target only.\
   Give its action a keyboard shortcut or a menu item, so that interactive controls do not nest.
8. Respect `prefers-reduced-motion`.\
   Only menus, popovers, and the command palette move, for 120 to 160 ms.
9. `pnpm screens` checks each screen story with axe-core, for the rules of WCAG 2.0, 2.1, and 2.2 at Level A and AA.\
   A screen MUST have no violation.

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

## Stories and screens

1. Keep the stories in `apps/desktop/stories/` and their sample data in `apps/desktop/fixtures/`.\
   Do not put sample data in `src/`.
2. Give each screen a story under `Screens/`, and add its id to `apps/desktop/e2e/screens.spec.ts`.
3. `pnpm --filter @vvorkflow/desktop screens` writes a screenshot of each screen to `apps/desktop/screens/`, in Chromium and in WebKit.\
   Chromium stands for WebView2 and Android.\
   WebKit stands for WKWebView and WebKitGTK.\
   Check a design change in both engines before a pull request.
