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
use vvorkflow_server::{ClientStream, Endpoint, Limits, serve};

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

/// Limits with a short idle time, so that a test that fails does not leave
/// an engine for long.
fn limits() -> Limits {
    Limits {
        idle: Duration::from_secs(60),
        ..Limits::default()
    }
}

fn start(place: &Place, limits: Limits) -> JoinHandle<Result<(), String>> {
    let engine = Arc::new(Engine::new(&place.root).unwrap());
    let endpoint = place.endpoint.clone();
    tokio::spawn(async move { serve(&endpoint, engine, limits).await })
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
    let server = start(&place, limits());
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
    let _server = start(&place, limits());
    let mut socket = connect(&place.endpoint).await;

    let refused = hello(&mut socket, PROTOCOL_VERSION + 1).await;
    assert_eq!(refused["error"]["code"], "failedPrecondition");
    assert_eq!(receive(&mut socket).await, None);
}

#[tokio::test]
async fn a_message_without_an_id_closes_the_connection() {
    let place = place();
    let _server = start(&place, limits());
    let mut socket = connect(&place.endpoint).await;

    send(&mut socket, json!({"method": "hello"})).await;
    assert_eq!(receive(&mut socket).await, None);
}

#[tokio::test]
async fn after_the_answer_to_shutdown_no_client_reaches_the_engine() {
    let place = place();
    let server = start(&place, limits());
    let mut socket = connect(&place.endpoint).await;

    send(
        &mut socket,
        json!({"id": 1, "method": "shutdown", "params": {}}),
    )
    .await;
    assert_eq!(
        receive(&mut socket).await.unwrap(),
        json!({"id": 1, "result": {}})
    );
    assert!(place.endpoint.connect().await.is_err());
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn shutdown_works_before_hello() {
    let place = place();
    let server = start(&place, limits());
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
    let _first = start(&place, limits());
    let _socket = connect(&place.endpoint).await;

    let refused = start(&place, limits()).await.unwrap();
    assert!(refused.unwrap_err().contains("Another engine"));
}

#[tokio::test]
async fn the_engine_stops_when_no_client_comes() {
    let place = place();
    let server = start(
        &place,
        Limits {
            idle: Duration::from_millis(300),
            ..limits()
        },
    );
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
    let _next = start(&place, limits());
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

    let _server = start(&place, limits());
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

    let refused = start(&place, limits()).await.unwrap();
    assert!(refused.unwrap_err().contains("other users cannot open"));
}

#[tokio::test]
async fn the_engine_answers_a_close_with_a_close() {
    let place = place();
    let _server = start(&place, limits());
    let mut socket = connect(&place.endpoint).await;

    socket.close(None).await.unwrap();
    let answer = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .unwrap();
    assert!(matches!(answer, Some(Ok(Message::Close(_)))), "{answer:?}");
}

#[tokio::test]
async fn a_client_that_does_not_say_hello_in_time_is_closed() {
    let place = place();
    let _server = start(
        &place,
        Limits {
            hello: Duration::from_millis(300),
            ..limits()
        },
    );
    let mut socket = connect(&place.endpoint).await;

    let closed = tokio::time::timeout(Duration::from_secs(5), receive(&mut socket)).await;
    assert_eq!(closed, Ok(None));
}

#[tokio::test]
async fn a_client_after_the_limit_is_closed_at_once() {
    let place = place();
    let _server = start(
        &place,
        Limits {
            clients: 2,
            ..limits()
        },
    );
    let mut first = connect(&place.endpoint).await;
    let _second = connect(&place.endpoint).await;
    let stream = place.endpoint.connect().await.unwrap();
    assert!(
        tokio_tungstenite::client_async("ws://localhost/", stream)
            .await
            .is_err()
    );

    // The clients in the limit still work.
    let welcome = hello(&mut first, PROTOCOL_VERSION).await;
    assert_eq!(welcome["result"]["protocol"], PROTOCOL_VERSION);
}

#[cfg(unix)]
#[tokio::test]
async fn a_folder_that_other_users_can_replace_is_refused() {
    use std::os::unix::fs::PermissionsExt;
    let place = place();
    let shared = place.endpoint.folder().parent().unwrap().join("shared");
    std::fs::create_dir(&shared).unwrap();
    std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(0o777)).unwrap();
    let endpoint = Endpoint::in_folder(shared.join("run"));

    let refused = endpoint.prepare().unwrap_err();
    assert!(refused.contains("Other users can replace"), "{refused}");

    // With the sticky bit, as on /tmp, other users cannot rename the folder.
    std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(0o1777)).unwrap();
    endpoint.prepare().unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn a_client_does_not_connect_through_a_folder_that_others_can_open() {
    use std::os::unix::fs::PermissionsExt;
    let place = place();
    let _server = start(&place, limits());
    connect(&place.endpoint).await;
    std::fs::set_permissions(
        place.endpoint.folder(),
        std::fs::Permissions::from_mode(0o755),
    )
    .unwrap();

    let refused = place.endpoint.connect().await.unwrap_err();
    assert_eq!(refused.kind(), std::io::ErrorKind::PermissionDenied);
}

// A client that opens the pipe and leaves at once does not stop the next
// client.
#[cfg(windows)]
#[tokio::test]
async fn clients_that_leave_at_once_do_not_spoil_the_pipe() {
    let place = place();
    let _server = start(&place, limits());
    connect(&place.endpoint).await;
    for _ in 0..5 {
        drop(place.endpoint.connect().await.unwrap());
    }
    let mut socket = connect(&place.endpoint).await;
    let welcome = hello(&mut socket, PROTOCOL_VERSION).await;
    assert_eq!(welcome["result"]["protocol"], PROTOCOL_VERSION);
}

// Each operation of the endpoint checks the folders again, so that a link
// that changes after a check cannot lead the next operation elsewhere.
#[cfg(unix)]
#[tokio::test]
async fn an_operation_after_a_changed_link_checks_the_folders_again() {
    use std::os::unix::fs::PermissionsExt;
    let place = place();
    let base = place.endpoint.folder().parent().unwrap().to_path_buf();
    let safe = base.join("safe");
    let shared = base.join("shared");
    std::fs::create_dir(&safe).unwrap();
    std::fs::create_dir(&shared).unwrap();
    std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(0o777)).unwrap();
    let link = base.join("link");
    std::os::unix::fs::symlink(&safe, &link).unwrap();
    let endpoint = Endpoint::in_folder(link.join("run"));
    endpoint.prepare().unwrap();
    assert_eq!(endpoint.check().unwrap(), safe.join("run"));

    // The link now leads through a folder that other users can write.
    std::fs::remove_file(&link).unwrap();
    std::os::unix::fs::symlink(&shared, &link).unwrap();
    std::fs::create_dir(shared.join("run")).unwrap();
    std::fs::set_permissions(shared.join("run"), std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(
        endpoint
            .lock()
            .unwrap_err()
            .contains("Other users can replace")
    );
    assert_eq!(
        endpoint.connect().await.unwrap_err().kind(),
        std::io::ErrorKind::PermissionDenied
    );
}

#[tokio::test]
async fn a_client_that_does_not_read_loses_its_place_at_the_hello_deadline() {
    let place = place();
    let _server = start(
        &place,
        Limits {
            hello: Duration::from_millis(300),
            clients: 1,
            ..limits()
        },
    );
    // Many requests before hello, and no read of their answers, until the
    // answers fill the buffers.
    let mut flood = connect(&place.endpoint).await;
    for id in 0..5000 {
        let request = json!({"id": id, "method": "project.list", "params": {}});
        if tokio::time::timeout(
            Duration::from_millis(500),
            flood.send(Message::text(request.to_string())),
        )
        .await
        .is_err()
        {
            break;
        }
    }

    // After the deadline, the place of the client is free for another one;
    // until then, the engine closes a new connection at once.
    let welcome = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(stream) = place.endpoint.connect().await
                && let Ok((mut socket, _)) =
                    tokio_tungstenite::client_async("ws://localhost/", stream).await
            {
                let message =
                    json!({"id": 1, "method": "hello", "params": {"protocol": PROTOCOL_VERSION}});
                if socket
                    .send(Message::text(message.to_string()))
                    .await
                    .is_ok()
                    && let Some(welcome) = receive(&mut socket).await
                {
                    return welcome;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(welcome["result"]["protocol"], PROTOCOL_VERSION);
    drop(flood);
}
