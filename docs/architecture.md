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
A binary frame holds terminal output ([Attach, output, and input](#attach-output-and-input)).

## Protocol

Each message is a JSON object.\
The receiver checks each message against the schema, at run time.

```text
→ {"id": 7, "method": "session.attach", "params": {"session": "5f0c2a9e41b7d386"}}
← {"id": 7, "result": {"id": "5f0c2a9e41b7d386", "title": "zsh", "folder": "/code/app", "columns": 120, "rows": 30}}
← {"id": 8, "error": {"code": "permissionDenied", "message": "…"}}
← (binary frame: the screen of the session, then its output)
← {"event": "session.ended", "params": {"session": "5f0c2a9e41b7d386", "exitCode": 0, "signal": null}}
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
4. The protocol version changes at each change that an older client or an older engine cannot read.\
   A new method is such a change, because an older engine does not know it.
5. `shutdown` stops the engine process: the engine stops to listen, answers `{}`, closes the connection, and stops.\
   It is valid before `hello`.\
   Its params are `{}` or `{"force": true}` ([Engine stop with sessions](#engine-stop-with-sessions)), and this shape never changes from M4, so that each app can stop an engine of another version.
6. A message that is not a request with an `id` closes the connection.\
   A request with an `id` and a method or params that the engine does not know gets `invalidArgument`.
7. Over Tauri IPC, the web UI sends only `method` and `params`, and the app core adds the `id`.
8. A client keeps at most 16 requests open on a connection: sent, and not answered yet.\
   The engine closes the connection of a client that sends more.
9. An event is a text frame with an `event` and `params`.\
   The engine can send it at any time after `hello`, between the answers.
10. The engine does the requests of a terminal session that must keep their order when it reads them ([Attach, output, and input](#attach-output-and-input)).\
    Each other request runs on a worker, and its answer can come in any order.
11. Over Tauri IPC, the web UI gives the app core one channel.\
    On it, the app core sends each event as JSON and each binary frame as bytes, in the order of the connection.
12. The web UI writes the frames to its terminal in their order, one after the end of the other, and tells the app core the bytes that the terminal took.\
    The app core counts the bytes of the frames that the terminal did not take yet, also those that are on their way to the web UI.\
    When the count is 1 MiB or more, it stops to read the connection, so that the limits of the engine apply, and no queue of the app grows without a limit.\
    One frame can take the count above 1 MiB, and a frame has at most 32 MiB and 21 bytes, so the count stays below 33 MiB and 21 bytes.
13. When the connection of the app core to the engine ends, each open request fails, and the app core sends the event `connection.closed` on the channel:\
    after the last frame of that connection, and before the first frame of the next connection.\
    The attachments of that connection are gone: the web UI attaches again, and the next request opens a new connection.\
    An attach is safe to repeat, so an event that the web UI reads late only brings the screen again.\
    The app core never sends a request again by itself.\
    The engine never sends this event.

Status: the methods, the version check, `shutdown`, and the envelope with the `id` are done (M3).\
The events and the binary frames are next, with the terminal sessions (M4).

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
4. `project.create` makes a project: a new, empty folder in the root, through the same handle.\
   The engine refuses it when the path of the root no longer leads to that handle, because the answer gives the path of the project.\
   Its name is one name that Linux, macOS, and Windows accept as a file name, and it does not start with `.`.\
   The engine refuses a name that is in the root already, and does not change that folder.\
   The engine does not run `git init`: the user does that in a terminal.
5. The worktrees of one repository are in one group in the Explorer.
6. The desktop app can also open other folders on its own computer, as in VS Code.\
   A remote client can open only the projects in the root.

Status: done (M3), with the methods `project.list` and `project.create`.\
The Welcome tab shows the projects, or the message of a root that is not correct.\
Its New project action asks for a name in a dialog, makes the project, and opens it.\
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
   The requests of a terminal session that keep their order are the exception: the engine does them on the connection, and they never wait.\
   A client that takes no byte for 30 seconds loses its connection; a large frame that moves is not a reason.\
   When a connection ends, its queued requests end too, and a request on a blocking thread keeps its place until it finishes.
8. The engine stops when a client sends `shutdown`, or when no client is connected for a time ([Memory limits](#memory-limits)).
9. The desktop app finds `vvorkflow-server` next to its own executable.\
   It connects, and when no engine answers, it starts one, detached, with stderr in `engine.log`.\
   When the engine stops before it listens, the app shows the last line of `engine.log`.\
   When the engine does not listen in 10 seconds, the app stops that process.\
   When `hello` fails because of the version, the app sends `shutdown`, and starts its own engine.\
   From M4, an engine with sessions refuses that `shutdown` ([Engine stop with sessions](#engine-stop-with-sessions)): the app then shows the refusal and starts no engine.\
   The app sends a `shutdown` on a connection of its own, before `hello`, and not on the connection of the requests.\
   Only one app at a time starts or replaces the engine: the app locks `engine.turn`, and says `hello` again before it does so.\
   Thus an app does not stop the engine that another app started a moment before.\
   An engine has 10 seconds to answer `hello`; after them the app shows an error, and the next request tries again.\
   The app keeps one connection while it runs, and sends each request of the web UI on it with a new `id`.\
   It keeps at most 16 requests open; a further request waits.\
   When the engine sends a text that is not an answer and not an event, the app ends the connection, and each open request gets an error.\
   When the engine stops, the next request opens a new connection, and starts an engine when none listens.
10. The engine continues when the app closes, with the projects root that it started with.\
    To use another root, set `VVORKFLOW_ROOT` and start the app after the engine stops: 5 minutes after the last client leaves.

Status: done (M3).

## Terminal sessions

```text
new terminal ──► session.create, then session.attach
close tab / close app ──► detach: the session continues in the engine
open tab again ──► session.attach: the current screen comes back
Kill (menu) / end of the shell ──► the session ends
```

### Session

1. A session is a pseudo-terminal, the shell of the user in it, and the state of its screen.\
   The engine keeps each session until its shell ends, also while no client is connected.\
   It uses ConPTY on Windows.
2. `session.create` makes a session with a size in columns and rows.\
   Its folder is an open worktree, or the projects root when the request names no worktree.\
   The request has no command: the program is always the shell of the user, and the user types each command (value 6).\
   When the shell does not start, the request fails (`failedPrecondition`), and no session stays.
3. The shell is the program that `$SHELL` names, or `/bin/sh` when the variable is not set or is empty.\
   On macOS it starts as a login shell, because an app there does not get the environment of the profile.\
   On Windows it is `pwsh.exe`, `powershell.exe`, or the program that `%COMSPEC%` names, the first that the engine finds.\
   The shell gets the environment that the engine started with, without the variables that hold a secret of the engine, and with `TERM=xterm-256color`, `COLORTERM=truecolor`, and `TERM_PROGRAM=vvorkflow`.
4. The id of a session is 16 characters, each one an ASCII digit or a lowercase letter from `a` to `f`, from a random number.\
   So an id of an engine that stopped does not name a session of the next engine.
5. A size has 2 to 500 columns and 1 to 200 rows; the engine refuses another size (`invalidArgument`).\
   The engine keeps at most 64 sessions (`failedPrecondition` for one more).
6. `session.list` answers each session in the order of its start: its id, its title, its folder, and its size.\
   The title is the last title that the program set (OSC 0 or OSC 2), cut to 1,024 bytes, or the name of the shell program before that.\
   An attached terminal reads a new title from the output.
7. Each client of the engine is the same owner, and can list, attach, write, resize, and kill each session.
8. The engine does not read the state of an agent.\
   An agent is only the program in a terminal.

### Screen state

1. The engine reads the output of each session, also while no client is attached, and keeps the state that the output makes:\
   the screen and the scrollback of at most 5,000 lines, with the lines that wrap;\
   the alternate screen, and the normal screen under it;\
   the cursor, its saved copy, and the scroll region;\
   the colors and the styles;\
   the title;\
   and the modes that change the input or the output, such as bracketed paste, the mouse modes, the focus events, the application cursor keys, and the keyboard protocol.
2. From this state the engine makes the screen bytes: bytes that draw the same state in a terminal that was reset to the size of the session.\
   The terminal of the web UI is xterm.js, so the measure is xterm.js:\
   for each recorded output in `crates/vvorkflow-engine/tests/screens/`, a terminal that gets the screen bytes of a position and then the output after it MUST show the same as a terminal that gets all the output.\
   A Rust test keeps the screen bytes of these records current, and a Vitest test compares the two terminals: each line of both buffers, the cursor, and the modes.
3. The engine can make the screen bytes in the middle of an escape sequence or of a character of more than one byte.\
   The screen bytes then end with the bytes of that part, so that the next output continues it.\
   The engine keeps at most 4 KiB of such a part.\
   For a longer part, which is a string sequence such as an OSC, the screen bytes end with the start of that kind of sequence, so that the terminal reads the rest of the string as a string and not as text.
4. The screen bytes have at most 32 MiB.\
   When they would be larger, the engine leaves out the oldest lines of the scrollback.\
   That is always sufficient: a cell keeps at most 32 bytes of text, so the two screens of the largest size, with each style on each cell, and the other state without the scrollback, are less than 32 MiB.\
   A test makes the screen bytes of that largest state.
5. Known limits of the state:\
   a cell keeps the combining characters only up to its 32 bytes;\
   the tab stops and the character sets come back at their defaults;\
   links (OSC 8) and images are not kept.\
   M4 names each other part that the engine cannot bring back, here.
6. A query of the program, such as the cursor position or the colors, gets its answer from the terminal of an attached client, because that terminal has the keyboard and the colors that the answer tells.\
   While no client is attached, the engine answers the queries for the cursor position and the device attributes, and no other query.\
   Known limits: when two clients are attached to one session, the program gets two answers; and a query in output that the engine discarded gets no answer.

### Attach, output, and input

1. `session.attach` adds the connection to the attached clients of the session, asks for a screen for that client, and answers the session.\
   A screen that a client waits for is a mark, not bytes: while the mark is set, the engine queues no output of that session for that client.\
   When the writer of the connection is ready for it, the engine makes the screen frame from the state of that moment and takes the mark away, in one step under the lock of the session; the output after that moment goes to the queue.\
   So the client gets the screen, then each byte of output after it, with no byte lost and no byte twice, and the engine keeps at most one screen frame for a client at a time.\
   `session.attach` on an attached session asks for the screen again.\
   A session that ended answers `notFound`, and sends nothing.
2. `session.detach`, and the end of the connection, remove the client; the session continues.
3. Terminal output is a binary frame.\
   Byte 0 is the kind, and bytes 1 to 16 are the session id.\
   Kind 0 is output: the other bytes are the next bytes of the program.\
   Kind 1 is a screen: bytes 17 and 18 are the columns, bytes 19 and 20 are the rows, each as a big-endian number, and the other bytes are the screen bytes.\
   The client sets its terminal to that size, resets it, and then writes the screen bytes.
4. Each attached client has an output queue for each session, with a limit of 1 MiB for its output frames.\
   The thread that reads the pseudo-terminal never waits for a client.\
   When a queue is full, the engine discards it, and asks for a screen for that client, as an attach does; the frames that the writer of the connection already took stay in their order.\
   A screen frame does not count for the limit.
5. `session.write` sends input to the program.\
   Its `data` is the input bytes in Base64 (RFC 4648, with padding): the web UI encodes the text of the keyboard as UTF-8, and takes each character of binary input, such as an old mouse report, as one byte.\
   The engine puts all the bytes of a write in the input queue of the session, or refuses the write and takes none of them (`failedPrecondition` when the queue of 1 MiB has no room).\
   An answer tells that the bytes are in the queue, not that the program read them.\
   One thread of the session writes the queue to the pseudo-terminal, in order.
6. `session.resize` changes the size of the pseudo-terminal and of the kept state.\
   A session has one size: the last `session.resize` of any client sets it.\
   The engine then sends the event `session.resized` with the size to each attached client, before the output that follows the change; each terminal takes that size.\
   Known limit: the engine and the terminal each wrap the long lines of the scrollback again by their own rules, so these lines can differ until the next screen frame.
7. The engine does `session.attach`, `session.detach`, `session.write`, and `session.resize` when it reads them, in the order of the connection, and they never wait for the pseudo-terminal.\
   The web UI and the app core send the writes and the resizes of one session one after the other, so that their order is the order of the user.\
   They do not send a write again that got no answer.
8. The session ends when its shell ends.\
   The engine then reads the output that is left, for at most 1 second, and sends it.\
   After it, each attached client gets the event `session.ended` once, with the exit code (a number from 0 to 4,294,967,295, or none) and the signal that ended the shell (a number, or none; always none on Windows), and no frame of that session after it.\
   Then the engine removes the session and closes the pseudo-terminal.
9. `session.kill` does what the close of a terminal window does: the engine sends SIGHUP to the shell and to the foreground job, and closes the pseudo-terminal when the shell ends.\
   After 3 seconds, it sends SIGKILL to the shell and to the foreground job that still run.\
   On Windows, it closes the ConPTY, which ends the programs in it; the read of the output continues on its own thread until the end.\
   Known limit: a program that left the terminal, or a background job that ignores SIGHUP, can continue.

### Engine stop with sessions

1. The engine does not stop for the idle time while a session runs.
2. `shutdown` has the optional param `force`.\
   Without it, or with `false`, an engine with sessions refuses `shutdown` (`failedPrecondition`), tells the number of sessions, and continues to listen.\
   With `true`, the engine takes no new session, ends all sessions at the same time as `session.kill` does, with one limit of 3 seconds for all of them, and then stops.
3. So an app of another protocol version does not end the sessions of the engine without a question to the user.\
   The app sends `shutdown` without `force` to an engine of another version.\
   When that engine refuses, the app starts no engine, and shows the refusal; the user can then stop that engine, and the app sends `shutdown` with `force` on a new connection, before `hello`.

Status: next (M4).

## Files

```text
open a file ──► file.read: the text and its version
save ──► file.write with that version: the engine refuses when the file changed
a change on the disk ──► event worktree.changed ──► the web UI reads again
an image, a video ──► the app core reads the file in ranges for the web UI
```

### Text

1. `file.read` answers the text of a file of an open worktree, and its version.\
   The text is the bytes of the file as UTF-8, with nothing changed: the line endings and a byte order mark stay.\
   The engine refuses a file that is not UTF-8, and a file of more than 4 MiB (`failedPrecondition`), a folder (`invalidArgument`), and a path that does not exist (`notFound`).
2. The version is the SHA-256 of the bytes, as 64 hexadecimal characters.\
   So a version tells the content, and not the time: a file that a program writes again with the same bytes keeps its version.
3. `file.write` writes the text of a file.\
   With `expected`, the version that the client read, the engine reads the file again, and writes only when its version is still that one.\
   When it is not, or when the file is gone, the engine refuses with the error code `conflict`, and writes nothing.\
   With no `expected`, the engine makes a new file, and refuses a path that exists (`conflict`).\
   The answer is the new version.
4. The engine writes into the file that is there: it does not put a new file in its place.\
   So the file keeps its mode, its links, and its owner, and a program that watches it sees a change and not a new file.\
   Known limit: between the check of the version and the write, another program can change the file, and that change is lost; and a stop of the machine in the middle of a write can leave a part of the text.
5. To write over a file that changed, the web UI reads the file again, and writes with the new version, after the user said yes.\
   The engine has no write that skips the check.
6. A message to the engine has at most 16 MiB, so that the JSON of a text of 4 MiB has room.
7. `git.show` answers the text of a file in the commit `HEAD` of its worktree, for the diff.\
   It has the limits of `file.read`.\
   A file that is not in that commit answers `notFound`; the diff then shows each line as new.

### Ranges

1. `file.readRange` answers a part of a file of an open worktree: the bytes from an offset, at most 1 MiB of them, in Base64, and the size of the whole file.\
   It reads each kind of file, of each size.
2. The web UI gets an image, a video, or a sound from a URL of the app core, in a scheme of its own (`vvfile`).\
   The app core answers a request for such a URL with `file.readRange`, also a request for a range, so a large video starts at once and can seek.\
   The URL names the worktree and the path; the engine does its checks for each request, so the scheme reaches only the open worktrees.
3. The web UI can load from that scheme only images and media (the content security policy), not scripts, styles, or frames.\
   The policy also lets it load images from `https:`, for the remote images of a Markdown document that the user allowed; an image from `http:` stays blocked.\
   The app core sends each answer with `X-Content-Type-Options: nosniff` and a media type from the name of the file, and with a type that no browser runs for each other name.

### Changes

1. The engine watches each open worktree while a client that opened it is connected.\
   It does not watch the folders that git ignores, and the `.git` folder.
2. The engine collects the changes of 100 ms, and sends them to each client that opened the worktree, as one event `worktree.changed` with the paths that changed, relative to the worktree.\
   An event has at most 256 paths.\
   For more, or when the system lost changes, the event has no paths, which tells that each path can be new.
3. The engine also watches the files of the git folder that change with a commit, a checkout, or a stage (`HEAD` and `index`), and sends an event with no paths for them.
4. After an event, the web UI reads again the folders of the Explorer that the paths are in, the open files among them, and, 300 ms after the last event, the git status.\
   An open file with no unsaved edits takes the new text.\
   An open file with unsaved edits keeps them, and shows that the file changed on the disk.

### Entries

1. `directory.create` makes a folder, and `file.write` with no `expected` makes a file.
2. `entry.rename` gives a file or a folder a new path in the same worktree.\
   The engine refuses a new path that exists (`conflict`), and never writes over an entry.
3. `entry.delete` moves a file or a folder to the trash of the machine of the engine.\
   When that machine has no trash that works, the engine refuses (`failedPrecondition`), and deletes nothing.
4. Each path of these requests is a plain relative path in an open worktree, as [`conventions/engine.md`](conventions/engine.md) says, and the engine does each one through the handle of the worktree.\
   The engine refuses the `.git` entry of a worktree, and each path in it, in each request of this section (`permissionDenied`).

Status: planned (M5).

## Memory limits

Each part keeps its memory in a limit.\
The defaults are proposals.\
A setting changes each one.

| Part | Rule | Default |
| --- | --- | --- |
| Engine process | The engine process stops when no client is connected for a time. From M4, it does not stop while a session runs. | 5 minutes |
| Requests | At most 32 clients; at most 8 requests of all clients run at a time; at most 16 open requests on each connection; a message to the engine has at most 1 MiB, and from M5 at most 16 MiB. | - |
| Text files | The engine reads and writes the text of a file up to a limit. | 4 MiB |
| Sessions | The engine keeps a limited number of sessions. | 64 sessions |
| Session screen | The engine keeps the screen and the scrollback of each session. Its title, and the part of an escape sequence that is not complete, have a limit too. | 5,000 lines; 1,024 bytes; 4 KiB |
| Screen frame | The engine leaves the oldest lines of the scrollback out of a screen frame that would be larger than the limit. A cell keeps a limited number of bytes of text. | 32 MiB; 32 bytes |
| Engine output | The engine sends output only for attached sessions. Each client has an output queue for each session, with a limit. When the queue is full, the engine discards the queued output and sends the current screen again. | 1 MiB |
| Session input | The input of a session waits in a queue with a limit. The engine refuses a write to a full queue. | 1 MiB |
| App terminal output | The app core stops to read the connection when the bytes that the terminal of the web UI did not take yet reach the limit. One frame can go above it. | 1 MiB |
| App terminals | The web UI drops the terminal of a hidden tab after a time, and gets the screen again from the engine when the tab shows. | 5 minutes |
| Media and previews | The engine reads a large file in ranges, not all at once. A hidden media tab stops playback and decoding. | 1 MiB ranges |
| Explorer | The web UI reads only the open folders, and drops the folders that it does not use. A large folder scrolls virtually. | 5 minutes |
| File watch | The engine watches only the open roots, not the ignored folders, and sends the changes in batches, with a limited number of paths in a batch. | 100 ms; 256 paths |
| Git status | The web UI reads the status again after the last batch of changes. An ignored folder is one line. | 300 ms |

## Security

| Subject | Rule | Status |
| --- | --- | --- |
| Access | Remote access is off by default. When it is on, the engine listens only on 127.0.0.1 and requires a token. A remote client comes through an SSH tunnel. The engine checks the token in the WebSocket handshake, before each request, also before `shutdown`. | Planned (M6) |
| Paths | A request can reach only the folders that the user opened, and the worktrees of their repositories. The engine reads the folders through directory handles, and runs git only with the git directory that it found when the folder opened. | Done |
| Projects root | The engine also lists the [projects root](#projects-root) and makes new projects in it, through a directory handle. A remote client can open only the projects in it. | Done for the root; planned (M6) for remote clients |
| Installs | The app does not run installs for the user. | Done |
| Commands | The app types a command in the terminal, and the user presses Enter. A session has no command of its own: its program is the shell of the user. | Next (M4) |
| Previews | The Markdown preview removes HTML and scripts from the document. It blocks remote images by default, and the user can allow them for each document. | Planned (M5) |
| Files | A request reads and writes only in the open worktrees, through their handles, and never in a `.git` folder. A write needs the version that the client read. A delete goes to the trash. The web UI loads only images and media from the file scheme of the app core. | Planned (M5) |
| Sessions | A session runs as the user that runs the engine. Each client of the engine is the same owner and can use each session. So the token of a remote engine gives a shell as that user: the roots limit the requests for files and the folder where a session starts, not the commands in a shell. | Next (M4) |

## Roadmap

| Step | Scope | Status |
| --- | --- | --- |
| M1 Shell | The design tokens, the window shell, accessibility, the tabs and the menus, and the icon. | Done |
| M2 Engine base | The protocol, the roots, the folders, git, and the Explorer on real folders. | Done |
| M3 Engine process | The protocol envelope with the version check, the projects root and the project list, the engine as a daemon, and the local socket. | Done |
| M4 Terminals | The sessions of the engine: the pseudo-terminal, the screen state, attach and detach, and the terminal tabs on real sessions. | Next |
| M5 Editor and viewers | Open, edit, and save files, the diff, the Markdown preview, the media viewer, the file watch, and the Explorer menus. | Planned |
| M6 Remote | The headless install of `vvorkflow-server`, WebSocket, the token, and the connection manager. | Planned |
| M7 Tools | Search, the command palette, the settings, and the browser panel. | Planned |
| M8 Release | Signing, updates, the packages of each platform, and the checks on macOS and Windows. | Planned |
