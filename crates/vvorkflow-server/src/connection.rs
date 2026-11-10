//! One connection of a client: the WebSocket handshake, `hello`, the
//! requests, and the output of the terminal sessions.
//!
//! The reader does `session.attach`, `session.detach`, `session.write`, and
//! `session.resize` when it reads them, in the order of the connection, and
//! runs each other request on a blocking thread, whose answer can come in
//! any order. The writer sends the answers first, and then the events and
//! the frames of the sessions that the client is attached to.
//!
//! Each wait of a connection has a limit, so that a client that stops to
//! read or to write cannot keep its place or its work in the engine: the
//! handshake and `hello` have one deadline, the writer has a time without
//! progress, and when the connection ends, its queued requests end too.

use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::{Notify, Semaphore, mpsc};
use tokio::task::JoinSet;
use tokio::time::Instant;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::protocol::frame::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use vvorkflow_engine::{Client as Attached, ClientKind, Engine, Outgoing};
use vvorkflow_protocol::{
    ClientMessage, Done, EngineError, ErrorCode, MAX_OPEN_REQUESTS, Request, Response,
    ServerMessage,
};

use crate::{Client, MAX_MESSAGE, Stop};

/// The time that the engine waits for progress of a frame to the client. A
/// client that takes no byte for this time loses its connection; a large
/// frame that moves is not a reason.
const WRITE_TIME: Duration = Duration::from_secs(30);

/// The time that the engine waits for the last frames of a connection that
/// ends.
const CLOSE_TIME: Duration = Duration::from_secs(1);

/// The id of a message that is not a request of the protocol.
#[derive(Deserialize)]
struct Id {
    id: u64,
}

/// The things that one connection shares with the engine.
pub(crate) struct Shared {
    pub(crate) engine: Arc<Engine>,
    /// The blocking threads of all clients.
    pub(crate) workers: Arc<Semaphore>,
    pub(crate) hello: Duration,
    pub(crate) stop: Arc<Stop>,
}

/// What one connection keeps while it runs.
struct Connection<'a> {
    shared: &'a Shared,
    /// The client in the engine: the context of the requests, and the
    /// output of the attached sessions.
    attached: Attached,
    /// The answers and the close frame, which the writer sends first.
    answers: mpsc::Sender<Message>,
    requests: JoinSet<()>,
    greeted: &'a AtomicBool,
    stopping: &'a AtomicBool,
}

/// Serves one client until it leaves, until `hello` fails or does not come
/// in the `hello` time, until the client takes no byte for [`WRITE_TIME`],
/// or until it sends `shutdown`, which then stops the engine after the
/// answer.
pub(crate) async fn serve<S>(stream: S, shared: Arc<Shared>, _client: Client)
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let deadline = Instant::now() + shared.hello;
    let progress = Arc::new(Progress::default());
    let stream = Tracked {
        inner: stream,
        progress: Arc::clone(&progress),
    };
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE))
        .max_frame_size(Some(MAX_MESSAGE));
    let handshake = tokio_tungstenite::accept_async_with_config(stream, Some(config));
    let Ok(Ok(socket)) = tokio::time::timeout_at(deadline, handshake).await else {
        return;
    };
    let (sink, mut source) = socket.split();
    let (answers, outbox) = mpsc::channel::<Message>(64);
    let ready = Arc::new(Notify::new());
    let wake = Arc::clone(&ready);
    let attached = shared
        .engine
        .connect(ClientKind::Local, Arc::new(move || wake.notify_one()));
    let mut writer = tokio::spawn(write(sink, outbox, attached.clone(), ready, progress));
    let greeted = AtomicBool::new(false);
    let stopping = AtomicBool::new(false);
    let mut connection = Connection {
        shared: &shared,
        attached,
        answers,
        requests: JoinSet::new(),
        greeted: &greeted,
        stopping: &stopping,
    };

    let writer_ended = tokio::select! {
        () = connection.read(&mut source) => false,
        () = hello_expires(&greeted, deadline) => false,
        _ = &mut writer => true,
    };
    // The requests that wait or run end with the connection. A request on a
    // blocking thread finishes there, and keeps its worker until it ends.
    connection.requests.abort_all();
    // The answers end, and the writer, which holds the last copy of the
    // client, detaches it from each session when it ends.
    drop(connection);
    let stopping = stopping.load(Ordering::Acquire);
    if !writer_ended && tokio::time::timeout(CLOSE_TIME, &mut writer).await.is_err() {
        writer.abort();
    }
    if stopping {
        shared.stop.finish();
    }
}

impl Connection<'_> {
    /// Reads the requests of the client until the connection ends. Sets
    /// `stopping` at an accepted `shutdown`, before the answer.
    async fn read<S>(&mut self, source: &mut SplitStream<WebSocketStream<S>>)
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        while let Some(Ok(message)) = source.next().await {
            // Forget the requests that ended, so that the set stays small.
            while self.requests.try_join_next().is_some() {}
            let text = match message {
                Message::Text(text) => text,
                Message::Close(_) => return,
                // Tungstenite answers a ping by itself.
                Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => continue,
                Message::Binary(_) => {
                    self.close(CloseCode::Unsupported, "A request is a text frame.")
                        .await;
                    return;
                }
            };
            let ClientMessage { id, request } = match serde_json::from_str(&text) {
                Ok(message) => message,
                Err(error) => match serde_json::from_str::<Id>(&text) {
                    Ok(Id { id }) => {
                        let message = format!("The request is not valid: {error}.");
                        self.answer(id, Err(refusal(ErrorCode::InvalidArgument, message)))
                            .await;
                        continue;
                    }
                    Err(_) => {
                        self.close(CloseCode::Policy, "A message is a request with an id.")
                            .await;
                        return;
                    }
                },
            };
            if !self.request(id, request).await {
                return;
            }
        }
    }

    /// Does one request. Returns false when the connection ends.
    async fn request(&mut self, id: u64, request: Request) -> bool {
        let engine = &self.shared.engine;
        match request {
            Request::Hello(hello) => match engine.hello(hello) {
                Ok(welcome) => {
                    self.greeted.store(true, Ordering::Release);
                    self.answer(id, Ok(Response::Welcome(welcome))).await;
                }
                Err(error) => {
                    self.answer(id, Err(error)).await;
                    self.close(CloseCode::Policy, "The protocol versions differ.")
                        .await;
                    return false;
                }
            },
            Request::Shutdown(shutdown) => {
                // Without force, an engine with sessions refuses, and
                // continues to listen.
                if !shutdown.force
                    && let Err(error) = engine.stop(false)
                {
                    self.answer(id, Err(error)).await;
                    return true;
                }
                self.stopping.store(true, Ordering::Release);
                self.shared.stop.begin().await;
                if shutdown.force {
                    // The sessions end in at most 3 seconds.
                    let engine = Arc::clone(engine);
                    let _ = tokio::task::spawn_blocking(move || engine.stop(true)).await;
                }
                self.answer(id, Ok(Response::Done(Done {}))).await;
                self.close(CloseCode::Away, "The engine stops.").await;
                return false;
            }
            _ if !self.greeted.load(Ordering::Acquire) => {
                let message = "Send hello first.".to_owned();
                self.answer(id, Err(refusal(ErrorCode::FailedPrecondition, message)))
                    .await;
            }
            // The requests of a session that keep the order of the
            // connection, which never wait for the pseudo-terminal.
            request @ (Request::AttachSession(_)
            | Request::DetachSession(_)
            | Request::WriteSession(_)
            | Request::ResizeSession(_)) => {
                let attach = matches!(request, Request::AttachSession(_));
                let value = engine.handle(&self.attached, request);
                self.answer(id, value).await;
                // The screen of an attach goes after its answer.
                if attach {
                    self.attached.answered();
                }
            }
            request => {
                // The reader never waits for a place, so that it always sees
                // the end of the connection.
                if self.requests.len() >= MAX_OPEN_REQUESTS {
                    self.close(CloseCode::Policy, "Too many open requests.")
                        .await;
                    return false;
                }
                let engine = Arc::clone(engine);
                let attached = self.attached.clone();
                let workers = Arc::clone(&self.shared.workers);
                let answers = self.answers.clone();
                self.requests.spawn(async move {
                    let Ok(worker) = workers.acquire_owned().await else {
                        return;
                    };
                    let value = tokio::task::spawn_blocking(move || {
                        let _worker = worker;
                        engine.handle(&attached, request)
                    })
                    .await
                    .unwrap_or_else(|error| {
                        let message = format!("The request stopped: {error}");
                        Err(refusal(ErrorCode::FailedPrecondition, message))
                    });
                    answer(&answers, id, value).await;
                });
            }
        }
        true
    }

    async fn answer(&self, id: u64, value: Result<Response, EngineError>) {
        answer(&self.answers, id, value).await;
    }

    async fn close(&self, code: CloseCode, reason: &'static str) {
        let frame = CloseFrame {
            code,
            reason: reason.into(),
        };
        let _ = self.answers.send(Message::Close(Some(frame))).await;
    }
}

/// Returns at the deadline when the client did not say `hello` before it.
async fn hello_expires(greeted: &AtomicBool, deadline: Instant) {
    tokio::time::sleep_until(deadline).await;
    if greeted.load(Ordering::Acquire) {
        std::future::pending::<()>().await;
    }
}

/// Writes to the client, until the outbox of the answers closes, until a
/// close frame, or until the client takes no byte for [`WRITE_TIME`]. The
/// answers come first: each answer waits at most for the frame that is on
/// its way. Then come the events and the frames of the attached sessions,
/// which `attached` makes when the writer is ready for them. At the end, the
/// writer sends the close frame, also the answer to a close of the client,
/// and flushes it.
async fn write<S>(
    mut sink: SplitSink<WebSocketStream<S>, Message>,
    mut outbox: mpsc::Receiver<Message>,
    attached: Attached,
    ready: Arc<Notify>,
    progress: Arc<Progress>,
) where
    S: AsyncRead + AsyncWrite + Unpin,
{
    loop {
        let message = match outbox.try_recv() {
            Ok(message) => message,
            Err(mpsc::error::TryRecvError::Disconnected) => break,
            Err(mpsc::error::TryRecvError::Empty) => match attached.next() {
                Some(Outgoing::Event(event)) => match serde_json::to_string(&event) {
                    Ok(text) => Message::text(text),
                    // A serde type of the protocol always serializes.
                    Err(_) => continue,
                },
                Some(Outgoing::Frame(frame)) => Message::binary(frame),
                None => {
                    tokio::select! {
                        biased;
                        message = outbox.recv() => match message {
                            Some(message) => message,
                            None => break,
                        },
                        () = ready.notified() => continue,
                    }
                }
            },
        };
        let close = matches!(message, Message::Close(_));
        progress.touch();
        tokio::select! {
            sent = sink.send(message) => match sent {
                Ok(()) if !close => {}
                // A close frame, or a frame that the closing connection
                // refuses: the rest does not go out, but the close does.
                _ => break,
            },
            // A client that does not read gets no close frame.
            () = progress.stalled() => return,
        }
    }
    let _ = tokio::time::timeout(CLOSE_TIME, sink.close()).await;
}

async fn answer(answers: &mpsc::Sender<Message>, id: u64, value: Result<Response, EngineError>) {
    let message: ServerMessage = match value {
        Ok(result) => ServerMessage::Result { id, result },
        Err(error) => ServerMessage::Error { id, error },
    };
    // A serde type of the protocol always serializes.
    if let Ok(text) = serde_json::to_string(&message) {
        let _ = answers.send(Message::text(text)).await;
    }
}

fn refusal(code: ErrorCode, message: String) -> EngineError {
    EngineError { code, message }
}

/// The time of the last byte that the client took, in milliseconds since
/// its start.
struct Progress {
    start: Instant,
    last: AtomicU64,
}

impl Default for Progress {
    fn default() -> Progress {
        Progress {
            start: Instant::now(),
            last: AtomicU64::new(0),
        }
    }
}

impl Progress {
    fn touch(&self) {
        let elapsed = u64::try_from(self.start.elapsed().as_millis()).unwrap_or(u64::MAX);
        self.last.store(elapsed, Ordering::Release);
    }

    /// Returns when the client took no byte for [`WRITE_TIME`].
    async fn stalled(&self) {
        loop {
            let last = self.last.load(Ordering::Acquire);
            tokio::time::sleep_until(self.start + Duration::from_millis(last) + WRITE_TIME).await;
            if self.last.load(Ordering::Acquire) == last {
                return;
            }
        }
    }
}

/// A stream that tells [`Progress`] each time the client takes bytes.
struct Tracked<S> {
    inner: S,
    progress: Arc<Progress>,
}

impl<S: AsyncRead + Unpin> AsyncRead for Tracked<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(context, buffer)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for Tracked<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let written = Pin::new(&mut self.inner).poll_write(context, buffer);
        if let Poll::Ready(Ok(count)) = written
            && count > 0
        {
            self.progress.touch();
        }
        written
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(context)
    }

    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(context)
    }
}
