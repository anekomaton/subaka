use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaProbeResult {
    pub file_path: String,
    pub duration_seconds: Option<f64>,
    pub format: String,
    pub audio_tracks: Vec<AudioTrackInfo>,
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
        let mut duration_seconds = None;
        let mut video_count = 0;

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

            // Parse Stream line: "Stream #0:1(bel): Audio: aac, 48000 Hz, stereo, fltp"
            if trimmed.contains("Stream #") && trimmed.contains("Audio:") {
                let stream_idx = audio_tracks.len();
                let mut lang = None;
                if let Some(paren_start) = trimmed.find('(') {
                    if let Some(paren_end) = trimmed[paren_start..].find(')') {
                        lang = Some(trimmed[paren_start + 1..paren_start + paren_end].to_string());
                    }
                }

                let codec = if let Some(audio_idx) = trimmed.find("Audio:") {
                    let after_audio = &trimmed[audio_idx + 6..];
                    after_audio.split(',').next().unwrap_or("unknown").trim().to_string()
                } else {
                    "unknown".to_string()
                };

                let channels = if trimmed.contains("stereo") {
                    2
                } else if trimmed.contains("5.1") {
                    6
                } else {
                    1
                };

                let sample_rate = if let Some(hz_idx) = trimmed.find("Hz") {
                    let before_hz = &trimmed[..hz_idx];
                    before_hz.split(',').last().unwrap_or("").trim().parse::<u32>().unwrap_or(44100)
                } else {
                    44100
                };

                audio_tracks.push(AudioTrackInfo {
                    index: stream_idx,
                    stream_index: stream_idx + 1,
                    codec,
                    channels,
                    sample_rate,
                    language: lang,
                    title: None,
                });
            } else if trimmed.contains("Stream #") && trimmed.contains("Video:") {
                video_count += 1;
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
            video_streams_count: video_count,
        })
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

        let _ = app.emit(
            "media-extraction-progress",
            ExtractionProgressPayload {
                progress: 0.1,
                message: "Starting audio extraction with FFmpeg sidecar...".into(),
                finished: false,
                error: None,
            },
        );

        // Try sidecar first, fallback to system ffmpeg
        let output = if let Ok(sidecar) = app.shell().sidecar("ffmpeg") {
            let res = tauri::async_runtime::block_on(sidecar.args(&args_refs).output());
            match res {
                Ok(out) => {
                    if out.status.success() {
                        Ok(output_path.to_string())
                    } else {
                        Err(String::from_utf8_lossy(&out.stderr).to_string())
                    }
                }
                Err(_) => Self::run_system_extract(&args_refs, output_path),
            }
        } else {
            Self::run_system_extract(&args_refs, output_path)
        };

        match output {
            Ok(path) => {
                let _ = app.emit(
                    "media-extraction-progress",
                    ExtractionProgressPayload {
                        progress: 1.0,
                        message: "Audio extraction complete".into(),
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
                        message: "Audio extraction failed".into(),
                        finished: true,
                        error: Some(e.clone()),
                    },
                );
                Err(e)
            }
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

        let out_p = Path::new(&target_out_path);

        if out_p.exists() {
            if let Ok(meta) = std::fs::metadata(out_p) {
                if meta.len() > 1024 * 1024 {
                    log::info!("[MediaProbe] Reusing existing clean video: {}", target_out_path);
                    return Ok(target_out_path);
                }
            }
        }

        if let Some(parent) = out_p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        // Attempt 1: Fast stream copy to MP4 (-map 0:v:0? -c:v copy -an)
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
            &target_out_path,
        ];

        let run_cmd = |args: &[&str]| -> Result<String, String> {
            if let Ok(sidecar) = app.shell().sidecar("ffmpeg") {
                let res = tauri::async_runtime::block_on(sidecar.args(args).output());
                match res {
                    Ok(out) => {
                        if out.status.success() {
                            Ok(target_out_path.clone())
                        } else {
                            Err(String::from_utf8_lossy(&out.stderr).to_string())
                        }
                    }
                    Err(_) => Self::run_system_extract(args, &target_out_path),
                }
            } else {
                Self::run_system_extract(args, &target_out_path)
            }
        };

        match run_cmd(&args_copy_mp4) {
            Ok(path) => {
                log::info!("[MediaProbe] Clean compatible video stream created (bitstream copy): {}", path);
                return Ok(path);
            }
            Err(e1) => {
                log::warn!("[MediaProbe] Direct stream copy to MP4 failed, trying MKV copy fallback: {}", e1);
            }
        }

        // Attempt 2: Stream copy to MKV container if MP4 muxing rejected the codec
        let mkv_out_path = target_out_path.replace(".mp4", ".mkv");
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
            &mkv_out_path,
        ];

        if let Ok(_) = run_cmd(&args_copy_mkv) {
            if Path::new(&mkv_out_path).exists() {
                log::info!("[MediaProbe] Clean compatible video stream created (MKV copy): {}", mkv_out_path);
                return Ok(mkv_out_path);
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
            &target_out_path,
        ];

        match run_cmd(&args_reencode) {
            Ok(path) => {
                log::info!("[MediaProbe] Clean compatible video stream created (H.264 transcode): {}", path);
                Ok(path)
            }
            Err(e) => {
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
