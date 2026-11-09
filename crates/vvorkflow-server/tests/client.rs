//! The client of the app core with the real `vvorkflow-server` binary: it
//! starts the engine, uses it again, starts it again after it stops, reports
//! the message of an engine that cannot start, and replaces an engine of
//! another protocol version.

use std::path::{Path, PathBuf};
use std::process::Command;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message;
use vvorkflow_protocol::{
    EngineError, ErrorCode, Hello, ListProjects, PROTOCOL_VERSION, Request, Shutdown,
};
use vvorkflow_server::{Endpoint, EngineClient};

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
    let older = endpoint(&place);
    older.prepare().unwrap();
    let lock = older.lock().unwrap();
    let mut listener = older.bind().unwrap();
    // An engine that knows no protocol of this client, but knows `shutdown`.
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
            let refused = json!({"id": id, "error": {"code": "failedPrecondition", "message": "Another protocol."}});
            socket
                .send(Message::text(refused.to_string()))
                .await
                .unwrap();
            let _ = socket.close(None).await;
        }
    });
    let client = client(&place, &place.root);

    let welcome = client.request(hello()).await.unwrap();
    assert_eq!(welcome["protocol"], PROTOCOL_VERSION);
    engine.await.unwrap();
    shutdown(&client).await;
}
