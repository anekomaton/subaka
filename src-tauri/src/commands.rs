use crate::grammar_db::{GrammarDbManager, GrammarDbStatus, GrammarSearchResult};
use crate::media_probe::{MediaProbeResult, MediaProbeService};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct DesktopInfo {
    pub app_name: String,
    pub version: String,
    pub os: String,
    pub arch: String,
    pub grammar_driver: String,
    pub media_engine: String,
}

#[tauri::command]
pub fn get_desktop_info() -> DesktopInfo {
    DesktopInfo {
        app_name: "Subaka Desktop".to_string(),
        version: "1.0.0".to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        grammar_driver: "Native SQLite (rusqlite)".to_string(),
        media_engine: "FFmpeg Sidecar".to_string(),
    }
}

#[tauri::command]
pub fn get_grammar_status(
    app: AppHandle,
    manager: State<'_, GrammarDbManager>,
) -> GrammarDbStatus {
    let status = manager.get_status();
    if !status.ready {
        // Attempt lazy initialization
        return manager.initialize(&app);
    }
    status
}

#[tauri::command]
pub fn lookup_grammar_word(
    word: String,
    manager: State<'_, GrammarDbManager>,
) -> GrammarSearchResult {
    manager.lookup(&word)
}

#[tauri::command]
pub fn batch_check_words(
    words: Vec<String>,
    manager: State<'_, GrammarDbManager>,
) -> HashMap<String, bool> {
    manager.batch_check(words)
}

#[tauri::command]
pub fn probe_media_streams(
    app: AppHandle,
    file_path: String,
) -> Result<MediaProbeResult, String> {
    MediaProbeService::probe_file(&app, &file_path)
}

#[tauri::command]
pub fn extract_audio_track(
    app: AppHandle,
    input_path: String,
    track_index: usize,
    output_path: String,
) -> Result<String, String> {
    MediaProbeService::extract_audio(&app, &input_path, track_index, &output_path)
}

#[tauri::command]
pub fn save_file_direct(file_path: String, content: String) -> Result<bool, String> {
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn save_binary_file_direct(file_path: String, data_base64: String) -> Result<bool, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let bytes = STANDARD.decode(&data_base64).map_err(|e| e.to_string())?;
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(path, bytes).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn read_file_direct(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DesktopStorageInfo {
    pub app_data_dir: String,
    pub cache_dir: String,
    pub temp_dir: String,
    pub resources_dir: String,
    pub grammardb_path: Option<String>,
    pub grammardb_size_mb: Option<f64>,
    pub verbum_path: Option<String>,
    pub verbum_size_mb: Option<f64>,
}

#[tauri::command]
pub fn get_desktop_storage_info(
    app: AppHandle,
    grammar_manager: State<'_, GrammarDbManager>,
    verbum_manager: State<'_, crate::verbum_db::VerbumDbManager>,
) -> DesktopStorageInfo {
    use tauri::Manager;
    let app_data = app.path().app_data_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    let cache = app.path().app_cache_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    let temp = std::env::temp_dir().to_string_lossy().to_string();

    let mut resources_dir = String::new();
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let res = exe_dir.join("resources");
            resources_dir = res.to_string_lossy().to_string();
        }
    }
    if resources_dir.is_empty() {
        if let Ok(res) = app.path().resource_dir() {
            resources_dir = res.join("resources").to_string_lossy().to_string();
        }
    }

    let g_status = grammar_manager.get_status();
    let v_status = verbum_manager.get_status();

    DesktopStorageInfo {
        app_data_dir: app_data,
        cache_dir: cache,
        temp_dir: temp,
        resources_dir,
        grammardb_path: g_status.path,
        grammardb_size_mb: g_status.size_mb,
        verbum_path: v_status.path,
        verbum_size_mb: v_status.size_mb,
    }
}

#[tauri::command]
pub fn clear_desktop_temp_cache(app: AppHandle) -> Result<bool, String> {
    use tauri::Manager;
    // Cleans temporary cache files, keeping resources (grammardb, verbum, dictionaries) intact!
    let mut deleted_count = 0;

    // 1. App cache directory
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        if cache_dir.exists() {
            if let Ok(entries) = fs::read_dir(&cache_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    // NEVER delete grammardb, verbum or dictionaries
                    if name.contains("grammardb") || name.contains("verbum") || name.ends_with(".sqlite3") {
                        continue;
                    }
                    if path.is_file() {
                        let _ = fs::remove_file(path);
                        deleted_count += 1;
                    }
                }
            }
        }
    }

    // 2. Temp directory subaka files
    let temp_dir = std::env::temp_dir();
    if let Ok(entries) = fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if (name.starts_with("subaka_") || name.starts_with("subaka-") || name.contains("waveform"))
                && !name.contains("grammardb")
                && !name.contains("verbum")
            {
                if path.is_file() {
                    let _ = fs::remove_file(path);
                    deleted_count += 1;
                }
            }
        }
    }

    log::info!("Cleaned {} temporary cache files", deleted_count);
    Ok(true)
}

#[tauri::command]
pub fn get_verbum_status(
    app: AppHandle,
    manager: State<'_, crate::verbum_db::VerbumDbManager>,
) -> crate::verbum_db::VerbumDbStatus {
    let status = manager.get_status();
    if !status.ready {
        return manager.initialize(&app);
    }
    status
}

#[tauri::command]
pub fn lookup_verbum_word(
    word: String,
    manager: State<'_, crate::verbum_db::VerbumDbManager>,
) -> Vec<crate::verbum_db::VerbumArticle> {
    manager.search(&word)
}
