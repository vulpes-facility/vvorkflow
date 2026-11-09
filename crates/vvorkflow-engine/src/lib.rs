//! The vvorkflow engine: it lists the projects of the projects root, and reads
//! the repositories, the worktrees, the folders, and the git status that a
//! client asks for, inside the folders that the user opened (core value 6).
//! Each method takes a request of `vvorkflow-protocol` and returns its value
//! or an [`EngineError`].

mod git;

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use vvorkflow_protocol::{
    ChangedPath, DirectoryEntry, EngineError, EntryKind, ErrorCode, Hello, ListDirectory,
    ListProjects, OpenFolder, PROTOCOL_VERSION, Project, ReadStatus, Repository, Request, Response,
    Welcome, Worktree,
};

/// The environment variable that names the projects root.
pub const ROOT_VARIABLE: &str = "VVORKFLOW_ROOT";

/// The projects root of this process: the folder in `VVORKFLOW_ROOT`, or
/// `~/vvorkflow`. See [`projects_root`].
pub fn projects_root_from_env() -> Result<PathBuf, EngineError> {
    projects_root(std::env::var_os(ROOT_VARIABLE), std::env::home_dir())
}

/// Finds the projects root, and checks it.
///
/// Returns the canonical path of `value` when it is set and not empty. Else
/// returns `vvorkflow` in `home`, and makes that folder when it does not
/// exist. Refuses (`failedPrecondition`) a value that is not an absolute path
/// to a folder, a missing home folder, a default root that is not a folder or
/// that the engine cannot make, and a root whose path is not UTF-8, because
/// the protocol sends paths as text.
pub fn projects_root(
    value: Option<OsString>,
    home: Option<PathBuf>,
) -> Result<PathBuf, EngineError> {
    let refused = |message: String| error(ErrorCode::FailedPrecondition, message);
    let path = match value.filter(|value| !value.is_empty()) {
        Some(value) => {
            let path = PathBuf::from(&value);
            if !path.is_absolute() {
                return Err(refused(format!(
                    "{ROOT_VARIABLE} is not an absolute path: {}.",
                    path.display()
                )));
            }
            path
        }
        None => {
            let home = home.ok_or_else(|| {
                refused(format!(
                    "The engine cannot find the home folder. Set {ROOT_VARIABLE}."
                ))
            })?;
            let path = home.join("vvorkflow");
            match std::fs::create_dir(&path) {
                Ok(()) => {}
                Err(made) if made.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(made) => {
                    return Err(refused(format!(
                        "The engine cannot make {}: {made}.",
                        path.display()
                    )));
                }
            }
            path
        }
    };
    match path.canonicalize() {
        Ok(folder) if folder.is_dir() && folder.to_str().is_some() => Ok(folder),
        Ok(folder) if folder.is_dir() => Err(refused(format!(
            "The path of the projects root is not UTF-8: {}.",
            folder.display()
        ))),
        _ => Err(refused(format!(
            "The projects root {} is not a folder.",
            path.display()
        ))),
    }
}

/// A folder that a request can reach.
struct Root {
    path: PathBuf,
    /// The folder, opened when the user opened it. The engine reads through
    /// this handle, so a path that changes later, for example to a symbolic
    /// link, cannot lead a read out of the folder.
    dir: Dir,
    /// The git directory of the worktree, as git named it when the folder
    /// opened, or None for a plain folder. Git runs with it, so git never
    /// looks for a repository above the folder.
    git_dir: Option<PathBuf>,
}

/// The engine of one machine. It keeps the projects root, and the roots that
/// requests can reach.
pub struct Engine {
    projects: Projects,
    roots: Mutex<BTreeMap<PathBuf, Arc<Root>>>,
}

/// The projects root, opened as a handle when the engine starts.
struct Projects {
    path: PathBuf,
    dir: Dir,
}

impl Engine {
    /// Starts the engine on a projects root from [`projects_root`].
    ///
    /// Refuses a path that is not an absolute path to a folder that the engine
    /// can open.
    pub fn new(projects_root: &Path) -> Result<Engine, EngineError> {
        if !projects_root.is_absolute() {
            return Err(error(
                ErrorCode::InvalidArgument,
                format!("{} is not an absolute path.", projects_root.display()),
            ));
        }
        Ok(Engine {
            projects: Projects {
                dir: open_dir(projects_root)?,
                path: projects_root.to_path_buf(),
            },
            roots: Mutex::default(),
        })
    }

    /// Does one request.
    ///
    /// Returns the value of its method, or the error of that method. Refuses
    /// `shutdown` (`failedPrecondition`), which the engine process does
    /// itself.
    pub fn handle(&self, request: Request) -> Result<Response, EngineError> {
        Ok(match request {
            Request::Hello(hello) => Response::Welcome(self.hello(hello)?),
            Request::ListProjects(list) => Response::Projects(self.list_projects(list)?),
            Request::OpenFolder(open) => Response::Repository(self.open_folder(open)?),
            Request::ListDirectory(list) => Response::Entries(self.list_directory(list)?),
            Request::ReadStatus(read) => Response::Status(self.read_status(read)?),
            Request::Shutdown(_) => {
                return Err(error(
                    ErrorCode::FailedPrecondition,
                    "Only the engine process can stop.".to_owned(),
                ));
            }
        })
    }

    /// Checks the protocol version of a client.
    ///
    /// Returns the version and the projects root. Refuses a client of another
    /// protocol version (`failedPrecondition`).
    pub fn hello(&self, request: Hello) -> Result<Welcome, EngineError> {
        if request.protocol != PROTOCOL_VERSION {
            return Err(error(
                ErrorCode::FailedPrecondition,
                format!(
                    "The app uses protocol {}, and the engine uses protocol {PROTOCOL_VERSION}. Update the older one.",
                    request.protocol
                ),
            ));
        }
        Ok(Welcome {
            protocol: PROTOCOL_VERSION,
            root: display(&self.projects.path),
        })
    }

    /// Lists the projects: the folders directly in the projects root, in name
    /// order.
    ///
    /// Leaves out the files, the names that start with `.` or that are not
    /// UTF-8, and the symbolic links that lead out of the root. Fails when the engine cannot read the
    /// root (`notFound` or `failedPrecondition`).
    pub fn list_projects(&self, _request: ListProjects) -> Result<Vec<Project>, EngineError> {
        let root = &self.projects;
        let entries = root
            .dir
            .entries()
            .map_err(|error| io_error(error, &display(&root.path)))?;
        let mut list: Vec<Project> = entries
            .filter_map(Result::ok)
            // A name that is not UTF-8 has no exact text in the protocol.
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| !name.starts_with('.'))
            // The handle does not follow a link out of the root.
            .filter(|name| root.dir.metadata(name).is_ok_and(|data| data.is_dir()))
            .map(|name| Project {
                git: root
                    .dir
                    .symlink_metadata(Path::new(&name).join(".git"))
                    .is_ok(),
                path: display(&root.path.join(&name)),
                name,
            })
            .collect();
        list.sort_by_key(|project| project.name.to_lowercase());
        Ok(list)
    }

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
        let (repository, roots) = match git::toplevel(&folder) {
            Some(top) => {
                let mut worktrees = git::worktrees(&top)?;
                let name = name_of(worktrees.first().map_or(&top, |main| &main.0));
                // Git also lists a worktree whose folder is gone until it is
                // pruned: leave such a worktree out, but not the opened one.
                let mut roots = Vec::new();
                let mut available = Vec::new();
                for (path, branch) in worktrees.drain(..) {
                    let root = open_dir(path.as_path()).and_then(|dir| {
                        Ok(Root {
                            dir,
                            git_dir: Some(git::git_dir(&path)?),
                            path: path.clone(),
                        })
                    });
                    match root {
                        Ok(root) => {
                            roots.push(root);
                            available.push((path, branch));
                        }
                        Err(error) if path == top => return Err(error),
                        Err(_) => {}
                    }
                }
                let worktrees = available;
                let repository = Repository {
                    name,
                    git: true,
                    worktrees: worktrees
                        .into_iter()
                        .map(|(path, branch)| Worktree {
                            current: path == top,
                            path: display(&path),
                            branch,
                        })
                        .collect(),
                };
                (repository, roots)
            }
            None => {
                let root = Root {
                    dir: open_dir(&folder)?,
                    git_dir: None,
                    path: folder.clone(),
                };
                let repository = Repository {
                    name: name_of(&folder),
                    git: false,
                    worktrees: vec![Worktree {
                        path: display(&folder),
                        branch: None,
                        current: true,
                    }],
                };
                (repository, vec![root])
            }
        };
        let mut known = self.roots.lock().expect("the roots lock is never poisoned");
        for root in roots {
            known.insert(root.path.clone(), Arc::new(root));
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
        let root = self.root(&request.worktree)?;
        let relative = plain_relative(&request.path)?;
        let folder = if relative.as_os_str().is_empty() {
            root.dir.try_clone()
        } else {
            root.dir.open_dir(relative)
        }
        .map_err(|error| io_error(error, &request.path))?;
        let entries = folder
            .entries()
            .map_err(|error| io_error(error, &request.path))?;
        let mut list: Vec<DirectoryEntry> = entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name() != ".git")
            .map(|entry| {
                let name = entry.file_name();
                // A link to a folder in the root opens as a folder, also when
                // it leads up and back down, as `src/link -> ../shared`. The
                // root handle does not follow a link out of the root.
                let is_folder = root
                    .dir
                    .metadata(relative.join(&name))
                    .is_ok_and(|metadata| metadata.is_dir());
                DirectoryEntry {
                    name: name.to_string_lossy().into_owned(),
                    kind: if is_folder {
                        EntryKind::Folder
                    } else {
                        EntryKind::File
                    },
                }
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
    /// open, or whose path is no longer the folder that was opened
    /// (`permissionDenied`), and fails when git fails, for example when the
    /// git directory is gone (`failedPrecondition`).
    pub fn read_status(&self, request: ReadStatus) -> Result<Vec<ChangedPath>, EngineError> {
        let root = self.root(&request.worktree)?;
        let Some(git_dir) = &root.git_dir else {
            return Ok(Vec::new());
        };
        // Git takes a path, not the handle: check that the path is still the
        // opened folder just before git runs.
        if !same_folder(&root) {
            return Err(error(
                ErrorCode::PermissionDenied,
                format!("{} is no longer the open folder.", root.path.display()),
            ));
        }
        git::status(git_dir, &root.path)
    }

    /// The opened root with this path.
    fn root(&self, path: &str) -> Result<Arc<Root>, EngineError> {
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

fn open_dir(path: &Path) -> Result<Dir, EngineError> {
    Dir::open_ambient_dir(path, ambient_authority())
        .map_err(|error| io_error(error, &path.display().to_string()))
}

/// Whether the path of a root still leads to the folder of its handle.
fn same_folder(root: &Root) -> bool {
    let Ok(handle) = root.dir.try_clone() else {
        return false;
    };
    let (Ok(opened), Ok(now)) = (
        same_file::Handle::from_file(handle.into_std_file()),
        same_file::Handle::from_path(&root.path),
    ) else {
        return false;
    };
    opened == now
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

/// A relative path of plain names only: no `..`, no `.`, and no root.
fn plain_relative(relative: &str) -> Result<&Path, EngineError> {
    let path = Path::new(relative);
    if path
        .components()
        .all(|part| matches!(part, Component::Normal(_)))
    {
        Ok(path)
    } else {
        Err(error(
            ErrorCode::InvalidArgument,
            format!("{relative} is not a plain relative path."),
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
        // The handle refuses a path that leads out of its folder with this kind.
        std::io::ErrorKind::PermissionDenied => self::error(
            ErrorCode::PermissionDenied,
            format!("The engine cannot read {path} from the open folder."),
        ),
        _ => self::error(ErrorCode::FailedPrecondition, format!("{path}: {error}")),
    }
}
