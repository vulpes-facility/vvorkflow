//! The engine process, `vvorkflow-server`: it serves one engine on a local
//! endpoint to the app core of the desktop app. Each connection carries
//! WebSocket frames; a text frame holds one JSON message of the envelope of
//! `vvorkflow-protocol`. `docs/architecture.md` gives the rules.

mod client;
mod connection;
mod endpoint;

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Notify, Semaphore, watch};
use vvorkflow_engine::Engine;

pub use client::EngineClient;
pub use endpoint::{ClientStream, Endpoint, Listener, ServerStream};

/// The largest message that the engine reads, which is far more than a
/// request needs.
pub const MAX_MESSAGE: usize = 1 << 20;

/// The requests of all clients that run at the same time, each on a blocking
/// thread.
pub const WORKERS: usize = 8;

/// The limits of an engine process, so that it does not keep memory for
/// nobody, and no client can take all of it.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    /// The time without a client after which the process stops.
    pub idle: Duration,
    /// The time that a client has for the WebSocket handshake and `hello`.
    pub hello: Duration,
    /// The clients that the engine serves at the same time. The engine
    /// closes the connection of a client after them at once.
    pub clients: usize,
}

impl Default for Limits {
    /// The limits of the binary: 5 minutes, 10 seconds, and 32 clients.
    fn default() -> Limits {
        Limits {
            idle: Duration::from_secs(5 * 60),
            hello: Duration::from_secs(10),
            clients: 32,
        }
    }
}

/// Serves the engine on the endpoint until a client sends `shutdown`, or
/// until no client is connected for the idle time of the `limits`.
///
/// Returns after the last answer is sent, and removes the socket. Refuses an
/// endpoint whose folder is not safe, and an endpoint where another engine
/// listens.
pub async fn serve(endpoint: &Endpoint, engine: Arc<Engine>, limits: Limits) -> Result<(), String> {
    endpoint.prepare()?;
    // The lock stays held until this function returns, after the listener
    // removes the socket.
    let _lock = endpoint.lock()?;
    let listener = endpoint.bind().map_err(|error| {
        format!(
            "The engine cannot listen in {}: {error}.",
            endpoint.folder().display()
        )
    })?;
    // The listener goes away when a client sends `shutdown`, so that no new
    // client reaches an engine that stops.
    let mut listener = Some(listener);
    let stop = Arc::new(Stop::default());
    let shared = Arc::new(connection::Shared {
        engine,
        workers: Arc::new(Semaphore::new(WORKERS)),
        hello: limits.hello,
        stop: Arc::clone(&stop),
    });
    let (clients, mut count) = watch::channel(0_usize);
    let clients = Arc::new(clients);
    loop {
        let alone = *count.borrow_and_update() == 0;
        tokio::select! {
            accepted = accept(&mut listener) => match accepted {
                Ok(stream) if *clients.borrow() < limits.clients => {
                    let client = Client::join(&clients);
                    tokio::spawn(connection::serve(stream, Arc::clone(&shared), client));
                }
                // Too many clients: the stream closes when it drops.
                Ok(_) => {}
                // A failed accept, for example when the client left at once,
                // does not stop the engine; a short wait keeps an error that
                // repeats from taking a whole core.
                Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
            },
            _ = count.changed() => {}
            () = stop.closing.notified() => {
                listener = None;
                stop.closed.notify_one();
            }
            () = stop.done.notified() => return Ok(()),
            () = tokio::time::sleep(limits.idle), if alone => return Ok(()),
        }
    }
}

/// The stop of the engine after `shutdown`: first it stops to listen, then
/// it answers, and after the answer is written, it stops.
#[derive(Default)]
pub(crate) struct Stop {
    closing: Notify,
    closed: Notify,
    done: Notify,
}

impl Stop {
    /// Returns when the engine no longer listens, so that no new client
    /// reaches an engine that stops.
    pub(crate) async fn begin(&self) {
        self.closing.notify_one();
        self.closed.notified().await;
    }

    pub(crate) fn finish(&self) {
        self.done.notify_one();
    }
}

/// The next connection, or none while the engine does not listen.
async fn accept(listener: &mut Option<Listener>) -> std::io::Result<ServerStream> {
    match listener {
        Some(listener) => listener.accept().await,
        None => std::future::pending().await,
    }
}

/// One connected client, which the engine counts until it leaves.
pub(crate) struct Client(Arc<watch::Sender<usize>>);

impl Client {
    fn join(clients: &Arc<watch::Sender<usize>>) -> Client {
        clients.send_modify(|count| *count += 1);
        Client(Arc::clone(clients))
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        self.0.send_modify(|count| *count -= 1);
    }
}
