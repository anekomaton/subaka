use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use tauri::{AppHandle, Emitter};
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
        let args = vec![
            "-y",
            "-i",
            input_path,
            "-map",
            &map_arg,
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            output_path,
        ];

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
            let res = tauri::async_runtime::block_on(sidecar.args(&args).output());
            match res {
                Ok(out) => {
                    if out.status.success() {
                        Ok(output_path.to_string())
                    } else {
                        Err(String::from_utf8_lossy(&out.stderr).to_string())
                    }
                }
                Err(_) => Self::run_system_extract(&args, output_path),
            }
        } else {
            Self::run_system_extract(&args, output_path)
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
}
