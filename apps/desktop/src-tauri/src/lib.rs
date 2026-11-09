use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;
use vvorkflow_engine::Engine;
use vvorkflow_protocol::{
    ChangedPath, DirectoryEntry, EngineError, ErrorCode, ListDirectory, OpenFolder, ReadStatus,
    Repository,
};

/// The folders of the command line, which the app opens at start.
struct StartupFolders(Vec<String>);

/// Runs a request of the engine on a blocking thread, because it waits for
/// the file system and for git, and the main thread draws the window.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, EngineError> + Send + 'static,
) -> Result<T, EngineError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .unwrap_or_else(|error| {
            Err(EngineError {
                code: ErrorCode::FailedPrecondition,
                message: format!("The engine stopped: {error}"),
            })
        })
}

#[tauri::command]
async fn open_folder(
    engine: State<'_, Arc<Engine>>,
    request: OpenFolder,
) -> Result<Repository, EngineError> {
    let engine = Arc::clone(&engine);
    blocking(move || engine.open_folder(request)).await
}

#[tauri::command]
async fn list_directory(
    engine: State<'_, Arc<Engine>>,
    request: ListDirectory,
) -> Result<Vec<DirectoryEntry>, EngineError> {
    let engine = Arc::clone(&engine);
    blocking(move || engine.list_directory(request)).await
}

#[tauri::command]
async fn read_status(
    engine: State<'_, Arc<Engine>>,
    request: ReadStatus,
) -> Result<Vec<ChangedPath>, EngineError> {
    let engine = Arc::clone(&engine);
    blocking(move || engine.read_status(request)).await
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
        .manage(Arc::new(Engine::default()))
        .manage(StartupFolders(folders))
        .invoke_handler(tauri::generate_handler![
            open_folder,
            list_directory,
            read_status,
            startup_folders
        ])
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
