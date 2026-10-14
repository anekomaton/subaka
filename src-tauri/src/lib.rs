mod commands;
mod grammar_db;
mod media_probe;

use commands::*;
use grammar_db::GrammarDbManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let grammar_manager = GrammarDbManager::new();

    tauri::Builder::default()
        .manage(grammar_manager)
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state: tauri::State<GrammarDbManager> = handle.state();
            let status = state.initialize(&handle);
            log::info!("Subaka desktop initialized. Grammar status: {:?}", status.message);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_info,
            get_grammar_status,
            lookup_grammar_word,
            batch_check_words,
            probe_media_streams,
            extract_audio_track,
            save_file_direct,
            read_file_direct,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Subaka desktop application");
}
