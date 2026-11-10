use std::path::PathBuf;
use std::process::Command;

use tauri::State;
use vvorkflow_protocol::{EngineError, ErrorCode, Request};
use vvorkflow_server::{Endpoint, EngineClient};

/// The folders of the command line, which the app opens at start.
struct StartupFolders(Vec<String>);

/// The client of the engine process, or the reason why the app has none.
/// Each request then answers that reason.
type EngineState = Result<EngineClient, EngineError>;

/// The client of the engine process of this user. The app starts
/// `vvorkflow-server` from the folder of its own executable when no engine
/// listens; the process gets the environment of the app, such as
/// `VVORKFLOW_ROOT`.
fn engine_client() -> EngineState {
    let refused = |message: String| EngineError {
        code: ErrorCode::FailedPrecondition,
        message,
    };
    let endpoint = Endpoint::of_user().map_err(refused)?;
    let program = std::env::current_exe()
        .map_err(|error| refused(format!("The app cannot find its own folder: {error}.")))?
        .with_file_name(format!("vvorkflow-server{}", std::env::consts::EXE_SUFFIX));
    Ok(EngineClient::new(endpoint, move || Command::new(&program)))
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(engine_client())
        .manage(StartupFolders(folders))
        .invoke_handler(tauri::generate_handler![request, startup_folders])
        .setup(|app| {
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
