//! Where the engine process listens: a Unix socket in a folder that only the
//! user can open, or a named pipe on Windows, with a lock file and a log file
//! in the same folder. Both sides check that the other side runs as the same
//! user before a request goes over the connection.

use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

/// The start of the message of an engine that stops because another engine
/// listens on its endpoint.
pub(crate) const BUSY: &str = "Another engine already listens in";

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
            Ok(Endpoint::in_folder(unix_folder(
                runtime,
                std::env::temp_dir(),
                effective_user(),
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
    /// stops at start, in the folder that [`Endpoint::check`] gives.
    pub fn log(&self) -> io::Result<PathBuf> {
        Ok(self.check()?.join("engine.log"))
    }

    /// Makes the folder when it does not exist, then checks it.
    ///
    /// Refuses a folder that [`Endpoint::check`] refuses.
    pub fn prepare(&self) -> Result<(), String> {
        let folder = &self.folder;
        #[cfg(unix)]
        let made = {
            use std::os::unix::fs::DirBuilderExt;
            std::fs::DirBuilder::new().mode(0o700).create(folder)
        };
        #[cfg(windows)]
        let made = std::fs::create_dir_all(folder);
        match made {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(format!(
                    "The engine cannot make {}: {error}.",
                    folder.display()
                ));
            }
        }
        self.check().map(|_| ()).map_err(|error| error.to_string())
    }

    /// Checks that no other user can open or replace the folder. Each other
    /// method of the endpoint does this check first, and then uses only the
    /// path that it gives.
    ///
    /// Returns the canonical path of the folder: a path without symbolic
    /// links, through folders that no other user can change. On Unix, refuses
    /// (`PermissionDenied`) a folder that is a symbolic link, that another
    /// user owns, or that other users can open, and a folder above it that a
    /// user other than this one and root owns, or that other users can write
    /// without the sticky bit. On Windows, the folder is in the profile of the
    /// user, which other users cannot open. Fails with `NotFound` when the
    /// folder does not exist.
    pub fn check(&self) -> io::Result<PathBuf> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let user = effective_user();
            let refused =
                |message: String| io::Error::new(io::ErrorKind::PermissionDenied, message);
            let parent = self
                .folder
                .parent()
                .ok_or_else(|| refused(format!("{} has no parent folder.", self.folder.display())))?
                .canonicalize()?;
            let name = self
                .folder
                .file_name()
                .ok_or_else(|| refused(format!("{} has no name.", self.folder.display())))?;
            let canonical = parent.join(name);
            let folder = std::fs::symlink_metadata(&canonical)?;
            if !folder.is_dir() || folder.uid() != user || folder.mode() & 0o077 != 0 {
                return Err(refused(format!(
                    "{} MUST be a folder of this user that other users cannot open.",
                    self.folder.display()
                )));
            }
            for above in parent.ancestors() {
                let metadata = std::fs::metadata(above)?;
                let owner = metadata.uid() == 0 || metadata.uid() == user;
                let sticky = metadata.mode() & 0o1000 != 0;
                let shared = metadata.mode() & 0o022 != 0;
                if !owner || (shared && !sticky) {
                    return Err(refused(format!(
                        "Other users can replace {}, because of {}.",
                        self.folder.display(),
                        above.display()
                    )));
                }
            }
            Ok(canonical)
        }
        #[cfg(windows)]
        {
            std::fs::metadata(&self.folder)?;
            Ok(self.folder.clone())
        }
    }

    /// Takes the lock of the endpoint, so that only one engine listens on it.
    ///
    /// Returns the lock, which the process keeps until it stops. Refuses when
    /// another engine holds it.
    pub fn lock(&self) -> Result<File, String> {
        let path = self
            .check()
            .map_err(|error| error.to_string())?
            .join("engine.lock");
        let file = File::options()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&path)
            .map_err(|error| format!("The engine cannot open {}: {error}.", path.display()))?;
        match file.try_lock() {
            Ok(()) => Ok(file),
            Err(std::fs::TryLockError::WouldBlock) => {
                Err(format!("{BUSY} {}.", self.folder.display()))
            }
            Err(std::fs::TryLockError::Error(error)) => Err(format!(
                "The engine cannot lock {}: {error}.",
                path.display()
            )),
        }
    }

    /// Starts to listen. Call it with the lock held: on Unix it removes a
    /// socket that an engine left when it stopped; on Windows it makes a pipe
    /// with a new random name, and writes that name to the folder.
    pub fn bind(&self) -> io::Result<Listener> {
        #[cfg(unix)]
        {
            let socket = self.check()?.join("engine.sock");
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
            let pipe = format!(r"\\.\pipe\vvorkflow-{}", pipe::random_name());
            let next = pipe::instance(&pipe, true)?;
            // Only the user can read the folder, so no other user learns the
            // name of the pipe.
            let file = self.check()?.join("engine.pipe");
            std::fs::write(&file, format!("{pipe}\n{}\n", std::process::id()))?;
            Ok(Listener { pipe, next, file })
        }
    }

    /// Connects to the engine of this endpoint, after a check that the engine
    /// runs as this user.
    ///
    /// Fails with `NotFound` or `ConnectionRefused` when no engine listens,
    /// and with `PermissionDenied` when the folder is not safe or another
    /// user runs the process on the other side.
    pub async fn connect(&self) -> io::Result<ClientStream> {
        #[cfg(unix)]
        {
            let socket = self.check()?.join("engine.sock");
            let stream = tokio::net::UnixStream::connect(socket).await?;
            if stream.peer_cred()?.uid() != effective_user() {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Another user runs the engine of this endpoint.",
                ));
            }
            Ok(stream)
        }
        #[cfg(windows)]
        {
            let text = std::fs::read_to_string(self.check()?.join("engine.pipe"))?;
            let mut lines = text.lines();
            let (Some(name), Some(Ok(engine))) =
                (lines.next(), lines.next().map(str::parse::<u32>))
            else {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "The pipe file is not complete.",
                ));
            };
            let stream = pipe::open(name).await?;
            if pipe::server_process(&stream)? != engine {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Another process holds the pipe of this endpoint.",
                ));
            }
            Ok(stream)
        }
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
    #[cfg(windows)]
    file: PathBuf,
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
            // A client that leaves before the engine takes it spoils its pipe
            // instance: replace the instance, so that the next client finds a
            // good one.
            let connected = self.next.connect().await;
            let next = pipe::instance(&self.pipe, false)?;
            let current = std::mem::replace(&mut self.next, next);
            connected.map(|()| current)
        }
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        #[cfg(unix)]
        let _ = std::fs::remove_file(&self.socket);
        #[cfg(windows)]
        let _ = std::fs::remove_file(&self.file);
    }
}

#[cfg(unix)]
fn effective_user() -> u32 {
    // SAFETY: geteuid has no preconditions and cannot fail.
    unsafe { libc::geteuid() }
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

/// The named pipe of Windows: a random name, a security descriptor that lets
/// only the owner and the system open it, and the process id of the server.
#[cfg(windows)]
mod pipe {
    use std::io;
    use std::os::windows::io::AsRawHandle;
    use std::time::Duration;

    use tokio::net::windows::named_pipe::{
        ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions,
    };
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
    use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;

    /// A name that no other user can guess: the hash of the time and the
    /// process id, with the random keys of `RandomState`.
    pub(super) fn random_name() -> String {
        use std::hash::{BuildHasher, Hasher};
        let time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |time| time.as_nanos());
        let mut parts = [0_u64; 2];
        for (index, part) in parts.iter_mut().enumerate() {
            let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
            hasher.write_u128(time);
            hasher.write_u32(std::process::id());
            hasher.write_usize(index);
            *part = hasher.finish();
        }
        format!("{:016x}{:016x}", parts[0], parts[1])
    }

    /// Makes one instance of the pipe, which only its owner and the system
    /// can open.
    pub(super) fn instance(name: &str, first: bool) -> io::Result<NamedPipeServer> {
        // A protected DACL: full access for the owner and for the system.
        let sddl: Vec<u16> = "D:P(A;;GA;;;OW)(A;;GA;;;SY)\0".encode_utf16().collect();
        let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        // SAFETY: the string ends with a zero, and the function writes a new
        // descriptor that this function frees with LocalFree.
        let made = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        };
        if made == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        // SAFETY: the attributes and their descriptor stay valid during the
        // call, and the pipe keeps its own copy of the descriptor.
        let server = unsafe {
            ServerOptions::new()
                .first_pipe_instance(first)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(name, (&raw mut attributes).cast())
        };
        // SAFETY: the descriptor came from the conversion above.
        unsafe { LocalFree(descriptor) };
        server
    }

    /// Opens the pipe, and waits while each instance is busy.
    pub(super) async fn open(name: &str) -> io::Result<NamedPipeClient> {
        // ERROR_PIPE_BUSY: each instance is taken, and the engine makes the
        // next one at once.
        const PIPE_BUSY: i32 = 231;
        for _ in 0..50 {
            match ClientOptions::new().open(name) {
                Err(error) if error.raw_os_error() == Some(PIPE_BUSY) => {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                other => return other,
            }
        }
        ClientOptions::new().open(name)
    }

    /// The process id of the server of a pipe.
    pub(super) fn server_process(client: &NamedPipeClient) -> io::Result<u32> {
        let mut process = 0_u32;
        // SAFETY: the handle is the open handle of the client.
        let found = unsafe { GetNamedPipeServerProcessId(client.as_raw_handle(), &mut process) };
        if found == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(process)
    }
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
