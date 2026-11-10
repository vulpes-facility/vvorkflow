//! The client of the engine process, for the app core: it connects to the
//! engine of an endpoint, starts one when none listens, replaces an engine of
//! another protocol version, and matches each answer to its request by id.
//! It gives the events and the binary frames of the engine to its owner, and
//! stops to read the connection while the owner did not take them.

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore, mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use vvorkflow_protocol::{
    ClientMessage, EngineError, ErrorCode, Event, Frame, Hello, MAX_FRAME, MAX_OPEN_REQUESTS,
    PROTOCOL_VERSION, Request, ServerMessage, Shutdown,
};

use crate::Endpoint;
use crate::endpoint::BUSY;

/// The time that a new engine process has to listen.
const START: Duration = Duration::from_secs(10);

/// The time that an engine has for the WebSocket handshake and its answer to
/// `hello` or to `shutdown`.
const ANSWER: Duration = Duration::from_secs(10);

/// The time that the client waits for another app that starts or replaces
/// the engine. It is longer than the longest start of this client.
const TURN: Duration = Duration::from_secs(60);

/// The bytes of the frames that the owner did not give back yet, at which
/// the client stops to read the connection (`docs/architecture.md`,
/// Protocol, rule 12). One frame can take the count above it.
pub const DELIVERY_LIMIT: usize = 1 << 20;

type Socket = tokio_tungstenite::WebSocketStream<crate::ClientStream>;
type Pending = Arc<Mutex<Waiting>>;

/// An event or a binary frame of the engine, in the order of the
/// connection.
#[derive(Clone, Debug, PartialEq)]
pub enum Delivery {
    /// An event, as the JSON that the engine sent.
    Event(Value),
    /// A binary frame of terminal output, as the engine sent it.
    Frame(Vec<u8>),
    /// The connection to the engine ended: after the last item of that
    /// connection, and before the first item of the next one. The
    /// attachments of that connection are gone.
    Closed,
}

/// The events and the frames of the engine, for the owner of a client. The
/// client stops to read the connection while the frames that the owner
/// did not give back with [`Budget::release`] have [`DELIVERY_LIMIT`]
/// bytes or more, so that the limits of the engine apply.
pub struct Deliveries {
    receiver: mpsc::UnboundedReceiver<(Delivery, usize)>,
    budget: Budget,
}

impl Deliveries {
    /// The next item, or None when the client is gone. The bytes of an
    /// event come back at once; the owner gives back the bytes of a frame.
    pub async fn next(&mut self) -> Option<Delivery> {
        let (delivery, size) = self.receiver.recv().await?;
        if !matches!(delivery, Delivery::Frame(_)) {
            self.budget.release(size);
        }
        Some(delivery)
    }

    /// The budget, for the owner part that tells which frames the terminal
    /// took.
    pub fn budget(&self) -> Budget {
        self.budget.clone()
    }
}

/// The bytes of the items that the owner did not take or give back yet.
#[derive(Clone, Default)]
pub struct Budget(Arc<Bytes>);

#[derive(Default)]
struct Bytes {
    held: Mutex<usize>,
    released: Notify,
}

impl Budget {
    /// Gives back the bytes of a frame: when the terminal took it, or when
    /// the owner dropped it.
    pub fn release(&self, bytes: usize) {
        let mut held = self
            .0
            .held
            .lock()
            .expect("the budget lock is never poisoned");
        *held = held.saturating_sub(bytes);
        drop(held);
        self.0.released.notify_one();
    }

    /// Waits until the held bytes are below [`DELIVERY_LIMIT`], and then
    /// holds `bytes` more.
    async fn hold(&self, bytes: usize) {
        loop {
            {
                let mut held = self
                    .0
                    .held
                    .lock()
                    .expect("the budget lock is never poisoned");
                if *held < DELIVERY_LIMIT {
                    *held += bytes;
                    return;
                }
            }
            self.0.released.notified().await;
        }
    }
}

/// Where the reader of a connection puts the events and the frames.
#[derive(Clone)]
struct Owner {
    sender: mpsc::UnboundedSender<(Delivery, usize)>,
    budget: Budget,
}

/// The requests of a connection that wait for an answer, and whether the
/// connection is gone. A gone connection takes no new request, so that no
/// request waits for an answer that cannot come.
#[derive(Default)]
struct Waiting {
    gone: bool,
    answers: HashMap<u64, Open>,
}

/// One open request: where its answer goes, and its place in the open
/// requests of the client, which it keeps until the answer comes or the
/// connection ends, also when the caller no longer waits.
struct Open {
    answer: oneshot::Sender<ServerMessage<Value>>,
    _place: OwnedSemaphorePermit,
}

/// A connection to the engine process that the client opens when it needs
/// one, and opens again after the engine stops.
pub struct EngineClient {
    endpoint: Endpoint,
    program: Box<dyn Fn() -> Command + Send + Sync>,
    connection: tokio::sync::Mutex<Slot>,
    owner: Option<Owner>,
    /// The places of the open requests: the engine closes a connection with
    /// more than `MAX_OPEN_REQUESTS`, so a request waits here for a place.
    open: Arc<Semaphore>,
    start: Duration,
}

/// The connection of the requests, and the reader of the connection before
/// it, which the next connection waits for, so that the `Closed` of the old
/// connection comes before the first item of the new one.
#[derive(Default)]
struct Slot {
    connection: Option<Connection>,
    ending: Option<JoinHandle<()>>,
}

/// One open connection: the queue of its writer, and the requests that wait
/// for an answer. The connection closes when this value drops.
struct Connection {
    outbox: mpsc::Sender<Message>,
    pending: Pending,
    next: AtomicU64,
    reader: Option<JoinHandle<()>>,
    writer: JoinHandle<()>,
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
            connection: tokio::sync::Mutex::default(),
            owner: None,
            open: Arc::new(Semaphore::new(MAX_OPEN_REQUESTS)),
            start: START,
        }
    }

    /// The same client, which gives the events and the binary frames of the
    /// engine to an owner. Without it, the client drops them.
    pub fn with_deliveries(mut self) -> (EngineClient, Deliveries) {
        let (sender, receiver) = mpsc::unbounded_channel();
        let budget = Budget::default();
        self.owner = Some(Owner {
            sender,
            budget: budget.clone(),
        });
        (self, Deliveries { receiver, budget })
    }

    /// The same client with another time that a new engine process has to
    /// listen, in place of 10 seconds.
    #[must_use]
    pub fn start_time(mut self, time: Duration) -> EngineClient {
        self.start = time;
        self
    }

    /// Sends one request to the engine, and waits for its answer.
    ///
    /// Returns the JSON value of the answer. Returns the error of the engine,
    /// or `failedPrecondition` when no engine can start or the engine stops
    /// before it answers. A request that the engine did not answer is not
    /// sent again.
    pub async fn request(&self, request: Request) -> Result<Value, EngineError> {
        let place = Arc::clone(&self.open)
            .acquire_owned()
            .await
            .map_err(|_| refused("The client is closed.".to_owned()))?;
        let stops = matches!(request, Request::Shutdown(_));
        let (outbox, pending, id) = {
            let mut slot = self.connection.lock().await;
            if slot.connection.as_ref().is_none_or(Connection::is_gone) {
                if let Some(old) = slot.connection.take() {
                    slot.ending = old.end();
                }
                // The old reader sends `Closed` when it ends. This wait
                // stays in the slot when the caller stops to wait.
                if let Some(ending) = &mut slot.ending {
                    let _ = ending.await;
                    slot.ending = None;
                }
                slot.connection = Some(self.establish().await?);
            }
            let open = slot
                .connection
                .as_ref()
                .expect("the slot holds a connection");
            let id = open.next.fetch_add(1, Ordering::Relaxed);
            (open.outbox.clone(), Arc::clone(&open.pending), id)
        };
        let text = serde_json::to_string(&ClientMessage { id, request })
            .map_err(|error| refused(format!("The request does not serialize: {error}.")))?;
        // The place in the queue of the writer comes first. Then nothing
        // waits between the entry of the request and its send, so a caller
        // that drops this future leaves no entry without a request.
        let Ok(queued) = outbox.reserve().await else {
            end(&pending);
            return Err(stopped());
        };
        let (answer, wait) = oneshot::channel();
        {
            let mut waiting = pending.lock().expect("the pending lock is never poisoned");
            if waiting.gone {
                return Err(stopped());
            }
            let open = Open {
                answer,
                _place: place,
            };
            waiting.answers.insert(id, open);
        }
        queued.send(Message::text(text));
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
            Err(_) => Err(stopped()),
        }
    }

    /// Opens a connection: to the engine that listens, or to a new one.
    async fn establish(&self) -> Result<Connection, EngineError> {
        match self.open().await {
            Ok(connection) => return Ok(connection),
            Err(Refused::Failed(error)) => return Err(error),
            Err(Refused::Absent | Refused::OtherVersion) => {}
        }
        // Another app can start or replace the engine while this one waits
        // for its turn: ask again, and never stop the engine of that app.
        let _turn = self.turn().await?;
        match self.open().await {
            Ok(connection) => return Ok(connection),
            Err(Refused::Failed(error)) => return Err(error),
            Err(Refused::Absent) => {}
            // An engine with sessions refuses: the request fails with its
            // message, and no second engine starts.
            Err(Refused::OtherVersion) => self.stop_other(false).await?,
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

    /// Waits for the turn of this app to start or to replace the engine.
    async fn turn(&self) -> Result<File, EngineError> {
        self.endpoint.prepare().map_err(refused)?;
        let deadline = tokio::time::Instant::now() + TURN;
        loop {
            if let Some(turn) = self.endpoint.turn().map_err(refused)? {
                return Ok(turn);
            }
            if tokio::time::Instant::now() > deadline {
                return Err(refused(
                    "Another app starts the engine, and does not finish.".to_owned(),
                ));
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// Connects, and says `hello`. Fails when the engine does not answer in
    /// [`ANSWER`], so that an engine that hangs does not stop each request.
    async fn open(&self) -> Result<Connection, Refused> {
        tokio::time::timeout(ANSWER, self.greet())
            .await
            .unwrap_or_else(|_| {
                Err(Refused::Failed(refused(
                    "The engine does not answer.".to_owned(),
                )))
            })
    }

    async fn greet(&self) -> Result<Connection, Refused> {
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
        Ok(Connection::run(socket, self.owner.clone()))
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
        // A screen frame can have 32 MiB and 21 bytes.
        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_FRAME))
            .max_frame_size(Some(MAX_FRAME));
        tokio_tungstenite::client_async_with_config("ws://localhost/", stream, Some(config))
            .await
            .map(|(socket, _)| socket)
            .map_err(|_| Refused::Absent)
    }

    /// Stops the engine that listens, on a connection of its own, before
    /// `hello`, with `shutdown`, which each version understands, and waits
    /// until it no longer listens. Without `force`, an engine with sessions
    /// refuses: then this returns the refusal of that engine.
    async fn stop_other(&self, force: bool) -> Result<(), EngineError> {
        let answer = tokio::time::timeout(ANSWER, async {
            let mut socket = self.handshake().await.ok()?;
            let shutdown = ClientMessage {
                id: 0,
                request: Request::Shutdown(Shutdown { force }),
            };
            send(&mut socket, &shutdown).await.ok()?;
            receive(&mut socket).await
        })
        .await;
        if let Ok(Some(ServerMessage::Error { error, .. })) = answer {
            return Err(error);
        }
        for _ in 0..100 {
            if self.endpoint.connect().await.is_err() {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        Ok(())
    }

    /// Stops the engine that listens, also when it has sessions: they end,
    /// as `session.kill` ends them. The client sends `shutdown` with
    /// `force` on a connection of its own, before `hello`, and waits until
    /// the engine no longer listens. The next request starts a new engine.
    ///
    /// Returns the error of the engine, or `failedPrecondition` when the turn
    /// to replace the engine does not come.
    pub async fn force_stop(&self) -> Result<(), EngineError> {
        {
            let _turn = self.turn().await?;
            self.stop_other(true).await?;
        }
        // The engine closed the connection of the requests too: the next
        // request opens a new one at once. A request that opens a connection
        // holds the slot while it waits for the turn, so the turn is free
        // first.
        if let Some(connection) = &self.connection.lock().await.connection {
            end(&connection.pending);
        }
        Ok(())
    }

    /// Starts an engine process, detached from the app, with its stderr in
    /// the log of the endpoint, and waits until it listens.
    ///
    /// Fails with the last line of the log when the process stops first, for
    /// example because the projects root is not correct. When the process
    /// does not listen in the start time, or when the caller no longer
    /// waits, the client stops the process.
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
        let mut process =
            Starting(Some(command.spawn().map_err(|error| {
                refused(format!("The app cannot start the engine: {error}."))
            })?));
        let deadline = tokio::time::Instant::now() + self.start;
        loop {
            if self.endpoint.connect().await.is_ok() {
                break;
            }
            if let Some(status) = process.stopped() {
                // Another engine can start at the same time, for example from
                // a command line: when this one stops because the other
                // listens, use the other one.
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
        process.keep();
        Ok(())
    }
}

/// An engine process that does not listen yet. When this value drops, for
/// example because the start time is over or the caller no longer waits, the
/// process stops.
struct Starting(Option<Child>);

impl Starting {
    /// The exit status, when the process stopped.
    fn stopped(&mut self) -> Option<ExitStatus> {
        let status = self.0.as_mut()?.try_wait().ok()??;
        self.0 = None;
        Some(status)
    }

    /// Lets the process continue after this value drops.
    fn keep(mut self) {
        if let Some(child) = self.0.take() {
            collect(child);
        }
    }
}

impl Drop for Starting {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            collect(child);
        }
    }
}

/// Collects the exit status of the process when it stops, so that it does
/// not stay as a zombie while the app runs.
fn collect(mut child: Child) {
    std::thread::spawn(move || child.wait());
}

impl Connection {
    fn is_gone(&self) -> bool {
        self.pending
            .lock()
            .expect("the pending lock is never poisoned")
            .gone
    }

    /// Starts the writer and the reader of an open socket. The reader gives
    /// each event and each binary frame to the `owner`, and `Closed` at its
    /// end, also when it stops because the connection drops.
    fn run(socket: Socket, owner: Option<Owner>) -> Connection {
        let (mut sink, mut source) = socket.split();
        let (outbox, mut queue) = mpsc::channel::<Message>(64);
        let pending: Pending = Arc::default();
        let answers = Arc::clone(&pending);
        let writer = tokio::spawn(async move {
            while let Some(message) = queue.recv().await {
                if sink.send(message).await.is_err() {
                    break;
                }
            }
            end(&answers);
        });
        let answers = Arc::clone(&pending);
        // The connection ends when the reader ends: the writer then stops
        // too, so that the socket closes, and the engine has its place again.
        let write = writer.abort_handle();
        let reader = tokio::spawn(async move {
            let closed = Closed(owner.as_ref().map(|owner| owner.sender.clone()));
            while let Some(Ok(message)) = source.next().await {
                let delivery = match message {
                    Message::Text(text) => {
                        // An engine that sends something else than an answer or
                        // an event does not speak the protocol: its connection
                        // ends, so that no request waits for an answer that
                        // cannot come.
                        match serde_json::from_str::<ServerMessage<Value>>(&text) {
                            Ok(answer) => {
                                answered(&answers, answer);
                                continue;
                            }
                            // The engine never sends `connection.closed`.
                            Err(_) => match serde_json::from_str::<Event>(&text) {
                                Ok(Event::ConnectionClosed(_)) | Err(_) => break,
                                Ok(_) => match serde_json::from_str::<Value>(&text) {
                                    Ok(event) => (Delivery::Event(event), text.len()),
                                    Err(_) => break,
                                },
                            },
                        }
                    }
                    Message::Binary(bytes) => {
                        if Frame::parse(&bytes).is_none() {
                            break;
                        }
                        let size = bytes.len();
                        (Delivery::Frame(bytes.into()), size)
                    }
                    Message::Close(_) => break,
                    _ => continue,
                };
                if let Some(owner) = &owner {
                    // The owner did not take enough: wait, and so stop to
                    // read the connection.
                    owner.budget.hold(delivery.1).await;
                    let _ = owner.sender.send(delivery);
                }
            }
            end(&answers);
            write.abort();
            drop(closed);
        });
        Connection {
            outbox,
            pending,
            next: AtomicU64::new(1),
            reader: Some(reader),
            writer,
        }
    }

    /// Ends the connection, and returns its reader, which ends soon after,
    /// and sends `Closed` then.
    fn end(mut self) -> Option<JoinHandle<()>> {
        let reader = self.reader.take();
        if let Some(reader) = &reader {
            reader.abort();
        }
        reader
    }
}

/// Gives an answer to the request that waits for it.
fn answered(pending: &Pending, answer: ServerMessage<Value>) {
    let id = match &answer {
        ServerMessage::Result { id, .. } | ServerMessage::Error { id, .. } => *id,
    };
    let open = pending
        .lock()
        .expect("the pending lock is never poisoned")
        .answers
        .remove(&id);
    if let Some(open) = open {
        let _ = open.answer.send(answer);
    }
}

/// Sends `Closed` to the owner when the reader of a connection ends, also
/// when its task stops.
struct Closed(Option<mpsc::UnboundedSender<(Delivery, usize)>>);

impl Drop for Closed {
    fn drop(&mut self) {
        if let Some(sender) = &self.0 {
            let _ = sender.send((Delivery::Closed, 0));
        }
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        if let Some(reader) = &self.reader {
            reader.abort();
        }
        self.writer.abort();
        end(&self.pending);
    }
}

/// The end of a connection: each waiting request fails, and the next request
/// opens a new connection.
fn end(pending: &Pending) {
    let mut waiting = pending.lock().expect("the pending lock is never poisoned");
    waiting.gone = true;
    waiting.answers.clear();
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

fn stopped() -> EngineError {
    refused("The engine stopped before it answered.".to_owned())
}

fn lost(error: io::Error) -> EngineError {
    refused(format!("The connection to the engine failed: {error}."))
}
