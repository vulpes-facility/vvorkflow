fn main() {
    // The app manifest makes each command of the app a permission, so that a
    // capability file allows it (`allow-<command>`), as the plugin commands.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_folder",
            "list_directory",
            "read_status",
            "startup_folders",
        ]),
    ))
    .expect("the Tauri build step runs");
}
