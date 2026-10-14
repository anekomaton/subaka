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
pub fn read_file_direct(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}
