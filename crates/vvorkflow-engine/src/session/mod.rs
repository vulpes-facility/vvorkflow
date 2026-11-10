//! The terminal sessions of the engine: a pseudo-terminal, the shell of the
//! user in it, and the state of its screen (`docs/architecture.md`,
//! Terminal sessions).
//!
//! Each session has three threads. The reader reads the output, feeds the
//! screen state, and puts the output in the queue of each attached client,
//! under the lock of the session, and never waits for a client. The writer
//! writes the input queue to the pseudo-terminal, in order. The waiter waits
//! for the end of the shell, and then ends the session.

mod client;
mod pty;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use portable_pty::{MasterPty, PtySize};
use vvorkflow_protocol::{
    EngineError, ErrorCode, MAX_COLUMNS, MAX_ROWS, MIN_COLUMNS, MIN_ROWS, Session, SessionEnded,
};

pub use client::{Client, ClientKind, OUTPUT_QUEUE, Outgoing, Wake};

use crate::screen::Screen;
use pty::{Exit, Foreground, Process, Reader, Writer};

/// The sessions that the engine keeps at most.
pub const MAX_SESSIONS: usize = 64;

/// The input bytes that wait for the pseudo-terminal at most, for each
/// session. The engine refuses a write that does not fit.
pub const INPUT_QUEUE: usize = 1 << 20;

/// The time that the engine reads the output that is left after the shell
/// ended.
const DRAIN_TIME: Duration = Duration::from_secs(1);

/// The time between SIGHUP and SIGKILL.
const KILL_TIME: Duration = Duration::from_secs(3);

/// The bytes that one read of the pseudo-terminal takes at most.
const READ_SIZE: usize = 64 * 1024;

/// Gets the number of sessions after each change.
type Watch = Box<dyn Fn(usize) + Send + Sync>;

/// A session whose shell started, with what its threads take.
type Started = (
    Arc<Live>,
    Reader,
    Writer,
    Box<dyn portable_pty::Child + Send + Sync>,
);

/// The sessions of an engine, in the order of their start.
pub(crate) struct Sessions {
    inner: Mutex<SessionsInner>,
    /// Tells a stop of the engine that a session went away.
    gone: Condvar,
    /// Gets the number of sessions after each change.
    watch: Mutex<Option<Watch>>,
}

#[derive(Default)]
struct SessionsInner {
    list: Vec<Arc<Live>>,
    /// The sessions that start now, which count for the limit.
    starting: usize,
    /// The engine stops, and takes no new session.
    closing: bool,
}

/// The part of a session that the clients share: its id, its folder, and
/// its state under one lock.
pub(crate) struct Core {
    id: String,
    folder: String,
    shell: String,
    state: Mutex<State>,
}

struct State {
    screen: Screen,
    /// The attached clients.
    clients: Vec<Weak<client::Inner>>,
    ended: bool,
}

/// A session that runs: its core, its input, its process, and its
/// pseudo-terminal.
struct Live {
    core: Arc<Core>,
    input: Input,
    process: Arc<Process>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    /// The reader read the end of the output.
    read_all: Mutex<bool>,
    read_end: Condvar,
    killed: Mutex<bool>,
}

/// The input queue of a session, with the bytes that its writer writes
/// now, so that the queue holds at most [`INPUT_QUEUE`] bytes.
struct Input {
    queue: Mutex<InputQueue>,
    ready: Condvar,
}

#[derive(Default)]
struct InputQueue {
    bytes: Vec<u8>,
    /// The bytes in the queue and the bytes that the writer writes now.
    size: usize,
    closed: bool,
}

fn error(code: ErrorCode, message: impl Into<String>) -> EngineError {
    EngineError {
        code,
        message: message.into(),
    }
}

fn not_found(id: &str) -> EngineError {
    error(
        ErrorCode::NotFound,
        format!("The session {id} does not exist."),
    )
}

impl Core {
    fn state(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .expect("the session lock is never poisoned")
    }
}

impl State {
    /// The attached clients that are still connected. The caller drops them
    /// after it releases the lock of the session: the drop of the last copy
    /// of a client takes that lock.
    fn attached(&self) -> Vec<Arc<client::Inner>> {
        self.clients.iter().filter_map(Weak::upgrade).collect()
    }
}

impl Live {
    fn info(&self) -> Session {
        let state = self.core.state();
        Session {
            id: self.core.id.clone(),
            title: state
                .screen
                .title()
                .map_or_else(|| self.core.shell.clone(), str::to_owned),
            folder: self.core.folder.clone(),
            columns: state.screen.columns(),
            rows: state.screen.rows(),
        }
    }

    /// Closes the pseudo-terminal. On Windows, the close of the ConPTY can
    /// wait until the reader took its last output, so the caller holds no
    /// lock of the session.
    fn close_terminal(&self) {
        let master = self
            .master
            .lock()
            .expect("the terminal lock is never poisoned")
            .take();
        drop(master);
    }

    /// Ends the shell as the close of a terminal window does. Returns the
    /// foreground job, for the SIGKILL after [`KILL_TIME`].
    fn hang_up(self: &Arc<Self>) -> Foreground {
        let foreground = self.process.hang_up();
        // On Windows the close of the ConPTY ends the programs in it.
        #[cfg(windows)]
        {
            let live = Arc::clone(self);
            let _ = std::thread::Builder::new()
                .name("session-close".to_owned())
                .spawn(move || live.close_terminal());
        }
        foreground
    }
}

impl Input {
    fn new() -> Input {
        Input {
            queue: Mutex::default(),
            ready: Condvar::new(),
        }
    }

    fn queue(&self) -> MutexGuard<'_, InputQueue> {
        self.queue.lock().expect("the input lock is never poisoned")
    }

    /// Puts all of `bytes` in the queue, or none of them. Returns false when
    /// they do not fit, or when the session takes no more input.
    fn push(&self, bytes: &[u8]) -> bool {
        let mut queue = self.queue();
        if queue.closed || queue.size + bytes.len() > INPUT_QUEUE {
            return false;
        }
        queue.bytes.extend_from_slice(bytes);
        queue.size += bytes.len();
        drop(queue);
        self.ready.notify_one();
        true
    }

    fn close(&self) {
        self.queue().closed = true;
        self.ready.notify_one();
    }
}

impl Sessions {
    pub(crate) fn new() -> Sessions {
        Sessions {
            inner: Mutex::default(),
            gone: Condvar::new(),
            watch: Mutex::default(),
        }
    }

    fn inner(&self) -> MutexGuard<'_, SessionsInner> {
        self.inner
            .lock()
            .expect("the sessions lock is never poisoned")
    }

    pub(crate) fn count(&self) -> usize {
        self.inner().list.len()
    }

    pub(crate) fn watch(&self, watch: Watch) {
        let count = self.count();
        watch(count);
        *self.watch.lock().expect("the watch lock is never poisoned") = Some(watch);
    }

    fn changed(&self, count: usize) {
        if let Some(watch) = &*self.watch.lock().expect("the watch lock is never poisoned") {
            watch(count);
        }
    }

    fn find(&self, id: &str) -> Result<Arc<Live>, EngineError> {
        self.inner()
            .list
            .iter()
            .find(|live| live.core.id == id)
            .cloned()
            .ok_or_else(|| not_found(id))
    }

    pub(crate) fn list(&self) -> Vec<Session> {
        let list = self.inner().list.clone();
        list.iter().map(|live| live.info()).collect()
    }

    /// Starts the shell of the user in a new pseudo-terminal, in `folder`.
    pub(crate) fn create(
        self: &Arc<Self>,
        folder: &Path,
        columns: u16,
        rows: u16,
    ) -> Result<Session, EngineError> {
        check_size(columns, rows)?;
        {
            let mut inner = self.inner();
            if inner.closing {
                return Err(error(
                    ErrorCode::FailedPrecondition,
                    "The engine stops, and starts no session.",
                ));
            }
            if inner.list.len() + inner.starting >= MAX_SESSIONS {
                return Err(error(
                    ErrorCode::FailedPrecondition,
                    format!("The engine keeps at most {MAX_SESSIONS} sessions."),
                ));
            }
            inner.starting += 1;
        }
        let started = self.start(folder, columns, rows);
        let mut inner = self.inner();
        inner.starting -= 1;
        let (live, reader, writer, child) = started?;
        let closing = inner.closing;
        if !closing {
            inner.list.push(Arc::clone(&live));
        }
        let count = inner.list.len();
        drop(inner);
        let info = live.info();
        self.run(Arc::clone(&live), reader, writer, child);
        if closing {
            // The engine began to stop while the shell started.
            live.hang_up();
            live.process.kill(Foreground::default());
            return Err(error(
                ErrorCode::FailedPrecondition,
                "The engine stops, and starts no session.",
            ));
        }
        self.changed(count);
        Ok(info)
    }

    /// Starts the shell, and makes the session, which no thread runs yet.
    fn start(&self, folder: &Path, columns: u16, rows: u16) -> Result<Started, EngineError> {
        let refused = |reason: String| error(ErrorCode::FailedPrecondition, reason);
        let shell: PathBuf =
            pty::shell().ok_or_else(|| refused("The engine finds no shell.".to_owned()))?;
        let spawned = pty::spawn(&shell, folder, columns, rows).map_err(|error| {
            refused(format!(
                "The shell {} does not start: {error}.",
                shell.display()
            ))
        })?;
        let id = loop {
            let number = getrandom::u64()
                .map_err(|error| refused(format!("The engine has no random number: {error}.")))?;
            let id = format!("{number:016x}");
            if !self.inner().list.iter().any(|live| live.core.id == id) {
                break id;
            }
        };
        let live = Arc::new(Live {
            core: Arc::new(Core {
                id,
                folder: folder.to_string_lossy().into_owned(),
                shell: pty::shell_name(&shell),
                state: Mutex::new(State {
                    screen: Screen::new(columns, rows),
                    clients: Vec::new(),
                    ended: false,
                }),
            }),
            input: Input::new(),
            process: spawned.process,
            master: Mutex::new(Some(spawned.master)),
            read_all: Mutex::new(false),
            read_end: Condvar::new(),
            killed: Mutex::new(false),
        });
        Ok((live, spawned.reader, spawned.writer, spawned.child))
    }

    /// Starts the three threads of a session.
    fn run(
        self: &Arc<Self>,
        live: Arc<Live>,
        reader: Reader,
        writer: Writer,
        child: Box<dyn portable_pty::Child + Send + Sync>,
    ) {
        let spawn = |name: &str, work: Box<dyn FnOnce() + Send>| {
            std::thread::Builder::new()
                .name(name.to_owned())
                .spawn(work)
                .is_ok()
        };
        let reads = Arc::clone(&live);
        let writes = Arc::clone(&live);
        let sessions = Arc::clone(self);
        let waits = Arc::clone(&live);
        // The waiter first: it ends the session also when a thread after it
        // does not start.
        let started = spawn(
            "session-waiter",
            Box::new(move || sessions.wait_end(&waits, child)),
        ) && spawn(
            "session-reader",
            Box::new(move || read_output(&reads, reader)),
        ) && spawn(
            "session-writer",
            Box::new(move || write_input(&writes, writer)),
        );
        if !started {
            // Without its threads, the session cannot run: end its shell.
            live.hang_up();
            live.process.kill(Foreground::default());
        }
    }

    /// Waits for the end of the shell, reads the output that is left, for at
    /// most [`DRAIN_TIME`], and then ends the session.
    fn wait_end(&self, live: &Arc<Live>, child: Box<dyn portable_pty::Child + Send + Sync>) {
        let exit = live.process.wait(child);
        // A ConPTY sends the end of its output only when it closes.
        #[cfg(windows)]
        live.close_terminal();
        let deadline = Instant::now() + DRAIN_TIME;
        let mut read_all = live
            .read_all
            .lock()
            .expect("the read lock is never poisoned");
        while !*read_all {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            read_all = live
                .read_end
                .wait_timeout(read_all, deadline - now)
                .expect("the read lock is never poisoned")
                .0;
        }
        drop(read_all);
        live.process.stop_io();
        self.end(live, exit);
    }

    /// Removes the session, so that a client that gets `session.ended` no
    /// longer finds it, and sends that event to each attached client, after
    /// the output that it has. A client that waits for a screen keeps the
    /// state until its writer made the screen. Then closes the
    /// pseudo-terminal.
    fn end(&self, live: &Arc<Live>, exit: Exit) {
        let count = {
            let mut inner = self.inner();
            inner.list.retain(|other| !Arc::ptr_eq(other, live));
            inner.list.len()
        };
        self.changed(count);
        self.gone.notify_all();
        let ended = SessionEnded {
            session: live.core.id.clone(),
            exit_code: exit.code,
            signal: exit.signal,
        };
        let clients = {
            let mut state = live.core.state();
            state.ended = true;
            let clients = state.attached();
            for client in &clients {
                client.ended(&live.core, ended.clone());
            }
            state.clients.clear();
            clients
        };
        drop(clients);
        live.input.close();
        live.close_terminal();
    }

    pub(crate) fn attach(&self, client: &Client, id: &str) -> Result<Session, EngineError> {
        let live = self.find(id)?;
        {
            let mut state = live.core.state();
            if state.ended {
                return Err(not_found(id));
            }
            let weak = client.downgrade();
            if !state.clients.iter().any(|other| other.ptr_eq(&weak)) {
                state.clients.push(weak);
            }
            client.attach(&live.core);
        }
        Ok(live.info())
    }

    pub(crate) fn detach(&self, client: &Client, id: &str) -> Result<(), EngineError> {
        let live = self.find(id)?;
        let mut state = live.core.state();
        let weak = client.downgrade();
        state.clients.retain(|other| !other.ptr_eq(&weak));
        client.detach(&live.core);
        Ok(())
    }

    pub(crate) fn write(&self, id: &str, data: &str) -> Result<(), EngineError> {
        let live = self.find(id)?;
        let bytes = STANDARD.decode(data).map_err(|reason| {
            error(
                ErrorCode::InvalidArgument,
                format!("The data is not Base64 with padding: {reason}."),
            )
        })?;
        if bytes.is_empty() || live.input.push(&bytes) {
            Ok(())
        } else {
            Err(error(
                ErrorCode::FailedPrecondition,
                "The input queue of the session is full, or the session ended.",
            ))
        }
    }

    pub(crate) fn resize(&self, id: &str, columns: u16, rows: u16) -> Result<(), EngineError> {
        check_size(columns, rows)?;
        let live = self.find(id)?;
        let clients = {
            let mut state = live.core.state();
            if state.ended {
                return Err(not_found(id));
            }
            if (state.screen.columns(), state.screen.rows()) == (columns, rows) {
                return Ok(());
            }
            if let Some(master) = &*live
                .master
                .lock()
                .expect("the terminal lock is never poisoned")
            {
                let size = PtySize {
                    rows,
                    cols: columns,
                    pixel_width: 0,
                    pixel_height: 0,
                };
                master.resize(size).map_err(|reason| {
                    error(
                        ErrorCode::FailedPrecondition,
                        format!("The pseudo-terminal does not take the size: {reason}."),
                    )
                })?;
            }
            state.screen.resize(columns, rows);
            let clients = state.attached();
            for client in &clients {
                client.resized(&live.core, columns, rows);
            }
            clients
        };
        drop(clients);
        Ok(())
    }

    /// Ends a session: SIGHUP now, and SIGKILL after [`KILL_TIME`] to the
    /// shell and the foreground job that still run.
    pub(crate) fn kill(&self, id: &str) -> Result<(), EngineError> {
        let live = self.find(id)?;
        let mut killed = live.killed.lock().expect("the kill lock is never poisoned");
        if *killed {
            return Ok(());
        }
        *killed = true;
        drop(killed);
        let foreground = live.hang_up();
        let process = Arc::clone(&live.process);
        let _ = std::thread::Builder::new()
            .name("session-kill".to_owned())
            .spawn(move || {
                if !process.wait_until(Instant::now() + KILL_TIME) {
                    process.kill(foreground);
                }
            });
        Ok(())
    }

    /// Stops the sessions for a stop of the engine. Without `force`, refuses
    /// when a session runs. With `force`, takes no new session, ends all
    /// sessions as [`Sessions::kill`] does, with one limit of [`KILL_TIME`]
    /// for all of them, and returns when they ended or the limit is over.
    pub(crate) fn stop(&self, force: bool) -> Result<(), EngineError> {
        let list = {
            let mut inner = self.inner();
            let running = inner.list.len() + inner.starting;
            if !force && running > 0 {
                return Err(error(
                    ErrorCode::FailedPrecondition,
                    format!(
                        "The engine runs {running} terminal session{}, and does not stop without force.",
                        if running == 1 { "" } else { "s" }
                    ),
                ));
            }
            inner.closing = true;
            inner.list.clone()
        };
        let deadline = Instant::now() + KILL_TIME;
        let foregrounds: Vec<_> = list.iter().map(|live| live.hang_up()).collect();
        let mut inner = self.inner();
        while !inner.list.is_empty() {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            inner = self
                .gone
                .wait_timeout(inner, deadline - now)
                .expect("the sessions lock is never poisoned")
                .0;
        }
        drop(inner);
        for (live, foreground) in list.iter().zip(foregrounds) {
            live.process.kill(foreground);
        }
        Ok(())
    }
}

fn check_size(columns: u16, rows: u16) -> Result<(), EngineError> {
    if (MIN_COLUMNS..=MAX_COLUMNS).contains(&columns) && (MIN_ROWS..=MAX_ROWS).contains(&rows) {
        Ok(())
    } else {
        Err(error(
            ErrorCode::InvalidArgument,
            format!(
                "A session has {MIN_COLUMNS} to {MAX_COLUMNS} columns and {MIN_ROWS} to {MAX_ROWS} rows, not {columns}x{rows}."
            ),
        ))
    }
}

/// The reader of a session: feeds the screen state and the queues of the
/// attached clients with each output, and answers the queries of the
/// program while no client is attached.
fn read_output(live: &Live, mut reader: Reader) {
    let mut buffer = vec![0; READ_SIZE];
    loop {
        let count = reader.read(&mut buffer);
        if count == 0 {
            break;
        }
        let output: Arc<[u8]> = Arc::from(&buffer[..count]);
        let (clients, answers) = {
            let mut state = live.core.state();
            if state.ended {
                break;
            }
            let clients = state.attached();
            state.screen.answer_queries(clients.is_empty());
            state.screen.feed(&output);
            for client in &clients {
                client.output(&live.core, &output);
            }
            (clients, state.screen.take_answers())
        };
        drop(clients);
        if !answers.is_empty() {
            // An answer that does not fit in a full queue is lost, as a key
            // press is.
            live.input.push(&answers);
        }
    }
    *live
        .read_all
        .lock()
        .expect("the read lock is never poisoned") = true;
    live.read_end.notify_all();
}

/// The writer of a session: writes the input queue to the pseudo-terminal,
/// in order, until the session ends.
fn write_input(live: &Live, mut writer: Writer) {
    loop {
        let batch = {
            let mut queue = live.input.queue();
            while queue.bytes.is_empty() && !queue.closed {
                queue = live
                    .input
                    .ready
                    .wait(queue)
                    .expect("the input lock is never poisoned");
            }
            if queue.closed {
                return;
            }
            std::mem::take(&mut queue.bytes)
        };
        let written = writer.write_all(&batch);
        let mut queue = live.input.queue();
        queue.size -= batch.len();
        if written.is_err() {
            queue.closed = true;
            return;
        }
    }
}
