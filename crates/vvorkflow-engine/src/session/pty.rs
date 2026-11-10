//! The pseudo-terminal of a session and the shell in it, on each platform:
//! a pseudo-terminal of the system on Linux and macOS, ConPTY on Windows
//! (`portable-pty` makes both).
//!
//! On Linux and macOS, the engine reads and writes the pseudo-terminal
//! itself, with `poll`, so that the end of a session can stop the two
//! threads that read and write, also while a program that left the terminal
//! keeps it open. On Windows, the close of the ConPTY ends the read and the
//! write.

use std::io;
#[cfg(windows)]
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Instant;

#[cfg(windows)]
use portable_pty::ChildKiller;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize};

/// How the shell ended: its exit code, or the signal that ended it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Exit {
    pub(crate) code: Option<u32>,
    pub(crate) signal: Option<i32>,
}

/// The shell of the user, as the architecture names it: `$SHELL`, or
/// `/bin/sh` when it is not set or empty. On Windows, `pwsh.exe`,
/// `powershell.exe`, or `%COMSPEC%`, the first that exists.
pub(crate) fn shell() -> Option<PathBuf> {
    #[cfg(unix)]
    {
        Some(
            std::env::var_os("SHELL")
                .filter(|value| !value.is_empty())
                .map_or_else(|| PathBuf::from("/bin/sh"), PathBuf::from),
        )
    }
    #[cfg(windows)]
    {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let found = ["pwsh.exe", "powershell.exe"].iter().find_map(|name| {
            std::env::split_paths(&path)
                .map(|folder| folder.join(name))
                .find(|candidate| candidate.is_file())
        });
        found.or_else(|| {
            std::env::var_os("COMSPEC")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        })
    }
}

/// The name of a shell for a title: its file name without the extension.
pub(crate) fn shell_name(shell: &Path) -> String {
    shell.file_stem().map_or_else(
        || shell.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}

/// A shell in a new pseudo-terminal.
pub(crate) struct Spawned {
    /// The pseudo-terminal: its drop closes it.
    pub(crate) master: Box<dyn MasterPty + Send>,
    pub(crate) child: Box<dyn Child + Send + Sync>,
    pub(crate) reader: Reader,
    pub(crate) writer: Writer,
    pub(crate) process: Arc<Process>,
}

/// Starts `shell` in a new pseudo-terminal of `columns` and `rows`, in
/// `folder`, with the environment of the engine and the variables of the
/// architecture.
pub(crate) fn spawn(shell: &Path, folder: &Path, columns: u16, rows: u16) -> io::Result<Spawned> {
    let size = PtySize {
        rows,
        cols: columns,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = portable_pty::native_pty_system()
        .openpty(size)
        .map_err(io::Error::other)?;
    let mut command = command(shell);
    command.cwd(folder);
    command.env_clear();
    for (name, value) in std::env::vars_os() {
        command.env(name, value);
    }
    // `portable-pty` gives the shell a `SHELL`; it names the shell that runs.
    command.env("SHELL", shell);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "vvorkflow");
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(io::Error::other)?;
    // The shell holds the other side; the end of the shell then ends it.
    drop(pair.slave);
    let master = pair.master;
    #[cfg(unix)]
    {
        let io = Arc::new(unix::Io::new(&*master)?);
        let pid = child
            .process_id()
            .and_then(|pid| i32::try_from(pid).ok())
            .ok_or_else(|| io::Error::other("the shell has no process id"))?;
        Ok(Spawned {
            master,
            child,
            reader: Reader(Arc::clone(&io)),
            writer: Writer(Arc::clone(&io)),
            process: Arc::new(Process::new(System { pid, io })),
        })
    }
    #[cfg(windows)]
    {
        let reader = master.try_clone_reader().map_err(io::Error::other)?;
        let writer = master.take_writer().map_err(io::Error::other)?;
        let killer = child.clone_killer();
        Ok(Spawned {
            master,
            child,
            reader: Reader(reader),
            writer: Writer(writer),
            process: Arc::new(Process::new(System {
                killer: Mutex::new(killer),
            })),
        })
    }
}

fn command(shell: &Path) -> CommandBuilder {
    // On macOS an app does not get the environment of the profile, so the
    // shell starts as a login shell: `portable-pty` does that for the shell
    // that `SHELL` names, with `-` before the name of the program.
    #[cfg(target_os = "macos")]
    {
        let _ = shell;
        CommandBuilder::new_default_prog()
    }
    #[cfg(not(target_os = "macos"))]
    {
        CommandBuilder::new(shell.as_os_str())
    }
}

/// Reads the output of the pseudo-terminal.
pub(crate) struct Reader(
    #[cfg(unix)] Arc<unix::Io>,
    #[cfg(windows)] Box<dyn Read + Send>,
);

/// Writes the input of the pseudo-terminal.
pub(crate) struct Writer(
    #[cfg(unix)] Arc<unix::Io>,
    #[cfg(windows)] Box<dyn Write + Send>,
);

impl Reader {
    /// The next output. Returns 0 at the end of the output, and also when
    /// the session stops the read (Linux and macOS).
    pub(crate) fn read(&mut self, buffer: &mut [u8]) -> usize {
        #[cfg(unix)]
        {
            self.0.read(buffer)
        }
        #[cfg(windows)]
        {
            loop {
                match self.0.read(buffer) {
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                    // A closed ConPTY ends the pipe.
                    Err(_) => return 0,
                    Ok(count) => return count,
                }
            }
        }
    }
}

impl Writer {
    /// Writes all of `input`. Fails when the pseudo-terminal closed, or when
    /// the session stops the write (Linux and macOS).
    pub(crate) fn write_all(&mut self, input: &[u8]) -> io::Result<()> {
        #[cfg(unix)]
        {
            self.0.write_all(input)
        }
        #[cfg(windows)]
        {
            self.0.write_all(input)?;
            self.0.flush()
        }
    }
}

/// The shell process, for its end: the signals of `session.kill`, and the
/// wait for its exit. A signal never reaches a process after the exit of
/// the shell, because the shell is reaped only after it is marked as ended.
pub(crate) struct Process {
    system: System,
    exited: Mutex<bool>,
    exit: Condvar,
}

#[cfg(unix)]
struct System {
    pid: i32,
    io: Arc<unix::Io>,
}

#[cfg(windows)]
struct System {
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

/// The process group of the foreground job when a hang-up started, for the
/// SIGKILL after it.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Foreground(#[cfg(unix)] Option<i32>);

impl Process {
    fn new(system: System) -> Process {
        Process {
            system,
            exited: Mutex::new(false),
            exit: Condvar::new(),
        }
    }

    fn exited(&self) -> std::sync::MutexGuard<'_, bool> {
        self.exited.lock().expect("the exit lock is never poisoned")
    }

    /// Waits for the end of the shell, and reaps it. Returns how it ended.
    pub(crate) fn wait(&self, mut child: Box<dyn Child + Send + Sync>) -> Exit {
        #[cfg(unix)]
        {
            unix::wait_without_reap(self.system.pid);
            // From now on no signal goes to this process id.
            *self.exited() = true;
            self.exit.notify_all();
            let child: &mut dyn Child = &mut *child;
            let status = child
                .downcast_mut::<std::process::Child>()
                .map(std::process::Child::wait);
            use std::os::unix::process::ExitStatusExt;
            match status {
                Some(Ok(status)) => Exit {
                    code: status.code().and_then(|code| u32::try_from(code).ok()),
                    signal: status.signal(),
                },
                _ => Exit {
                    code: None,
                    signal: None,
                },
            }
        }
        #[cfg(windows)]
        {
            let status = child.wait();
            *self.exited() = true;
            self.exit.notify_all();
            Exit {
                code: status.ok().map(|status| status.exit_code()),
                signal: None,
            }
        }
    }

    /// Waits until the shell ended or the deadline. Returns whether it
    /// ended.
    pub(crate) fn wait_until(&self, deadline: Instant) -> bool {
        let mut exited = self.exited();
        while !*exited {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            exited = self
                .exit
                .wait_timeout(exited, deadline - now)
                .expect("the exit lock is never poisoned")
                .0;
        }
        true
    }

    /// Sends SIGHUP to the shell and to the foreground job, as the close of
    /// a terminal window does. Returns the foreground job, for
    /// [`Process::kill`]. On Windows the close of the ConPTY does this.
    pub(crate) fn hang_up(&self) -> Foreground {
        #[cfg(unix)]
        {
            let exited = self.exited();
            if *exited {
                return Foreground(None);
            }
            let pid = self.system.pid;
            let group = self.system.io.foreground().filter(|group| *group != pid);
            unix::signal(pid, libc::SIGHUP);
            if let Some(group) = group {
                unix::signal(-group, libc::SIGHUP);
            }
            Foreground(group)
        }
        #[cfg(windows)]
        {
            Foreground()
        }
    }

    /// Sends SIGKILL to the shell and to the foreground job that still run,
    /// or ends the shell on Windows.
    pub(crate) fn kill(&self, foreground: Foreground) {
        let exited = self.exited();
        #[cfg(unix)]
        {
            if !*exited {
                unix::signal(self.system.pid, libc::SIGKILL);
            }
            if let Some(group) = foreground.0 {
                unix::signal(-group, libc::SIGKILL);
            }
        }
        #[cfg(windows)]
        {
            let _ = foreground;
            if !*exited {
                let _ = self
                    .system
                    .killer
                    .lock()
                    .expect("the killer lock is never poisoned")
                    .kill();
            }
        }
    }

    /// Stops the read and the write of the pseudo-terminal at once, on
    /// Linux and macOS. On Windows the close of the ConPTY ends them.
    pub(crate) fn stop_io(&self) {
        #[cfg(unix)]
        self.system.io.stop();
    }
}

#[cfg(unix)]
mod unix {
    use std::io::{self, Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
    use std::os::unix::net::UnixStream;

    use portable_pty::MasterPty;

    /// The pseudo-terminal for the read and the write: an own copy of its
    /// descriptor, which does not block, and a socket that stops both.
    pub(super) struct Io {
        fd: OwnedFd,
        stopped: UnixStream,
        stop: UnixStream,
    }

    impl Io {
        pub(super) fn new(master: &dyn MasterPty) -> io::Result<Io> {
            let master = master
                .as_raw_fd()
                .ok_or_else(|| io::Error::other("the pseudo-terminal has no descriptor"))?;
            // SAFETY: `master` is open while `master` lives, and `fcntl`
            // returns a new descriptor that this value owns.
            let fd = unsafe { libc::fcntl(master, libc::F_DUPFD_CLOEXEC, 0) };
            if fd < 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: `fd` is a new descriptor that nothing else owns.
            let fd = unsafe { OwnedFd::from_raw_fd(fd) };
            // The flag is on the open file, which the copy shares.
            // SAFETY: `fd` is open.
            let flags = unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_GETFL) };
            if flags < 0
                || unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) }
                    < 0
            {
                return Err(io::Error::last_os_error());
            }
            let (stopped, stop) = UnixStream::pair()?;
            Ok(Io { fd, stopped, stop })
        }

        /// Makes each wait of the read and the write return at once.
        pub(super) fn stop(&self) {
            let _ = (&self.stop).write(&[0]);
        }

        /// Waits until the descriptor has `events`. Returns false when the
        /// session stopped.
        fn wait(&self, events: libc::c_short) -> bool {
            let mut fds = [
                libc::pollfd {
                    fd: self.fd.as_raw_fd(),
                    events,
                    revents: 0,
                },
                libc::pollfd {
                    fd: self.stopped.as_raw_fd(),
                    events: libc::POLLIN,
                    revents: 0,
                },
            ];
            loop {
                // SAFETY: `fds` holds two valid entries.
                let ready = unsafe { libc::poll(fds.as_mut_ptr(), 2, -1) };
                if ready >= 0 {
                    return fds[1].revents == 0;
                }
                if io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
                    return false;
                }
            }
        }

        pub(super) fn read(&self, buffer: &mut [u8]) -> usize {
            loop {
                if !self.wait(libc::POLLIN) {
                    return 0;
                }
                let file = self.file();
                let mut file: &std::fs::File = &file;
                match file.read(buffer) {
                    Ok(count) => return count,
                    Err(error) => match error.kind() {
                        io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted => {}
                        // EIO: no process holds the other side any more.
                        _ => return 0,
                    },
                }
            }
        }

        pub(super) fn write_all(&self, mut input: &[u8]) -> io::Result<()> {
            while !input.is_empty() {
                if !self.wait(libc::POLLOUT) {
                    return Err(io::ErrorKind::BrokenPipe.into());
                }
                let file = self.file();
                let mut file: &std::fs::File = &file;
                match file.write(input) {
                    Ok(0) => return Err(io::ErrorKind::WriteZero.into()),
                    Ok(count) => input = &input[count..],
                    Err(error) => match error.kind() {
                        io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted => {}
                        _ => return Err(error),
                    },
                }
            }
            Ok(())
        }

        /// The descriptor as a file, which this value keeps open.
        fn file(&self) -> std::mem::ManuallyDrop<std::fs::File> {
            // SAFETY: the file does not drop, so it does not close `fd`.
            std::mem::ManuallyDrop::new(unsafe { std::fs::File::from_raw_fd(self.fd.as_raw_fd()) })
        }

        /// The process group of the foreground job of the terminal.
        pub(super) fn foreground(&self) -> Option<i32> {
            // SAFETY: `fd` is open.
            let group = unsafe { libc::tcgetpgrp(self.fd.as_raw_fd()) };
            (group > 0).then_some(group)
        }
    }

    impl AsRawFd for Io {
        fn as_raw_fd(&self) -> RawFd {
            self.fd.as_raw_fd()
        }
    }

    pub(super) fn signal(target: i32, signal: libc::c_int) {
        // SAFETY: `kill` has no memory effects.
        unsafe {
            libc::kill(target, signal);
        }
    }

    /// Waits until the process exits, and leaves it to be reaped.
    pub(super) fn wait_without_reap(pid: i32) {
        loop {
            // SAFETY: `info` is a valid place for the answer.
            let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
            let id = libc::id_t::try_from(pid).unwrap_or_default();
            let done =
                unsafe { libc::waitid(libc::P_PID, id, &mut info, libc::WEXITED | libc::WNOWAIT) };
            if done == 0 || io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
                return;
            }
        }
    }
}
