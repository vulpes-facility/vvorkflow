//! The way of the events and the frames of the engine to the web UI: one
//! channel of the Tauri IPC, in the order of the connection
//! (`docs/architecture.md`, Protocol, rules 11 to 13).

use std::sync::{Arc, Mutex};

use serde_json::json;
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::Notify;
use vvorkflow_server::{Budget, Deliveries, Delivery};

/// Sends each event and each frame of the engine to the channel of the web
/// UI, and gives the bytes back to the client of the engine when the web UI
/// acknowledged them. So the client stops to read the connection while the
/// web UI is behind, and no queue of the app grows without a limit.
pub(crate) struct Relay {
    page: Mutex<Page>,
    subscribed: Notify,
    budget: Budget,
}

/// The web UI that listens now.
#[derive(Default)]
struct Page {
    channel: Option<Channel>,
    /// The bytes that this page got and did not acknowledge yet.
    sent: usize,
}

impl Relay {
    pub(crate) fn new(budget: Budget) -> Relay {
        Relay {
            page: Mutex::default(),
            subscribed: Notify::new(),
            budget,
        }
    }

    /// Takes the channel of the web UI. A page that loads again gives a new
    /// channel: the bytes that the page before it did not acknowledge come
    /// back, because that page is gone.
    pub(crate) fn subscribe(&self, channel: Channel) {
        let mut page = self.page.lock().expect("the page lock is never poisoned");
        self.budget.release(page.sent);
        *page = Page {
            channel: Some(channel),
            sent: 0,
        };
        self.subscribed.notify_one();
    }

    /// Gives back bytes that the web UI took: a frame that its terminal
    /// wrote, or an event that it noted. Never more than the page got.
    pub(crate) fn acknowledge(&self, bytes: usize) {
        let mut page = self.page.lock().expect("the page lock is never poisoned");
        let bytes = bytes.min(page.sent);
        page.sent -= bytes;
        self.budget.release(bytes);
    }

    /// Sends the items of the client until the client is gone. An item waits
    /// until a web UI listens.
    ///
    /// An event goes as JSON, with the bytes that the web UI gives back for
    /// it: `{"bytes": 31, "event": {"event": "…", "params": {…}}}`. A frame
    /// goes as its bytes, and the web UI gives back its length. The end of a
    /// connection goes as the event `connection.closed`.
    pub(crate) async fn run(self: Arc<Relay>, mut deliveries: Deliveries) {
        while let Some(item) = deliveries.next().await {
            let bytes = item.size();
            let mut body = Some(match item {
                Delivery::Event { event, .. } => message(bytes, &event),
                Delivery::Frame(frame) => InvokeResponseBody::Raw(frame),
                Delivery::Closed => message(0, &json!({"event": "connection.closed", "params": {}})),
            });
            while let Some(item) = body.take() {
                // Ask for the wake-up before the look at the page, so that a
                // page that comes between the two is not missed.
                let subscribed = self.subscribed.notified();
                {
                    let mut page = self.page.lock().expect("the page lock is never poisoned");
                    if let Some(channel) = &page.channel {
                        // A send fails only when the webview is gone: the
                        // item is then for nobody.
                        if channel.send(item).is_ok() {
                            page.sent += bytes;
                        } else {
                            self.budget.release(bytes);
                        }
                        continue;
                    }
                }
                body = Some(item);
                subscribed.await;
            }
        }
    }
}

fn message(bytes: usize, event: &serde_json::Value) -> InvokeResponseBody {
    InvokeResponseBody::Json(json!({"bytes": bytes, "event": event}).to_string())
}
