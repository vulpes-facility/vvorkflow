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
| Web UI | Shows the folders, the files, and the terminals, and sends requests. It does not know if the engine is local or remote. | Done for the shell, the Explorer, and the projects on the Welcome tab |
| App core | The Rust part of the Tauri app. It connects to one engine, and sends the requests, the responses, and the events between the web UI and the engine. It keeps the token out of the web UI. | Done for the local engine (M3); the remote engine and the token come in M6 |
| Engine | One Rust process. It owns the projects root, the files, git, and the terminal sessions. On the desktop, the app starts it as a daemon. On a remote machine, it runs headless. | Done as the process `vvorkflow-server` (M3) |
| Protocol | The Rust types of `crates/vvorkflow-protocol`, their JSON Schema, and the TypeScript client that the schema makes. | Done for `hello`, the projects, the folders, and git |

The engine continues when the app closes, so its terminal sessions continue.

## Transports

| Transport | Between | Status |
| --- | --- | --- |
| Tauri IPC | The web UI and the app core. | Done |
| Local socket | The app core and the engine on the same computer: a Unix socket, or a named pipe on Windows ([Engine process](#engine-process)). | Done (M3) |
| SSH tunnel | The app core and a remote engine, through an SSH tunnel that the user opens. It requires a token. | Planned (M6) |

Each connection of the app core carries WebSocket frames, on the local socket and in the SSH tunnel.\
A text frame holds one JSON message of the protocol.\
A binary frame is for terminal output (M4).

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
   The engine sends the events of a subject only to the clients that watch it.\
   For example, only the attached clients of a session get its output.
3. The first request of a connection is `hello`, with the protocol version of the client.\
   When the engine uses another version, it answers with the error `failedPrecondition`, and closes the connection.\
   A request before `hello` gets `failedPrecondition`, and the connection stays open.\
   The engine accepts `hello` again on the same connection.
4. The protocol version changes at each change that an older client cannot read.
5. `shutdown` stops the engine process: the engine stops to listen, answers `{}`, closes the connection, and stops.\
   It is valid before `hello`, and its shape never changes, so that each app can stop an engine of an older version.
6. A message that is not a request with an `id` closes the connection.\
   A request with an `id` and a method or params that the engine does not know gets `invalidArgument`.
7. Over Tauri IPC, the web UI sends only `method` and `params`, and the app core adds the `id`.
8. A client keeps at most 16 requests open on a connection: sent, and not answered yet.\
   The engine closes the connection of a client that sends more.

Status: the methods, the version check, `shutdown`, and the envelope with the `id` are done (M3).\
The events come with the terminal sessions (M4).

## Projects root

1. The engine has one projects root: `~/vvorkflow`, or the folder in `VVORKFLOW_ROOT`.\
   `VVORKFLOW_ROOT` MUST be an absolute path to a folder.\
   An empty value is the same as no value.\
   The path of the root MUST be UTF-8, because the protocol sends paths as text.
2. At start, the engine checks the root, and stops with a message when it is not correct.\
   It makes `~/vvorkflow` when that folder does not exist.
3. A project is a folder directly in the root.\
   A name that starts with `.`, or that is not UTF-8, is not a project.\
   A symbolic link that leads out of the root is not a project, because the engine reads the root through a directory handle.
4. The worktrees of one repository are in one group in the Explorer.
5. The desktop app can also open other folders on its own computer, as in VS Code.\
   A remote client can open only the projects in the root.

Status: done (M3), with the method `project.list`.\
The Welcome tab shows the projects, or the message of a root that is not correct.\
The engine process stops on a root that is not correct, and the app shows its message.

[`conventions/engine.md`](conventions/engine.md) gives the rules that keep each request in these folders.

## Engine process

1. The binary `vvorkflow-server` is the engine process.\
   At start it checks the [projects root](#projects-root).\
   When the root is not correct, it writes the message to stderr, and stops with exit code 1.
2. On Linux and macOS, its folder is the first of these where the canonical path of the socket has at most 100 bytes:\
   `$XDG_RUNTIME_DIR/vvorkflow`, `vvorkflow-<uid>` in the temporary folder, and `/tmp/vvorkflow-<uid>`.\
   On Windows, it is `%LOCALAPPDATA%\vvorkflow`.
3. On Linux and macOS, the engine makes the folder with mode 0700.\
   It refuses a folder that is a symbolic link, that another user owns, or that other users can open.\
   It also refuses a folder above it that a user other than this user and root owns, or that other users can write without the sticky bit.\
   Each operation on the endpoint does these checks again on the canonical path, from `/` down, and does not follow a link.\
   A folder that passes cannot change under the next one, because no other user can rename an entry in it.\
   So no other user can replace the folder or lead an operation to another folder.
4. The folder holds `engine.lock`, `engine.turn`, `engine.log`, and the socket `engine.sock`.\
   A client does the same checks of the folder before it connects.\
   Each side refuses the other side when it runs as another user (the peer credentials of the socket).
5. On Windows, the folder is in the profile of the user, which other users cannot open.\
   The engine makes a named pipe with a random name, and writes the name and its process id to `engine.pipe` in the folder.\
   The pipe lets only its owner and the system open it, and it refuses remote clients.\
   A client reads `engine.pipe`, and refuses a pipe whose server is not that process, or does not run as this user.
6. Only one engine listens on an endpoint.\
   The engine locks `engine.lock`, then removes a socket that an old engine left, and then listens.
7. The engine serves at most 32 clients, and closes the connection of a client after them at once.\
   A client has 10 seconds for the WebSocket handshake and `hello`.\
   The engine reads a message of at most 1 MiB.\
   It runs each request on a blocking thread, at most 8 requests of all clients at a time, and reads the next message also while a request waits.\
   A client that does not take a frame for 30 seconds loses its connection.\
   When a connection ends, its queued requests end too, and a request on a blocking thread keeps its place until it finishes.
8. The engine stops when a client sends `shutdown`, or when no client is connected for a time ([Memory limits](#memory-limits)).
9. The desktop app finds `vvorkflow-server` next to its own executable.\
   It connects, and when no engine answers, it starts one, detached, with stderr in `engine.log`.\
   When the engine stops before it listens, the app shows the last line of `engine.log`.\
   When the engine does not listen in 10 seconds, the app stops that process.\
   When `hello` fails because of the version, the app sends `shutdown`, and starts its own engine.\
   Only one app at a time starts or replaces the engine: the app locks `engine.turn`, and says `hello` again before it does so.\
   Thus an app does not stop the engine that another app started a moment before.\
   An engine has 10 seconds to answer `hello`; after them the app shows an error, and the next request tries again.\
   The app keeps one connection while it runs, and sends each request of the web UI on it with a new `id`.\
   It keeps at most 16 requests open; a further request waits.\
   When the engine sends a text that is not an answer, the app ends the connection, and each open request gets an error.\
   When the engine stops, the next request opens a new connection, and starts an engine when none listens.
10. The engine continues when the app closes, with the projects root that it started with.\
    To use another root, set `VVORKFLOW_ROOT` and start the app after the engine stops: 5 minutes after the last client leaves.

Status: done (M3).

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
| Engine process | The engine process stops when no client is connected for a time. From M4, it also waits for the end of each session. | 5 minutes |
| Requests | At most 32 clients; at most 8 requests of all clients run at a time; at most 16 open requests on each connection; a message to the engine has at most 1 MiB. | - |
| Session screen | The engine keeps the screen and the scrollback of each session. | 5,000 lines |
| Engine output | The engine sends output only for attached sessions. Each client has an output queue with a limit. When the queue is full, the engine discards the queued output and sends the current screen again. | Proposal in M4 |
| App terminals | The web UI drops the terminal of a hidden tab after a time, and gets the screen again from the engine when the tab shows. | 5 minutes |
| Media and previews | The engine reads a large file in ranges, not all at once. A hidden media tab stops playback and decoding. | 1 MB ranges |
| Explorer | The web UI reads only the open folders, and drops the folders that it does not use. A large folder scrolls virtually. | 5 minutes |
| File watch | The engine watches only the open roots, not the ignored folders, and sends the changes in batches. | 100 ms |
| Git status | The engine reads the status again after a batch of changes. An ignored folder is one line. | 300 ms |

## Security

| Subject | Rule | Status |
| --- | --- | --- |
| Access | Remote access is off by default. When it is on, the engine listens only on 127.0.0.1 and requires a token. A remote client comes through an SSH tunnel. | Planned (M6) |
| Paths | A request can reach only the folders that the user opened, and the worktrees of their repositories. The engine reads the folders through directory handles, and runs git only with the git directory that it found when the folder opened. | Done |
| Projects root | The engine also lists the [projects root](#projects-root), through a directory handle. A remote client can open only the projects in it. | Done for the root; planned (M6) for remote clients |
| Installs | The app does not run installs for the user. | Done |
| Commands | The app types a command in the terminal, and the user presses Enter. | Planned (M4) |
| Previews | The Markdown preview removes HTML and scripts from the document. It blocks remote images by default, and the user can allow them for each document. | Planned (M5) |
| Sessions | A session runs as the user that runs the engine. | Planned (M4) |

## Roadmap

| Step | Scope | Status |
| --- | --- | --- |
| M1 Shell | The design tokens, the window shell, accessibility, the tabs and the menus, and the icon. | Done |
| M2 Engine base | The protocol, the roots, the folders, git, and the Explorer on real folders. | Done |
| M3 Engine process | The protocol envelope with the version check, the projects root and the project list, the engine as a daemon, and the local socket. | Done |
| M4 Terminals | The sessions of the engine: the pseudo-terminal, the screen state, attach and detach, and the terminal tabs on real sessions. | Planned |
| M5 Editor and viewers | Open, edit, and save files, the diff, the Markdown preview, the media viewer, the file watch, and the Explorer menus. | Planned |
| M6 Remote | The headless install of `vvorkflow-server`, WebSocket, the token, and the connection manager. | Planned |
| M7 Tools | Search, the command palette, the settings, and the browser panel. | Planned |
| M8 Release | Signing, updates, the packages of each platform, and the checks on macOS and Windows. | Planned |
