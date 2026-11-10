//! The terminal sessions through the engine process: the events and the
//! frames that the client of the app core gives to its owner, the limit of
//! the frames that the owner did not take, the stop of an engine with
//! sessions, the replacement of an engine of another version that has
//! sessions, the idle time while a session runs, a frame of the largest
//! size, and the events that the owner keeps.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;
use vvorkflow_engine::Engine;
use vvorkflow_protocol::{
    CreateSession, ErrorCode, Frame, Hello, MAX_COLUMNS, MAX_FRAME, MAX_ROWS, MAX_SCREEN,
    PROTOCOL_VERSION, Request, Shutdown,
};
use vvorkflow_server::{
    DELIVERY_LIMIT, Deliveries, Delivery, Endpoint, EngineClient, Limits, serve,
};

const WAIT: Duration = Duration::from_secs(30);

struct Place {
    _base: tempfile::TempDir,
    runtime: PathBuf,
    root: PathBuf,
}

fn place() -> Place {
    let base = tempfile::tempdir().unwrap();
    let path = base.path().to_path_buf();
    let runtime = path.join("run");
    let root = path.join("projects");
    std::fs::create_dir(&runtime).unwrap();
    std::fs::create_dir(&root).unwrap();
    Place {
        _base: base,
        runtime,
        root,
    }
}

fn endpoint(place: &Place) -> Endpoint {
    Endpoint::in_folder(place.runtime.join("vvorkflow"))
}

/// A client that starts the binary of this crate, whose sessions run
/// `/bin/sh` on Linux and macOS, with deliveries to the test.
fn client(place: &Place) -> (EngineClient, Deliveries) {
    let runtime = place.runtime.clone();
    let root = place.root.clone();
    EngineClient::new(endpoint(place), move || {
        let mut command = Command::new(env!("CARGO_BIN_EXE_vvorkflow-server"));
        command
            .env("VVORKFLOW_ROOT", &root)
            .env("XDG_RUNTIME_DIR", &runtime)
            .env("LOCALAPPDATA", &runtime)
            .env("SHELL", "/bin/sh");
        command
    })
    .with_deliveries()
}

/// A client of the engine that `place` started, which starts none itself.
fn client_only(place: &Place) -> (EngineClient, Deliveries) {
    EngineClient::new(endpoint(place), || {
        Command::new(Path::new("missing").join("vvorkflow-server"))
    })
    .with_deliveries()
}

fn hello() -> Request {
    Request::Hello(Hello {
        protocol: PROTOCOL_VERSION,
    })
}

async fn create(client: &EngineClient) -> String {
    let session = client
        .request(Request::CreateSession(CreateSession {
            worktree: None,
            columns: 80,
            rows: 24,
        }))
        .await
        .unwrap();
    session["id"].as_str().unwrap().to_owned()
}

async fn force_stop(client: &EngineClient) {
    client.force_stop().await.unwrap();
}

/// The tests that run only with `/bin/sh`.
#[cfg(unix)]
mod unix {
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;
    use vvorkflow_engine::screen::Screen;
    use vvorkflow_protocol::{AttachSession, FRAME_SCREEN, ResizeSession, WriteSession};

    use super::*;

    async fn write(client: &EngineClient, session: &str, input: &str) {
        client
            .request(Request::WriteSession(WriteSession {
                session: session.to_owned(),
                data: STANDARD.encode(input),
            }))
            .await
            .unwrap();
    }

    /// A terminal that follows the deliveries of one session, as the web UI
    /// does, and gives back the bytes of each frame that it took.
    #[derive(Default)]
    struct Mirror {
        screen: Option<Screen>,
        screens: usize,
        events: Vec<Value>,
        closed: bool,
        /// The last bytes that the terminal got, for a quick look at the end
        /// of the output.
        recent: Vec<u8>,
    }

    /// The bytes that [`Mirror::recent`] keeps.
    const RECENT: usize = 256;

    impl Mirror {
        /// Uses an item, and then gives its bytes back, as the web UI
        /// acknowledges them.
        fn take(&mut self, deliveries: &Deliveries, delivery: Delivery) {
            let size = delivery.size();
            match delivery {
                Delivery::Frame(bytes) => match Frame::parse(&bytes).expect("a valid frame") {
                    Frame::Screen {
                        columns,
                        rows,
                        screen,
                        ..
                    } => {
                        let mut fresh = Screen::new(columns, rows);
                        fresh.feed(screen);
                        self.screen = Some(fresh);
                        self.screens += 1;
                        self.remember(screen);
                    }
                    Frame::Output { output, .. } => {
                        self.screen.as_mut().expect("a screen first").feed(output);
                        self.remember(output);
                    }
                },
                Delivery::Event { event, .. } => {
                    if event["event"] == "session.resized" {
                        let screen = self.screen.as_mut().expect("a screen first");
                        let size = &event["params"];
                        screen.resize(
                            u16::try_from(size["columns"].as_u64().unwrap()).unwrap(),
                            u16::try_from(size["rows"].as_u64().unwrap()).unwrap(),
                        );
                    }
                    self.events.push(event);
                }
                Delivery::Closed => self.closed = true,
            }
            deliveries.budget().release(size);
        }

        fn remember(&mut self, bytes: &[u8]) {
            self.recent.extend_from_slice(bytes);
            let extra = self.recent.len().saturating_sub(RECENT);
            self.recent.drain(..extra);
        }

        /// Whether the last bytes that the terminal got hold `text`.
        fn recently(&self, text: &str) -> bool {
            self.recent
                .windows(text.len())
                .any(|window| window == text.as_bytes())
        }

        fn text(&mut self) -> String {
            self.screen
                .as_mut()
                .map(Screen::describe)
                .unwrap_or_default()
                .lines()
                .filter_map(|line| {
                    let start = line.find('"')?;
                    let end = line.rfind('"')?;
                    (end > start).then(|| line[start + 1..end].to_owned())
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
    }

    /// Takes deliveries until `done` holds.
    async fn follow(
        deliveries: &mut Deliveries,
        mirror: &mut Mirror,
        mut done: impl FnMut(&mut Mirror) -> bool,
    ) {
        tokio::time::timeout(WAIT, async {
            while !done(mirror) {
                let delivery = deliveries.next().await.expect("the client lives");
                mirror.take(deliveries, delivery);
            }
        })
        .await
        .unwrap_or_else(|_| panic!("the condition does not come: {}", mirror.text()));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn the_owner_gets_the_frames_and_the_events_of_a_session() {
        let place = place();
        let (client, mut deliveries) = client(&place);
        client.request(hello()).await.unwrap();
        let session = create(&client).await;
        let attached = client
            .request(Request::AttachSession(AttachSession {
                session: session.clone(),
            }))
            .await
            .unwrap();
        assert_eq!(attached["id"], session.as_str());
        let mut mirror = Mirror::default();
        let first = deliveries.next().await.unwrap();
        assert!(matches!(&first, Delivery::Frame(bytes) if bytes[0] == FRAME_SCREEN));
        mirror.take(&deliveries, first);

        write(&client, &session, "printf 'out%s\\n' put\r").await;
        follow(&mut deliveries, &mut mirror, |mirror| {
            mirror.recently("output")
        })
        .await;
        client
            .request(Request::ResizeSession(ResizeSession {
                session: session.clone(),
                columns: 100,
                rows: 30,
            }))
            .await
            .unwrap();
        write(&client, &session, "stty size; exit 3\r").await;
        follow(&mut deliveries, &mut mirror, |mirror| {
            mirror
                .events
                .iter()
                .any(|event| event["event"] == "session.ended")
        })
        .await;
        assert!(mirror.text().contains("30 100"));
        let resized = mirror
            .events
            .iter()
            .find(|event| event["event"] == "session.resized")
            .unwrap();
        assert_eq!(
            resized["params"],
            json!({"session": session, "columns": 100, "rows": 30})
        );
        assert_eq!(
            mirror.events.last().unwrap()["params"],
            json!({"session": session, "exitCode": 3, "signal": null})
        );

        // The end of the connection comes after its last item.
        force_stop(&client).await;
        follow(&mut deliveries, &mut mirror, |mirror| mirror.closed).await;
    }

    /// The owner takes nothing for a while: the client stops to read, the queue
    /// of the engine overflows, and a screen brings the client back in sync.
    #[tokio::test(flavor = "multi_thread")]
    async fn an_owner_that_does_not_take_the_frames_stops_the_read() {
        let place = place();
        let (client, mut deliveries) = client(&place);
        client.request(hello()).await.unwrap();
        let session = create(&client).await;
        client
            .request(Request::AttachSession(AttachSession {
                session: session.clone(),
            }))
            .await
            .unwrap();
        // About 3.3 MiB of output, while the owner takes nothing: more than
        // what the owner holds, the sockets, and the queue of the engine take.
        write(
            &client,
            &session,
            "seq 1 500000; printf 'do%s\\n' ne; read x; exit\r",
        )
        .await;
        // Another client sees the end of the output: the engine did not wait.
        let (witness, mut seen) = client_only(&place);
        witness.request(hello()).await.unwrap();
        witness
            .request(Request::AttachSession(AttachSession {
                session: session.clone(),
            }))
            .await
            .unwrap();
        let mut witnessed = Mirror::default();
        follow(&mut seen, &mut witnessed, |mirror| mirror.recently("done")).await;

        let mut mirror = Mirror::default();
        follow(&mut deliveries, &mut mirror, |mirror| {
            mirror.recently("done")
        })
        .await;
        // The queue of the engine overflowed while the client did not read, so
        // a second screen came.
        assert!(mirror.screens >= 2, "{} screens", mirror.screens);
        let numbers: Vec<u64> = mirror
            .text()
            .lines()
            .filter_map(|line| line.trim().parse().ok())
            .collect();
        assert_eq!(numbers.last(), Some(&500_000));
        for pair in numbers.windows(2) {
            assert_eq!(pair[1], pair[0] + 1, "a line is lost or comes twice");
        }
        write(&client, &session, "\r").await;
        force_stop(&client).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn an_engine_with_sessions_stops_only_with_force() {
    let place = place();
    let (client, _deliveries) = client(&place);
    client.request(hello()).await.unwrap();
    let session = create(&client).await;
    let refused = client
        .request(Request::Shutdown(Shutdown { force: false }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, ErrorCode::FailedPrecondition);
    assert!(
        refused.message.contains("1 terminal session"),
        "{}",
        refused.message
    );
    // The engine continues with its session.
    let list = client
        .request(Request::ListSessions(vvorkflow_protocol::ListSessions {}))
        .await
        .unwrap();
    assert_eq!(list[0]["id"], session.as_str());

    force_stop(&client).await;
    // The next request starts a new engine, without the session.
    client.request(hello()).await.unwrap();
    let list = client
        .request(Request::ListSessions(vvorkflow_protocol::ListSessions {}))
        .await
        .unwrap();
    assert_eq!(list, json!([]));
    client
        .request(Request::Shutdown(Shutdown { force: false }))
        .await
        .unwrap();
}

/// An engine of another protocol version that has sessions: it refuses
/// `shutdown` without force, and stops with force.
fn older_engine_with_sessions(place: &Place) -> JoinHandle<()> {
    let older = endpoint(place);
    older.prepare().unwrap();
    let lock = older.lock().unwrap();
    let mut listener = older.bind().unwrap();
    tokio::spawn(async move {
        loop {
            let stream = listener.accept().await.unwrap();
            let Ok(mut socket) = tokio_tungstenite::accept_async(stream).await else {
                continue;
            };
            let Some(Ok(Message::Text(text))) = socket.next().await else {
                continue;
            };
            let message: Value = serde_json::from_str(&text).unwrap();
            let id = message["id"].clone();
            let stop = message["method"] == "shutdown";
            let answer = if stop && message["params"]["force"] == true {
                json!({"id": id, "result": {}})
            } else if stop {
                json!({"id": id, "error": {"code": "failedPrecondition", "message": "The engine runs 2 terminal sessions."}})
            } else {
                json!({"id": id, "error": {"code": "failedPrecondition", "message": "Another protocol."}})
            };
            socket
                .send(Message::text(answer.to_string()))
                .await
                .unwrap();
            if answer.get("result").is_some() {
                drop(socket);
                drop(listener);
                drop(lock);
                return;
            }
        }
    })
}

#[tokio::test(flavor = "multi_thread")]
async fn an_engine_of_another_version_with_sessions_is_not_replaced() {
    let place = place();
    let older = older_engine_with_sessions(&place);
    let (client, _deliveries) = client(&place);
    let refused = client.request(hello()).await.unwrap_err();
    assert_eq!(refused.code, ErrorCode::FailedPrecondition);
    assert_eq!(refused.message, "The engine runs 2 terminal sessions.");
    // No second engine started: the older one still listens.
    assert!(!older.is_finished());
    assert!(endpoint(&place).connect().await.is_ok());

    // The user stops it, and the next request starts the engine of the app.
    force_stop(&client).await;
    older.await.unwrap();
    let welcome = client.request(hello()).await.unwrap();
    assert_eq!(welcome["protocol"], PROTOCOL_VERSION);
    client
        .request(Request::Shutdown(Shutdown { force: false }))
        .await
        .unwrap();
}

/// An engine in the test process, whose sessions run the shell of the user.
fn engine(place: &Place, idle: Duration) -> (Arc<Engine>, JoinHandle<Result<(), String>>) {
    let engine = Arc::new(Engine::new(&place.root.canonicalize().unwrap()).unwrap());
    let endpoint = endpoint(place);
    let limits = Limits {
        idle,
        ..Limits::default()
    };
    let serves = Arc::clone(&engine);
    let server = tokio::spawn(async move { serve(&endpoint, serves, limits).await });
    (engine, server)
}

async fn raw_request(place: &Place, request: Value) -> Value {
    let stream = loop {
        if let Ok(stream) = endpoint(place).connect().await {
            break stream;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    let (mut socket, _) = tokio_tungstenite::client_async("ws://localhost/", stream)
        .await
        .unwrap();
    let hello = json!({"id": 1, "method": "hello", "params": {"protocol": PROTOCOL_VERSION}});
    socket.send(Message::text(hello.to_string())).await.unwrap();
    socket.next().await.unwrap().unwrap();
    socket
        .send(Message::text(request.to_string()))
        .await
        .unwrap();
    loop {
        if let Message::Text(text) = socket.next().await.unwrap().unwrap() {
            return serde_json::from_str(&text).unwrap();
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_engine_does_not_stop_for_the_idle_time_while_a_session_runs() {
    let place = place();
    let (engine, mut server) = engine(&place, Duration::from_millis(300));
    let created = raw_request(
        &place,
        json!({"id": 2, "method": "session.create", "params": {"columns": 80, "rows": 24}}),
    )
    .await;
    let session = created["result"]["id"].as_str().unwrap().to_owned();
    // No client is connected now, but a session runs.
    assert!(
        tokio::time::timeout(Duration::from_millis(1_200), &mut server)
            .await
            .is_err(),
        "the engine stopped while a session runs"
    );
    let killed = raw_request(
        &place,
        json!({"id": 2, "method": "session.kill", "params": {"session": session}}),
    )
    .await;
    assert_eq!(killed["result"], json!({}));
    // After the end of the session, the idle time stops the engine.
    tokio::time::timeout(WAIT, server)
        .await
        .expect("the engine stops")
        .unwrap()
        .unwrap();
    assert_eq!(engine.session_count(), 0);
}

/// The next delivery, within [`WAIT`].
async fn delivery(deliveries: &mut Deliveries) -> Delivery {
    tokio::time::timeout(WAIT, deliveries.next())
        .await
        .expect("a delivery comes")
        .expect("the client lives")
}

/// An engine that welcomes the client, and then sends `messages`.
fn fake_engine(place: &Place, messages: Vec<Message>) -> JoinHandle<()> {
    let endpoint = endpoint(place);
    endpoint.prepare().unwrap();
    let lock = endpoint.lock().unwrap();
    let mut listener = endpoint.bind().unwrap();
    tokio::spawn(async move {
        let _lock = lock;
        // A probe of the client closes at once.
        let (mut socket, mut text) = loop {
            let stream = listener.accept().await.unwrap();
            let Ok(mut socket) = tokio_tungstenite::accept_async(stream).await else {
                continue;
            };
            if let Some(Ok(Message::Text(text))) = socket.next().await {
                break (socket, text);
            }
        };
        // The `hello` of the client, and then the request of the test.
        for answered in [false, true] {
            let id = serde_json::from_str::<Value>(&text).unwrap()["id"].clone();
            let welcome = json!({"id": id, "result": {"protocol": PROTOCOL_VERSION, "root": "/"}});
            socket
                .send(Message::text(welcome.to_string()))
                .await
                .unwrap();
            if answered {
                break;
            }
            let Some(Ok(Message::Text(next))) = socket.next().await else {
                return;
            };
            text = next;
        }
        for message in messages {
            if socket.send(message).await.is_err() {
                return;
            }
        }
        // The client ends the connection.
        while let Some(Ok(_)) = socket.next().await {}
    })
}

/// A frame of the largest size passes the WebSocket of the client, whose
/// default limit is 16 MiB; a larger one ends the connection.
#[tokio::test(flavor = "multi_thread")]
async fn the_client_takes_a_frame_of_the_largest_size() {
    let place = place();
    let screen = vec![b'x'; MAX_SCREEN];
    let largest = Frame::Screen {
        session: "0123456789abcdef",
        columns: MAX_COLUMNS,
        rows: MAX_ROWS,
        screen: &screen,
    }
    .encode();
    assert_eq!(largest.len(), MAX_FRAME);
    let too_large = vec![0; MAX_FRAME + 1];
    let engine = fake_engine(
        &place,
        vec![Message::binary(largest), Message::binary(too_large)],
    );
    let (client, mut deliveries) = client_only(&place);
    client.request(hello()).await.unwrap();
    let frame = delivery(&mut deliveries).await;
    assert_eq!(frame.size(), MAX_FRAME);
    let Delivery::Frame(bytes) = &frame else {
        panic!("the frame comes first");
    };
    assert!(matches!(
        Frame::parse(bytes),
        Some(Frame::Screen { screen, .. }) if screen.len() == MAX_SCREEN
    ));
    // The owner gives the bytes back, so that the client reads again.
    deliveries.budget().release(frame.size());
    assert!(matches!(delivery(&mut deliveries).await, Delivery::Closed));
    engine.await.unwrap();
}

/// The bytes of an event stay in the budget until the owner gives them
/// back, as the bytes of a frame do: an owner that keeps 1 MiB of events
/// stops the read, and the rest comes after it gives them back.
#[tokio::test(flavor = "multi_thread")]
async fn an_owner_that_keeps_the_events_stops_the_read() {
    let place = place();
    let event = json!({
        "event": "session.resized",
        "params": {"session": "0123456789abcdef", "columns": 80, "rows": 24},
    })
    .to_string();
    let count = DELIVERY_LIMIT / event.len() + 2;
    let mut messages = vec![Message::text(event.clone()); count];
    let last = Frame::Output {
        session: "0123456789abcdef",
        output: b"last",
    }
    .encode();
    messages.push(Message::binary(last.clone()));
    let engine = fake_engine(&place, messages);
    let (client, mut deliveries) = client_only(&place);
    client.request(hello()).await.unwrap();

    // The owner takes the events, and gives nothing back.
    let mut held = 0;
    while held < DELIVERY_LIMIT {
        let item = delivery(&mut deliveries).await;
        assert!(
            matches!(&item, Delivery::Event { event, .. } if event["event"] == "session.resized")
        );
        assert_eq!(item.size(), event.len());
        held += item.size();
    }
    // The client stops to read.
    let next = tokio::time::timeout(Duration::from_millis(300), deliveries.next()).await;
    assert!(next.is_err(), "an item came: {next:?}");

    // The rest comes when the owner gives the bytes back.
    deliveries.budget().release(held);
    for _ in held / event.len()..count {
        let item = delivery(&mut deliveries).await;
        assert!(matches!(item, Delivery::Event { .. }));
        deliveries.budget().release(item.size());
    }
    assert_eq!(delivery(&mut deliveries).await, Delivery::Frame(last));
    drop(client);
    engine.await.unwrap();
}
