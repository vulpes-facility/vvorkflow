//! Where the engine process listens: a Unix socket in a folder that only the
//! user can open, or a named pipe on Windows, with a lock file and a log file
//! in the same folder.

use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

/// The local endpoint of one engine process.
#[derive(Clone, Debug)]
pub struct Endpoint {
    folder: PathBuf,
}

/// The stream of one connection that the engine accepts.
#[cfg(unix)]
pub type ServerStream = tokio::net::UnixStream;
#[cfg(windows)]
pub type ServerStream = tokio::net::windows::named_pipe::NamedPipeServer;

/// The stream of one connection to the engine.
#[cfg(unix)]
pub type ClientStream = tokio::net::UnixStream;
#[cfg(windows)]
pub type ClientStream = tokio::net::windows::named_pipe::NamedPipeClient;

impl Endpoint {
    /// The endpoint of the user that runs this process.
    ///
    /// On Unix the folder is `$XDG_RUNTIME_DIR/vvorkflow`, else
    /// `vvorkflow-<uid>` in the temporary folder, else `/tmp/vvorkflow-<uid>`:
    /// the first one where the path of the socket is short enough. On Windows
    /// the folder is `%LOCALAPPDATA%\vvorkflow`. Refuses a Windows machine
    /// without that folder.
    pub fn of_user() -> Result<Endpoint, String> {
        #[cfg(unix)]
        {
            let runtime = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from);
            // SAFETY: geteuid has no preconditions and cannot fail.
            let user = unsafe { libc::geteuid() };
            Ok(Endpoint::in_folder(unix_folder(
                runtime,
                std::env::temp_dir(),
                user,
            )))
        }
        #[cfg(windows)]
        {
            std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .filter(|path| path.is_absolute())
                .map(|local| Endpoint::in_folder(local.join("vvorkflow")))
                .ok_or_else(|| "The engine cannot find %LOCALAPPDATA%.".to_owned())
        }
    }

    /// An endpoint in a folder that the caller picks, for example for a test.
    pub fn in_folder(folder: PathBuf) -> Endpoint {
        Endpoint { folder }
    }

    /// The folder of the endpoint.
    pub fn folder(&self) -> &Path {
        &self.folder
    }

    /// The log of the engine process, which the app reads when the process
    /// stops at start.
    pub fn log(&self) -> PathBuf {
        self.folder.join("engine.log")
    }

    fn lock_file(&self) -> PathBuf {
        self.folder.join("engine.lock")
    }

    #[cfg(unix)]
    fn socket(&self) -> PathBuf {
        self.folder.join("engine.sock")
    }

    /// The name of the pipe: the path of the folder, which is unique for each
    /// user, without its backslashes.
    #[cfg(windows)]
    fn pipe(&self) -> String {
        format!(
            r"\\.\pipe\vvorkflow-{}",
            self.folder.to_string_lossy().replace('\\', "-")
        )
    }

    /// Makes the folder, and checks that only this user can open it.
    ///
    /// Refuses a folder that is a symbolic link, that another user owns, or
    /// that other users can open.
    pub fn prepare(&self) -> Result<(), String> {
        let folder = &self.folder;
        #[cfg(unix)]
        {
            use std::os::unix::fs::{DirBuilderExt, MetadataExt};
            match std::fs::DirBuilder::new().mode(0o700).create(folder) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => {
                    return Err(format!(
                        "The engine cannot make {}: {error}.",
                        folder.display()
                    ));
                }
            }
            let metadata = std::fs::symlink_metadata(folder).map_err(|error| {
                format!("The engine cannot read {}: {error}.", folder.display())
            })?;
            // SAFETY: geteuid has no preconditions and cannot fail.
            let user = unsafe { libc::geteuid() };
            if !metadata.is_dir() || metadata.uid() != user || metadata.mode() & 0o077 != 0 {
                return Err(format!(
                    "{} MUST be a folder of this user that other users cannot open.",
                    folder.display()
                ));
            }
        }
        #[cfg(windows)]
        std::fs::create_dir_all(folder)
            .map_err(|error| format!("The engine cannot make {}: {error}.", folder.display()))?;
        Ok(())
    }

    /// Takes the lock of the endpoint, so that only one engine listens on it.
    ///
    /// Returns the lock, which the process keeps until it stops. Refuses when
    /// another engine holds it.
    pub fn lock(&self) -> Result<File, String> {
        let path = self.lock_file();
        let file = File::options()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&path)
            .map_err(|error| format!("The engine cannot open {}: {error}.", path.display()))?;
        match file.try_lock() {
            Ok(()) => Ok(file),
            Err(std::fs::TryLockError::WouldBlock) => Err(format!(
                "Another engine already listens in {}.",
                self.folder.display()
            )),
            Err(std::fs::TryLockError::Error(error)) => Err(format!(
                "The engine cannot lock {}: {error}.",
                path.display()
            )),
        }
    }

    /// Starts to listen. Call it with the lock held: it removes a socket that
    /// an engine left when it stopped.
    pub fn bind(&self) -> io::Result<Listener> {
        #[cfg(unix)]
        {
            let socket = self.socket();
            match std::fs::remove_file(&socket) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
            Ok(Listener {
                listener: tokio::net::UnixListener::bind(&socket)?,
                socket,
            })
        }
        #[cfg(windows)]
        {
            let pipe = self.pipe();
            let next = Self::pipe_instance(&pipe, true)?;
            Ok(Listener { pipe, next })
        }
    }

    #[cfg(windows)]
    fn pipe_instance(
        pipe: &str,
        first: bool,
    ) -> io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
        tokio::net::windows::named_pipe::ServerOptions::new()
            .first_pipe_instance(first)
            .reject_remote_clients(true)
            .create(pipe)
    }

    /// Connects to the engine of this endpoint.
    ///
    /// Fails when no engine listens.
    pub async fn connect(&self) -> io::Result<ClientStream> {
        #[cfg(unix)]
        {
            tokio::net::UnixStream::connect(self.socket()).await
        }
        #[cfg(windows)]
        {
            use tokio::net::windows::named_pipe::ClientOptions;
            // ERROR_PIPE_BUSY: each instance is taken, and the engine makes
            // the next one at once.
            const PIPE_BUSY: i32 = 231;
            let pipe = self.pipe();
            for _ in 0..50 {
                match ClientOptions::new().open(&pipe) {
                    Err(error) if error.raw_os_error() == Some(PIPE_BUSY) => {
                        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                    }
                    other => return other,
                }
            }
            ClientOptions::new().open(&pipe)
        }
    }
}

/// The longest path of a Unix socket that each platform takes: the limit is
/// 108 bytes on Linux and 104 bytes on macOS, with the final zero.
#[cfg(unix)]
const MAX_SOCKET_PATH: usize = 100;

/// The folder of the endpoint of a user on Unix: the first candidate where
/// the path of the socket is short enough. The temporary folder of macOS, for
/// example, is long.
#[cfg(unix)]
fn unix_folder(runtime: Option<PathBuf>, temp: PathBuf, user: u32) -> PathBuf {
    let name = format!("vvorkflow-{user}");
    let last = Path::new("/tmp").join(&name);
    runtime
        .filter(|path| path.is_absolute())
        .map(|path| path.join("vvorkflow"))
        .into_iter()
        .chain([temp.join(&name)])
        .find(|folder| folder.join("engine.sock").as_os_str().len() <= MAX_SOCKET_PATH)
        .unwrap_or(last)
}

#[cfg(all(test, unix))]
mod tests {
    use std::path::PathBuf;

    use super::unix_folder;

    #[test]
    fn the_folder_of_a_user_keeps_the_socket_path_short() {
        let long = PathBuf::from(format!("/{}", "a".repeat(100)));
        let run = Some(PathBuf::from("/run/user/1000"));
        let tmp = PathBuf::from("/var/tmp");
        assert_eq!(
            unix_folder(run.clone(), tmp.clone(), 1000),
            PathBuf::from("/run/user/1000/vvorkflow")
        );
        assert_eq!(
            unix_folder(Some("relative".into()), tmp.clone(), 1000),
            PathBuf::from("/var/tmp/vvorkflow-1000")
        );
        assert_eq!(
            unix_folder(Some(long.clone()), tmp, 1000),
            PathBuf::from("/var/tmp/vvorkflow-1000")
        );
        assert_eq!(
            unix_folder(None, long, 1000),
            PathBuf::from("/tmp/vvorkflow-1000")
        );
    }
}

/// The listener of an endpoint.
pub struct Listener {
    #[cfg(unix)]
    listener: tokio::net::UnixListener,
    #[cfg(unix)]
    socket: PathBuf,
    #[cfg(windows)]
    pipe: String,
    #[cfg(windows)]
    next: tokio::net::windows::named_pipe::NamedPipeServer,
}

impl Listener {
    /// Waits for the next connection.
    pub async fn accept(&mut self) -> io::Result<ServerStream> {
        #[cfg(unix)]
        {
            Ok(self.listener.accept().await?.0)
        }
        #[cfg(windows)]
        {
            self.next.connect().await?;
            // Make the next instance before the connected one leaves, so that
            // a client always finds the pipe.
            let next = Endpoint::pipe_instance(&self.pipe, false)?;
            Ok(std::mem::replace(&mut self.next, next))
        }
    }
}

#[cfg(unix)]
impl Drop for Listener {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.socket);
    }
}
