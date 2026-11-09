use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;
use vvorkflow_engine::{Engine, projects_root_from_env};
use vvorkflow_protocol::{EngineError, ErrorCode, Request, Response};

/// The folders of the command line, which the app opens at start.
struct StartupFolders(Vec<String>);

/// The engine, or the error that stopped it at start, for example a projects
/// root that is not a folder. Each request then answers that error.
type EngineState = Result<Arc<Engine>, EngineError>;

/// Sends one request to the engine, on a blocking thread, because the engine
/// waits for the file system and for git, and the main thread draws the
/// window.
///
/// Returns the value of the request, or its error. When the engine did not
/// start, returns the error that stopped it.
#[tauri::command]
async fn request(
    engine: State<'_, EngineState>,
    request: Request,
) -> Result<Response, EngineError> {
    let engine = Arc::clone(engine.inner().as_ref().map_err(Clone::clone)?);
    tauri::async_runtime::spawn_blocking(move || engine.handle(request))
        .await
        .unwrap_or_else(|error| {
            Err(EngineError {
                code: ErrorCode::FailedPrecondition,
                message: format!("The engine stopped: {error}"),
            })
        })
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
        .manage::<EngineState>(
            projects_root_from_env().and_then(|root| Engine::new(&root).map(Arc::new)),
        )
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
