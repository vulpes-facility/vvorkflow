# Core values

These values decide the design of vvorkflow.\
Read them before you make a design decision.\
When a proposal breaks a value, change the proposal, or ask the owner to change the value.

The owner confirmed these values on 2026-11-09, and changed the scope on the same day.\
They are in priority order.\
When two values conflict, the value with the lower number has priority.

## Quality bar

vvorkflow MUST be a masterpiece of fantastic quality.\
It MUST be a clean IDE for developers.\
This bar applies to each value and each decision in this file.

## Purpose

vvorkflow is a light IDE that does four things:

1. Its front end and its engine are separate.
2. The user opens folders, as in VS Code, to see and edit them.
3. The user opens terminals, to run commands and agents.
4. The user reaches a headless install on a remote machine from the app.

[`architecture.md`](architecture.md) tells how the parts do these things.

## Values

1. **The IDE is the product, and it is light.**\
   Each part keeps its memory in a limit, and reads only what the screen shows.\
   The mobile apps come later.
2. **The front end and the engine are separate, with one protocol.**\
   Each IDE feature is a request, a response, or an event of one Rust engine.\
   The engine is a process apart from the app.\
   The front end does not know if the engine is local or remote, so each feature also works remotely.\
   The headless engine on a remote machine is a primary use, not a later addition.
3. **Agents are programs in terminals.**\
   An agent, such as Claude Code or Codex, runs as its real TUI in a terminal tab.\
   The app does not read the state of an agent, and it does not coordinate agents.\
   The plugins of Claude Code and Codex do the coordination.
4. **The design follows the real workflow.**\
   A project is a folder in the projects root.\
   The worktrees of one repository are in one group in the Explorer.\
   Git status shows as decorations in the Explorer, not in a separate panel.\
   A terminal session continues when its tab or the app closes, until the user ends it.
5. **A fixed shell, in the style of VS Code.**\
   The activity bar and the side bar take the full height, and the header is only above the editor area.\
   There is no bottom panel.\
   Free docking is only in the editor area.\
   The terminals, the viewers, and the Welcome page are editor tabs.\
   There are no floating toolbars: actions open from context menus and commands.
6. **The user is in control.**\
   The app does not run installs for the user.\
   It types a command in the terminal, and the user presses Enter.\
   Remote access is off by default, listens only on 127.0.0.1, and MUST require a token.\
   A request can reach only the projects root, the folders that the user opened, and the worktrees of their repositories.
7. **A predictable codebase.**\
   Follow known structures, for example Feature-Sliced Design, a Cargo workspace, and Turborepo.\
   Document only the parts that are different from them.

## Decisions

The owner confirmed these decisions on 2026-11-09.

- **Users:** vvorkflow is for its owner alone, for now.
- **Accessibility:** The app MUST conform to WCAG 2.2 Level AA.
- **Platforms:** The desktop app on macOS, Windows, and Linux comes first, with the headless engine on Linux.\
  iOS and Android come later (value 1).
- **Webview:** The app uses Tauri 2 with the system webview of each platform.\
  These are WebView2 on Windows, WKWebView on macOS and iOS, WebKitGTK on Linux, and Android System WebView on Android.\
  The app is not limited to Chromium, so check the UI on both Chromium and WebKit.
- **Browser panel:** The IDE has a browser panel, which is a child webview of Tauri 2 multiwebview.\
  Multiwebview needs the `unstable` feature of the `tauri` crate.\
  Until it is stable, follow its API changes at each Tauri update.
- **No agent graph:** The app has no agent graph and no command line tool to coordinate agents (value 3).
- **Headless engine:** Its name is `vvorkflow-server`.
- **Projects root:** It is `~/vvorkflow`, or the folder in the environment variable `VVORKFLOW_ROOT`.\
  The engine checks it at start, and stops when it is not correct.\
  The desktop app can also open other folders on its own computer, as in VS Code.
- **Terminal sessions:** The engine keeps each session itself, on each platform: the pseudo-terminal, the screen state, and a scrollback with a limit.\
  It uses ConPTY on Windows, and no external terminal multiplexer.\
  To close a tab detaches the tab from its session.\
  Only the Kill action of a menu, or the end of its program, ends a session.
- **Code editor:** CodeMirror 6, because it is light and accessible.
- **Viewers:** A Markdown preview, with GitHub Flavored Markdown and footnotes, and a media viewer for images, video, and audio, as in VS Code.
- **Remote connection:** The user opens the SSH tunnel.\
  The app takes only the address and the token.
- **Terminal screen reader mode:** A setting turns it on.
