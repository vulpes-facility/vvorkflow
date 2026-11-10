//! The protocol of the vvorkflow engine: the requests that a client sends, and
//! the values and the errors that the engine sends back.
//!
//! A client does not know if the engine is local or remote (core value 2), so
//! each type is plain data that serializes to JSON. `schema/protocol.schema.json`
//! is generated from these types, and the TypeScript client is generated from it.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The version of this protocol. It changes at each change that an older
/// client or engine cannot read, also a new method.
pub const PROTOCOL_VERSION: u32 = 3;

/// A request to the engine: its method, and its params.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "method", content = "params")]
pub enum Request {
    /// The first request of a connection. Answers [`Welcome`].
    #[serde(rename = "hello")]
    Hello(Hello),
    /// Answers each [`Project`] in the projects root.
    #[serde(rename = "project.list")]
    ListProjects(ListProjects),
    /// Makes a folder in the projects root. Answers its [`Project`].
    #[serde(rename = "project.create")]
    CreateProject(CreateProject),
    /// Answers a [`Repository`].
    #[serde(rename = "folder.open")]
    OpenFolder(OpenFolder),
    /// Answers each [`DirectoryEntry`] of the folder.
    #[serde(rename = "directory.list")]
    ListDirectory(ListDirectory),
    /// Answers each [`ChangedPath`] of the worktree.
    #[serde(rename = "git.status")]
    ReadStatus(ReadStatus),
    /// Answers each [`Session`] of the engine, in the order of its start.
    #[serde(rename = "session.list")]
    ListSessions(ListSessions),
    /// Starts the shell of the user in a new pseudo-terminal. Answers its
    /// [`Session`].
    #[serde(rename = "session.create")]
    CreateSession(CreateSession),
    /// Sends the screen and then the output of a session to this connection.
    /// Answers the [`Session`].
    #[serde(rename = "session.attach")]
    AttachSession(AttachSession),
    /// Stops the output of a session to this connection. Answers [`Done`].
    #[serde(rename = "session.detach")]
    DetachSession(DetachSession),
    /// Puts input bytes in the input queue of a session. Answers [`Done`].
    #[serde(rename = "session.write")]
    WriteSession(WriteSession),
    /// Changes the size of a session. Answers [`Done`].
    #[serde(rename = "session.resize")]
    ResizeSession(ResizeSession),
    /// Ends a session as the close of a terminal window does. Answers
    /// [`Done`]; the event `session.ended` follows.
    #[serde(rename = "session.kill")]
    KillSession(KillSession),
    /// Stops the engine process. Answers [`Done`], then the process stops.
    /// It is valid before `hello`, and its shape never changes from protocol
    /// 3, so that each app can stop an engine of another version.
    #[serde(rename = "shutdown")]
    Shutdown(Shutdown),
}

/// The requests that a client keeps open on one connection at most: sent,
/// and not answered yet. The engine closes the connection of a client that
/// sends more, so that a client cannot fill the memory of the engine.
pub const MAX_OPEN_REQUESTS: usize = 16;

/// A request on a connection to the engine process, with the id that its
/// answer repeats. The client picks the ids; each one is unique while its
/// request is open.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClientMessage {
    pub id: u64,
    #[serde(flatten)]
    pub request: Request,
}

/// The answer to one [`ClientMessage`]: its value, or its error. A client
/// that only passes the value on reads it as `ServerMessage<serde_json::Value>`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ServerMessage<R = Response> {
    Result { id: u64, result: R },
    Error { id: u64, error: EngineError },
}

/// The value of a request, in the type that its method gives.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Response {
    Welcome(Welcome),
    Projects(Vec<Project>),
    Project(Project),
    Repository(Repository),
    Entries(Vec<DirectoryEntry>),
    Status(Vec<ChangedPath>),
    Session(Session),
    Sessions(Vec<Session>),
    /// Last: a value without fields reads each object.
    Done(Done),
}

/// Starts a connection with the protocol version of the client.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub protocol: u32,
}

/// The answer to [`Hello`] when the engine speaks the protocol of the client.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Welcome {
    pub protocol: u32,
    /// The absolute path of the projects root.
    pub root: String,
}

/// Stops the engine process.
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Shutdown {
    /// False, or not set: an engine with sessions refuses to stop. True: the
    /// engine ends each session, and then stops.
    #[serde(default)]
    pub force: bool,
}

/// The answer of a request that has no value.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Done {}

/// Lists the projects: the folders directly in the projects root.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListProjects {}

/// A folder directly in the projects root.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub name: String,
    /// The absolute path, which `folder.open` takes.
    pub path: String,
    /// True when the folder has a `.git` entry.
    pub git: bool,
}

/// Makes a project: a new, empty folder directly in the projects root.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateProject {
    /// The name of the folder: one name that each system accepts, which does
    /// not start with a dot.
    pub name: String,
}

/// Opens a folder: a git repository, or a plain folder.
/// The engine adds the folder, and each worktree of its repository, to the
/// roots that later requests can reach (core value 6).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OpenFolder {
    /// An absolute path on the machine of the engine.
    pub path: String,
}

/// A repository and its worktrees, or a plain folder as one worktree.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    /// The name of the folder of the main worktree.
    pub name: String,
    /// False for a plain folder, which has no git status.
    pub git: bool,
    pub worktrees: Vec<Worktree>,
}

/// One worktree of a repository.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    /// The absolute path of the worktree.
    pub path: String,
    /// The checked-out branch, without `refs/heads/`. None when the HEAD is
    /// detached, or for a plain folder.
    pub branch: Option<String>,
    /// True for the worktree of the opened folder.
    pub current: bool,
}

/// Lists one folder of a worktree. The engine reads only this folder, so that
/// a large tree, such as `node_modules`, costs nothing until the user opens it.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListDirectory {
    /// The absolute path of the worktree.
    pub worktree: String,
    /// The folder, relative to the worktree, with `/` between the names.
    /// An empty path is the worktree itself.
    pub path: String,
}

/// An entry of a folder.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub kind: EntryKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    File,
    Folder,
}

/// Reads the git status of a worktree.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadStatus {
    /// The absolute path of the worktree.
    pub worktree: String,
}

/// A path with a git status, relative to its worktree, with `/` between the
/// names. A folder that git reports as a whole, such as an ignored or an
/// untracked folder, ends with `/`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangedPath {
    pub path: String,
    pub status: GitStatus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum GitStatus {
    Added,
    Modified,
    Deleted,
    Untracked,
    Conflict,
    Ignored,
}

/// The fewest columns of a session.
pub const MIN_COLUMNS: u16 = 2;
/// The most columns of a session.
pub const MAX_COLUMNS: u16 = 500;
/// The fewest rows of a session.
pub const MIN_ROWS: u16 = 1;
/// The most rows of a session.
pub const MAX_ROWS: u16 = 200;

/// Lists the terminal sessions of the engine.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListSessions {}

/// A terminal session: a pseudo-terminal with the shell of the user in it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// 16 characters, each a digit or a lowercase letter from `a` to `f`.
    pub id: String,
    /// The last title that the program set, or the name of the shell.
    pub title: String,
    /// The absolute path of the folder where the shell started.
    pub folder: String,
    #[schemars(range(min = 2, max = 500))]
    pub columns: u16,
    #[schemars(range(min = 1, max = 200))]
    pub rows: u16,
}

/// Starts the shell of the user in a new pseudo-terminal. The request has no
/// command: the user types each command (core value 6).
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSession {
    /// The absolute path of an open worktree, where the shell starts. None
    /// is the projects root.
    #[serde(default)]
    pub worktree: Option<String>,
    #[schemars(range(min = 2, max = 500))]
    pub columns: u16,
    #[schemars(range(min = 1, max = 200))]
    pub rows: u16,
}

/// Attaches the connection to a session: the screen of the session comes as
/// a binary frame, and then each byte of its output. A second attach sends
/// the screen again.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AttachSession {
    pub session: String,
}

/// Detaches the connection from a session; the session continues.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DetachSession {
    pub session: String,
}

/// Sends input to the program of a session.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WriteSession {
    pub session: String,
    /// The input bytes in Base64 (RFC 4648, with padding).
    pub data: String,
}

/// Changes the size of the pseudo-terminal and of the kept screen.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResizeSession {
    pub session: String,
    #[schemars(range(min = 2, max = 500))]
    pub columns: u16,
    #[schemars(range(min = 1, max = 200))]
    pub rows: u16,
}

/// Ends a session: the shell and its foreground job get SIGHUP, and SIGKILL
/// after 3 seconds.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct KillSession {
    pub session: String,
}

/// A message without an id, which the engine can send at any time after
/// `hello`, between the answers. The engine sends the events of a session
/// only to its attached clients.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "event", content = "params")]
pub enum Event {
    /// The shell of a session ended. No frame of that session follows.
    #[serde(rename = "session.ended")]
    SessionEnded(SessionEnded),
    /// A session has a new size, from the output that follows.
    #[serde(rename = "session.resized")]
    SessionResized(SessionResized),
    /// The connection of the app core to the engine ended. Only the app core
    /// sends it, after the last frame of that connection.
    #[serde(rename = "connection.closed")]
    ConnectionClosed(ConnectionClosed),
}

/// The end of the shell of a session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionEnded {
    pub session: String,
    /// The exit code of the shell, or none when a signal ended it.
    pub exit_code: Option<u32>,
    /// The signal that ended the shell, or none. Always none on Windows.
    pub signal: Option<i32>,
}

/// The new size of a session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionResized {
    pub session: String,
    #[schemars(range(min = 2, max = 500))]
    pub columns: u16,
    #[schemars(range(min = 1, max = 200))]
    pub rows: u16,
}

/// The end of the connection of the app core to the engine.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionClosed {}

/// The length of a session id.
pub const SESSION_ID_LENGTH: usize = 16;

/// The kind of a binary frame that holds output of a program.
pub const FRAME_OUTPUT: u8 = 0;

/// The kind of a binary frame that holds a screen.
pub const FRAME_SCREEN: u8 = 1;

/// The largest screen bytes of a screen frame: 32 MiB.
pub const MAX_SCREEN: usize = 32 << 20;

/// The largest binary frame: a screen frame with [`MAX_SCREEN`] bytes, and
/// its 21 bytes before them.
pub const MAX_FRAME: usize = MAX_SCREEN + 21;

/// A binary frame of terminal output. Byte 0 is the kind, and bytes 1 to 16
/// are the session id. A screen frame then has the columns and the rows, each
/// as a big-endian `u16`, and then the screen bytes. An output frame has the
/// next bytes of the program.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Frame<'a> {
    /// The next bytes of the program.
    Output { session: &'a str, output: &'a [u8] },
    /// Bytes that draw the state of the session in a terminal that was reset
    /// to this size.
    Screen {
        session: &'a str,
        columns: u16,
        rows: u16,
        screen: &'a [u8],
    },
}

impl<'a> Frame<'a> {
    /// The bytes of the frame. The session id MUST have
    /// [`SESSION_ID_LENGTH`] bytes, as each id of the engine has.
    pub fn encode(&self) -> Vec<u8> {
        let (kind, session, size, data) = match *self {
            Frame::Output { session, output } => (FRAME_OUTPUT, session, None, output),
            Frame::Screen {
                session,
                columns,
                rows,
                screen,
            } => (FRAME_SCREEN, session, Some((columns, rows)), screen),
        };
        debug_assert_eq!(session.len(), SESSION_ID_LENGTH);
        let mut bytes = Vec::with_capacity(1 + SESSION_ID_LENGTH + 4 + data.len());
        bytes.push(kind);
        bytes.extend_from_slice(session.as_bytes());
        if let Some((columns, rows)) = size {
            bytes.extend_from_slice(&columns.to_be_bytes());
            bytes.extend_from_slice(&rows.to_be_bytes());
        }
        bytes.extend_from_slice(data);
        bytes
    }

    /// Reads a frame.
    ///
    /// Returns None for bytes that are not a frame of this protocol: an
    /// unknown kind, an id that is not 16 digits and lowercase letters from
    /// `a` to `f`, a screen frame without its size, a size outside the limits
    /// of a session, or screen bytes larger than [`MAX_SCREEN`].
    pub fn parse(bytes: &'a [u8]) -> Option<Frame<'a>> {
        let (&kind, rest) = bytes.split_first()?;
        let id = rest.get(..SESSION_ID_LENGTH)?;
        if !id
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
        {
            return None;
        }
        // Only ASCII digits and letters: always UTF-8.
        let session = std::str::from_utf8(id).ok()?;
        let rest = &rest[SESSION_ID_LENGTH..];
        match kind {
            FRAME_OUTPUT => Some(Frame::Output {
                session,
                output: rest,
            }),
            FRAME_SCREEN => {
                let columns = u16::from_be_bytes(rest.get(..2)?.try_into().ok()?);
                let rows = u16::from_be_bytes(rest.get(2..4)?.try_into().ok()?);
                let screen = &rest[4..];
                let valid = (MIN_COLUMNS..=MAX_COLUMNS).contains(&columns)
                    && (MIN_ROWS..=MAX_ROWS).contains(&rows)
                    && screen.len() <= MAX_SCREEN;
                valid.then_some(Frame::Screen {
                    session,
                    columns,
                    rows,
                    screen,
                })
            }
            _ => None,
        }
    }
}

/// A refused or failed request.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineError {
    pub code: ErrorCode,
    /// A sentence for the user.
    pub message: String,
}

/// The kind of an error: `notFound`, the path does not exist;
/// `permissionDenied`, the path is outside the roots that the engine can
/// reach; `invalidArgument`, the request is not valid, for example a relative
/// path; `failedPrecondition`, the state does not let the request occur, for
/// example git is missing. The variants have no doc comments of their own,
/// so that the schema keeps them as one plain enum.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    NotFound,
    PermissionDenied,
    InvalidArgument,
    FailedPrecondition,
}

/// The JSON Schema of each type that the web UI sends or reads, also the
/// events, in one document, with each type written in place, so that a
/// generator needs no references.
/// The keyword `x-protocol-version` holds [`PROTOCOL_VERSION`], so that a
/// client can check its own version against it. The envelope of a connection,
/// [`ClientMessage`] and [`ServerMessage`], is not in it: only the app core
/// reads it.
pub fn schema() -> schemars::Schema {
    #[derive(JsonSchema)]
    #[allow(dead_code)]
    struct Protocol {
        request: Request,
        hello: Hello,
        welcome: Welcome,
        list_projects: ListProjects,
        create_project: CreateProject,
        shutdown: Shutdown,
        done: Done,
        project: Project,
        open_folder: OpenFolder,
        repository: Repository,
        list_directory: ListDirectory,
        directory_entry: DirectoryEntry,
        read_status: ReadStatus,
        changed_path: ChangedPath,
        list_sessions: ListSessions,
        create_session: CreateSession,
        attach_session: AttachSession,
        detach_session: DetachSession,
        write_session: WriteSession,
        resize_session: ResizeSession,
        kill_session: KillSession,
        session: Session,
        event: Event,
        engine_error: EngineError,
    }
    let mut schema = schemars::generate::SchemaSettings::draft2020_12()
        .with(|settings| settings.inline_subschemas = true)
        .into_generator()
        .into_root_schema_for::<Protocol>();
    schema.insert("x-protocol-version".to_owned(), PROTOCOL_VERSION.into());
    schema
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use serde_json::json;

    /// The envelope keeps `method` and `params` next to `id`, as
    /// `docs/architecture.md` shows.
    #[test]
    fn the_envelope_has_the_shape_of_the_architecture() {
        let message = ClientMessage {
            id: 7,
            request: Request::OpenFolder(OpenFolder {
                path: "/code/app".to_owned(),
            }),
        };
        let text = json!({"id": 7, "method": "folder.open", "params": {"path": "/code/app"}});
        assert_eq!(serde_json::to_value(&message).unwrap(), text);
        let read: ClientMessage = serde_json::from_value(text).unwrap();
        assert!(matches!(read.request, Request::OpenFolder(open) if open.path == "/code/app"));

        let done: ServerMessage = ServerMessage::Result {
            id: 7,
            result: Response::Done(Done {}),
        };
        assert_eq!(
            serde_json::to_value(&done).unwrap(),
            json!({"id": 7, "result": {}})
        );
        let refused: ServerMessage = ServerMessage::Error {
            id: 8,
            error: EngineError {
                code: ErrorCode::NotFound,
                message: "gone".to_owned(),
            },
        };
        let text = json!({"id": 8, "error": {"code": "notFound", "message": "gone"}});
        assert_eq!(serde_json::to_value(&refused).unwrap(), text);

        // A client that passes the value on reads it as JSON.
        let read: ServerMessage<serde_json::Value> = serde_json::from_value(text).unwrap();
        assert!(matches!(read, ServerMessage::Error { id: 8, .. }));
        let read: ServerMessage<serde_json::Value> =
            serde_json::from_value(json!({"id": 9, "result": []})).unwrap();
        assert_eq!(
            read,
            ServerMessage::Result {
                id: 9,
                result: json!([])
            }
        );
    }

    /// `shutdown` takes `{}` from each app, and `force` from protocol 3.
    #[test]
    fn shutdown_takes_its_old_and_its_new_params() {
        let old: ClientMessage =
            serde_json::from_value(json!({"id": 1, "method": "shutdown", "params": {}})).unwrap();
        assert!(matches!(
            old.request,
            Request::Shutdown(Shutdown { force: false })
        ));
        let new: ClientMessage = serde_json::from_value(
            json!({"id": 2, "method": "shutdown", "params": {"force": true}}),
        )
        .unwrap();
        assert!(matches!(
            new.request,
            Request::Shutdown(Shutdown { force: true })
        ));
    }

    /// An event has an `event` and `params`, and no `id`.
    #[test]
    fn the_events_have_the_shape_of_the_architecture() {
        let ended = Event::SessionEnded(SessionEnded {
            session: "5f0c2a9e41b7d386".to_owned(),
            exit_code: Some(0),
            signal: None,
        });
        let text = json!({"event": "session.ended", "params": {"session": "5f0c2a9e41b7d386", "exitCode": 0, "signal": null}});
        assert_eq!(serde_json::to_value(&ended).unwrap(), text);
        assert_eq!(serde_json::from_value::<Event>(text).unwrap(), ended);

        let resized = Event::SessionResized(SessionResized {
            session: "5f0c2a9e41b7d386".to_owned(),
            columns: 120,
            rows: 30,
        });
        assert_eq!(
            serde_json::to_value(&resized).unwrap(),
            json!({"event": "session.resized", "params": {"session": "5f0c2a9e41b7d386", "columns": 120, "rows": 30}})
        );
        assert_eq!(
            serde_json::to_value(Event::ConnectionClosed(ConnectionClosed {})).unwrap(),
            json!({"event": "connection.closed", "params": {}})
        );
        // A message with an id is not an event.
        assert!(serde_json::from_value::<Event>(json!({"id": 1, "result": {}})).is_err());
    }

    /// The answers are untagged, so each value MUST read back as its own
    /// variant: no variant before it takes its fields. An empty list reads as
    /// the first list, which is the same JSON.
    #[test]
    fn no_value_shadows_another() {
        let session = Session {
            id: "5f0c2a9e41b7d386".to_owned(),
            title: "zsh".to_owned(),
            folder: "/code/app".to_owned(),
            columns: 120,
            rows: 30,
        };
        let project = Project {
            name: "app".to_owned(),
            path: "/code/app".to_owned(),
            git: true,
        };
        let values = [
            Response::Welcome(Welcome {
                protocol: PROTOCOL_VERSION,
                root: "/code".to_owned(),
            }),
            Response::Projects(vec![project.clone()]),
            Response::Project(project),
            Response::Repository(Repository {
                name: "app".to_owned(),
                git: false,
                worktrees: vec![],
            }),
            Response::Entries(vec![DirectoryEntry {
                name: "a".to_owned(),
                kind: EntryKind::File,
            }]),
            Response::Status(vec![ChangedPath {
                path: "a".to_owned(),
                status: GitStatus::Added,
            }]),
            Response::Session(session.clone()),
            Response::Sessions(vec![session]),
            Response::Done(Done {}),
        ];
        for value in values {
            let text = serde_json::to_value(&value).unwrap();
            assert_eq!(serde_json::from_value::<Response>(text).unwrap(), value);
        }
    }

    #[test]
    fn a_frame_reads_back() {
        let id = "5f0c2a9e41b7d386";
        let output = Frame::Output {
            session: id,
            output: b"\x1b[1mbold",
        };
        let bytes = output.encode();
        assert_eq!(bytes[0], FRAME_OUTPUT);
        assert_eq!(&bytes[1..17], id.as_bytes());
        assert_eq!(&bytes[17..], b"\x1b[1mbold");
        assert_eq!(Frame::parse(&bytes), Some(output));

        let screen = Frame::Screen {
            session: id,
            columns: 500,
            rows: 200,
            screen: b"\x1b[H",
        };
        let bytes = screen.encode();
        assert_eq!(bytes[0], FRAME_SCREEN);
        assert_eq!(&bytes[17..21], &[0x01, 0xf4, 0x00, 0xc8]);
        assert_eq!(Frame::parse(&bytes), Some(screen));

        // An output frame can be empty; a screen frame has its size.
        let empty = Frame::Output {
            session: id,
            output: b"",
        };
        assert_eq!(Frame::parse(&empty.encode()), Some(empty));
        assert_eq!(Frame::parse(&bytes[..20]), None);
    }

    #[test]
    fn a_frame_that_is_not_valid_is_refused() {
        let mut frame = Frame::Output {
            session: "5f0c2a9e41b7d386",
            output: b"x",
        }
        .encode();
        assert_eq!(Frame::parse(&[]), None);
        assert_eq!(Frame::parse(&frame[..16]), None);
        frame[0] = 2;
        assert_eq!(Frame::parse(&frame), None);
        frame[0] = FRAME_OUTPUT;
        frame[1] = b'A';
        assert_eq!(Frame::parse(&frame), None);

        let screen = |columns, rows| {
            Frame::Screen {
                session: "5f0c2a9e41b7d386",
                columns,
                rows,
                screen: b"",
            }
            .encode()
        };
        assert!(Frame::parse(&screen(2, 1)).is_some());
        assert_eq!(Frame::parse(&screen(1, 1)), None);
        assert_eq!(Frame::parse(&screen(501, 1)), None);
        assert_eq!(Frame::parse(&screen(2, 0)), None);
        assert_eq!(Frame::parse(&screen(2, 201)), None);

        let mut large = screen(80, 24);
        large.resize(MAX_FRAME, b'x');
        assert!(Frame::parse(&large).is_some());
        large.push(b'x');
        assert_eq!(Frame::parse(&large), None);
    }

    /// The committed schema MUST match the types; the TypeScript client is
    /// generated from it. `VVORKFLOW_UPDATE_SCHEMA=1 cargo test` writes it again.
    #[test]
    fn the_committed_schema_is_current() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("schema/protocol.schema.json");
        let current = serde_json::to_string_pretty(&super::schema()).unwrap() + "\n";
        if std::env::var_os("VVORKFLOW_UPDATE_SCHEMA").is_some() {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &current).unwrap();
        }
        let committed = std::fs::read_to_string(&path).unwrap_or_default();
        assert!(
            committed == current,
            "{} is out of date: run `VVORKFLOW_UPDATE_SCHEMA=1 cargo test -p vvorkflow-protocol`",
            path.display()
        );
    }
}
