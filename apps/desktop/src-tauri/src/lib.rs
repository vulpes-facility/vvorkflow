mod relay;

use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

use tauri::State;
use tauri::ipc::Channel;
use vvorkflow_protocol::{EngineError, ErrorCode, Request};
use vvorkflow_server::{Budget, Deliveries, Endpoint, EngineClient};

use relay::Relay;

/// The folders of the command line, which the app opens at start.
struct StartupFolders(Vec<String>);

/// The client of the engine process, or the reason why the app has none.
/// Each request then answers that reason.
type EngineState = Result<EngineClient, EngineError>;

/// The client of the engine process of this user. The app starts
/// `vvorkflow-server` from the folder of its own executable when no engine
/// listens; the process gets the environment of the app, such as
/// `VVORKFLOW_ROOT`.
///
/// Returns it with its events and frames, for the relay to the web UI.
fn engine_client() -> Result<(EngineClient, Deliveries), EngineError> {
    let refused = |message: String| EngineError {
        code: ErrorCode::FailedPrecondition,
        message,
    };
    let endpoint = Endpoint::of_user().map_err(refused)?;
    let program = std::env::current_exe()
        .map_err(|error| refused(format!("The app cannot find its own folder: {error}.")))?
        .with_file_name(format!("vvorkflow-server{}", std::env::consts::EXE_SUFFIX));
    Ok(EngineClient::new(endpoint, move || Command::new(&program)).with_deliveries())
}

/// Sends one request of the web UI to the engine process, with an id.
///
/// Returns the value of the request, or its error. When no engine can start,
/// returns why, for example the message of a projects root that is not
/// correct.
#[tauri::command]
async fn request(
    engine: State<'_, EngineState>,
    request: Request,
) -> Result<serde_json::Value, EngineError> {
    engine
        .inner()
        .as_ref()
        .map_err(Clone::clone)?
        .request(request)
        .await
}

/// Gives the app core the channel of the web UI for the events and the
/// frames of the engine. A page calls it once, when it loads.
#[tauri::command]
fn subscribe(relay: State<'_, Arc<Relay>>, channel: Channel) {
    relay.subscribe(channel);
}

/// Tells the app core the bytes that the web UI took from the channel: the
/// length of a frame that its terminal wrote, or the `bytes` of an event
/// that it noted. The app core then reads more from the engine.
#[tauri::command]
fn acknowledge(relay: State<'_, Arc<Relay>>, bytes: usize) {
    relay.acknowledge(bytes);
}

/// Tells if an engine of another protocol version listens. Such an engine
/// refuses to stop while it has sessions, and the user can then stop it
/// with [`stop_engine`].
#[tauri::command]
async fn other_engine(engine: State<'_, EngineState>) -> Result<bool, ()> {
    match engine.inner() {
        Ok(engine) => Ok(engine.other_version_listens().await),
        Err(_) => Ok(false),
    }
}

/// Stops the engine that listens, with its sessions, after the user said
/// yes. The next request starts a new engine.
#[tauri::command]
async fn stop_engine(engine: State<'_, EngineState>) -> Result<(), EngineError> {
    engine
        .inner()
        .as_ref()
        .map_err(Clone::clone)?
        .force_stop()
        .await
}

/// The folders to open at start: each argument of the command line, as an
/// absolute path, for example `vvorkflow-desktop ~/workspaces/app`.
#[tauri::command]
fn startup_folders(folders: State<'_, StartupFolders>) -> Vec<String> {
    folders.0.clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let folders = std::env::args()
        .skip(1)
        .filter(|argument| !argument.starts_with('-'))
        .map(|argument| {
            std::path::absolute(PathBuf::from(&argument))
                .map_or(argument, |path| path.to_string_lossy().into_owned())
        })
        .collect();
    // Without a client, the relay has nothing to send, and each request
    // answers why.
    let (engine, deliveries, budget) = match engine_client() {
        Ok((engine, deliveries)) => {
            let budget = deliveries.budget();
            (Ok(engine), Some(deliveries), budget)
        }
        Err(error) => (Err(error), None, Budget::default()),
    };
    let engine: EngineState = engine;
    let relay = Arc::new(Relay::new(budget));
    let sender = Arc::clone(&relay);
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(engine)
        .manage(relay)
        .manage(StartupFolders(folders))
        .invoke_handler(tauri::generate_handler![
            request,
            subscribe,
            acknowledge,
            other_engine,
            stop_engine,
            startup_folders
        ])
        .setup(move |app| {
            if let Some(deliveries) = deliveries {
                tauri::async_runtime::spawn(sender.run(deliveries));
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
