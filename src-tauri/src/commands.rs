use crate::grammar_db::{GrammarDbManager, GrammarDbStatus, GrammarSearchResult};
use crate::media_probe::{MediaProbeResult, MediaProbeService};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};

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
pub fn get_desktop_info(app: AppHandle) -> DesktopInfo {
    DesktopInfo {
        app_name: "Subaka Desktop".to_string(),
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        grammar_driver: "Native SQLite (rusqlite)".to_string(),
        media_engine: "FFmpeg Sidecar".to_string(),
    }
}

#[tauri::command]
pub fn take_launch_file_path(state: State<'_, crate::LaunchFilePath>) -> Option<String> {
    if let Ok(mut guard) = state.0.lock() {
        guard.take()
    } else {
        None
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
    app: AppHandle,
    word: String,
    manager: State<'_, GrammarDbManager>,
) -> GrammarSearchResult {
    let status = manager.get_status();
    if !status.ready {
        let _ = manager.initialize(&app);
    }
    manager.lookup(&word)
}

#[tauri::command]
pub fn batch_check_words(
    app: AppHandle,
    words: Vec<String>,
    manager: State<'_, GrammarDbManager>,
) -> HashMap<String, bool> {
    let status = manager.get_status();
    if !status.ready {
        let _ = manager.initialize(&app);
    }
    manager.batch_check(words)
}

#[tauri::command]
pub fn stress_text(
    app: AppHandle,
    text: String,
    manager: State<'_, GrammarDbManager>,
) -> String {
    let status = manager.get_status();
    if !status.ready {
        let _ = manager.initialize(&app);
    }
    manager.stress_text(&text)
}

#[tauri::command]
pub fn batch_lookup_stressed(
    app: AppHandle,
    words: Vec<String>,
    manager: State<'_, GrammarDbManager>,
) -> HashMap<String, String> {
    let status = manager.get_status();
    if !status.ready {
        let _ = manager.initialize(&app);
    }
    manager.batch_lookup_stressed(words)
}

#[tauri::command]
pub async fn probe_media_streams(
    app: AppHandle,
    file_path: String,
) -> Result<MediaProbeResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        MediaProbeService::probe_file(&app, &file_path)
    })
    .await
    .map_err(|e| format!("Памылка патоку пры аналізе медыя: {}", e))?
}

#[tauri::command]
pub async fn extract_audio_track(
    app: AppHandle,
    input_path: String,
    track_index: usize,
    output_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        MediaProbeService::extract_audio(&app, &input_path, track_index, &output_path)
    })
    .await
    .map_err(|e| format!("Памылка патоку пры здабыванні аўдыя: {}", e))?
}

#[tauri::command]
pub async fn extract_subtitle_track(
    app: AppHandle,
    input_path: String,
    track_index: usize,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        MediaProbeService::extract_subtitle(&app, &input_path, track_index)
    })
    .await
    .map_err(|e| format!("Памылка патоку пры здабыванні субцітраў: {}", e))?
}

#[tauri::command]
pub async fn prepare_compatible_video(
    app: AppHandle,
    input_path: String,
    output_path: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        MediaProbeService::prepare_compatible_video(&app, &input_path, output_path)
    })
    .await
    .map_err(|e| format!("Памылка падрыхтоўкі сумяшчальнага відэа: {}", e))?
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

fn decode_cp1251_char(byte: u8) -> char {
    match byte {
        0x00..=0x7F => byte as char,
        0x80 => 'Ђ', 0x81 => 'Ѓ', 0x82 => '‚', 0x83 => 'ѓ',
        0x84 => '„', 0x85 => '…', 0x86 => '†', 0x87 => '‡',
        0x88 => '€', 0x89 => '‰', 0x8A => 'Љ', 0x8B => '‹',
        0x8C => 'Њ', 0x8D => 'Ќ', 0x8E => 'Ћ', 0x8F => 'Џ',
        0x90 => 'ђ', 0x91 => '‘', 0x92 => '’', 0x93 => '“',
        0x94 => '”', 0x95 => '•', 0x96 => '–', 0x97 => '—',
        0x98 => '\u{0098}', 0x99 => '™', 0x9A => 'љ', 0x9B => '›',
        0x9C => 'њ', 0x9D => 'ќ', 0x9E => 'ћ', 0x9F => 'џ',
        0xA0 => '\u{00A0}',
        0xA1 => 'Ў', // Belarusian capital Ў (U+040E) in Windows-1251
        0xA2 => 'ў', // Belarusian small ў (U+045E) in Windows-1251
        0xA3 => 'Ј',
        0xA4 => '¤',
        0xA5 => 'Ґ',
        0xA6 => '¦',
        0xA7 => '§',
        0xA8 => 'Ё',
        0xA9 => '©',
        0xAA => 'Є',
        0xAB => '«',
        0xAC => '¬',
        0xAD => '\u{00AD}',
        0xAE => '®',
        0xAF => 'Ї',
        0xB0 => '°',
        0xB1 => '±',
        0xB2 => 'І', // Belarusian/Ukrainian capital І (U+0406)
        0xB3 => 'і', // Belarusian/Ukrainian small і (U+0456)
        0xB4 => 'ґ',
        0xB5 => 'µ',
        0xB6 => '¶',
        0xB7 => '·',
        0xB8 => 'ё',
        0xB9 => '№',
        0xBA => 'є',
        0xBB => '»',
        0xBC => 'ј',
        0xBD => 'Ѕ',
        0xBE => 'ѕ',
        0xBF => 'ї',
        0xC0..=0xDF => std::char::from_u32(0x0410 + (byte - 0xC0) as u32).unwrap_or('?'),
        0xE0..=0xFF => std::char::from_u32(0x0430 + (byte - 0xE0) as u32).unwrap_or('?'),
    }
}

pub fn decode_bytes_to_string(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    // 1. Check for UTF-8 with optional BOM
    let bytes_to_check = if bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
        &bytes[3..]
    } else {
        bytes
    };

    if let Ok(s) = std::str::from_utf8(bytes_to_check) {
        return s.to_string();
    }

    // 2. Check for UTF-16 LE BOM (0xFF, 0xFE)
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let u16_slice: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        if let Ok(s) = String::from_utf16(&u16_slice) {
            return s;
        }
    }

    // 3. Check for UTF-16 BE BOM (0xFE, 0xFF)
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let u16_slice: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect();
        if let Ok(s) = String::from_utf16(&u16_slice) {
            return s;
        }
    }

    // 4. Try UTF-16 LE without BOM if even length and high null-byte count
    if bytes.len() % 2 == 0 && bytes.iter().filter(|&&b| b == 0).count() > bytes.len() / 4 {
        let u16_slice: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        if let Ok(s) = String::from_utf16(&u16_slice) {
            return s;
        }
    }

    // 5. Fallback to CP1251 (Windows-1251)
    bytes.iter().map(|&b| decode_cp1251_char(b)).collect()
}

#[tauri::command]
pub fn read_file_direct(file_path: String) -> Result<String, String> {
    let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    Ok(decode_bytes_to_string(&bytes))
}

#[tauri::command]
pub fn read_binary_file_direct(file_path: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(&bytes))
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
    
    let base_cache = app.path().app_cache_dir().unwrap_or_else(|_| std::env::temp_dir());
    let cache_dir = base_cache.join("cache");
    if !cache_dir.exists() {
        let _ = std::fs::create_dir_all(&cache_dir);
    }
    let cache = cache_dir.to_string_lossy().to_string();

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
    // Cleans temporary media, transcribe & cache files, keeping resources (grammardb, verbum, dictionaries) intact!
    let mut deleted_count = 0;

    let is_temp_media_file = |name: &str| -> bool {
        let lower = name.to_lowercase();
        if lower.contains("grammardb") || lower.contains("verbum") || lower.ends_with(".sqlite3") {
            return false;
        }
        lower.starts_with("clean_video")
            || lower.starts_with("audio_cache")
            || lower.starts_with("extracted_audio")
            || lower.starts_with("subaka_")
            || lower.starts_with("subaka-")
            || lower.starts_with("transcribe")
            || lower.contains("transcribe")
            || lower.starts_with("whisper")
            || lower.contains("whisper")
            || lower.contains("waveform")
    };

    let clean_folder = |dir: &Path| -> usize {
        let mut count = 0;
        if dir.exists() {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if is_temp_media_file(name) {
                        if path.is_file() {
                            let _ = fs::remove_file(&path);
                            count += 1;
                        } else if path.is_dir() {
                            let _ = fs::remove_dir_all(&path);
                            count += 1;
                        }
                    }
                }
            }
        }
        count
    };

    // 1. App cache directory root AND app cache directory /cache subfolder
    if let Ok(base_cache) = app.path().app_cache_dir() {
        deleted_count += clean_folder(&base_cache);
        
        let cache_dir = base_cache.join("cache");
        if cache_dir.exists() {
            if let Ok(entries) = fs::read_dir(&cache_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    let lower = name.to_lowercase();
                    if !lower.contains("grammardb") && !lower.contains("verbum") && !lower.ends_with(".sqlite3") {
                        if path.is_file() {
                            let _ = fs::remove_file(&path);
                            deleted_count += 1;
                        } else if path.is_dir() {
                            let _ = fs::remove_dir_all(&path);
                            deleted_count += 1;
                        }
                    }
                }
            }
        }
    }

    // 2. Temp directory subaka, whisper & transcribe cache files
    let temp_dir = std::env::temp_dir();
    deleted_count += clean_folder(&temp_dir);

    // 3. Remove transcribe jobs and upload temp subdirs if any
    let transcribe_db_dir = temp_dir.join("transcribe_jobs_db");
    if transcribe_db_dir.exists() {
        let _ = fs::remove_dir_all(&transcribe_db_dir);
    }
    let uploads_dir = temp_dir.join("uploads");
    if uploads_dir.exists() {
        let _ = fs::remove_dir_all(&uploads_dir);
    }

    log::info!("Cleaned {} temporary media and transcribe cache files", deleted_count);
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
    app: AppHandle,
    word: String,
    manager: State<'_, crate::verbum_db::VerbumDbManager>,
    grammar_manager: State<'_, crate::grammar_db::GrammarDbManager>,
) -> Vec<crate::verbum_db::VerbumArticle> {
    let status = manager.get_status();
    if !status.ready {
        let _ = manager.initialize(&app);
    }
    let mut articles = manager.search(&word);

    // If no direct results, try looking up lemma in GrammarDB for full offline Belarusian search
    if articles.is_empty() {
        let g_status = grammar_manager.get_status();
        if !g_status.ready {
            let _ = grammar_manager.initialize(&app);
        }
        let g_res = grammar_manager.lookup(&word);
        if let Some(lemma) = g_res.lemma {
            let clean_lemma = lemma.replace(['\u{0301}', '\u{0300}', '+'], "").to_lowercase().trim().to_string();
            let clean_word = word.replace(['\u{0301}', '\u{0300}', '+'], "").to_lowercase().trim().to_string();
            if !clean_lemma.is_empty() && clean_lemma != clean_word {
                articles = manager.search(&clean_lemma);
            }
        }
    }

    articles
}

use std::sync::OnceLock;

static HTTP_CLIENT: OnceLock<ureq::Agent> = OnceLock::new();

fn get_http_client() -> &'static ureq::Agent {
    HTTP_CLIENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(180))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
    })
}

#[inline]
fn silent_command(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

fn fetch_audio_buffer_native_blocking(url: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use std::io::Read;

    // 1. Primary: In-process pure Rust HTTP client with Keep-Alive connection pool (ureq Agent).
    // Socket created directly in subaka.exe process memory space for Split Tunneling VPN interception.
    let req = get_http_client().get(&url)
        .set("Referer", "https://translate.google.com/");

    if let Ok(resp) = req.call() {
        let mut bytes = Vec::new();
        if resp.into_reader().read_to_end(&mut bytes).is_ok() && !bytes.is_empty() {
            return Ok(STANDARD.encode(&bytes));
        }
    }

    // 2. Secondary fallback: curl child process
    let curl_res = silent_command("curl")
        .args([
            "-s",
            "-L",
            "--max-time", "30",
            "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "-e", "https://translate.google.com/",
            url.as_str(),
        ])
        .output();

    if let Ok(output) = curl_res {
        if output.status.success() && !output.stdout.is_empty() {
            return Ok(STANDARD.encode(&output.stdout));
        }
    }

    // 3. PowerShell fallback (Windows built-in)
    #[cfg(windows)]
    {
        let ps_cmd = format!(
            "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $u = '{}'; $wc = New-Object System.Net.WebClient; $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'); $wc.Headers.Add('Referer', 'https://translate.google.com/'); $bytes = $wc.DownloadData($u); [Convert]::ToBase64String($bytes)",
            url.replace("'", "''")
        );
        let ps_res = silent_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", ps_cmd.as_str()])
            .output();

        if let Ok(output) = ps_res {
            if output.status.success() {
                let base64_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !base64_str.is_empty() {
                    return Ok(base64_str);
                }
            }
        }
    }

    Err("Не ўдалося спампаваць аўдыёструмень праз натыўны сеткавы драйвер".into())
}

#[tauri::command]
pub async fn fetch_audio_buffer_native(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_audio_buffer_native_blocking(url))
        .await
        .map_err(|e| format!("Памылка фонавага патоку аўдыя: {}", e))?
}

pub fn sanitize_path_str(path_str: &str) -> String {
    if path_str.is_empty() {
        return String::new();
    }
    let p = Path::new(path_str);
    let file_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");

    let is_cache_file = file_name.starts_with("clean_video")
        || file_name.starts_with("audio_cache")
        || file_name.starts_with("extracted_audio")
        || file_name.starts_with("whisper_input")
        || file_name.starts_with("subaka_")
        || file_name.starts_with("subaka-")
        || file_name.contains("grammardb")
        || file_name.contains("verbum");

    if is_cache_file {
        format!("<CACHE_DIR>/{}", file_name)
    } else {
        if !ext.is_empty() {
            format!("<USER_DIR>/[REDACTED_FILENAME].{}", ext)
        } else if !file_name.is_empty() {
            "<USER_DIR>/[REDACTED_FILENAME]".to_string()
        } else {
            "<USER_DIR>".to_string()
        }
    }
}

pub fn sanitize_sensitive_info(text: &str) -> String {
    let mut result = text.to_string();

    // 1. Redact key=... in query parameters
    while let Some(start_idx) = result.find("key=") {
        let val_start = start_idx + 4;
        let bytes = result.as_bytes();
        let mut val_end = val_start;
        while val_end < bytes.len() && !matches!(bytes[val_end], b'&' | b' ' | b'\t' | b'\n' | b'\r' | b'"' | b'\'' | b'\\' | b'>') {
            val_end += 1;
        }
        if val_end > val_start {
            result.replace_range(val_start..val_end, "[REDACTED_API_KEY]");
        } else {
            break;
        }
    }

    // 2. Redact x-goog-api-key or X-Goog-Api-Key headers
    let lower = result.to_lowercase();
    if let Some(start_idx) = lower.find("x-goog-api-key") {
        let val_start = start_idx + 14;
        let bytes = result.as_bytes();
        let mut val_begin = val_start;
        while val_begin < bytes.len() && matches!(bytes[val_begin], b':' | b'=' | b' ') {
            val_begin += 1;
        }
        let mut val_end = val_begin;
        while val_end < bytes.len() && !matches!(bytes[val_end], b'&' | b' ' | b'\t' | b'\n' | b'\r' | b'"' | b'\'' | b',' | b';') {
            val_end += 1;
        }
        if val_end > val_begin {
            result.replace_range(val_begin..val_end, "[REDACTED_API_KEY]");
        }
    }

    // 3. Redact by detected system username (from environment variables)
    for env_var in &["USERNAME", "USER"] {
        if let Ok(uname) = std::env::var(env_var) {
            let trimmed = uname.trim();
            if trimmed.len() >= 2 && !trimmed.eq_ignore_ascii_case("root") && !trimmed.eq_ignore_ascii_case("default") {
                let lower_trimmed = trimmed.to_lowercase();
                let mut search_from = 0;
                while let Some(rel) = result[search_from..].to_lowercase().find(&lower_trimmed) {
                    let idx = search_from + rel;
                    let end = idx + trimmed.len();
                    result.replace_range(idx..end, "[REDACTED_USER]");
                    search_from = idx + "[REDACTED_USER]".len();
                    if search_from >= result.len() {
                        break;
                    }
                }
            }
        }
    }

    // 4. Redact Windows user directory names: Users\<username>, Users\\<username>, Users/<username>, Пользователи\<username>
    for marker in &["users", "пользователи"] {
        let mut search_offset = 0;
        while let Some(rel_pos) = result[search_offset..].to_lowercase().find(marker) {
            let pos = search_offset + rel_pos;
            let after_marker = pos + marker.len();
            let bytes = result.as_bytes();

            // Skip any slashes or backslashes (handles both single \ and escaped \\)
            let mut sep_end = after_marker;
            while sep_end < bytes.len() && (bytes[sep_end] == b'\\' || bytes[sep_end] == b'/') {
                sep_end += 1;
            }

            if sep_end > after_marker && sep_end < bytes.len() {
                let u_start = sep_end;
                let mut u_end = u_start;
                while u_end < bytes.len() && !matches!(bytes[u_end], b'\\' | b'/' | b' ' | b'\t' | b'\n' | b'\r' | b'"' | b'\'' | b',' | b';') {
                    u_end += 1;
                }
                if u_end > u_start {
                    let segment = result[u_start..u_end].to_string();
                    if segment != "[REDACTED_USER]" && segment != "Public" && segment != "Default" && segment != "All Users" {
                        result = result.replace(&segment, "[REDACTED_USER]");
                    }
                }
            }
            search_offset = pos + marker.len() + 1;
            if search_offset >= result.len() {
                break;
            }
        }
    }

    // 5. Redact Linux & macOS home directories: /home/<username> or /Users/<username>
    for prefix in &["/home/", "/users/"] {
        let mut search_offset = 0;
        while let Some(rel_pos) = result[search_offset..].to_lowercase().find(prefix) {
            let pos = search_offset + rel_pos;
            let u_start = pos + prefix.len();
            let bytes = result.as_bytes();
            let mut u_end = u_start;
            while u_end < bytes.len() && !matches!(bytes[u_end], b'/' | b'\\' | b' ' | b'\t' | b'\n' | b'\r' | b'"' | b'\'' | b',' | b';') {
                u_end += 1;
            }
            if u_end > u_start {
                let segment = result[u_start..u_end].to_string();
                if segment != "[REDACTED_USER]" {
                    result = result.replace(&segment, "[REDACTED_USER]");
                }
            }
            search_offset = pos + prefix.len() + 1;
            if search_offset >= result.len() {
                break;
            }
        }
    }

    result
}

fn post_json_native_blocking(
    url: String,
    json_body: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    use std::io::Write;
    use std::process::Stdio;

    let clean_url = sanitize_sensitive_info(&url);

    // 1. Primary: In-process pure Rust HTTP client with Keep-Alive connection pool (ureq Agent).
    let mut req = get_http_client()
        .post(&url)
        .set("Content-Type", "application/json; charset=utf-8");

    if let Some(ref hdrs) = headers {
        for (k, v) in hdrs {
            req = req.set(k, v);
        }
    }

    let ureq_res = req.send_bytes(json_body.as_bytes());

    match ureq_res {
        Ok(resp) => {
            if let Ok(text) = resp.into_string() {
                if !text.is_empty() {
                    return Ok(text);
                }
            }
        }
        Err(ureq::Error::Status(_code, resp)) => {
            if let Ok(text) = resp.into_string() {
                if !text.is_empty() {
                    return Ok(text);
                }
            }
        }
        Err(e) => {
            log::warn!("[Native Network] ureq post failed for {}, trying curl fallback: {}", clean_url, e);
        }
    }

    // 2. Secondary fallback: CLI curl
    let mut curl_args = vec![
        "-s".to_string(),
        "-X".to_string(),
        "POST".to_string(),
        url.clone(),
        "-H".to_string(),
        "Content-Type: application/json; charset=utf-8".to_string(),
        "-H".to_string(),
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string(),
    ];

    if let Some(ref hdrs) = headers {
        for (k, v) in hdrs {
            curl_args.push("-H".to_string());
            curl_args.push(format!("{}: {}", k, v));
        }
    }

    curl_args.push("--data-binary".to_string());
    curl_args.push("@-".to_string());
    curl_args.push("--max-time".to_string());
    curl_args.push("180".to_string());

    let child = silent_command("curl")
        .args(&curl_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    if let Ok(mut c) = child {
        if let Some(mut stdin) = c.stdin.take() {
            let _ = stdin.write_all(json_body.as_bytes());
            let _ = stdin.flush();
        }
        if let Ok(output) = c.wait_with_output() {
            if output.status.success() && !output.stdout.is_empty() {
                return String::from_utf8(output.stdout)
                    .map_err(|e| format!("Invalid UTF-8 response: {}", e));
            }
        }
    }

    // 3. PowerShell fallback (Windows built-in)
    #[cfg(windows)]
    {
        let temp_json_path = std::env::temp_dir().join(format!("subaka_req_{}.json", std::process::id()));
        if std::fs::write(&temp_json_path, json_body.as_bytes()).is_ok() {
            let mut ps_headers = String::from("$wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'); $wc.Headers.Add('Content-Type', 'application/json; charset=utf-8');");
            if let Some(ref hdrs) = headers {
                for (k, v) in hdrs {
                    ps_headers.push_str(&format!(" $wc.Headers.Add('{}', '{}');", k.replace("'", "''"), v.replace("'", "''")));
                }
            }

            let ps_cmd = format!(
                "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $body = Get-Content -Raw -Encoding UTF8 '{}'; $wc = New-Object System.Net.WebClient; $wc.Encoding = [System.Text.Encoding]::UTF8; {} $res = $wc.UploadString('{}', 'POST', $body); $res",
                temp_json_path.to_string_lossy().replace("'", "''"),
                ps_headers,
                url.replace("'", "''")
            );
            let ps_res = silent_command("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", ps_cmd.as_str()])
                .output();
            let _ = std::fs::remove_file(&temp_json_path);

            if let Ok(output) = ps_res {
                if output.status.success() {
                    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !text.is_empty() {
                        return Ok(text);
                    }
                }
            }
        }
    }

    Err("Не ўдалося выканаць натыўны сеткавы POST запыт".into())
}

#[tauri::command]
pub async fn post_json_native(
    url: String,
    json_body: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || post_json_native_blocking(url, json_body, headers))
        .await
        .map_err(|e| format!("Памылка фонавага патоку сеткі: {}", e))?
}

fn fetch_verbum_online_native_blocking(
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    let is_verbum = url.contains("verbum.by");

    // 1. Primary: In-process pure Rust HTTP client with Keep-Alive connection pool (ureq Agent).
    let mut req = get_http_client().get(&url).set("Accept", "application/json");

    if is_verbum {
        req = req.set("Referer", "https://verbum.by/");
    }

    if let Some(ref hdrs) = headers {
        for (k, v) in hdrs {
            req = req.set(k, v);
        }
    }

    match req.call() {
        Ok(resp) => {
            if let Ok(text) = resp.into_string() {
                if !text.is_empty() {
                    return Ok(text);
                }
            }
        }
        Err(ureq::Error::Status(_code, resp)) => {
            if let Ok(text) = resp.into_string() {
                if !text.is_empty() {
                    return Ok(text);
                }
            }
        }
        Err(e) => {
            let clean_url = sanitize_sensitive_info(&url);
            log::warn!("[Native Network] ureq get failed for {}, trying curl fallback: {}", clean_url, e);
        }
    }

    // 2. Secondary fallback: CLI curl
    let mut args = vec![
        "-s".to_string(),
        "-L".to_string(),
        "--max-time".to_string(),
        "20".to_string(),
        "-H".to_string(),
        "Accept: application/json".to_string(),
        "-H".to_string(),
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string(),
    ];
    if is_verbum {
        args.push("-H".to_string());
        args.push("Referer: https://verbum.by/".to_string());
    }
    if let Some(ref hdrs) = headers {
        for (k, v) in hdrs {
            args.push("-H".to_string());
            args.push(format!("{}: {}", k, v));
        }
    }
    args.push(url.clone());

    let curl_res = silent_command("curl").args(&args).output();

    if let Ok(output) = curl_res {
        if output.status.success() && !output.stdout.is_empty() {
            return String::from_utf8(output.stdout)
                .map_err(|e| format!("Invalid UTF-8 response: {}", e));
        }
    }

    // 3. PowerShell fallback (Windows built-in)
    #[cfg(windows)]
    {
        let referer_part = if is_verbum { "$wc.Headers.Add('Referer', 'https://verbum.by/');" } else { "" };
        let mut ps_headers = String::from(referer_part);
        if let Some(ref hdrs) = headers {
            for (k, v) in hdrs {
                ps_headers.push_str(&format!(" $wc.Headers.Add('{}', '{}');", k.replace("'", "''"), v.replace("'", "''")));
            }
        }

        let ps_cmd = format!(
            "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $u = '{}'; $wc = New-Object System.Net.WebClient; $wc.Encoding = [System.Text.Encoding]::UTF8; $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'); $wc.Headers.Add('Accept', 'application/json'); {} $wc.DownloadString($u)",
            url.replace("'", "''"),
            ps_headers
        );
        let ps_res = silent_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", ps_cmd.as_str()])
            .output();

        if let Ok(output) = ps_res {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !text.is_empty() {
                    return Ok(text);
                }
            }
        }
    }

    Err("Не ўдалося выканаць натыўны сеткавы запыт".into())
}

#[tauri::command]
pub async fn fetch_verbum_online_native(
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_verbum_online_native_blocking(url, headers))
        .await
        .map_err(|e| format!("Памылка фонавага патоку Verbum: {}", e))?
}

#[tauri::command]
#[allow(deprecated)]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell().open(&url, None).map_err(|e| format!("Не ўдалося адкрыць спасылку: {}", e))
}

#[tauri::command]
pub fn restore_post_fullscreen_bounds(app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        if let Some(path) = crate::get_window_state_path(&app) {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(state) = serde_json::from_str::<crate::WindowState>(&content) {
                    if !state.maximized {
                        if let (Some(x), Some(y)) = (state.x, state.y) {
                            if x > 0 || y > 0 {
                                let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                            }
                        }
                        if state.width >= 600 && state.height >= 400 {
                            let _ = window.set_size(tauri::PhysicalSize::new(state.width, state.height));
                        }
                    } else {
                        let _ = window.maximize();
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn log_desktop_event(level: String, category: String, message: String, details: Option<String>) {
    let details_str = details.map(|d| format!(" | {}", d)).unwrap_or_default();
    let raw_entry = format!("[{}] {}{}", category, message, details_str);
    let entry = sanitize_sensitive_info(&raw_entry);
    match level.to_lowercase().as_str() {
        "warn" => log::warn!("{}", entry),
        "info" => log::info!("{}", entry),
        _ => log::error!("{}", entry),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WhisperResourcePaths {
    pub binary_path: String,
    pub model_path: String,
}

static ACTIVE_WHISPER_PID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
static WHISPER_CANCELLED_BY_USER: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn ensure_whisper_downloaded(app: &AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let target_dir = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| {
            std::env::var("LOCALAPPDATA")
                .map(|l| Path::new(&l).join("SUBaka"))
                .unwrap_or_else(|_| PathBuf::from("."))
        });

    let has_nvidia = if cfg!(target_os = "windows") {
        silent_command("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*NVIDIA*' }",
            ])
            .output()
            .map(|o| !o.stdout.is_empty())
            .unwrap_or(false)
    } else {
        false
    };

    // 1. Check if Whisper executable already exists in bundled resources directory
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let res_dir = exe_dir.join("resources");
            let res_cuda = res_dir.join("whisper-cuda.exe");
            let res_cpu = res_dir.join("whisper.exe");
            if has_nvidia && res_cuda.exists() && res_cuda.metadata().map(|m| m.len()).unwrap_or(0) > 100000 {
                return Ok(res_cuda);
            }
            if res_cpu.exists() && res_cpu.metadata().map(|m| m.len()).unwrap_or(0) > 100000 {
                return Ok(res_cpu);
            }
        }
    }

    let cuda_exe = target_dir.join("whisper-cuda.exe");
    let cpu_exe = target_dir.join("whisper.exe");

    if has_nvidia && cuda_exe.exists() && cuda_exe.metadata().map(|m| m.len()).unwrap_or(0) > 100000 {
        return Ok(cuda_exe);
    }
    if cpu_exe.exists() && cpu_exe.metadata().map(|m| m.len()).unwrap_or(0) > 100000 {
        return Ok(cpu_exe);
    }

    let _ = fs::create_dir_all(&target_dir);

    let log_msg = sanitize_sensitive_info(&format!(
        "[WhisperEngine] Auto-downloading native Whisper binary into {:?} (NVIDIA GPU detected: {})",
        target_dir,
        has_nvidia
    ));
    log::info!("{}", log_msg);

    if has_nvidia {
        let cuda_urls = [
            "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-cublas-12.4.0-bin-x64.zip",
            "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-cublas-11.8.0-bin-x64.zip",
            "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-cublas-12.4.0-bin-x64.zip",
        ];
        let zip_cuda = target_dir.join("whisper-cuda.zip");
        for cuda_url in &cuda_urls {
            let dl_res = silent_command("curl.exe")
                .args(["-s", "-S", "-f", "-L", "--retry", "3", cuda_url, "-o", zip_cuda.to_str().unwrap_or("")])
                .status();

            if dl_res.map(|s| s.success()).unwrap_or(false) && zip_cuda.exists() && zip_cuda.metadata().map(|m| m.len()).unwrap_or(0) > 1000000 {
                let _ = silent_command("powershell")
                    .args([
                        "-NoProfile",
                        "-Command",
                        &format!(
                            "$ProgressPreference='SilentlyContinue'; \
                             $tempDir = Join-Path '{}' 'temp_cuda'; \
                             New-Item -ItemType Directory -Force -Path $tempDir | Out-Null; \
                             Expand-Archive -Path '{}' -DestinationPath $tempDir -Force; \
                             $exe = Get-ChildItem -Path $tempDir -Recurse -Filter '*.exe' | Where-Object {{ $_.Name -match 'whisper-cli|whisper|main' }} | Select-Object -First 1; \
                             if ($exe) {{ Copy-Item $exe.FullName '{}' -Force }}; \
                             Get-ChildItem -Path $tempDir -Recurse -Filter '*.dll' | ForEach-Object {{ Copy-Item $_.FullName '{}' -Force }}; \
                             Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue; \
                             Remove-Item '{}' -Force -ErrorAction SilentlyContinue;",
                            target_dir.display(),
                            zip_cuda.display(),
                            cuda_exe.display(),
                            target_dir.display(),
                            zip_cuda.display()
                        ),
                    ])
                    .status();
                break;
            }
        }
        if cuda_exe.exists() {
            return Ok(cuda_exe);
        }
    }

    let cpu_urls = [
        "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip",
        "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip",
    ];
    let zip_cpu = target_dir.join("whisper-bin-cpu.zip");
    for cpu_url in &cpu_urls {
        let dl_cpu = silent_command("curl.exe")
            .args(["-s", "-S", "-f", "-L", "--retry", "3", cpu_url, "-o", zip_cpu.to_str().unwrap_or("")])
            .status();

        if dl_cpu.map(|s| s.success()).unwrap_or(false) && zip_cpu.exists() && zip_cpu.metadata().map(|m| m.len()).unwrap_or(0) > 500000 {
            let _ = silent_command("powershell")
                .args([
                    "-NoProfile",
                    "-Command",
                    &format!(
                        "$ProgressPreference='SilentlyContinue'; \
                         $tempDir = Join-Path '{}' 'temp_cpu'; \
                         New-Item -ItemType Directory -Force -Path $tempDir | Out-Null; \
                         Expand-Archive -Path '{}' -DestinationPath $tempDir -Force; \
                         $exe = Get-ChildItem -Path $tempDir -Recurse -Filter '*.exe' | Where-Object {{ $_.Name -match 'whisper-cli|whisper|main' }} | Select-Object -First 1; \
                         if ($exe) {{ Copy-Item $exe.FullName '{}' -Force }}; \
                         Get-ChildItem -Path $tempDir -Recurse -Filter '*.dll' | ForEach-Object {{ Copy-Item $_.FullName '{}' -Force }}; \
                         Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue; \
                         Remove-Item '{}' -Force -ErrorAction SilentlyContinue;",
                        target_dir.display(),
                        zip_cpu.display(),
                        cpu_exe.display(),
                        target_dir.display(),
                        zip_cpu.display()
                    ),
                ])
                .status();
            break;
        }
    }

    if cpu_exe.exists() {
        Ok(cpu_exe)
    } else {
        Err("Не ўдалося спампаваць бінарны файл Whisper для SUBaka.".to_string())
    }
}

pub fn ensure_whisper_model_downloaded(app: &AppHandle, requested_model: &str) -> Result<PathBuf, String> {
    use tauri::Manager;
    let target_dir = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| {
            std::env::var("LOCALAPPDATA")
                .map(|l| Path::new(&l).join("SUBaka"))
                .unwrap_or_else(|_| PathBuf::from("."))
        });

    let m_file = if requested_model.trim().is_empty() {
        "ggml-small.bin"
    } else {
        requested_model.trim()
    };

    // 1. Check if model already exists in bundled resources directory
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let res_model = exe_dir.join("resources").join(m_file);
            if res_model.exists() && res_model.metadata().map(|m| m.len()).unwrap_or(0) > 10000000 {
                return Ok(res_model);
            }
        }
    }

    let target_model = target_dir.join(m_file);

    if target_model.exists() && target_model.metadata().map(|m| m.len()).unwrap_or(0) > 10000000 {
        return Ok(target_model);
    }

    let _ = fs::create_dir_all(&target_dir);

    let log_msg = sanitize_sensitive_info(&format!(
        "[WhisperEngine] Auto-downloading GGML Whisper model ({}) into {:?}",
        m_file,
        target_dir
    ));
    log::info!("{}", log_msg);

    let model_url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}", m_file);
    let dl_res = silent_command("curl.exe")
        .args(["-s", "-S", "-f", "-L", "--retry", "3", &model_url, "-o", target_model.to_str().unwrap_or("")])
        .status();

    if dl_res.map(|s| s.success()).unwrap_or(false) && target_model.exists() {
        Ok(target_model)
    } else {
        Err(format!("Не ўдалося спампаваць мадэль Whisper ({}).", m_file))
    }
}

pub fn get_whisper_candidate_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidate_dirs: Vec<PathBuf> = Vec::new();

    // 1. Executable directory: <exe_dir>/resources and <exe_dir>
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidate_dirs.push(exe_dir.join("resources"));
            candidate_dirs.push(exe_dir.to_path_buf());
        }
    }

    // 2. Tauri resource_dir
    if let Ok(res_dir) = app.path().resource_dir() {
        candidate_dirs.push(res_dir.join("resources"));
        candidate_dirs.push(res_dir);
    }

    // 3. App local data directory (%LOCALAPPDATA%/SUBaka)
    if let Ok(app_dir) = app.path().app_local_data_dir() {
        candidate_dirs.push(app_dir);
    }

    // 4. Fallback LOCALAPPDATA environment variable
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        let base_dir = Path::new(&local_appdata).join("SUBaka");
        candidate_dirs.push(base_dir);
    }

    // 5. Current working directory
    if let Ok(cwd) = std::env::current_dir() {
        candidate_dirs.push(cwd.join("resources"));
        candidate_dirs.push(cwd);
    }

    candidate_dirs
}

pub fn locate_whisper_binary(app: &AppHandle) -> Option<PathBuf> {
    let binary_names = [
        "whisper-cuda.exe",
        "whisper-cublas.exe",
        "whisper-gpu.exe",
        "whisper-cli.exe",
        "main.exe",
        "whisper.exe",
        "whisper",
    ];

    let dirs = get_whisper_candidate_dirs(app);
    for dir in &dirs {
        for b_name in &binary_names {
            let candidate = dir.join(b_name);
            if candidate.exists() && candidate.is_file() {
                if let Ok(meta) = candidate.metadata() {
                    if meta.len() > 100000 {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    // Check system PATH
    if let Ok(path_var) = std::env::var("PATH") {
        for path_entry in std::env::split_paths(&path_var) {
            for b_name in &binary_names {
                let candidate = path_entry.join(b_name);
                if candidate.exists() && candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    None
}

pub fn locate_whisper_model(app: &AppHandle, requested_model: &str) -> Option<PathBuf> {
    let mut model_names = Vec::new();
    if !requested_model.trim().is_empty() {
        model_names.push(requested_model.trim().to_string());
    }
    model_names.push("ggml-small.bin".to_string());
    model_names.push("ggml-base.bin".to_string());
    model_names.push("ggml-medium.bin".to_string());
    model_names.push("ggml-tiny.bin".to_string());

    if !requested_model.trim().is_empty() {
        let direct_path = Path::new(requested_model);
        if direct_path.is_absolute() && direct_path.exists() {
            if let Ok(meta) = direct_path.metadata() {
                if meta.len() > 10000000 {
                    return Some(direct_path.to_path_buf());
                }
            }
        }
    }

    let dirs = get_whisper_candidate_dirs(app);
    for dir in &dirs {
        for m_name in &model_names {
            let candidate = dir.join(m_name);
            if candidate.exists() && candidate.is_file() {
                if let Ok(meta) = candidate.metadata() {
                    if meta.len() > 10000000 {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    None
}

pub fn resolve_whisper_executable_and_model(
    app: &AppHandle,
    requested_model: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let binary = match locate_whisper_binary(app) {
        Some(b) => b,
        None => {
            if let Ok(dl_bin) = ensure_whisper_downloaded(app) {
                dl_bin
            } else {
                return Err("Не знойдзены выканаўчы файл рухавіка Whisper (whisper.exe).".to_string());
            }
        }
    };

    let model = match locate_whisper_model(app, requested_model) {
        Some(m) => m,
        None => {
            if let Ok(dl_mod) = ensure_whisper_model_downloaded(app, requested_model) {
                dl_mod
            } else {
                return Err("Мадэль афлайн-распазнавання Whisper (ggml-small.bin) не знойдзена. Спампуйце мадэль у мадальным акне выбару дарожкі або выкарыстоўвайце Gemini.".to_string());
            }
        }
    };

    Ok((binary, model))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperEngineDetails {
    pub is_installed: bool,
    pub model_installed: bool,
    pub binary_installed: bool,
    pub binary_path: String,
    pub model_path: String,
    pub is_cuda: bool,
    pub engine_name: String,
    pub model_size_mb: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperDownloadProgress {
    pub stage: String,
    pub percent: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

static WHISPER_DOWNLOAD_CANCELLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub fn cancel_whisper_download() -> Result<bool, String> {
    WHISPER_DOWNLOAD_CANCELLED.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(true)
}

#[tauri::command]
pub fn get_whisper_resource_paths(app: AppHandle) -> Result<WhisperResourcePaths, String> {
    let (binary, model) = resolve_whisper_executable_and_model(&app, "ggml-small.bin")?;
    Ok(WhisperResourcePaths {
        binary_path: binary.to_string_lossy().to_string(),
        model_path: model.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn get_whisper_engine_details(app: AppHandle) -> Result<WhisperEngineDetails, String> {
    let binary_opt = locate_whisper_binary(&app);
    let model_opt = locate_whisper_model(&app, "ggml-small.bin");

    let binary_installed = binary_opt.is_some();
    let model_installed = model_opt.is_some();
    let is_installed = binary_installed && model_installed;

    let bin_str = binary_opt
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let lower = bin_str.to_lowercase();
    let is_cuda = lower.contains("cuda") || lower.contains("cublas") || lower.contains("gpu");
    let engine_name = if is_cuda {
        "NVIDIA CUDA GPU (cuBLAS)".to_string()
    } else {
        "CPU (Standard whisper.cpp)".to_string()
    };

    let model_str = model_opt
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let model_size_mb = model_opt
        .as_ref()
        .and_then(|p| p.metadata().ok())
        .map(|m| (m.len() as f64) / (1024.0 * 1024.0))
        .unwrap_or(0.0);

    Ok(WhisperEngineDetails {
        is_installed,
        model_installed,
        binary_installed,
        binary_path: bin_str,
        model_path: model_str,
        is_cuda,
        engine_name,
        model_size_mb: (model_size_mb * 10.0).round() / 10.0,
    })
}

#[tauri::command]
pub async fn download_whisper_bundle(app: AppHandle) -> Result<WhisperEngineDetails, String> {
    WHISPER_DOWNLOAD_CANCELLED.store(false, std::sync::atomic::Ordering::SeqCst);
    let app_clone = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let target_dir = app_clone
            .path()
            .app_local_data_dir()
            .unwrap_or_else(|_| {
                std::env::var("LOCALAPPDATA")
                    .map(|l| Path::new(&l).join("SUBaka"))
                    .unwrap_or_else(|_| PathBuf::from("."))
            });
        let _ = fs::create_dir_all(&target_dir);

        // 1. Ensure binary exists
        let binary_opt = locate_whisper_binary(&app_clone);
        if binary_opt.is_none() {
            let _ = app_clone.emit(
                "whisper-download-progress",
                WhisperDownloadProgress {
                    stage: "Спампоўка бінарных файлаў Whisper...".to_string(),
                    percent: 5.0,
                    downloaded_bytes: 0,
                    total_bytes: 0,
                },
            );
            if let Err(e) = ensure_whisper_downloaded(&app_clone) {
                return Err(format!("Памылка спампоўкі выканаўчага рухавіка Whisper: {}", e));
            }
        }

        if WHISPER_DOWNLOAD_CANCELLED.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Спампоўка адменена карыстальнікам.".to_string());
        }

        // 2. Download ggml-small.bin
        let model_opt = locate_whisper_model(&app_clone, "ggml-small.bin");
        if model_opt.is_none() {
            let model_file = target_dir.join("ggml-small.bin");
            let temp_model_file = target_dir.join("ggml-small.bin.downloading");
            let expected_total_bytes: u64 = 488_000_000;

            let _ = app_clone.emit(
                "whisper-download-progress",
                WhisperDownloadProgress {
                    stage: "Падключэнне для спампоўкі мадэлі...".to_string(),
                    percent: 10.0,
                    downloaded_bytes: 0,
                    total_bytes: expected_total_bytes,
                },
            );

            let urls = [
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
                "https://huggingface.co/datasets/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
            ];

            let mut success = false;
            for model_url in &urls {
                if WHISPER_DOWNLOAD_CANCELLED.load(std::sync::atomic::Ordering::SeqCst) {
                    let _ = fs::remove_file(&temp_model_file);
                    return Err("Спампоўка адменена карыстальнікам.".to_string());
                }

                #[cfg(target_os = "windows")]
                let mut child = match silent_command("curl.exe")
                    .args([
                        "-s",
                        "-S",
                        "-f",
                        "-L",
                        "--retry",
                        "3",
                        model_url,
                        "-o",
                        temp_model_file.to_str().unwrap_or(""),
                    ])
                    .spawn()
                {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                #[cfg(not(target_os = "windows"))]
                let mut child = match silent_command("curl")
                    .args([
                        "-s",
                        "-S",
                        "-f",
                        "-L",
                        "--retry",
                        "3",
                        model_url,
                        "-o",
                        temp_model_file.to_str().unwrap_or(""),
                    ])
                    .spawn()
                {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                loop {
                    if WHISPER_DOWNLOAD_CANCELLED.load(std::sync::atomic::Ordering::SeqCst) {
                        let _ = child.kill();
                        let _ = fs::remove_file(&temp_model_file);
                        return Err("Спампоўка адменена карыстальнікам.".to_string());
                    }

                    match child.try_wait() {
                        Ok(Some(status)) => {
                            if status.success() && temp_model_file.exists() && temp_model_file.metadata().map(|m| m.len()).unwrap_or(0) > 10000000 {
                                success = true;
                            }
                            break;
                        }
                        Ok(None) => {
                            let cur_len = temp_model_file.metadata().map(|m| m.len()).unwrap_or(0);
                            let pct = (10.0 + (cur_len as f64 / expected_total_bytes as f64) * 88.0).min(98.0);
                            let _ = app_clone.emit(
                                "whisper-download-progress",
                                WhisperDownloadProgress {
                                    stage: format!("Спампоўка мадэлі Whisper ({:.1} МБ / {:.1} МБ)...", cur_len as f64 / 1048576.0, expected_total_bytes as f64 / 1048576.0),
                                    percent: (pct * 10.0).round() / 10.0,
                                    downloaded_bytes: cur_len,
                                    total_bytes: expected_total_bytes,
                                },
                            );
                            std::thread::sleep(std::time::Duration::from_millis(300));
                        }
                        Err(_) => break,
                    }
                }

                if success {
                    let _ = fs::rename(&temp_model_file, &model_file);
                    break;
                }
            }

            if !success && !model_file.exists() {
                return Err("Не ўдалося спампаваць мадэль Whisper (ggml-small.bin).".to_string());
            }
        }

        let _ = app_clone.emit(
            "whisper-download-progress",
            WhisperDownloadProgress {
                stage: "Мадэль Whisper паспяхова спампавана!".to_string(),
                percent: 100.0,
                downloaded_bytes: 488_000_000,
                total_bytes: 488_000_000,
            },
        );

        get_whisper_engine_details(app_clone)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_whisper_transcribe() -> Result<bool, String> {
    WHISPER_CANCELLED_BY_USER.store(true, std::sync::atomic::Ordering::SeqCst);
    let pid = ACTIVE_WHISPER_PID.swap(0, std::sync::atomic::Ordering::SeqCst);
    if pid != 0 {
        log::info!("[WhisperEngine] Force killing active Whisper process PID: {}", pid);
        #[cfg(target_os = "windows")]
        {
            let _ = silent_command("taskkill")
                .args(["/F", "/PID", &pid.to_string(), "/T"])
                .status();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = silent_command("kill")
                .args(["-9", &pid.to_string()])
                .status();
        }
    }

    #[cfg(target_os = "windows")]
    {
        for exe_name in &["whisper.exe", "whisper-cuda.exe", "whisper-cli.exe", "whisper-cublas.exe", "main.exe"] {
            let _ = silent_command("taskkill")
                .args(["/F", "/IM", exe_name, "/T"])
                .status();
        }
    }

    Ok(true)
}

#[tauri::command]
pub async fn run_whisper_transcribe(
    app: AppHandle,
    audio_path: String,
    model_name: String,
    language: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        WHISPER_CANCELLED_BY_USER.store(false, std::sync::atomic::Ordering::SeqCst);

        let (whisper_exe, model_file) = resolve_whisper_executable_and_model(&app, &model_name)?;

        let log_msg = sanitize_sensitive_info(&format!(
            "Running whisper transcription via {:?} with model {:?}, audio: {}, lang: {}",
            whisper_exe,
            model_file,
            audio_path,
            if language.is_empty() { "auto" } else { &language }
        ));
        log::info!("{}", log_msg);

        let output_srt_path = std::env::temp_dir().join(format!("subaka_whisper_{}", std::process::id()));

        // 1. Try whisper.cpp CLI flags syntax (-m model -f audio -osrt -of output_prefix -l lang)
        let mut cmd = silent_command(whisper_exe.to_str().unwrap_or("whisper.exe"));
        if let Some(parent_dir) = whisper_exe.parent() {
            cmd.current_dir(parent_dir);
            if let Ok(cur_path) = std::env::var("PATH") {
                let new_path = format!("{};{}", parent_dir.display(), cur_path);
                cmd.env("PATH", new_path);
            } else {
                cmd.env("PATH", parent_dir);
            }
        }
        cmd.args([
            "-m",
            model_file.to_str().unwrap_or("ggml-small.bin"),
            "-f",
            &audio_path,
            "-osrt",
            "-of",
            output_srt_path.to_str().unwrap_or("subaka_whisper_output"),
            "-l",
            if language.is_empty() { "auto" } else { &language },
        ]);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                if WHISPER_CANCELLED_BY_USER.load(std::sync::atomic::Ordering::SeqCst) {
                    return Err("Прыпынена карыстальнікам".to_string());
                }
                return Err(format!("Не ўдалося запусціць працэс Whisper: {}", e));
            }
        };

        let pid = child.id();
        ACTIVE_WHISPER_PID.store(pid, std::sync::atomic::Ordering::SeqCst);

        let output_res = child.wait_with_output();
        ACTIVE_WHISPER_PID.store(0, std::sync::atomic::Ordering::SeqCst);

        if WHISPER_CANCELLED_BY_USER.swap(false, std::sync::atomic::Ordering::SeqCst) {
            log::info!("[WhisperEngine] Whisper transcription cancelled by user");
            return Err("Прыпынена карыстальнікам".to_string());
        }

        if let Ok(output) = output_res {
            if output.status.success() {
                let srt_file_path = format!("{}.srt", output_srt_path.to_str().unwrap_or(""));
                let srt_file_with_ext = Path::new(&srt_file_path);
                if srt_file_with_ext.exists() {
                    let content = fs::read(srt_file_with_ext).map_err(|e| e.to_string())?;
                    let _ = fs::remove_file(srt_file_with_ext);
                    return Ok(decode_bytes_to_string(&content));
                }
            }

            if WHISPER_CANCELLED_BY_USER.swap(false, std::sync::atomic::Ordering::SeqCst) {
                return Err("Прыпынена карыстальнікам".to_string());
            }

            let err_msg = String::from_utf8_lossy(&output.stderr);
            // 2. Check if stderr indicates Python OpenAI Whisper CLI
            if err_msg.contains("usage: whisper") || err_msg.contains("output_format") || err_msg.contains("invalid choice") || err_msg.contains("unrecognized arguments") {
                log::info!("[WhisperEngine] Detected Python OpenAI Whisper CLI, switching to Python CLI syntax...");
                let audio_path_buf = PathBuf::from(&audio_path);
                let temp_dir = audio_path_buf.parent().unwrap_or_else(|| Path::new("."));
                let stem = audio_path_buf.file_stem().and_then(|s| s.to_str()).unwrap_or("whisper_input");
                let expected_srt_path = temp_dir.join(format!("{}.srt", stem));
                let _ = fs::remove_file(&expected_srt_path);

                let raw_model_str = model_name.to_lowercase();
                let py_model = if raw_model_str.contains("tiny") {
                    "tiny"
                } else if raw_model_str.contains("base") {
                    "base"
                } else if raw_model_str.contains("medium") {
                    "medium"
                } else if raw_model_str.contains("large-v3") {
                    "large-v3"
                } else if raw_model_str.contains("large-v2") {
                    "large-v2"
                } else if raw_model_str.contains("large") {
                    "large"
                } else {
                    "small"
                };

                let mut py_cmd = silent_command(whisper_exe.to_str().unwrap_or("whisper.exe"));
                if let Some(parent_dir) = whisper_exe.parent() {
                    py_cmd.current_dir(parent_dir);
                    if let Ok(cur_path) = std::env::var("PATH") {
                        let new_path = format!("{};{}", parent_dir.display(), cur_path);
                        py_cmd.env("PATH", new_path);
                    } else {
                        py_cmd.env("PATH", parent_dir);
                    }
                }
                let mut py_args = vec![
                    audio_path.clone(),
                    "--model".to_string(),
                    py_model.to_string(),
                    "--output_dir".to_string(),
                    temp_dir.to_string_lossy().to_string(),
                    "--output_format".to_string(),
                    "srt".to_string(),
                    "--verbose".to_string(),
                    "False".to_string(),
                ];

                if !language.is_empty() && language != "auto" {
                    py_args.push("--language".to_string());
                    py_args.push(language.clone());
                }

                py_cmd.args(&py_args);

                let mut py_child = match py_cmd.spawn() {
                    Ok(c) => c,
                    Err(e) => {
                        if WHISPER_CANCELLED_BY_USER.load(std::sync::atomic::Ordering::SeqCst) {
                            return Err("Прыпынена карыстальнікам".to_string());
                        }
                        return Err(format!("Не ўдалося запусціць працэс Python Whisper: {}", e));
                    }
                };

                let py_pid = py_child.id();
                ACTIVE_WHISPER_PID.store(py_pid, std::sync::atomic::Ordering::SeqCst);

                let py_output_res = py_child.wait_with_output();
                ACTIVE_WHISPER_PID.store(0, std::sync::atomic::Ordering::SeqCst);

                if WHISPER_CANCELLED_BY_USER.swap(false, std::sync::atomic::Ordering::SeqCst) {
                    log::info!("[WhisperEngine] Python Whisper transcription cancelled by user");
                    return Err("Прыпынена карыстальнікам".to_string());
                }

                if let Ok(py_output) = py_output_res {
                    if py_output.status.success() || expected_srt_path.exists() {
                        if expected_srt_path.exists() {
                            let content = fs::read(&expected_srt_path).map_err(|e| e.to_string())?;
                            let _ = fs::remove_file(&expected_srt_path);
                            return Ok(decode_bytes_to_string(&content));
                        }
                    }
                    if WHISPER_CANCELLED_BY_USER.swap(false, std::sync::atomic::Ordering::SeqCst) {
                        return Err("Прыпынена карыстальнікам".to_string());
                    }
                    let py_err = String::from_utf8_lossy(&py_output.stderr);
                    return Err(format!("Памылка генерацыі Python Whisper: {}", sanitize_sensitive_info(&py_err)));
                }
            }

            if WHISPER_CANCELLED_BY_USER.swap(false, std::sync::atomic::Ordering::SeqCst) {
                return Err("Прыпынена карыстальнікам".to_string());
            }

            return Err(format!("Памылка генерацыі Whisper: {}", sanitize_sensitive_info(&err_msg)));
        }

        if WHISPER_CANCELLED_BY_USER.swap(false, std::sync::atomic::Ordering::SeqCst) {
            return Err("Прыпынена карыстальнікам".to_string());
        }

        Err("Не ўдалося запусціць працэс Whisper".to_string())
    })
    .await
    .map_err(|e| format!("Памылка патоку Whisper: {}", e))?
}


