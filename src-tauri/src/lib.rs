mod commands;
mod grammar_db;
mod media_probe;
mod verbum_db;

use commands::*;
use grammar_db::GrammarDbManager;
use verbum_db::VerbumDbManager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
struct WindowState {
    width: u32,
    height: u32,
    x: Option<i32>,
    y: Option<i32>,
    maximized: bool,
}

fn get_window_state_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("window_state.json"))
}

fn save_window_state(window: &tauri::WebviewWindow) {
    let app = window.app_handle();
    if let Some(path) = get_window_state_path(app) {
        let is_max = window.is_maximized().unwrap_or(false);
        let size = window.inner_size().unwrap_or(tauri::PhysicalSize::new(1280, 720));
        let pos = window.outer_position().ok();
        let state = WindowState {
            width: size.width,
            height: size.height,
            x: pos.map(|p| p.x),
            y: pos.map(|p| p.y),
            maximized: is_max,
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string(&state) {
            let _ = std::fs::write(&path, json);
        }
    }
}

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
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Close button (X) pauses player and minimizes to tray
                    api.prevent_close();
                    let _ = window.emit("subaka-pause-playback", ());
                    save_window_state(window);
                    let _ = window.hide();
                }
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                    save_window_state(window);
                }
                _ => {}
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // Restore saved window size & position
            if let Some(window) = app.get_webview_window("main") {
                if let Some(path) = get_window_state_path(&handle) {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        if let Ok(state) = serde_json::from_str::<WindowState>(&content) {
                            if state.width >= 600 && state.height >= 400 {
                                let _ = window.set_size(tauri::PhysicalSize::new(state.width, state.height));
                            }
                            if let (Some(x), Some(y)) = (state.x, state.y) {
                                let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                            }
                            if state.maximized {
                                let _ = window.maximize();
                            }
                        }
                    }
                }
            }

            // Setup Tray Icon
            let open_i = MenuItemBuilder::with_id("open", "Адкрыць SUBaka").build(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Выйсці з SUBaka").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&open_i)
                .item(&quit_i)
                .build()?;

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
                            if let Some(window) = app.get_webview_window("main") {
                                save_window_state(&window);
                            }
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

            let _ = tray_builder.build(app)?;

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
