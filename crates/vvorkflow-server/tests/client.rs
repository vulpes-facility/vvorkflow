//! The client of the app core with the real `vvorkflow-server` binary: it
//! starts the engine, uses it again, starts it again after it stops, reports
//! the message of an engine that cannot start, and replaces an engine of
//! another protocol version. Also the client with an engine in the test
//! process: its turn to start an engine, its places, and its end, and with
//! an engine that does not send answers.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;
use vvorkflow_engine::Engine;
use vvorkflow_protocol::{
    EngineError, ErrorCode, Hello, ListProjects, MAX_OPEN_REQUESTS, PROTOCOL_VERSION, Request,
    Shutdown,
};
use vvorkflow_server::{Endpoint, EngineClient, Limits, serve};

/// A projects root, and the folder of the user's endpoint, in temporary
/// folders that the test keeps until it ends.
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

/// The endpoint that the engine process finds from its environment.
fn endpoint(place: &Place) -> Endpoint {
    Endpoint::in_folder(place.runtime.join("vvorkflow"))
}

/// A client that starts the binary of this crate with `root` as the projects
/// root, on the endpoint of `place`.
fn client(place: &Place, root: &Path) -> EngineClient {
    let runtime = place.runtime.clone();
    let root = root.to_path_buf();
    EngineClient::new(endpoint(place), move || {
        let mut command = Command::new(env!("CARGO_BIN_EXE_vvorkflow-server"));
        command
            .env("VVORKFLOW_ROOT", &root)
            .env("XDG_RUNTIME_DIR", &runtime)
            .env("LOCALAPPDATA", &runtime);
        command
    })
}

/// A client that cannot start an engine: it uses only the engine that
/// listens.
fn client_only(place: &Place) -> EngineClient {
    EngineClient::new(endpoint(place), || {
        Command::new(Path::new("missing").join("vvorkflow-server"))
    })
}

/// An engine in the test process, with a short idle time, so that a test
/// that fails does not leave it for long.
fn engine(place: &Place, limits: Limits) -> JoinHandle<Result<(), String>> {
    let engine = Arc::new(Engine::new(&place.root).unwrap());
    let endpoint = endpoint(place);
    let limits = Limits {
        idle: Duration::from_secs(60),
        ..limits
    };
    tokio::spawn(async move { serve(&endpoint, engine, limits).await })
}

/// An engine that knows no protocol of this client, but knows `shutdown`.
/// It tells each `hello` that it refused.
fn older_engine(place: &Place) -> (JoinHandle<()>, mpsc::UnboundedReceiver<()>) {
    let older = endpoint(place);
    older.prepare().unwrap();
    let lock = older.lock().unwrap();
    let mut listener = older.bind().unwrap();
    let (refused, refusals) = mpsc::unbounded_channel();
    let engine = tokio::spawn(async move {
        loop {
            let stream = listener.accept().await.unwrap();
            // A probe of the client that closes at once has no handshake.
            let Ok(mut socket) = tokio_tungstenite::accept_async(stream).await else {
                continue;
            };
            let Some(Ok(Message::Text(text))) = socket.next().await else {
                continue;
            };
            let message: Value = serde_json::from_str(&text).unwrap();
            let id = message["id"].clone();
            if message["method"] == "shutdown" {
                let done = json!({"id": id, "result": {}});
                socket.send(Message::text(done.to_string())).await.unwrap();
                drop(socket);
                drop(listener);
                drop(lock);
                return;
            }
            let answer = json!({"id": id, "error": {"code": "failedPrecondition", "message": "Another protocol."}});
            socket
                .send(Message::text(answer.to_string()))
                .await
                .unwrap();
            let _ = socket.close(None).await;
            let _ = refused.send(());
        }
    });
    (engine, refusals)
}

/// An engine that welcomes the client, and then sends a text that is not an
/// answer for each request. It keeps the connection open.
fn engine_without_answers(place: &Place) -> JoinHandle<()> {
    let endpoint = endpoint(place);
    endpoint.prepare().unwrap();
    let _lock = endpoint.lock().unwrap();
    let mut listener = endpoint.bind().unwrap();
    tokio::spawn(async move {
        let _lock = _lock;
        let mut sockets = Vec::new();
        loop {
            let stream = listener.accept().await.unwrap();
            // A probe of the client that closes at once has no handshake.
            let Ok(mut socket) = tokio_tungstenite::accept_async(stream).await else {
                continue;
            };
            let Some(Ok(Message::Text(_))) = socket.next().await else {
                continue;
            };
            let welcome = json!({"id": 0, "result": {"protocol": PROTOCOL_VERSION, "root": "/"}});
            socket
                .send(Message::text(welcome.to_string()))
                .await
                .unwrap();
            if let Some(Ok(Message::Text(_))) = socket.next().await {
                socket.send(Message::text("no answer")).await.unwrap();
            }
            sockets.push(socket);
        }
    })
}

/// The answer to `hello`, as soon as the engine listens and has a place for
/// the client, within five seconds.
async fn hello_when_free(client: &EngineClient) -> Value {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(welcome) = client.request(hello()).await {
                return welcome;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap()
}

fn hello() -> Request {
    Request::Hello(Hello {
        protocol: PROTOCOL_VERSION,
    })
}

async fn shutdown(client: &EngineClient) {
    let done = client.request(Request::Shutdown(Shutdown {})).await;
    assert_eq!(done, Ok(json!({})));
}

#[tokio::test(flavor = "multi_thread")]
async fn the_client_starts_the_engine_and_uses_it_again() {
    let place = place();
    let client = client(&place, &place.root);

    let welcome = client.request(hello()).await.unwrap();
    assert_eq!(welcome["protocol"], PROTOCOL_VERSION);
    assert_eq!(
        welcome["root"],
        place
            .root
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .as_ref()
    );

    // Requests at the same time get their own answers on one connection.
    std::fs::create_dir(place.root.join("app")).unwrap();
    let answers = futures_util::future::join_all(
        (0..20).map(|_| client.request(Request::ListProjects(ListProjects {}))),
    )
    .await;
    for answer in answers {
        assert_eq!(answer.unwrap()[0]["name"], "app");
    }
    shutdown(&client).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_client_starts_the_engine_again_after_it_stops() {
    let place = place();
    let client = client(&place, &place.root);

    client.request(hello()).await.unwrap();
    shutdown(&client).await;
    let welcome = client.request(hello()).await.unwrap();
    assert_eq!(welcome["protocol"], PROTOCOL_VERSION);
    shutdown(&client).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_message_of_an_engine_that_cannot_start_comes_back() {
    let place = place();
    let client = client(&place, Path::new("relative"));

    let refused = client.request(hello()).await.unwrap_err();
    assert_eq!(
        refused,
        EngineError {
            code: ErrorCode::FailedPrecondition,
            message: "VVORKFLOW_ROOT is not an absolute path: relative.".to_owned(),
        }
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_missing_program_is_an_error() {
    let place = place();
    let client = EngineClient::new(endpoint(&place), || {
        Command::new(Path::new("missing").join("vvorkflow-server"))
    });

    let refused = client.request(hello()).await.unwrap_err();
    assert_eq!(refused.code, ErrorCode::FailedPrecondition);
    assert!(
        refused
            .message
            .starts_with("The app cannot start the engine")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_client_replaces_an_engine_of_another_version() {
    let place = place();
    let (older, _refusals) = older_engine(&place);
    let client = client(&place, &place.root);

    let welcome = client.request(hello()).await.unwrap();
    assert_eq!(welcome["protocol"], PROTOCOL_VERSION);
    older.await.unwrap();
    shutdown(&client).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_text_that_is_not_an_answer_ends_the_connection() {
    let place = place();
    let engine = engine_without_answers(&place);
    let client = client_only(&place);

    // Each request gets a new connection, because the last one ended.
    for _ in 0..2 {
        let refused = tokio::time::timeout(Duration::from_secs(5), client.request(hello()))
            .await
            .expect("the request ends")
            .unwrap_err();
        assert_eq!(refused.message, "The engine stopped before it answered.");
    }
    engine.abort();
}

#[tokio::test(flavor = "multi_thread")]
async fn the_client_keeps_the_engine_that_another_app_started_in_its_turn() {
    let place = place();
    let (older, mut refusals) = older_engine(&place);
    // Another app has the turn to replace the engine.
    let turn = endpoint(&place).turn().unwrap().unwrap();
    let client = client(&place, &place.root);
    let waits = tokio::spawn(async move {
        let welcome = client.request(hello()).await;
        (client, welcome)
    });
    // The client now knows the engine of another version, and waits.
    refusals.recv().await.unwrap();

    // The other app replaces the engine, and ends its turn.
    let stream = endpoint(&place).connect().await.unwrap();
    let (mut socket, _) = tokio_tungstenite::client_async("ws://localhost/", stream)
        .await
        .unwrap();
    let stop = json!({"id": 0, "method": "shutdown", "params": {}});
    socket.send(Message::text(stop.to_string())).await.unwrap();
    older.await.unwrap();
    let newer = engine(&place, Limits::default());
    while endpoint(&place).connect().await.is_err() {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    drop(turn);

    let (client, welcome) = waits.await.unwrap();
    assert_eq!(welcome.unwrap()["protocol"], PROTOCOL_VERSION);
    assert!(!newer.is_finished());
    shutdown(&client).await;
    assert_eq!(newer.await.unwrap(), Ok(()));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_client_that_drops_frees_its_place_in_the_engine() {
    let place = place();
    let limits = Limits {
        clients: 1,
        ..Limits::default()
    };
    let _engine = engine(&place, limits);
    let first = client_only(&place);
    hello_when_free(&first).await;

    drop(first);

    let welcome = hello_when_free(&client_only(&place)).await;
    assert_eq!(welcome["protocol"], PROTOCOL_VERSION);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_request_whose_caller_left_keeps_its_place() {
    let place = place();
    // No worker is free, so no request gets an answer.
    let limits = Limits {
        workers: 0,
        ..Limits::default()
    };
    let _engine = engine(&place, limits);
    let client = client_only(&place);
    hello_when_free(&client).await;
    let list = || client.request(Request::ListProjects(ListProjects {}));
    for _ in 0..MAX_OPEN_REQUESTS {
        let left = tokio::time::timeout(Duration::from_millis(20), list()).await;
        assert!(left.is_err());
    }

    // The next request waits for a place: the client does not send it, so
    // the engine does not close the connection.
    let waits = tokio::time::timeout(Duration::from_millis(300), list()).await;
    assert!(waits.is_err());
}

/// A client whose program writes its process id to a file, and then never
/// listens.
#[cfg(unix)]
fn client_that_never_listens(place: &Place) -> (EngineClient, PathBuf) {
    let id = place.runtime.join("process");
    let file = id.clone();
    let client = EngineClient::new(endpoint(place), move || {
        let mut command = Command::new("sh");
        command
            .args(["-c", "echo $$ > \"$0\"; exec sleep 60"])
            .arg(&file);
        command
    });
    (client, id)
}

/// Waits until the process of the id in `file` is gone, within five seconds.
#[cfg(unix)]
async fn gone(file: &Path) {
    let id = std::fs::read_to_string(file).unwrap();
    for _ in 0..100 {
        let lives = Command::new("kill")
            .args(["-0", id.trim()])
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success();
        if !lives {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the process {id} continues");
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn the_client_stops_an_engine_that_does_not_listen_in_time() {
    let place = place();
    let (client, id) = client_that_never_listens(&place);
    let client = client.start_time(Duration::from_secs(1));

    let refused = client.request(hello()).await.unwrap_err();
    assert_eq!(refused.message, "The engine did not start in time.");
    gone(&id).await;
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn the_client_stops_an_engine_whose_caller_left() {
    let place = place();
    let (client, id) = client_that_never_listens(&place);
    let waits = tokio::spawn(async move { client.request(hello()).await });
    while !std::fs::read_to_string(&id).is_ok_and(|text| text.ends_with('\n')) {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    waits.abort();
    assert!(waits.await.unwrap_err().is_cancelled());
    gone(&id).await;
}
