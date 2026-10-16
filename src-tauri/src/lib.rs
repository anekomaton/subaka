mod commands;
mod grammar_db;
mod media_probe;
mod verbum_db;

use commands::*;
use grammar_db::GrammarDbManager;
use verbum_db::VerbumDbManager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let grammar_manager = GrammarDbManager::new();
    let verbum_manager = VerbumDbManager::new();

    tauri::Builder::default()
        .manage(grammar_manager)
        .manage(verbum_manager)
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .on_window_event(|window, event| {
            // Close button (X) minimizes to tray
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // Setup Tray Icon
            let open_i = MenuItem::with_id(app, "open", "Адкрыць SUBaka", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Закрыць", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_i, &quit_i])?;

            let mut tray_builder = TrayIconBuilder::new()
                .tooltip("SUBaka")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "open" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Left click on tray icon restores and focuses the window
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder.build(app)?;

            // Initialize managers
            let g_state: tauri::State<GrammarDbManager> = handle.state();
            let g_status = g_state.initialize(&handle);
            log::info!("SUBaka desktop initialized. Grammar status: {:?}", g_status.message);

            let v_state: tauri::State<VerbumDbManager> = handle.state();
            let v_status = v_state.initialize(&handle);
            log::info!("SUBaka desktop initialized. Verbum status: {:?}", v_status.message);

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
            save_binary_file_direct,
            read_file_direct,
            get_desktop_storage_info,
            clear_desktop_temp_cache,
            get_verbum_status,
            lookup_verbum_word,
            fetch_audio_buffer_native,
            post_json_native,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SUBaka desktop application");
}
