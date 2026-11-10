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
pub const PROTOCOL_VERSION: u32 = 2;

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
    /// Stops the engine process. Answers [`Done`], then the process stops.
    /// It is valid before `hello`, and its shape never changes, so that each
    /// app can stop an engine of an older version.
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
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Shutdown {}

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

/// The JSON Schema of each type that the web UI sends or reads, in one document,
/// with each type written in place, so that a generator needs no references.
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
