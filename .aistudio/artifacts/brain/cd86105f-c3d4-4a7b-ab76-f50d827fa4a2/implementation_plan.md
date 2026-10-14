# Subaka Desktop (Tauri v2 Edition)

Cross-platform native desktop application for subtitle editing, synchronized video playback, Belarusian linguistic validation with GrammarDB, and audio transcription powered by Tauri v2 with native Rust and bundled FFmpeg.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural parameters were confirmed during the initial interview:
> - **Backend Architecture**: Native Rust commands with direct SQLite connection (`rusqlite`) for instant, zero-latency GrammarDB queries without requiring Node.js on the client machine.
> - **Media Engine**: Bundled native FFmpeg binary executed as a Tauri sidecar (`tauri-plugin-shell`), ensuring maximum audio extraction speed and handling large files without browser memory constraints.
> - **Platform Targets**: Cross-platform releases with native installers for Windows (`.msi` / `.exe`), macOS (`.dmg` / universal binary), and Linux (`.deb` / `AppImage`).

- **Confirmed Decision 1 (Rust SQLite)**: The GrammarDB database (`grammardb.sqlite3`, ~2.01 million word forms across 17 grammatical classes) will be accessed directly by Rust via memory-mapped SQLite connections, removing the need for a background Node.js/Express server.
- **Confirmed Decision 2 (Bundled FFmpeg Sidecar)**: Instead of WebAssembly memory limitations (2GB max) or requiring manual FFmpeg installation by the user, platform-specific FFmpeg binaries will be bundled into the application bundle as a managed Tauri sidecar.
- **Confirmed Decision 3 (Cross-Platform Pipeline)**: Build definitions and configurations will support cross-compilation and automated release packaging for Windows (x64), macOS (Apple Silicon + Intel), and Linux (x64).

---

## 1. Overview & Core Concept

- **What It Does**: Subaka Desktop brings the full web suite of Subaka—interactive waveform timeline, synchronized video playback, dual-subtitle track synchronization, Belarusian GrammarDB validation, stress markers, dialectal replacements, and automated AI transcription—into a lightweight, standalone desktop executable.
- **Target Audience / Persona**: Translators, subtitle editors, dubbing artists, content creators, and cultural archivists working with Belarusian video content who need high-performance local video processing, offline dictionary lookups, and instant file saving.
- **Key Value**:
  - **Zero System Prerequisites**: Users do not need Node.js, Python, or command-line FFmpeg installed.
  - **Instant Startup & Low Footprint**: Tauri utilizes the OS native WebView (WebView2 on Windows, WebKit on macOS, WebKitGTK on Linux), resulting in a compact application bundle (~15MB installer + database/sidecars) and low RAM usage.
  - **Native File System & Large File Handling**: Directly stream or inspect 4K / multi-gigabyte MKV/MP4 files from disk without browser sandbox file cloning delays.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Launch & Workspace Setup**:
   - The user opens Subaka Desktop. On first launch, the local GrammarDB status is verified; if missing, an unobtrusive background bootstrap prepares the SQLite database in the local app directory.
   - Drag-and-drop video/audio or subtitle files directly onto the app window or click "Адкрыць медыя" / "Адкрыць субтытры" using native OS file dialogs (`@tauri-apps/plugin-dialog`).
2. **Timeline Editing & Multi-Track Audio**:
   - The player displays the video canvas alongside the high-performance waveform visualizer.
   - When opening multi-audio MKV files, the native FFmpeg probe instantly extracts stream information, and audio extraction happens in seconds via the native sidecar with live percentage progress in the status bar.
3. **Grammar & Spellchecking Operations**:
   - Clicking on words or running automatic subtitle validation sends commands directly to Rust via Tauri IPC (`invoke('lookup_word')`), returning lemma, part of speech, and stress markup in sub-millisecond time.
4. **Export & Autosave**:
   - Instant file overwrite or export (`.srt`, `.vtt`, `.ass`, or burned-in subtitles) without browser download prompts, utilizing native file save locations and session auto-recovery.

### Visual Identity & Theme

- **Aesthetic Direction**: Utilitarian, precision-focused media workstation adhering to dark slate workspace standards. High information density without visual clutter.
- **Color Palette & Mood**:
  - Workspace Base: `#0F172A` (Slate 950 deep canvas), `#1E293B` (Slate 800 panel elevations).
  - Accents: `#38BDF8` (Sky blue primary timeline cursor), `#3B82F6` (Electric cobalt active selections).
  - Status Semantics: Emerald (`#10B981` validated forms / ready), Amber (`#F59E0B` unknown token / warning), Crimson (`#EF4444` timing collision / parse error).
- **Typography & Hierarchy**:
  - Primary UI: Clean contemporary geometric sans (`Plus Jakarta Sans` / `Inter`), crisp at 12px–14px sizes.
  - Metrics & Timestamps: Strict monospace tabular figures (`font-mono`, `tabular-nums`) for frame times (`00:01:24,350`), bitrates, and waveform zoom levels.
- **Window Chrome & Native Integration**:
  - Modern borderless or native titlebar with custom accent frame matching the theme.
  - Native OS menus (File, Edit, Subtitles, Audio Tracks, View, Help) with standard keyboard shortcuts (Space for Play/Pause, Ctrl+Z / Cmd+Z for Undo).

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Tauri v2 over Electron
- **Chosen Approach**: Tauri v2 with Rust backend.
- **Why**: Electron bundles a full Chromium instance and Node.js runtime, producing ~150MB+ bundle sizes and high baseline memory usage (300MB+ idle). Tauri v2 produces ~10-15MB binaries, boots in under 300ms, and runs on <60MB baseline RAM.
- **Trade-Off**: Requires writing native Rust bridge commands for file streaming and SQLite rather than reusing Node.js Express server routes as-is.

### Decision 2: Native Rust SQLite vs. Client WASM SQLite
- **Chosen Approach**: Native Rust SQLite connection with `rusqlite` using WAL mode and prepared statements.
- **Why**: GrammarDB contains over 2 million words. In WebAssembly, loading a 150MB+ SQLite database requires copying it entirely into browser memory and causes garbage collection pauses. In Rust, SQLite opens in-place on disk with memory-mapping (`PRAGMA mmap_size = 268435456`), giving instant cold-boot queries.
- **Alternatives Considered**: Tauri SQLite plugin from JS (adds serialization overhead); Rust IPC commands provide typed, structured structs directly to TypeScript.

### Decision 3: FFmpeg Native Sidecar vs. FFmpeg WASM
- **Chosen Approach**: Bundled FFmpeg static binary as a Tauri sidecar executed via `tauri-plugin-shell`.
- **Why**: FFmpeg WASM is limited to 2GB files in 32-bit memory space and lacks hardware decoding acceleration. A native FFmpeg binary runs multithreaded at native CPU speed and can process multi-gigabyte MKV/MP4 files in seconds.

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SUBAKA DESKTOP FRONTEND                         │
│  (React 19 + TypeScript + Tailwind CSS + Lucide + HTML5 Video Canvas)  │
│                                                                        │
│  ┌──────────────────────┐  ┌───────────────────┐  ┌─────────────────┐ │
│  │   Timeline Player    │  │  Subtitle Table   │  │  Grammar Panel  │ │
│  │  (Waveform, Canvas)  │  │ (Virtual Scroller)│  │ (Lemma, Stress) │ │
│  └──────────┬───────────┘  └─────────┬─────────┘  └────────┬────────┘ │
└─────────────┼────────────────────────┼─────────────────────┼──────────┘
              │                        │                     │
              ▼                        ▼                     ▼
       ┌────────────────────────────────────────────────────────────┐
       │             TAURI IPC BRIDGE (tauri::invoke)               │
       └──────────────────────────────┬─────────────────────────────┘
                                      │
┌─────────────────────────────────────┼───────────────────────────────────┐
│ TAURI RUST CORE (src-tauri)         │                                   │
│                                     ▼                                   │
│  ┌─────────────────────────┐  ┌────────────────────────┐  ┌──────────┐  │
│  │     GrammarDB Bridge    │  │    Media & Sidecar     │  │ OS Files │  │
│  │     (rusqlite engine)   │  │  (FFmpeg sidecar exec) │  │ & Dialog │  │
│  └───────────┬─────────────┘  └───────────┬────────────┘  └────┬─────┘  │
└──────────────┼────────────────────────────┼────────────────────┼────────┘
               ▼                            ▼                    ▼
     ┌───────────────────┐        ┌──────────────────┐    ┌─────────────┐
     │ grammardb.sqlite3 │        │  ffmpeg static   │    │ File System │
     │  (OS AppData Dir) │        │  (Sidecar Bin)   │    │ (.srt, .mkv)│
     └───────────────────┘        └──────────────────┘    └─────────────┘
```

### IPC Command Interface Mapping

| Tauri Command (`invoke`) | Arguments | Return Type | Description |
| :--- | :--- | :--- | :--- |
| `lookup_grammar_word` | `{ word: string }` | `GrammarWordInfo[]` | Queries SQLite for lemmas, grammatical codes, and stress variants. |
| `batch_check_words` | `{ words: string[] }` | `Record<string, boolean>` | High-speed batch validation of subtitle tokens. |
| `probe_media_streams` | `{ filePath: string }` | `MediaStreamInfo` | Calls FFmpeg probe to discover audio tracks, codecs, and metadata. |
| `extract_audio_track` | `{ inputPath: string, trackIdx: number, outputPath: string }` | `ExtractionProgress` | Sidecar FFmpeg execution streaming progress events to UI. |
| `open_file_dialog` | `{ filters: Filter[] }` | `string | null` | Native OS file picker dialog for media or subtitle files. |
| `save_subtitle_file` | `{ filePath: string, content: string }` | `void` | Direct atomic file save to user-selected location. |

### Project Directory Structure for Tauri

```
subaka/
├── src/                          # Existing React Frontend
│   ├── components/               # Subtitle table, timeline player, modals
│   ├── utils/                    # Subtitle parsers, translation logic
│   └── tauriBridge.ts            # Adaptor layer (switches between Tauri IPC & Web fallback)
├── src-tauri/                    # Rust Tauri Desktop Application
│   ├── Cargo.toml                # Rust dependencies (tauri, rusqlite, serde)
│   ├── tauri.conf.json           # Window properties, sidecar declarations, bundle IDs
│   ├── capabilities/             # Tauri v2 security permission policies
│   ├── binaries/                 # FFmpeg sidecars per target triplet
│   │   ├── ffmpeg-x86_64-pc-windows-msvc.exe
│   │   ├── ffmpeg-x86_64-unknown-linux-gnu
│   │   └── ffmpeg-aarch64-apple-darwin
│   └── src/
│       ├── main.rs               # Tauri entrypoint and plugin registration
│       ├── grammar_db.rs         # rusqlite connection and query routines
│       ├── media_probe.rs        # FFmpeg sidecar controller and stream parsing
│       └── commands.rs           # #[tauri::command] handlers
└── package.json                  # Scripts: dev, build, tauri:dev, tauri:build
```

### Phased Execution Steps

1. **Phase 1: Tauri Scaffold & Project Setup**:
   - Initialize `@tauri-apps/cli` and `src-tauri` workspace configuration compatible with Vite.
   - Configure window sizing, minimum constraints (1024x700), theme defaults, and title.
2. **Phase 2: Rust SQLite GrammarDB Module**:
   - Implement `grammar_db.rs` with embedded fallback or auto-bootstrap logic to locate `grammardb.sqlite3` in the application data directory.
   - Implement high-speed lookup commands and add unit tests in Rust.
3. **Phase 3: FFmpeg Sidecar & Media Extraction**:
   - Configure sidecar declarations in `tauri.conf.json`.
   - Implement Rust wrapper for audio stream discovery and track extraction with asynchronous progress reporting over Tauri events.
4. **Phase 4: Frontend Tauri Bridge & Adaptor**:
   - Implement `src/utils/tauriBridge.ts` so the frontend gracefully uses native Tauri IPC when running inside the desktop app, while preserving web browser capability.
5. **Phase 5: Packaging & Cross-Platform CI**:
   - Configure installer settings (WiX/NSIS for Windows, DMG for macOS, Debian/AppImage for Linux).
   - Configure automated GitHub Actions workflow to build release binaries for all target platforms.
