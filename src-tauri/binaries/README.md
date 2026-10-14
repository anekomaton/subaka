# FFmpeg Sidecar Binaries for Subaka Desktop

Tauri bundles native sidecar binaries per target platform architecture.
Subaka uses FFmpeg as a sidecar to perform instant local audio stream probing and extraction from multi-audio MKV/MP4 files without WebAssembly memory limits.

## Target Triplet Naming Convention

When running `tauri build`, Tauri searches for sidecars with the target triplet suffix in this directory:

- **Windows (x64)**: `ffmpeg-x86_64-pc-windows-msvc.exe`
- **Linux (x64)**: `ffmpeg-x86_64-unknown-linux-gnu`
- **macOS (Apple Silicon - M1/M2/M3/M4)**: `ffmpeg-aarch64-apple-darwin`
- **macOS (Intel - x86_64)**: `ffmpeg-x86_64-apple-darwin`

## Automated Download Scripts

Run the helper scripts in this directory or in CI/CD before building release installers:
- Linux / macOS: `bash download_ffmpeg_sidecars.sh`
- Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File download_ffmpeg_sidecars.ps1`
