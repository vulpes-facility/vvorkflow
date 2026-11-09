//! The vvorkflow engine: it reads the repositories, the worktrees, the folders,
//! and the git status that a client asks for, inside the roots that the user
//! opened (core value 6). Each method takes a request of `vv-protocol` and
//! returns its value or an [`EngineError`].

mod git;

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use vv_protocol::{
    ChangedPath, DirectoryEntry, EngineError, EntryKind, ErrorCode, ListDirectory, OpenFolder,
    ReadStatus, Repository, Worktree,
};

/// The engine of one machine. It keeps the roots that requests can reach.
#[derive(Default)]
pub struct Engine {
    roots: Mutex<BTreeSet<PathBuf>>,
}

impl Engine {
    /// Opens a folder and adds it, and each worktree of its repository, to the
    /// roots.
    ///
    /// Returns the repository with its worktrees, where the worktree that
    /// holds the folder is current. A folder that is not in a git repository,
    /// or a machine without git, gives one plain worktree with `git: false`.
    /// Refuses a relative path (`invalidArgument`) and a path that is not a
    /// folder (`notFound`).
    pub fn open_folder(&self, request: OpenFolder) -> Result<Repository, EngineError> {
        let path = absolute(&request.path)?;
        let folder = path
            .canonicalize()
            .map_err(|error| io_error(error, &request.path))?;
        if !folder.is_dir() {
            return Err(error(
                ErrorCode::NotFound,
                format!("{} is not a folder.", request.path),
            ));
        }
        let repository = match git::toplevel(&folder) {
            Some(top) => {
                let worktrees = git::worktrees(&top)?;
                Repository {
                    name: name_of(&worktrees.first().map_or(top.clone(), |main| main.0.clone())),
                    git: true,
                    worktrees: worktrees
                        .into_iter()
                        .map(|(path, branch)| Worktree {
                            current: path == top,
                            path: display(&path),
                            branch,
                        })
                        .collect(),
                }
            }
            None => Repository {
                name: name_of(&folder),
                git: false,
                worktrees: vec![Worktree {
                    path: display(&folder),
                    branch: None,
                    current: true,
                }],
            },
        };
        let mut roots = self.roots.lock().expect("the roots lock is never poisoned");
        for worktree in &repository.worktrees {
            roots.insert(PathBuf::from(&worktree.path));
        }
        Ok(repository)
    }

    /// Lists one folder of an opened worktree: the folders first, then the
    /// files, each in name order. The `.git` entry is left out.
    ///
    /// Refuses a worktree that is not open, and a path that leaves it, also
    /// through a symbolic link (`permissionDenied`); a path with `..` or with
    /// a root (`invalidArgument`); and a folder that does not exist
    /// (`notFound`).
    pub fn list_directory(
        &self,
        request: ListDirectory,
    ) -> Result<Vec<DirectoryEntry>, EngineError> {
        let worktree = self.root(&request.worktree)?;
        let folder = inside(&worktree, &request.path)?;
        let entries = std::fs::read_dir(&folder).map_err(|error| io_error(error, &request.path))?;
        let mut list: Vec<DirectoryEntry> = entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name() != ".git")
            .map(|entry| DirectoryEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                // A link to a folder opens as a folder.
                kind: if entry.path().is_dir() {
                    EntryKind::Folder
                } else {
                    EntryKind::File
                },
            })
            .collect();
        list.sort_by(|a, b| {
            (a.kind != EntryKind::Folder, a.name.to_lowercase())
                .cmp(&(b.kind != EntryKind::Folder, b.name.to_lowercase()))
        });
        Ok(list)
    }

    /// Reads the git status of an opened worktree: each changed, untracked,
    /// conflicted, or ignored path. Git reports an untracked or an ignored
    /// folder as one path that ends with `/`, so the list stays short also for
    /// a large ignored folder.
    ///
    /// Returns no paths for a plain folder. Refuses a worktree that is not
    /// open (`permissionDenied`), and fails when git fails
    /// (`failedPrecondition`).
    pub fn read_status(&self, request: ReadStatus) -> Result<Vec<ChangedPath>, EngineError> {
        let worktree = self.root(&request.worktree)?;
        if git::toplevel(&worktree).is_none() {
            return Ok(Vec::new());
        }
        git::status(&worktree)
    }

    /// The opened root with this path.
    fn root(&self, path: &str) -> Result<PathBuf, EngineError> {
        let path = absolute(path)?;
        let roots = self.roots.lock().expect("the roots lock is never poisoned");
        roots.get(&path).cloned().ok_or_else(|| {
            error(
                ErrorCode::PermissionDenied,
                format!("{} is not an open folder.", path.display()),
            )
        })
    }
}

fn absolute(path: &str) -> Result<PathBuf, EngineError> {
    let path = PathBuf::from(path);
    if path.is_absolute() {
        Ok(path)
    } else {
        Err(error(
            ErrorCode::InvalidArgument,
            format!("{} is not an absolute path.", path.display()),
        ))
    }
}

/// Joins a relative path to a root, and checks that the result stays in it.
fn inside(root: &Path, relative: &str) -> Result<PathBuf, EngineError> {
    let relative = Path::new(relative);
    if relative
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(error(
            ErrorCode::InvalidArgument,
            format!("{} is not a plain relative path.", relative.display()),
        ));
    }
    let path = root
        .join(relative)
        .canonicalize()
        .map_err(|error| io_error(error, &relative.display().to_string()))?;
    if path.starts_with(root) {
        Ok(path)
    } else {
        Err(error(
            ErrorCode::PermissionDenied,
            format!("{} leaves the open folder.", relative.display()),
        ))
    }
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map_or_else(|| display(path), |name| name.to_string_lossy().into_owned())
}

fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn error(code: ErrorCode, message: String) -> EngineError {
    EngineError { code, message }
}

fn io_error(error: std::io::Error, path: &str) -> EngineError {
    match error.kind() {
        std::io::ErrorKind::NotFound => {
            self::error(ErrorCode::NotFound, format!("{path} does not exist."))
        }
        std::io::ErrorKind::PermissionDenied => self::error(
            ErrorCode::PermissionDenied,
            format!("The system does not let the engine read {path}."),
        ),
        _ => self::error(ErrorCode::FailedPrecondition, format!("{path}: {error}")),
    }
}
