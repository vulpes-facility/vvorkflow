//! The client of the engine process, for the app core: it connects to the
//! engine of an endpoint, starts one when none listens, replaces an engine of
//! another protocol version, and matches each answer to its request by id.

use std::collections::HashMap;
use std::io::{self, Read, Seek, SeekFrom};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;
use vvorkflow_protocol::{
    ClientMessage, EngineError, ErrorCode, Hello, MAX_OPEN_REQUESTS, PROTOCOL_VERSION, Request,
    ServerMessage, Shutdown,
};

use crate::Endpoint;
use crate::endpoint::BUSY;

/// The time that a new engine process has to listen.
const START: Duration = Duration::from_secs(10);

type Socket = tokio_tungstenite::WebSocketStream<crate::ClientStream>;
type Pending = Arc<Mutex<Waiting>>;

/// The requests of a connection that wait for an answer, and whether the
/// connection is gone. A gone connection takes no new request, so that no
/// request waits for an answer that cannot come.
#[derive(Default)]
struct Waiting {
    gone: bool,
    answers: HashMap<u64, oneshot::Sender<ServerMessage<Value>>>,
}

/// A connection to the engine process that the client opens when it needs
/// one, and opens again after the engine stops.
pub struct EngineClient {
    endpoint: Endpoint,
    program: Box<dyn Fn() -> Command + Send + Sync>,
    connection: tokio::sync::Mutex<Option<Connection>>,
    /// The places of the open requests: the engine closes a connection with
    /// more than `MAX_OPEN_REQUESTS`, so a request waits here for a place.
    open: tokio::sync::Semaphore,
}

/// One open connection: the queue of its writer, and the requests that wait
/// for an answer.
struct Connection {
    outbox: mpsc::Sender<Message>,
    pending: Pending,
    next: AtomicU64,
}

/// Why a connection did not open.
enum Refused {
    /// No engine listens on the endpoint, or the engine stopped while the
    /// connection opened, for example at the end of its idle time.
    Absent,
    /// The engine uses another protocol version.
    OtherVersion,
    Failed(EngineError),
}

impl EngineClient {
    /// A client of the engine on `endpoint`. `program` makes the command that
    /// starts an engine process on that endpoint; the client adds the
    /// standard streams.
    pub fn new(
        endpoint: Endpoint,
        program: impl Fn() -> Command + Send + Sync + 'static,
    ) -> EngineClient {
        EngineClient {
            endpoint,
            program: Box::new(program),
            connection: tokio::sync::Mutex::new(None),
            open: tokio::sync::Semaphore::new(MAX_OPEN_REQUESTS),
        }
    }

    /// Sends one request to the engine, and waits for its answer.
    ///
    /// Returns the JSON value of the answer. Returns the error of the engine,
    /// or `failedPrecondition` when no engine can start or the engine stops
    /// before it answers. A request that the engine did not answer is not
    /// sent again.
    pub async fn request(&self, request: Request) -> Result<Value, EngineError> {
        let _place = self
            .open
            .acquire()
            .await
            .map_err(|_| refused("The client is closed.".to_owned()))?;
        let stops = matches!(request, Request::Shutdown(_));
        let (answer, wait) = oneshot::channel();
        let (outbox, pending, id) = {
            let mut slot = self.connection.lock().await;
            if slot.as_ref().is_none_or(Connection::is_gone) {
                *slot = Some(self.establish().await?);
            }
            let open = slot.as_ref().expect("the slot holds a connection");
            let id = open.next.fetch_add(1, Ordering::Relaxed);
            let mut waiting = open
                .pending
                .lock()
                .expect("the pending lock is never poisoned");
            if waiting.gone {
                return Err(refused("The engine stopped before it answered.".to_owned()));
            }
            waiting.answers.insert(id, answer);
            drop(waiting);
            (open.outbox.clone(), Arc::clone(&open.pending), id)
        };
        let text = serde_json::to_string(&ClientMessage { id, request })
            .map_err(|error| refused(format!("The request does not serialize: {error}.")))?;
        if outbox.send(Message::text(text)).await.is_err() {
            pending
                .lock()
                .expect("the pending lock is never poisoned")
                .answers
                .remove(&id);
        }
        match wait.await {
            Ok(ServerMessage::Result { result, .. }) => {
                // The engine closes this connection now: the next request
                // opens a new one at once.
                if stops {
                    pending
                        .lock()
                        .expect("the pending lock is never poisoned")
                        .gone = true;
                }
                Ok(result)
            }
            Ok(ServerMessage::Error { error, .. }) => Err(error),
            Err(_) => Err(refused("The engine stopped before it answered.".to_owned())),
        }
    }

    /// Opens a connection: to the engine that listens, or to a new one.
    async fn establish(&self) -> Result<Connection, EngineError> {
        match self.open().await {
            Ok(connection) => return Ok(connection),
            Err(Refused::Failed(error)) => return Err(error),
            Err(Refused::Absent) => {}
            Err(Refused::OtherVersion) => self.stop_other().await,
        }
        self.start().await?;
        match self.open().await {
            Ok(connection) => Ok(connection),
            Err(Refused::Failed(error)) => Err(error),
            Err(Refused::Absent | Refused::OtherVersion) => Err(refused(
                "The engine that the app started does not answer.".to_owned(),
            )),
        }
    }

    /// Connects, and says `hello`.
    async fn open(&self) -> Result<Connection, Refused> {
        let mut socket = self.handshake().await?;
        let hello = ClientMessage {
            id: 0,
            request: Request::Hello(Hello {
                protocol: PROTOCOL_VERSION,
            }),
        };
        // An engine at the end of its idle time can close the connection at
        // once: then it is absent, and the client starts a new one.
        send(&mut socket, &hello)
            .await
            .map_err(|_| Refused::Absent)?;
        match receive(&mut socket).await {
            Some(ServerMessage::Result { .. }) => {}
            Some(ServerMessage::Error { error, .. })
                if error.code == ErrorCode::FailedPrecondition =>
            {
                return Err(Refused::OtherVersion);
            }
            Some(ServerMessage::Error { error, .. }) => return Err(Refused::Failed(error)),
            // The engine left while the connection opened.
            None => return Err(Refused::Absent),
        }
        Ok(Connection::run(socket))
    }

    async fn handshake(&self) -> Result<Socket, Refused> {
        let stream = self
            .endpoint
            .connect()
            .await
            .map_err(|error| match error.kind() {
                // No engine, or an engine that stops at this moment.
                io::ErrorKind::NotFound
                | io::ErrorKind::ConnectionRefused
                | io::ErrorKind::ConnectionReset
                | io::ErrorKind::ConnectionAborted
                | io::ErrorKind::BrokenPipe
                | io::ErrorKind::UnexpectedEof => Refused::Absent,
                _ => Refused::Failed(lost(error)),
            })?;
        tokio_tungstenite::client_async("ws://localhost/", stream)
            .await
            .map(|(socket, _)| socket)
            .map_err(|_| Refused::Absent)
    }

    /// Stops an engine of another protocol version with `shutdown`, which
    /// every version understands, and waits until it no longer listens.
    async fn stop_other(&self) {
        if let Ok(mut socket) = self.handshake().await {
            let shutdown = ClientMessage {
                id: 0,
                request: Request::Shutdown(Shutdown {}),
            };
            if send(&mut socket, &shutdown).await.is_ok() {
                let _ = receive(&mut socket).await;
            }
        }
        for _ in 0..100 {
            if self.endpoint.connect().await.is_err() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// Starts an engine process, detached from the app, with its stderr in
    /// the log of the endpoint, and waits until it listens.
    ///
    /// Fails with the last line of the log when the process stops first, for
    /// example because the projects root is not correct.
    async fn start(&self) -> Result<(), EngineError> {
        // An engine at the end of its idle time can still hold the lock for a
        // moment: then the new engine stops at once, and the client tries
        // again.
        for _ in 0..2 {
            match self.start_once().await {
                Err(error) if error.message.starts_with(BUSY) => {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
                other => return other,
            }
        }
        self.start_once().await
    }

    async fn start_once(&self) -> Result<(), EngineError> {
        self.endpoint.prepare().map_err(refused)?;
        let log_path = self.endpoint.log().map_err(lost)?;
        let mut log = std::fs::File::options()
            .create(true)
            .truncate(true)
            .read(true)
            .write(true)
            .open(&log_path)
            .map_err(|error| {
                refused(format!(
                    "The app cannot open {}: {error}.",
                    log_path.display()
                ))
            })?;
        let mut command = (self.program)();
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log.try_clone().map_err(lost)?);
        detach(&mut command);
        let mut child = command
            .spawn()
            .map_err(|error| refused(format!("The app cannot start the engine: {error}.")))?;
        let deadline = tokio::time::Instant::now() + START;
        loop {
            if self.endpoint.connect().await.is_ok() {
                break;
            }
            if let Ok(Some(status)) = child.try_wait() {
                // Another app can start an engine at the same time: when this
                // one stops because the other listens, use the other one.
                if self.endpoint.connect().await.is_ok() {
                    break;
                }
                let mut text = String::new();
                let _ = log.seek(SeekFrom::Start(0));
                let _ = log.read_to_string(&mut text);
                let message = text
                    .lines()
                    .rev()
                    .find(|line| !line.trim().is_empty())
                    .map_or_else(
                        || format!("The engine stopped at start ({status})."),
                        str::to_owned,
                    );
                return Err(refused(message));
            }
            if tokio::time::Instant::now() > deadline {
                return Err(refused("The engine did not start in time.".to_owned()));
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        // Collect the exit status of the process when it stops, so that it
        // does not stay as a zombie while the app runs.
        std::thread::spawn(move || child.wait());
        Ok(())
    }
}

impl Connection {
    fn is_gone(&self) -> bool {
        self.pending
            .lock()
            .expect("the pending lock is never poisoned")
            .gone
    }

    /// Starts the writer and the reader of an open socket.
    fn run(socket: Socket) -> Connection {
        let (mut sink, mut source) = socket.split();
        let (outbox, mut queue) = mpsc::channel::<Message>(64);
        let pending: Pending = Arc::default();
        tokio::spawn(async move {
            while let Some(message) = queue.recv().await {
                if sink.send(message).await.is_err() {
                    break;
                }
            }
        });
        let answers = Arc::clone(&pending);
        let closing = outbox.clone();
        tokio::spawn(async move {
            while let Some(Ok(message)) = source.next().await {
                let Message::Text(text) = message else {
                    if matches!(message, Message::Close(_)) {
                        break;
                    }
                    continue;
                };
                let Ok(answer) = serde_json::from_str::<ServerMessage<Value>>(&text) else {
                    continue;
                };
                let id = match &answer {
                    ServerMessage::Result { id, .. } | ServerMessage::Error { id, .. } => *id,
                };
                let waiting = answers
                    .lock()
                    .expect("the pending lock is never poisoned")
                    .answers
                    .remove(&id);
                if let Some(waiting) = waiting {
                    let _ = waiting.send(answer);
                }
            }
            // The engine left: each waiting request fails, and the next
            // request opens a new connection.
            let mut waiting = answers.lock().expect("the pending lock is never poisoned");
            waiting.gone = true;
            waiting.answers.clear();
            drop(waiting);
            drop(closing);
        });
        Connection {
            outbox,
            pending,
            next: AtomicU64::new(1),
        }
    }
}

async fn send(socket: &mut Socket, message: &ClientMessage) -> io::Result<()> {
    let text = serde_json::to_string(message).map_err(io::Error::other)?;
    socket
        .send(Message::text(text))
        .await
        .map_err(io::Error::other)
}

async fn receive(socket: &mut Socket) -> Option<ServerMessage<Value>> {
    while let Some(Ok(message)) = socket.next().await {
        match message {
            Message::Text(text) => return serde_json::from_str(&text).ok(),
            Message::Close(_) => return None,
            _ => {}
        }
    }
    None
}

/// Starts the process in a group of its own, so that it continues when the
/// app, or the terminal that started the app, stops.
fn detach(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
}

fn refused(message: String) -> EngineError {
    EngineError {
        code: ErrorCode::FailedPrecondition,
        message,
    }
}

fn lost(error: io::Error) -> EngineError {
    refused(format!("The connection to the engine failed: {error}."))
}
