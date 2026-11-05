use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioTrackInfo {
    pub index: usize,
    pub stream_index: usize,
    pub codec: String,
    pub channels: u32,
    pub sample_rate: u32,
    pub language: Option<String>,
    pub title: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleTrackInfo {
    pub index: usize,
    pub stream_index: usize,
    pub codec: String,
    pub language: Option<String>,
    pub title: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaProbeResult {
    pub file_path: String,
    pub duration_seconds: Option<f64>,
    pub format: String,
    pub audio_tracks: Vec<AudioTrackInfo>,
    pub subtitle_tracks: Vec<SubtitleTrackInfo>,
    pub video_streams_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionProgressPayload {
    pub progress: f64,
    pub message: String,
    pub finished: bool,
    pub error: Option<String>,
}

pub struct MediaProbeService;

impl MediaProbeService {
    pub fn probe_file(app: &AppHandle, file_path: &str) -> Result<MediaProbeResult, String> {
        let path = Path::new(file_path);
        if !path.exists() {
            return Err(format!("File does not exist: {}", file_path));
        }

        // Try probing via tauri sidecar or system command
        let output = if let Ok(sidecar) = app.shell().sidecar("ffmpeg") {
            // Run `ffmpeg -i file_path`
            let out = tauri::async_runtime::block_on(sidecar.args(["-i", file_path]).output());
            match out {
                Ok(o) => String::from_utf8_lossy(&o.stderr).to_string(),
                Err(_) => Self::probe_with_system_cmd(file_path)?,
            }
        } else {
            Self::probe_with_system_cmd(file_path)?
        };

        Self::parse_ffmpeg_probe_output(file_path, &output)
    }

    fn probe_with_system_cmd(file_path: &str) -> Result<String, String> {
        let mut cmd = Command::new("ffmpeg");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let child = cmd.args(["-i", file_path]).output();

        match child {
            Ok(out) => Ok(String::from_utf8_lossy(&out.stderr).to_string()),
            Err(e) => Err(format!("FFmpeg execution failed: {}", e)),
        }
    }

    pub fn parse_ffmpeg_probe_output(file_path: &str, output: &str) -> Result<MediaProbeResult, String> {
        let mut audio_tracks = Vec::new();
        let mut subtitle_tracks = Vec::new();
        let mut duration_seconds = None;
        let mut video_count = 0;

        #[derive(Copy, Clone, PartialEq, Eq)]
        enum LastTrackType {
            Audio(usize),
            Subtitle(usize),
            None,
        }
        let mut last_track = LastTrackType::None;

        for line in output.lines() {
            let trimmed = line.trim();

            // Parse duration: "Duration: 00:01:23.45, start: ..."
            if trimmed.starts_with("Duration:") {
                if let Some(dur_str) = trimmed.strip_prefix("Duration:") {
                    let parts: Vec<&str> = dur_str.split(',').collect();
                    if let Some(time_part) = parts.first() {
                        let t = time_part.trim();
                        let time_segs: Vec<&str> = t.split(':').collect();
                        if time_segs.len() == 3 {
                            if let (Ok(h), Ok(m), Ok(s)) = (
                                time_segs[0].parse::<f64>(),
                                time_segs[1].parse::<f64>(),
                                time_segs[2].parse::<f64>(),
                            ) {
                                duration_seconds = Some(h * 3600.0 + m * 60.0 + s);
                            }
                        }
                    }
                }
            }

            // Stream line detection
            if trimmed.contains("Stream #") {
                let is_default = trimmed.contains("(default)");

                // Parse stream index: "Stream #0:2..." -> 2
                let stream_idx = if let Some(hash_pos) = trimmed.find('#') {
                    let after_hash = &trimmed[hash_pos + 1..];
                    if let Some(colon_pos) = after_hash.find(':') {
                        let after_colon = &after_hash[colon_pos + 1..];
                        let num_str: String = after_colon.chars().take_while(|c| c.is_ascii_digit()).collect();
                        num_str.parse::<usize>().unwrap_or(0)
                    } else {
                        0
                    }
                } else {
                    0
                };

                // Parse language: "Stream #0:1(rus): Audio..."
                let mut lang = None;
                if let Some(paren_start) = trimmed.find('(') {
                    if let Some(paren_end) = trimmed[paren_start..].find(')') {
                        let l = trimmed[paren_start + 1..paren_start + paren_end].trim().to_string();
                        if !l.is_empty() {
                            lang = Some(l);
                        }
                    }
                }

                if trimmed.contains("Audio:") {
                    let audio_track_idx = audio_tracks.len();

                    let codec = if let Some(audio_idx) = trimmed.find("Audio:") {
                        let after_audio = &trimmed[audio_idx + 6..];
                        let raw = after_audio.split(',').next().unwrap_or("unknown").trim();
                        // "aac (LC)" -> "aac"
                        raw.split(' ').next().unwrap_or(raw).to_string()
                    } else {
                        "unknown".to_string()
                    };

                    let channels = if trimmed.contains("7.1") {
                        8
                    } else if trimmed.contains("5.1") {
                        6
                    } else if trimmed.contains("stereo") {
                        2
                    } else if trimmed.contains("mono") {
                        1
                    } else {
                        2
                    };

                    let sample_rate = if let Some(hz_idx) = trimmed.find("Hz") {
                        let before_hz = &trimmed[..hz_idx];
                        before_hz.split(',').last().unwrap_or("").trim().parse::<u32>().unwrap_or(48000)
                    } else {
                        48000
                    };

                    audio_tracks.push(AudioTrackInfo {
                        index: audio_track_idx,
                        stream_index: stream_idx,
                        codec,
                        channels,
                        sample_rate,
                        language: lang,
                        title: None,
                        is_default,
                    });
                    last_track = LastTrackType::Audio(audio_track_idx);
                } else if trimmed.contains("Subtitle:") {
                    let sub_track_idx = subtitle_tracks.len();

                    let codec = if let Some(sub_idx) = trimmed.find("Subtitle:") {
                        let after_sub = &trimmed[sub_idx + 9..];
                        let raw = after_sub.split(',').next().unwrap_or("subrip").trim();
                        raw.split(' ').next().unwrap_or(raw).to_string()
                    } else {
                        "subrip".to_string()
                    };

                    subtitle_tracks.push(SubtitleTrackInfo {
                        index: sub_track_idx,
                        stream_index: stream_idx,
                        codec,
                        language: lang,
                        title: None,
                        is_default,
                    });
                    last_track = LastTrackType::Subtitle(sub_track_idx);
                } else if trimmed.contains("Video:") {
                    video_count += 1;
                    last_track = LastTrackType::None;
                } else {
                    last_track = LastTrackType::None;
                }
            } else if trimmed.to_lowercase().starts_with("title") && (trimmed.contains(':') || trimmed.contains('=')) {
                // Parse Metadata title line for currently active stream
                let title_val = if let Some((_, v)) = trimmed.split_once(':') {
                    v.trim().to_string()
                } else if let Some((_, v)) = trimmed.split_once('=') {
                    v.trim().to_string()
                } else {
                    String::new()
                };

                if !title_val.is_empty() {
                    match last_track {
                        LastTrackType::Audio(idx) => {
                            if idx < audio_tracks.len() {
                                audio_tracks[idx].title = Some(title_val);
                            }
                        }
                        LastTrackType::Subtitle(idx) => {
                            if idx < subtitle_tracks.len() {
                                subtitle_tracks[idx].title = Some(title_val);
                            }
                        }
                        LastTrackType::None => {}
                    }
                }
            }
        }

        let ext = Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("unknown")
            .to_lowercase();

        Ok(MediaProbeResult {
            file_path: file_path.to_string(),
            duration_seconds,
            format: ext,
            audio_tracks,
            subtitle_tracks,
            video_streams_count: video_count,
        })
    }

    fn parse_time_from_ffmpeg_output(text: &str) -> Option<(f64, String)> {
        let time_idx = text.find("time=")?;
        let after_time = &text[time_idx + 5..];
        let time_raw = after_time.trim_start().split_whitespace().next()?.trim();
        let parts: Vec<&str> = time_raw.split(':').collect();
        if parts.len() == 3 {
            let h = parts[0].parse::<f64>().ok()?;
            let m = parts[1].parse::<f64>().ok()?;
            let s = parts[2].parse::<f64>().ok()?;
            let secs = h * 3600.0 + m * 60.0 + s;
            let total_s = secs as u64;
            let formatted = format!("{:02}:{:02}:{:02}", total_s / 3600, (total_s % 3600) / 60, total_s % 60);
            Some((secs, formatted))
        } else {
            None
        }
    }

    fn parse_duration_from_ffmpeg_output(text: &str) -> Option<f64> {
        if let Some(dur_idx) = text.find("Duration:") {
            let after_dur = &text[dur_idx + 9..];
            let parts: Vec<&str> = after_dur.split(',').collect();
            if let Some(time_part) = parts.first() {
                let segs: Vec<&str> = time_part.trim().split(':').collect();
                if segs.len() == 3 {
                    let h = segs[0].parse::<f64>().ok()?;
                    let m = segs[1].parse::<f64>().ok()?;
                    let s = segs[2].parse::<f64>().ok()?;
                    return Some(h * 3600.0 + m * 60.0 + s);
                }
            }
        }
        None
    }

    pub fn extract_audio(
        app: &AppHandle,
        input_path: &str,
        track_index: usize,
        output_path: &str,
    ) -> Result<String, String> {
        let map_arg = format!("0:a:{}", track_index);

        let out_p = Path::new(output_path);
        if let Some(parent) = out_p.parent() {
            if !parent.exists() {
                let _ = std::fs::create_dir_all(parent);
            }
        }

        let ext = Path::new(output_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("m4a")
            .to_lowercase();

        let mut args = vec![
            "-y".to_string(),
            "-i".to_string(),
            input_path.to_string(),
            "-map".to_string(),
            map_arg,
            "-vn".to_string(),
            "-sn".to_string(),
            "-dn".to_string(),
        ];

        if ext == "m4a" || ext == "mp4" {
            args.extend(vec![
                "-c:a".to_string(), "aac".to_string(),
                "-b:a".to_string(), "192k".to_string(),
                "-ar".to_string(), "44100".to_string(),
                "-ac".to_string(), "2".to_string(),
                "-movflags".to_string(), "+faststart".to_string(),
            ]);
        } else if ext == "mp3" {
            args.extend(vec![
                "-c:a".to_string(), "libmp3lame".to_string(),
                "-q:a".to_string(), "2".to_string(),
                "-ar".to_string(), "44100".to_string(),
                "-ac".to_string(), "2".to_string(),
            ]);
        } else if ext == "wav" {
            args.extend(vec![
                "-c:a".to_string(), "pcm_s16le".to_string(),
                "-ar".to_string(), "44100".to_string(),
                "-ac".to_string(), "2".to_string(),
            ]);
        } else {
            args.extend(vec![
                "-c:a".to_string(), "aac".to_string(),
                "-b:a".to_string(), "192k".to_string(),
                "-ar".to_string(), "44100".to_string(),
                "-ac".to_string(), "2".to_string(),
            ]);
        }

        args.push(output_path.to_string());
        let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

        let initial_duration = Self::probe_file(app, input_path)
            .ok()
            .and_then(|p| p.duration_seconds)
            .unwrap_or(0.0);

        let _ = app.emit(
            "media-extraction-progress",
            ExtractionProgressPayload {
                progress: 0.05,
                message: "ffmpeg.exe 5% 00:00:00".into(),
                finished: false,
                error: None,
            },
        );

        let mut ran_sidecar = false;
        let mut sidecar_success = false;
        let mut last_time_display = "00:00:00".to_string();

        if let Ok(sidecar) = app.shell().sidecar("ffmpeg") {
            if let Ok((mut rx, _child)) = sidecar.args(&args_refs).spawn() {
                ran_sidecar = true;
                let mut total_duration = initial_duration;
                let mut last_emit = std::time::Instant::now();
                let mut last_pct = 5u32;

                tauri::async_runtime::block_on(async {
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stderr(bytes) => {
                                let text = String::from_utf8_lossy(&bytes);
                                for line in text.split(&['\r', '\n'][..]) {
                                    if total_duration <= 0.0 {
                                        if let Some(d) = Self::parse_duration_from_ffmpeg_output(line) {
                                            total_duration = d;
                                        }
                                    }
                                    if let Some((secs, formatted)) = Self::parse_time_from_ffmpeg_output(line) {
                                        last_time_display = formatted;
                                        let pct = if total_duration > 0.0 {
                                            ((secs / total_duration) * 100.0).clamp(1.0, 99.0).round() as u32
                                        } else {
                                            10
                                        };
                                        if pct != last_pct || last_emit.elapsed() >= std::time::Duration::from_millis(200) {
                                            last_pct = pct;
                                            last_emit = std::time::Instant::now();
                                            let msg = format!("ffmpeg.exe {}% {}", pct, last_time_display);
                                            let _ = app.emit(
                                                "media-extraction-progress",
                                                ExtractionProgressPayload {
                                                    progress: (pct as f64) / 100.0,
                                                    message: msg,
                                                    finished: false,
                                                    error: None,
                                                },
                                            );
                                        }
                                    }
                                }
                            }
                            CommandEvent::Terminated(term) => {
                                if term.code == Some(0) && Path::new(output_path).exists() {
                                    sidecar_success = true;
                                }
                            }
                            _ => {}
                        }
                    }
                });
            }
        }

        let output = if ran_sidecar && sidecar_success {
            Ok(output_path.to_string())
        } else {
            Self::run_system_extract_with_progress(app, &args_refs, output_path, initial_duration)
        };

        match output {
            Ok(path) => {
                let _ = app.emit(
                    "media-extraction-progress",
                    ExtractionProgressPayload {
                        progress: 1.0,
                        message: format!("ffmpeg.exe 100% {}", last_time_display),
                        finished: true,
                        error: None,
                    },
                );
                Ok(path)
            }
            Err(e) => {
                log::error!("[MediaProbe] Audio extraction failed for track index {}", track_index);
                let _ = app.emit(
                    "media-extraction-progress",
                    ExtractionProgressPayload {
                        progress: 0.0,
                        message: "ffmpeg.exe error".into(),
                        finished: true,
                        error: Some(e.clone()),
                    },
                );
                Err(e)
            }
        }
    }

    fn run_system_extract_with_progress(
        app: &AppHandle,
        args: &[&str],
        output_path: &str,
        mut total_duration: f64,
    ) -> Result<String, String> {
        let mut cmd = Command::new("ffmpeg");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        cmd.args(args);
        cmd.stderr(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::null());

        let mut child = cmd.spawn().map_err(|e| format!("System ffmpeg failed to spawn: {}", e))?;
        let mut last_emit = std::time::Instant::now();
        let mut last_pct = 5u32;
        let mut last_time_display = "00:00:00".to_string();

        if let Some(stderr) = child.stderr.take() {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stderr);
            for segment in reader.split(b'\r') {
                if let Ok(bytes) = segment {
                    let text = String::from_utf8_lossy(&bytes);
                    for line in text.split(&['\r', '\n'][..]) {
                        if total_duration <= 0.0 {
                            if let Some(d) = Self::parse_duration_from_ffmpeg_output(line) {
                                total_duration = d;
                            }
                        }
                        if let Some((secs, formatted)) = Self::parse_time_from_ffmpeg_output(line) {
                            last_time_display = formatted;
                            let pct = if total_duration > 0.0 {
                                ((secs / total_duration) * 100.0).clamp(1.0, 99.0).round() as u32
                            } else {
                                10
                            };
                            if pct != last_pct || last_emit.elapsed() >= std::time::Duration::from_millis(200) {
                                last_pct = pct;
                                last_emit = std::time::Instant::now();
                                let msg = format!("ffmpeg.exe {}% {}", pct, last_time_display);
                                let _ = app.emit(
                                    "media-extraction-progress",
                                    ExtractionProgressPayload {
                                        progress: (pct as f64) / 100.0,
                                        message: msg,
                                        finished: false,
                                        error: None,
                                    },
                                );
                            }
                        }
                    }
                }
            }
        }

        let status = child.wait().map_err(|e| format!("System ffmpeg process failed: {}", e))?;
        if status.success() && Path::new(output_path).exists() {
            Ok(output_path.to_string())
        } else {
            Err(format!("System ffmpeg failed with status {:?}", status.code()))
        }
    }

    fn run_system_extract(args: &[&str], output_path: &str) -> Result<String, String> {
        let mut cmd = Command::new("ffmpeg");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let child = cmd.args(args).output();

        match child {
            Ok(out) => {
                if out.status.success() {
                    Ok(output_path.to_string())
                } else {
                    Err(String::from_utf8_lossy(&out.stderr).to_string())
                }
            }
            Err(e) => Err(format!("System ffmpeg failed: {}", e)),
        }
    }

    pub fn extract_subtitle(
        app: &AppHandle,
        input_path: &str,
        track_index: usize,
    ) -> Result<String, String> {
        let in_p = Path::new(input_path);
        if !in_p.exists() {
            return Err(format!("Input file does not exist: {}", input_path));
        }

        let temp_dir = std::env::temp_dir();
        let pid = std::process::id();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let out_file = temp_dir.join(format!("subaka_sub_{}_{}_{}.srt", pid, track_index, now));
        let out_path = out_file.to_string_lossy().to_string();

        let map_arg = format!("0:s:{}", track_index);
        let args = [
            "-y",
            "-i",
            input_path,
            "-map",
            &map_arg,
            "-f",
            "srt",
            &out_path,
        ];

        let status = if let Ok(sidecar) = app.shell().sidecar("ffmpeg") {
            let res = tauri::async_runtime::block_on(sidecar.args(&args).output());
            match res {
                Ok(out) => {
                    if out.status.success() {
                        Ok(())
                    } else {
                        Err(String::from_utf8_lossy(&out.stderr).to_string())
                    }
                }
                Err(_) => Self::run_system_extract(&args, &out_path).map(|_| ()),
            }
        } else {
            Self::run_system_extract(&args, &out_path).map(|_| ())
        };

        match status {
            Ok(()) => {
                let content = std::fs::read(&out_file)
                    .map_err(|e| format!("Failed to read extracted subtitle file: {}", e))?;
                let _ = std::fs::remove_file(&out_file);
                Ok(crate::commands::decode_bytes_to_string(&content))
            }
            Err(e) => {
                let _ = std::fs::remove_file(&out_file);
                Err(format!("FFmpeg subtitle extraction failed: {}", e))
            }
        }
    }

    pub fn prepare_compatible_video(
        app: &AppHandle,
        input_path: &str,
        output_path: Option<String>,
    ) -> Result<String, String> {
        let in_p = Path::new(input_path);
        if !in_p.exists() {
            return Err(format!("Input file does not exist: {}", input_path));
        }

        let target_out_path = if let Some(out) = output_path {
            if !out.trim().is_empty() {
                out
            } else {
                Self::compute_cache_video_path(app, input_path)
            }
        } else {
            Self::compute_cache_video_path(app, input_path)
        };

        let mkv_out_path = target_out_path.replace(".mp4", ".mkv");

        // If either clean MP4 or clean MKV already exists and is non-empty, reuse it immediately
        let out_p = Path::new(&target_out_path);
        if out_p.exists() {
            if let Ok(meta) = std::fs::metadata(out_p) {
                if meta.len() > 64 * 1024 {
                    log::info!("[MediaProbe] Reusing existing clean video (MP4): {}", target_out_path);
                    return Ok(target_out_path);
                }
            }
        }

        let mkv_p = Path::new(&mkv_out_path);
        if mkv_p.exists() {
            if let Ok(meta) = std::fs::metadata(mkv_p) {
                if meta.len() > 64 * 1024 {
                    log::info!("[MediaProbe] Reusing existing clean video (MKV): {}", mkv_out_path);
                    return Ok(mkv_out_path);
                }
            }
        }

        // Concurrency guard: avoid launching multiple FFmpeg jobs for the exact same input file
        static ACTIVE_JOBS: std::sync::Mutex<Option<std::collections::HashSet<String>>> = std::sync::Mutex::new(None);
        let acquired = {
            let mut guard = ACTIVE_JOBS.lock().unwrap_or_else(|e| e.into_inner());
            let set = guard.get_or_insert_with(std::collections::HashSet::new);
            if set.contains(input_path) {
                false
            } else {
                set.insert(input_path.to_string());
                true
            }
        };

        if !acquired {
            log::info!("[MediaProbe] Another thread is preparing clean video for {}, waiting...", input_path);
            for _ in 0..120 {
                std::thread::sleep(std::time::Duration::from_millis(250));
                if Path::new(&target_out_path).exists() {
                    if let Ok(m) = std::fs::metadata(&target_out_path) {
                        if m.len() > 64 * 1024 {
                            return Ok(target_out_path);
                        }
                    }
                }
                if Path::new(&mkv_out_path).exists() {
                    if let Ok(m) = std::fs::metadata(&mkv_out_path) {
                        if m.len() > 64 * 1024 {
                            return Ok(mkv_out_path);
                        }
                    }
                }
                let still_active = {
                    let guard = ACTIVE_JOBS.lock().unwrap_or_else(|e| e.into_inner());
                    guard.as_ref().map(|s| s.contains(input_path)).unwrap_or(false)
                };
                if !still_active {
                    break;
                }
            }
            if Path::new(&target_out_path).exists() {
                return Ok(target_out_path);
            }
            if Path::new(&mkv_out_path).exists() {
                return Ok(mkv_out_path);
            }
        }

        struct JobGuard<'a>(&'a str);
        impl<'a> Drop for JobGuard<'a> {
            fn drop(&mut self) {
                if let Ok(mut guard) = ACTIVE_JOBS.lock() {
                    if let Some(set) = guard.as_mut() {
                        set.remove(self.0);
                    }
                }
            }
        }
        let _guard = JobGuard(input_path);

        if let Some(parent) = out_p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let pid = std::process::id();
        let temp_mp4_path = if target_out_path.ends_with(".mp4") {
            format!("{}_part_{}.mp4", &target_out_path[..target_out_path.len() - 4], pid)
        } else {
            format!("{}_part_{}.mp4", target_out_path, pid)
        };
        let temp_mkv_path = if mkv_out_path.ends_with(".mkv") {
            format!("{}_part_{}.mkv", &mkv_out_path[..mkv_out_path.len() - 4], pid)
        } else {
            format!("{}_part_{}.mkv", mkv_out_path, pid)
        };

        // Helper to run FFmpeg and return Ok(true) if the output file was successfully written and non-empty
        let run_cmd = |args: &[&str], out_file: &str| -> Result<(), String> {
            let status = if let Ok(sidecar) = app.shell().sidecar("ffmpeg") {
                let res = tauri::async_runtime::block_on(sidecar.args(args).output());
                match res {
                    Ok(out) => {
                        if out.status.success() {
                            Ok(())
                        } else {
                            Err(String::from_utf8_lossy(&out.stderr).to_string())
                        }
                    }
                    Err(_) => Self::run_system_extract(args, out_file).map(|_| ()),
                }
            } else {
                Self::run_system_extract(args, out_file).map(|_| ())
            };

            if status.is_ok() {
                if Path::new(out_file).exists() {
                    if let Ok(meta) = std::fs::metadata(out_file) {
                        if meta.len() > 32 * 1024 {
                            return Ok(());
                        }
                    }
                }
                let _ = std::fs::remove_file(out_file);
                Err("FFmpeg completed but output file is missing or zero-sized".into())
            } else {
                let _ = std::fs::remove_file(out_file);
                status
            }
        };

        // Attempt 1: Fast stream copy to MP4 (-map 0:v:0? -c:v copy -an -f mp4)
        let args_copy_mp4 = [
            "-y",
            "-i",
            input_path,
            "-map",
            "0:v:0?",
            "-c:v",
            "copy",
            "-an",
            "-sn",
            "-dn",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            &temp_mp4_path,
        ];

        match run_cmd(&args_copy_mp4, &temp_mp4_path) {
            Ok(()) => {
                let _ = std::fs::rename(&temp_mp4_path, &target_out_path);
                log::info!("[MediaProbe] Clean compatible video stream created (bitstream copy): {}", target_out_path);
                return Ok(target_out_path);
            }
            Err(e1) => {
                let _ = std::fs::remove_file(&temp_mp4_path);
                log::warn!("[MediaProbe] Direct stream copy to MP4 failed, trying MKV copy fallback: {}", e1);
            }
        }

        // Attempt 2: Stream copy to MKV container if MP4 muxing rejected the codec
        let args_copy_mkv = [
            "-y",
            "-i",
            input_path,
            "-map",
            "0:v:0?",
            "-c:v",
            "copy",
            "-an",
            "-sn",
            "-dn",
            "-f",
            "matroska",
            &temp_mkv_path,
        ];

        match run_cmd(&args_copy_mkv, &temp_mkv_path) {
            Ok(()) => {
                let _ = std::fs::rename(&temp_mkv_path, &mkv_out_path);
                log::info!("[MediaProbe] Clean compatible video stream created (MKV copy): {}", mkv_out_path);
                return Ok(mkv_out_path);
            }
            Err(e2) => {
                let _ = std::fs::remove_file(&temp_mkv_path);
                log::warn!("[MediaProbe] Stream copy to MKV failed, trying fast H.264 re-encode: {}", e2);
            }
        }

        // Attempt 3: Fast re-encode to H.264 MP4 with ultrafast preset if bitstream copy is impossible
        log::info!("[MediaProbe] Stream copy impossible, re-encoding video to fast H.264...");
        let args_reencode = [
            "-y",
            "-i",
            input_path,
            "-map",
            "0:v:0?",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "22",
            "-an",
            "-sn",
            "-dn",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            &temp_mp4_path,
        ];

        match run_cmd(&args_reencode, &temp_mp4_path) {
            Ok(()) => {
                let _ = std::fs::rename(&temp_mp4_path, &target_out_path);
                log::info!("[MediaProbe] Clean compatible video stream created (H.264 transcode): {}", target_out_path);
                Ok(target_out_path)
            }
            Err(e) => {
                let _ = std::fs::remove_file(&temp_mp4_path);
                log::error!("[MediaProbe] All video conversion attempts failed: {}", e);
                Err(e)
            }
        }
    }

    fn compute_cache_video_path(app: &AppHandle, input_path: &str) -> String {
        use std::hash::{Hash, Hasher, DefaultHasher};
        let mut hasher = DefaultHasher::new();
        input_path.hash(&mut hasher);
        if let Ok(meta) = std::fs::metadata(input_path) {
            meta.len().hash(&mut hasher);
        }
        let hash = hasher.finish();

        let base_dir = app.path().app_cache_dir()
            .or_else(|_| app.path().app_local_data_dir().map(|d| d.join("cache")))
            .unwrap_or_else(|_| std::env::temp_dir());

        let out_file = base_dir.join(format!("clean_video_{:x}.mp4", hash));
        out_file.to_string_lossy().to_string()
    }
}
