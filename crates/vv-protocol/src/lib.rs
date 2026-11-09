//! The protocol of the vvorkflow engine: the requests that a client sends, and
//! the values and the errors that the engine sends back.
//!
//! A client does not know if the engine is local or remote (core value 4), so
//! each type is plain data that serializes to JSON. `schema/protocol.schema.json`
//! is generated from these types, and the TypeScript client is generated from it.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

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

/// One worktree of a repository. In vvorkflow, one worktree is one project.
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

/// The JSON Schema of each type that crosses the protocol, in one document,
/// with each type written in place, so that a generator needs no references.
pub fn schema() -> schemars::Schema {
    #[derive(JsonSchema)]
    #[allow(dead_code)]
    struct Protocol {
        open_folder: OpenFolder,
        repository: Repository,
        list_directory: ListDirectory,
        directory_entry: DirectoryEntry,
        read_status: ReadStatus,
        changed_path: ChangedPath,
        engine_error: EngineError,
    }
    schemars::generate::SchemaSettings::draft2020_12()
        .with(|settings| settings.inline_subschemas = true)
        .into_generator()
        .into_root_schema_for::<Protocol>()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    /// The committed schema MUST match the types; the TypeScript client is
    /// generated from it. `VV_UPDATE_SCHEMA=1 cargo test` writes it again.
    #[test]
    fn the_committed_schema_is_current() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("schema/protocol.schema.json");
        let current = serde_json::to_string_pretty(&super::schema()).unwrap() + "\n";
        if std::env::var_os("VV_UPDATE_SCHEMA").is_some() {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &current).unwrap();
        }
        let committed = std::fs::read_to_string(&path).unwrap_or_default();
        assert!(
            committed == current,
            "{} is out of date: run `VV_UPDATE_SCHEMA=1 cargo test -p vv-protocol`",
            path.display()
        );
    }
}
