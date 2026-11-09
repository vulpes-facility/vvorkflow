# Core values

These values decide the design of vvorkflow.\
Read them before you make a design decision.\
When a proposal breaks a value, change the proposal, or ask the owner to change the value.

The owner confirmed these values on 2026-11-09.\
They are in priority order.\
When two values conflict, the value with the lower number has priority.

## Quality bar

vvorkflow MUST be a masterpiece of fantastic quality.\
It MUST be a clean IDE for developers.\
This bar applies to each value and each decision in this file.

## Values

1. **The desktop IDE is the product.**\
   Keep it light.\
   The mobile app and the headless server come later.\
   The server is only a transport to develop on a different machine.
2. **The agent graph is only a blueprint.**\
   The engine MUST NOT run or track a graph: it has no runs, no run state, no gates, and no completion watch.\
   The orchestrator is the main agent that the user opens in a terminal.\
   It uses the `vv` CLI to make the worktrees and the terminals of the workers, to send briefs, and to receive reports.\
   A graph has one node kind, `agent`.\
   Its edges make a DAG: a node can have more than one successor and more than one predecessor, and an edge has no condition.\
   The input of a node is only the outputs of its direct predecessors, in the order of their edges in the graph.\
   A node with no predecessor gets the goal that the orchestrator gives for the whole graph.
3. **The design follows the real workflow.**\
   A worktree is a first-class object: one worktree is one project, and the projects of one repository are in one group.\
   Git status shows as decorations in the Explorer, not in a separate panel.\
   Agents run as their real TUIs, in terminal tabs that the user can see.
4. **Engine first, with one protocol.**\
   Each IDE feature is a request, a response, or an event of one Rust engine.\
   The front end does not know if the engine is local or remote, so each feature also works remotely.\
   The desktop app MUST be able to expose itself as a server, as an option.
5. **A fixed shell, in the style of VS Code.**\
   The activity bar and the side bar take the full height, and the header is only above the editor area.\
   There is no bottom panel.\
   Free docking is only in the editor area.\
   The terminal and the Welcome page are editor tabs.\
   There are no floating toolbars: actions open from context menus and commands.
6. **The user is in control.**\
   The app does not run installs for the user.\
   It types a command in the terminal, and the user presses Enter.\
   Remote access is off by default, listens only on 127.0.0.1, and MUST require a token.\
   A remote request can reach only paths in the allowed roots.
7. **A predictable codebase.**\
   Follow known structures, for example Feature-Sliced Design, a Cargo workspace, and Turborepo.\
   Document only the parts that are different from them.

## Decisions

The owner confirmed these decisions on 2026-11-09.

- **Users:** vvorkflow is for its owner alone, for now.
- **Accessibility:** The app MUST conform to WCAG 2.2 Level AA.\
  The owner confirmed this on 2026-11-09.
- **Platforms:** The desktop app on macOS, Windows, and Linux comes first.\
  iOS and Android come later (value 1).
- **Webview:** The app uses Tauri 2 with the system webview of each platform.\
  These are WebView2 on Windows, WKWebView on macOS and iOS, WebKitGTK on Linux, and Android System WebView on Android.\
  The app is not limited to Chromium, so check the UI on both Chromium and WebKit.
- **Browser panel:** The IDE has a browser panel, which is a child webview of Tauri 2 multiwebview.\
  Multiwebview needs the `unstable` feature of the `tauri` crate.\
  Until it is stable, follow its API changes at each Tauri update.
