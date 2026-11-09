//! The engine process, `vvorkflow-server`: it serves one engine on a local
//! endpoint to the app core of the desktop app. Each connection carries
//! WebSocket frames; a text frame holds one JSON message of the envelope of
//! `vvorkflow-protocol`. `docs/architecture.md` gives the rules.

mod connection;
mod endpoint;

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Notify, watch};
use vvorkflow_engine::Engine;

pub use endpoint::{ClientStream, Endpoint, Listener, ServerStream};

/// The time without a client after which the engine process stops, so that
/// it does not keep memory for nobody.
pub const IDLE: Duration = Duration::from_secs(5 * 60);

/// The largest message that the engine reads, which is far more than a
/// request needs.
pub const MAX_MESSAGE: usize = 1 << 20;

/// Serves the engine on the endpoint until a client sends `shutdown`, or
/// until no client is connected for the `idle` time.
///
/// Returns after the last answer is sent, and removes the socket. Refuses an
/// endpoint whose folder is not safe, and an endpoint where another engine
/// listens.
pub async fn serve(endpoint: &Endpoint, engine: Arc<Engine>, idle: Duration) -> Result<(), String> {
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
    let (clients, mut count) = watch::channel(0_usize);
    let clients = Arc::new(clients);
    loop {
        let alone = *count.borrow_and_update() == 0;
        tokio::select! {
            accepted = listener.accept() => {
                // A failed accept, for example when the client left at once,
                // does not stop the engine.
                if let Ok(stream) = accepted {
                    let client = Client::join(&clients);
                    tokio::spawn(connection::serve(
                        stream,
                        Arc::clone(&engine),
                        Arc::clone(&stop),
                        client,
                    ));
                }
            }
            _ = count.changed() => {}
            () = stop.notified() => return Ok(()),
            () = tokio::time::sleep(idle), if alone => return Ok(()),
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
