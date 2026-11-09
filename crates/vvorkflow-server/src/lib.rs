//! The engine process, `vvorkflow-server`: it serves one engine on a local
//! endpoint to the app core of the desktop app. Each connection carries
//! WebSocket frames; a text frame holds one JSON message of the envelope of
//! `vvorkflow-protocol`. `docs/architecture.md` gives the rules.

mod connection;
mod endpoint;

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Notify, Semaphore, watch};
use vvorkflow_engine::Engine;

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
    let mut listener = endpoint.bind().map_err(|error| {
        format!(
            "The engine cannot listen in {}: {error}.",
            endpoint.folder().display()
        )
    })?;
    let stop = Arc::new(Notify::new());
    let workers = Arc::new(Semaphore::new(WORKERS));
    let (clients, mut count) = watch::channel(0_usize);
    let clients = Arc::new(clients);
    loop {
        let alone = *count.borrow_and_update() == 0;
        tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok(stream) if *clients.borrow() < limits.clients => {
                    let client = Client::join(&clients);
                    tokio::spawn(connection::serve(
                        stream,
                        Arc::clone(&engine),
                        Arc::clone(&workers),
                        limits.hello,
                        Arc::clone(&stop),
                        client,
                    ));
                }
                // Too many clients: the stream closes when it drops.
                Ok(_) => {}
                // A failed accept, for example when the client left at once,
                // does not stop the engine; a short wait keeps an error that
                // repeats from taking a whole core.
                Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
            },
            _ = count.changed() => {}
            () = stop.notified() => return Ok(()),
            () = tokio::time::sleep(limits.idle), if alone => return Ok(()),
        }
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
