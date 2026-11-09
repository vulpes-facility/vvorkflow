//! One connection of a client: the WebSocket handshake, `hello`, and the
//! requests, each on a blocking thread, with their answers in any order.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{Semaphore, mpsc};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::protocol::frame::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use vvorkflow_engine::Engine;
use vvorkflow_protocol::{
    ClientMessage, Done, EngineError, ErrorCode, Request, Response, ServerMessage,
};

use crate::{Client, MAX_MESSAGE, Stop};

/// The requests of one connection that run at the same time. A client that
/// sends more waits, so that it cannot fill the memory of the engine.
const PARALLEL: usize = 8;

/// The id of a message that is not a request of the protocol.
#[derive(Deserialize)]
struct Id {
    id: u64,
}

/// Serves one client until it leaves, until `hello` fails or does not come
/// in the `hello` time, or until it sends `shutdown`, which then stops the
/// engine after the answer. Each request waits for one of the `workers`.
pub(crate) async fn serve<S>(
    stream: S,
    engine: Arc<Engine>,
    workers: Arc<Semaphore>,
    hello: Duration,
    stop: Arc<Stop>,
    _client: Client,
) where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let deadline = tokio::time::Instant::now() + hello;
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE))
        .max_frame_size(Some(MAX_MESSAGE));
    let handshake = tokio_tungstenite::accept_async_with_config(stream, Some(config));
    let Ok(Ok(socket)) = tokio::time::timeout_at(deadline, handshake).await else {
        return;
    };
    let (mut sink, mut source) = socket.split();
    let (send, mut outbox) = mpsc::channel::<Message>(64);
    let writer = tokio::spawn(async move {
        while let Some(message) = outbox.recv().await {
            let close = matches!(message, Message::Close(_));
            if sink.send(message).await.is_err() || close {
                break;
            }
        }
        // Send the close frame, also the answer to a close of the client, and
        // flush it.
        let _ = sink.close().await;
    });

    let parallel = Arc::new(Semaphore::new(PARALLEL));
    let mut greeted = false;
    let mut stopping = false;
    loop {
        let next = if greeted {
            source.next().await
        } else {
            match tokio::time::timeout_at(deadline, source.next()).await {
                Ok(next) => next,
                Err(_) => {
                    close(&send, CloseCode::Policy, "Send hello first.").await;
                    break;
                }
            }
        };
        let Some(Ok(message)) = next else {
            break;
        };
        let text = match message {
            Message::Text(text) => text,
            Message::Close(_) => break,
            // Tungstenite answers a ping by itself.
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => continue,
            Message::Binary(_) => {
                close(&send, CloseCode::Unsupported, "A request is a text frame.").await;
                break;
            }
        };
        let ClientMessage { id, request } = match serde_json::from_str(&text) {
            Ok(message) => message,
            Err(error) => match serde_json::from_str::<Id>(&text) {
                Ok(Id { id }) => {
                    let message = format!("The request is not valid: {error}.");
                    answer(&send, id, Err(refusal(ErrorCode::InvalidArgument, message))).await;
                    continue;
                }
                Err(_) => {
                    close(
                        &send,
                        CloseCode::Policy,
                        "A message is a request with an id.",
                    )
                    .await;
                    break;
                }
            },
        };
        match request {
            Request::Hello(hello) => match engine.hello(hello) {
                Ok(welcome) => {
                    greeted = true;
                    answer(&send, id, Ok(Response::Welcome(welcome))).await;
                }
                Err(error) => {
                    answer(&send, id, Err(error)).await;
                    close(&send, CloseCode::Policy, "The protocol versions differ.").await;
                    break;
                }
            },
            Request::Shutdown(_) => {
                stop.begin().await;
                answer(&send, id, Ok(Response::Done(Done {}))).await;
                close(&send, CloseCode::Away, "The engine stops.").await;
                stopping = true;
                break;
            }
            _ if !greeted => {
                let message = "Send hello first.".to_owned();
                answer(
                    &send,
                    id,
                    Err(refusal(ErrorCode::FailedPrecondition, message)),
                )
                .await;
            }
            request => {
                let Ok(permit) = Arc::clone(&parallel).acquire_owned().await else {
                    break;
                };
                let engine = Arc::clone(&engine);
                let workers = Arc::clone(&workers);
                let send = send.clone();
                tokio::spawn(async move {
                    let Ok(_worker) = workers.acquire_owned().await else {
                        return;
                    };
                    let value = tokio::task::spawn_blocking(move || engine.handle(request))
                        .await
                        .unwrap_or_else(|error| {
                            let message = format!("The request stopped: {error}");
                            Err(refusal(ErrorCode::FailedPrecondition, message))
                        });
                    answer(&send, id, value).await;
                    drop(permit);
                });
            }
        }
    }
    // The writer ends when each sender is gone: this one, and those of the
    // requests that still run.
    drop(send);
    let _ = writer.await;
    if stopping {
        stop.finish();
    }
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
