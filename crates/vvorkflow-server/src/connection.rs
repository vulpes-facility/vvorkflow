//! One connection of a client: the WebSocket handshake, `hello`, and the
//! requests, each on a blocking thread, with their answers in any order.
//!
//! Each wait of a connection has a limit, so that a client that stops to
//! read or to write cannot keep its place or its work in the engine: the
//! handshake and `hello` have one deadline, each frame to the client has a
//! write time, and when the connection ends, its queued requests end too.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{Semaphore, mpsc};
use tokio::task::JoinSet;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::protocol::frame::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use vvorkflow_engine::Engine;
use vvorkflow_protocol::{
    ClientMessage, Done, EngineError, ErrorCode, Request, Response, ServerMessage,
};

use crate::{Client, MAX_MESSAGE, Stop};

/// The requests of one connection that wait or run at the same time. A
/// client that sends more waits, so that it cannot fill the memory of the
/// engine.
const PARALLEL: usize = 8;

/// The time that the engine waits for the client to take one frame. A client
/// that does not read for this time loses its connection.
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

/// Serves one client until it leaves, until `hello` fails or does not come
/// in the `hello` time, until the client does not read for [`WRITE_TIME`], or
/// until it sends `shutdown`, which then stops the engine after the answer.
pub(crate) async fn serve<S>(stream: S, shared: Arc<Shared>, _client: Client)
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let deadline = tokio::time::Instant::now() + shared.hello;
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE))
        .max_frame_size(Some(MAX_MESSAGE));
    let handshake = tokio_tungstenite::accept_async_with_config(stream, Some(config));
    let Ok(Ok(socket)) = tokio::time::timeout_at(deadline, handshake).await else {
        return;
    };
    let (sink, mut source) = socket.split();
    let (send, outbox) = mpsc::channel::<Message>(64);
    let mut writer = tokio::spawn(write(sink, outbox));
    let mut requests = JoinSet::new();
    let greeted = AtomicBool::new(false);
    let stopping = AtomicBool::new(false);

    let writer_ended = tokio::select! {
        () = read(&mut source, &send, &mut requests, &greeted, &stopping, &shared) => false,
        () = hello_expires(&greeted, deadline) => false,
        _ = &mut writer => true,
    };
    // The requests that wait or run end with the connection. A request on a
    // blocking thread finishes there, and keeps its worker until it ends.
    requests.abort_all();
    drop(send);
    if !writer_ended && tokio::time::timeout(CLOSE_TIME, &mut writer).await.is_err() {
        writer.abort();
    }
    if stopping.load(Ordering::Acquire) {
        shared.stop.finish();
    }
}

/// Reads the requests of the client until the connection ends. Sets
/// `stopping` at `shutdown`, before the answer.
async fn read<S>(
    source: &mut SplitStream<WebSocketStream<S>>,
    send: &mpsc::Sender<Message>,
    requests: &mut JoinSet<()>,
    greeted: &AtomicBool,
    stopping: &AtomicBool,
    shared: &Shared,
) where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let parallel = Arc::new(Semaphore::new(PARALLEL));
    while let Some(Ok(message)) = source.next().await {
        // Forget the requests that ended, so that the set stays small.
        while requests.try_join_next().is_some() {}
        let text = match message {
            Message::Text(text) => text,
            Message::Close(_) => return,
            // Tungstenite answers a ping by itself.
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => continue,
            Message::Binary(_) => {
                close(send, CloseCode::Unsupported, "A request is a text frame.").await;
                return;
            }
        };
        let ClientMessage { id, request } = match serde_json::from_str(&text) {
            Ok(message) => message,
            Err(error) => match serde_json::from_str::<Id>(&text) {
                Ok(Id { id }) => {
                    let message = format!("The request is not valid: {error}.");
                    answer(send, id, Err(refusal(ErrorCode::InvalidArgument, message))).await;
                    continue;
                }
                Err(_) => {
                    close(
                        send,
                        CloseCode::Policy,
                        "A message is a request with an id.",
                    )
                    .await;
                    return;
                }
            },
        };
        match request {
            Request::Hello(hello) => match shared.engine.hello(hello) {
                Ok(welcome) => {
                    greeted.store(true, Ordering::Release);
                    answer(send, id, Ok(Response::Welcome(welcome))).await;
                }
                Err(error) => {
                    answer(send, id, Err(error)).await;
                    close(send, CloseCode::Policy, "The protocol versions differ.").await;
                    return;
                }
            },
            Request::Shutdown(_) => {
                stopping.store(true, Ordering::Release);
                shared.stop.begin().await;
                answer(send, id, Ok(Response::Done(Done {}))).await;
                close(send, CloseCode::Away, "The engine stops.").await;
                return;
            }
            _ if !greeted.load(Ordering::Acquire) => {
                let message = "Send hello first.".to_owned();
                answer(
                    send,
                    id,
                    Err(refusal(ErrorCode::FailedPrecondition, message)),
                )
                .await;
            }
            request => {
                let Ok(place) = Arc::clone(&parallel).acquire_owned().await else {
                    return;
                };
                let engine = Arc::clone(&shared.engine);
                let workers = Arc::clone(&shared.workers);
                let send = send.clone();
                requests.spawn(async move {
                    let _place = place;
                    let Ok(worker) = workers.acquire_owned().await else {
                        return;
                    };
                    let value = tokio::task::spawn_blocking(move || {
                        let _worker = worker;
                        engine.handle(request)
                    })
                    .await
                    .unwrap_or_else(|error| {
                        let message = format!("The request stopped: {error}");
                        Err(refusal(ErrorCode::FailedPrecondition, message))
                    });
                    answer(&send, id, value).await;
                });
            }
        }
    }
}

/// Returns at the deadline when the client did not say `hello` before it.
async fn hello_expires(greeted: &AtomicBool, deadline: tokio::time::Instant) {
    tokio::time::sleep_until(deadline).await;
    if greeted.load(Ordering::Acquire) {
        std::future::pending::<()>().await;
    }
}

/// Writes each frame of the outbox to the client, until the outbox closes,
/// until a close frame, or until the client does not take a frame for
/// [`WRITE_TIME`]. Then sends the close frame, also the answer to a close of
/// the client, and flushes it.
async fn write<S>(
    mut sink: SplitSink<WebSocketStream<S>, Message>,
    mut outbox: mpsc::Receiver<Message>,
) where
    S: AsyncRead + AsyncWrite + Unpin,
{
    while let Some(message) = outbox.recv().await {
        let close = matches!(message, Message::Close(_));
        match tokio::time::timeout(WRITE_TIME, sink.send(message)).await {
            Ok(Ok(())) if !close => {}
            Ok(Ok(())) => break,
            Ok(Err(_)) | Err(_) => return,
        }
    }
    let _ = tokio::time::timeout(CLOSE_TIME, sink.close()).await;
}

async fn answer(send: &mpsc::Sender<Message>, id: u64, value: Result<Response, EngineError>) {
    let message: ServerMessage = match value {
        Ok(result) => ServerMessage::Result { id, result },
        Err(error) => ServerMessage::Error { id, error },
    };
    // A serde type of the protocol always serializes.
    if let Ok(text) = serde_json::to_string(&message) {
        let _ = send.send(Message::text(text)).await;
    }
}

async fn close(send: &mpsc::Sender<Message>, code: CloseCode, reason: &'static str) {
    let frame = CloseFrame {
        code,
        reason: reason.into(),
    };
    let _ = send.send(Message::Close(Some(frame))).await;
}

fn refusal(code: ErrorCode, message: String) -> EngineError {
    EngineError { code, message }
}
