# Architecture

This file tells how the parts of vvorkflow do the four things of the [core values](core-values.md).\
Each section gives the status of its parts: done, next, or planned.\
The [roadmap](#roadmap) gives the order.

## Parts

```text
web UI (React) ──Tauri IPC──► app core (Rust) ──local socket──► engine on this computer
                                              └──WebSocket────► engine on a remote machine
                                                 (SSH tunnel)
```

| Part | What it does | Status |
| --- | --- | --- |
| Web UI | Shows the folders, the files, and the terminals, and sends requests. It does not know if the engine is local or remote. | Done for the shell and the Explorer |
| App core | The Rust part of the Tauri app. It connects to one engine, and sends the requests, the responses, and the events between the web UI and the engine. It keeps the token out of the web UI. | Next (M3) |
| Engine | One Rust process. It owns the projects root, the files, git, and the terminal sessions. On the desktop, the app starts it as a daemon. On a remote machine, it runs headless. | Done in the app process; next as a process (M3) |
| Protocol | The Rust types of `crates/vv-protocol`, their JSON Schema, and the TypeScript client that the schema makes. | Done for folders and git |

The engine continues when the app closes, so its terminal sessions continue.

## Transports

| Transport | Between | Status |
| --- | --- | --- |
| Tauri IPC | The web UI and the app core. | Done |
| Local socket | The app core and the engine on the same computer: a Unix socket, or a named pipe on Windows. Only the user can open it. | Next (M3) |
| WebSocket | The app core and a remote engine, through an SSH tunnel that the user opens. It requires a token. | Planned (M6) |

## Protocol

Each message is a JSON object.\
The receiver checks each message against the schema, at run time.

```text
→ {"id": 7, "method": "session.attach", "params": {"session": "s3"}}
← {"id": 7, "result": {"screen": "…", "scrollback": 5000}}
← {"id": 8, "error": {"code": "permissionDenied", "message": "…"}}
← {"event": "session.output", "params": {"session": "s3", "data": "…"}}
```

1. A request has an `id`, a `method`, and `params`.\
   Its response has the same `id`, and a `result` or an `error`.
2. An event has no `id`.\
   The engine sends the events of a subject only to the clients that watch it, for example the output of a session only to its attached clients.
3. The first request of a connection is `hello`, with the protocol version of the client.\
   When the engine does not know that version, it answers with the error `failedPrecondition`, and closes the connection.
4. The protocol version changes at each change that an older client cannot read.

## Projects root

1. The engine has one projects root: `~/vvorkflow`, or the folder in `VVORKFLOW_ROOT`.\
   `VVORKFLOW_ROOT` MUST be an absolute path to a folder.
2. At start, the engine checks the root, and stops with a message when it is not correct.\
   It makes `~/vvorkflow` when that folder does not exist.
3. A project is a folder directly in the root.\
   The worktrees of one repository are in one group.
4. The desktop app can also open other folders on its own computer, as in VS Code.\
   A remote client can open only the projects in the root.

[`conventions/engine.md`](conventions/engine.md) gives the rules that keep each request in these folders.

## Terminal sessions

```text
open tab ──► attach (makes the session when it does not exist)
close tab / close app ──► detach: the session continues in the engine
open tab again ──► attach: the current screen comes back
Kill (menu) / end of the program ──► the session ends
```

1. The engine keeps each session: the pseudo-terminal, the screen state, and a scrollback with a limit.\
   It uses ConPTY on Windows.
2. On attach, the engine sends the current screen, then only the new output, while the client stays attached.
3. The engine does not read the state of an agent.\
   An agent is only the program in a terminal.

Status: planned (M4).

## Memory limits

Each part keeps its memory in a limit.\
The defaults are proposals.\
A setting changes each one.

| Part | Rule | Default |
| --- | --- | --- |
| Session screen | The engine keeps the screen and the scrollback of each session. | 5,000 lines |
| Engine output | The engine sends output only for attached sessions. When a client is slow, the engine sends the output in larger batches. When a client falls behind, the engine sends the current screen again. | - |
| App terminals | The web UI drops the terminal of a hidden tab after a time, and gets the screen again from the engine when the tab shows. | 5 minutes |
| Media and previews | The engine reads a large file in ranges, not all at once. A hidden media tab stops playback and decoding. | 1 MB ranges |
| Explorer | The web UI reads only the open folders, and drops the folders that it does not use. A large folder scrolls virtually. | 5 minutes |
| File watch | The engine watches only the open roots, not the ignored folders, and sends the changes in batches. | 100 ms |
| Git status | The engine reads the status again after a batch of changes. An ignored folder is one line. | 300 ms |

## Security

| Subject | Rule | Status |
| --- | --- | --- |
| Access | Remote access is off by default. When it is on, the engine listens only on 127.0.0.1 and requires a token. A remote client comes through an SSH tunnel. | Planned (M6) |
| Paths | A request can reach only the folders of the [projects root](#projects-root) rules. The engine reads the folders through directory handles, and runs git only with the git directory that it found when the folder opened. | Done |
| Commands | The app does not run installs. It types a command in the terminal, and the user presses Enter. | Done |
| Previews | The Markdown preview removes HTML and scripts from the document. It blocks remote images by default, and the user can allow them for each document. | Planned (M5) |
| Sessions | A session runs as the user that runs the engine. | Planned (M4) |

## Roadmap

| Step | Scope | Status |
| --- | --- | --- |
| M1 Shell | The design tokens, the window shell, accessibility, the tabs and the menus, and the icon. | Done |
| M2 Engine base | The protocol, the roots, the folders, git, and the Explorer on real folders. | Done |
| M3 Engine process | The protocol envelope with the version check, the projects root and the project list, the engine as a daemon, and the local socket. | Next |
| M4 Terminals | The sessions of the engine: the pseudo-terminal, the screen state, attach and detach, and the terminal tabs on real sessions. | Planned |
| M5 Editor and viewers | Open, edit, and save files, the diff, the Markdown preview, the media viewer, the file watch, and the Explorer menus. | Planned |
| M6 Remote | The headless install of `vvorkflow-server`, WebSocket, the token, and the connection manager. | Planned |
| M7 Tools | Search, the command palette, the settings, and the browser panel. | Planned |
| M8 Release | Signing, updates, the packages of each platform, and the checks on macOS and Windows. | Planned |
