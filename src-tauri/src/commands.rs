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

fn post_json_native_blocking(url: String, json_body: String) -> Result<String, String> {
    use std::io::Write;
    use std::process::Stdio;

    // 1. Primary: In-process pure Rust HTTP client with Keep-Alive connection pool (ureq Agent).
    // The TCP socket is opened directly by subaka.exe itself, ensuring 100% compatibility
    // with Windows VPN Split Tunneling (where only subaka.exe is routed through VPN).
    let ureq_res = get_http_client().post(&url)
        .set("Content-Type", "application/json; charset=utf-8")
        .send_bytes(json_body.as_bytes());

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
            log::warn!("[Native Network] ureq post failed, trying curl fallback: {}", e);
        }
    }

    // 2. Secondary fallback: CLI curl (avoids Windows cmd line quote corruption via STDIN)
    let child = silent_command("curl")
        .args([
            "-s",
            "-X", "POST",
            url.as_str(),
            "-H", "Content-Type: application/json; charset=utf-8",
            "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "--data-binary", "@-",
            "--max-time", "180",
        ])
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
            let ps_cmd = format!(
                "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $body = Get-Content -Raw -Encoding UTF8 '{}'; $res = Invoke-RestMethod -Uri '{}' -Method POST -ContentType 'application/json; charset=utf-8' -Body $body -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'; if ($res -is [string]) {{ $res }} else {{ $res | ConvertTo-Json -Compress }}",
                temp_json_path.to_string_lossy().replace("'", "''"),
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
pub async fn post_json_native(url: String, json_body: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || post_json_native_blocking(url, json_body))
        .await
        .map_err(|e| format!("Памылка фонавага патоку сеткі: {}", e))?
}

fn fetch_verbum_online_native_blocking(url: String) -> Result<String, String> {
    let is_verbum = url.contains("verbum.by");

    // 1. Primary: In-process pure Rust HTTP client with Keep-Alive connection pool (ureq Agent).
    // The TCP socket is opened directly by subaka.exe for Split Tunneling VPN support.
    let mut req = get_http_client().get(&url)
        .set("Accept", "application/json");

    if is_verbum {
        req = req.set("Referer", "https://verbum.by/");
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
            log::warn!("[Native Network] ureq get failed, trying curl fallback: {}", e);
        }
    }

    // 2. Secondary fallback: CLI curl
    let mut args = vec![
        "-s",
        "-L",
        "--max-time", "20",
        "-H", "Accept: application/json",
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ];
    if is_verbum {
        args.push("-H");
        args.push("Referer: https://verbum.by/");
    }
    args.push(url.as_str());

    let curl_res = silent_command("curl")
        .args(&args)
        .output();

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
        let ps_cmd = format!(
            "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $u = '{}'; $wc = New-Object System.Net.WebClient; $wc.Encoding = [System.Text.Encoding]::UTF8; $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'); {} $wc.Headers.Add('Accept', 'application/json'); $wc.DownloadString($u)",
            url.replace("'", "''"),
            referer_part
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
pub async fn fetch_verbum_online_native(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_verbum_online_native_blocking(url))
        .await
        .map_err(|e| format!("Памылка фонавага патоку Verbum: {}", e))?
}

#[tauri::command]
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

