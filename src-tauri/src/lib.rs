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
pub(crate) struct WindowState {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) x: Option<i32>,
    pub(crate) y: Option<i32>,
    pub(crate) maximized: bool,
}

pub(crate) fn get_window_state_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("window_state.json"))
}

pub(crate) fn save_window_state(window: &tauri::Window) {
    if window.is_fullscreen().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return;
    }
    let app = window.app_handle();
    if let Some(path) = get_window_state_path(app) {
        let is_max = window.is_maximized().unwrap_or(false);
        let size = window.inner_size().unwrap_or(tauri::PhysicalSize::new(1280, 720));
        let pos = window.outer_position().ok();

        let mut final_x = pos.map(|p| p.x);
        let mut final_y = pos.map(|p| p.y);

        if is_max {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(prev_state) = serde_json::from_str::<WindowState>(&content) {
                    if prev_state.x.is_some() && prev_state.y.is_some() {
                        final_x = prev_state.x;
                        final_y = prev_state.y;
                    }
                }
            }
        } else if let (Some(x), Some(y)) = (final_x, final_y) {
            if x <= 0 && y <= 0 {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(prev_state) = serde_json::from_str::<WindowState>(&content) {
                        if prev_state.x.unwrap_or(0) > 0 || prev_state.y.unwrap_or(0) > 0 {
                            final_x = prev_state.x;
                            final_y = prev_state.y;
                        }
                    }
                }
            }
        }

        let state = WindowState {
            width: size.width,
            height: size.height,
            x: final_x,
            y: final_y,
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

#[derive(Clone)]
pub struct LaunchFilePath(pub std::sync::Arc<std::sync::Mutex<Option<String>>>);

pub(crate) fn extract_file_path_from_args(args: &[String]) -> Option<String> {
    for arg in args.iter().skip(1) {
        if !arg.starts_with('-') && !arg.trim().is_empty() {
            let path_str = arg.trim_matches('"').trim_matches('\'');
            let p = std::path::Path::new(path_str);
            if p.exists() || p.is_file() || p.extension().is_some() {
                return Some(path_str.to_string());
            }
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let grammar_manager = GrammarDbManager::new();
    let verbum_manager = VerbumDbManager::new();

    let env_args: Vec<String> = std::env::args().collect();
    let initial_path = extract_file_path_from_args(&env_args);
    let launch_path_state = LaunchFilePath(std::sync::Arc::new(std::sync::Mutex::new(initial_path)));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(file_path) = extract_file_path_from_args(&args) {
                if let Some(state) = app.try_state::<LaunchFilePath>() {
                    if let Ok(mut guard) = state.0.lock() {
                        *guard = Some(file_path.clone());
                    }
                }
                let _ = app.emit("subaka-open-file-path", file_path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(grammar_manager)
        .manage(verbum_manager)
        .manage(launch_path_state)
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

            // Emit initial launch file path to webview once mounted
            let handle_for_launch = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(600));
                if let Some(state) = handle_for_launch.try_state::<LaunchFilePath>() {
                    if let Ok(guard) = state.0.lock() {
                        if let Some(ref path) = *guard {
                            let _ = handle_for_launch.emit("subaka-open-file-path", path.clone());
                        }
                    }
                }
            });

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

            // Warm up / pre-initialize GrammarDB and VerbumDB on startup in background
            let handle_for_init = handle.clone();
            std::thread::spawn(move || {
                if let Some(gm) = handle_for_init.try_state::<GrammarDbManager>() {
                    let _ = gm.initialize(&handle_for_init);
                }
                if let Some(vm) = handle_for_init.try_state::<VerbumDbManager>() {
                    let _ = vm.initialize(&handle_for_init);
                }
            });

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

            if let Err(e) = tray_builder.build(app) {
                log::warn!("Could not create system tray icon: {}", e);
            }

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
            take_launch_file_path,
            get_grammar_status,
            lookup_grammar_word,
            batch_check_words,
            stress_text,
            batch_lookup_stressed,
            probe_media_streams,
            extract_audio_track,
            prepare_compatible_video,
            save_file_direct,
            save_binary_file_direct,
            read_file_direct,
            read_binary_file_direct,
            get_desktop_storage_info,
            clear_desktop_temp_cache,
            get_verbum_status,
            lookup_verbum_word,
            fetch_audio_buffer_native,
            post_json_native,
            fetch_verbum_online_native,
            open_external_url,
            restore_post_fullscreen_bounds,
            log_desktop_event,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SUBaka desktop application");
}
