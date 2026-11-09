//! The engine process on a real local endpoint: the envelope, `hello`, the
//! lock, the folder checks, `shutdown`, and the idle stop.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::task::JoinHandle;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use vvorkflow_engine::Engine;
use vvorkflow_protocol::PROTOCOL_VERSION;
use vvorkflow_server::{ClientStream, Endpoint, serve};

type Socket = WebSocketStream<ClientStream>;

/// A projects root and an endpoint folder in temporary folders, which the
/// test keeps until it ends.
struct Place {
    _base: tempfile::TempDir,
    root: std::path::PathBuf,
    endpoint: Endpoint,
}

fn place() -> Place {
    let base = tempfile::tempdir().unwrap();
    let path = base.path().canonicalize().unwrap();
    let root = path.join("projects");
    std::fs::create_dir(&root).unwrap();
    Place {
        endpoint: Endpoint::in_folder(path.join("run")),
        root,
        _base: base,
    }
}

fn start(place: &Place, idle: Duration) -> JoinHandle<Result<(), String>> {
    let engine = Arc::new(Engine::new(&place.root).unwrap());
    let endpoint = place.endpoint.clone();
    tokio::spawn(async move { serve(&endpoint, engine, idle).await })
}

/// Connects when the engine listens, within two seconds.
async fn connect(endpoint: &Endpoint) -> Socket {
    for _ in 0..100 {
        if let Ok(stream) = endpoint.connect().await {
            let (socket, _) = tokio_tungstenite::client_async("ws://localhost/", stream)
                .await
                .unwrap();
            return socket;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the engine does not listen");
}

async fn send(socket: &mut Socket, message: Value) {
    socket
        .send(Message::text(message.to_string()))
        .await
        .unwrap();
}

/// The next text message, or None when the engine closes the connection.
async fn receive(socket: &mut Socket) -> Option<Value> {
    loop {
        match socket.next().await? {
            Ok(Message::Text(text)) => return Some(serde_json::from_str(&text).unwrap()),
            Ok(Message::Close(_)) | Err(_) => return None,
            Ok(_) => {}
        }
    }
}

async fn hello(socket: &mut Socket, protocol: u32) -> Value {
    let message = json!({"id": 1, "method": "hello", "params": {"protocol": protocol}});
    send(socket, message).await;
    receive(socket).await.unwrap()
}

#[tokio::test]
async fn a_client_says_hello_then_sends_requests() {
    let place = place();
    let server = start(&place, Duration::from_secs(60));
    let mut socket = connect(&place.endpoint).await;

    send(
        &mut socket,
        json!({"id": 1, "method": "project.list", "params": {}}),
    )
    .await;
    let early = receive(&mut socket).await.unwrap();
    assert_eq!(early["id"], 1);
    assert_eq!(early["error"]["code"], "failedPrecondition");

    let welcome = hello(&mut socket, PROTOCOL_VERSION).await;
    assert_eq!(
        welcome,
        json!({"id": 1, "result": {"protocol": PROTOCOL_VERSION, "root": place.root.to_string_lossy()}})
    );

    std::fs::create_dir(place.root.join("app")).unwrap();
    send(
        &mut socket,
        json!({"id": 2, "method": "project.list", "params": {}}),
    )
    .await;
    let projects = receive(&mut socket).await.unwrap();
    assert_eq!(projects["id"], 2);
    assert_eq!(projects["result"][0]["name"], "app");

    send(
        &mut socket,
        json!({"id": 3, "method": "folder.close", "params": {}}),
    )
    .await;
    let unknown = receive(&mut socket).await.unwrap();
    assert_eq!(unknown["id"], 3);
    assert_eq!(unknown["error"]["code"], "invalidArgument");

    send(
        &mut socket,
        json!({"id": 4, "method": "shutdown", "params": {}}),
    )
    .await;
    assert_eq!(
        receive(&mut socket).await.unwrap(),
        json!({"id": 4, "result": {}})
    );
    assert_eq!(receive(&mut socket).await, None);
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn another_protocol_version_closes_the_connection() {
    let place = place();
    let _server = start(&place, Duration::from_secs(60));
    let mut socket = connect(&place.endpoint).await;

    let refused = hello(&mut socket, PROTOCOL_VERSION + 1).await;
    assert_eq!(refused["error"]["code"], "failedPrecondition");
    assert_eq!(receive(&mut socket).await, None);
}

#[tokio::test]
async fn a_message_without_an_id_closes_the_connection() {
    let place = place();
    let _server = start(&place, Duration::from_secs(60));
    let mut socket = connect(&place.endpoint).await;

    send(&mut socket, json!({"method": "hello"})).await;
    assert_eq!(receive(&mut socket).await, None);
}

#[tokio::test]
async fn shutdown_works_before_hello() {
    let place = place();
    let server = start(&place, Duration::from_secs(60));
    let mut socket = connect(&place.endpoint).await;

    send(
        &mut socket,
        json!({"id": 9, "method": "shutdown", "params": {}}),
    )
    .await;
    assert_eq!(
        receive(&mut socket).await.unwrap(),
        json!({"id": 9, "result": {}})
    );
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn only_one_engine_listens_on_an_endpoint() {
    let place = place();
    let _first = start(&place, Duration::from_secs(60));
    let _socket = connect(&place.endpoint).await;

    let refused = start(&place, Duration::from_secs(60)).await.unwrap();
    assert!(refused.unwrap_err().contains("Another engine"));
}

#[tokio::test]
async fn the_engine_stops_when_no_client_comes() {
    let place = place();
    let server = start(&place, Duration::from_millis(300));
    let socket = connect(&place.endpoint).await;

    // A connected client keeps the engine.
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert!(!server.is_finished());

    drop(socket);
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .expect("the engine stops")
        .unwrap()
        .unwrap();
    // The next engine starts on the same endpoint.
    let _next = start(&place, Duration::from_secs(60));
    connect(&place.endpoint).await;
}

#[cfg(unix)]
#[tokio::test]
async fn a_socket_that_an_engine_left_does_not_stop_the_next_one() {
    use std::os::unix::fs::DirBuilderExt;
    let place = place();
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(place.endpoint.folder())
        .unwrap();
    std::fs::write(place.endpoint.folder().join("engine.sock"), "").unwrap();

    let _server = start(&place, Duration::from_secs(60));
    let mut socket = connect(&place.endpoint).await;
    let welcome = hello(&mut socket, PROTOCOL_VERSION).await;
    assert_eq!(welcome["result"]["protocol"], PROTOCOL_VERSION);
}

#[cfg(unix)]
#[tokio::test]
async fn a_folder_that_other_users_can_open_is_refused() {
    use std::os::unix::fs::DirBuilderExt;
    let place = place();
    std::fs::DirBuilder::new()
        .mode(0o755)
        .create(place.endpoint.folder())
        .unwrap();

    let refused = start(&place, Duration::from_secs(60)).await.unwrap();
    assert!(refused.unwrap_err().contains("other users cannot open"));
}
