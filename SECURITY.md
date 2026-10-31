# Security Policy for SUBaka

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0.0 | :x:                |

---

## Reporting a Vulnerability

If you discover a potential security vulnerability in **SUBaka**, please report it responsibly:

- **Email:** Create a GitHub Issue tagged with `security` or contact the maintainer directly via GitHub repository issues.
- **Response Time:** We aim to acknowledge reports within 48 hours and provide a patch/mitigation timeline promptly.

Please do not disclose potential security issues publicly until we have evaluated and addressed the report.

---

## Security Architecture & Design Principles

### 1. Local-First & Offline Architecture
SUBaka is built with a **Local-First / Privacy-First** philosophy:
- All core linguistic databases (**GrammarDB** containing 2.38M Belarusian word forms, **VerbumDB** digital dictionaries, and **BelG2P** phonetic rules) operate 100% offline via embedded SQLite inside the application.
- Your subtitles, video media files, and project data are processed locally and never uploaded to third-party telemetry or analytics servers.
- Network connections are established **only** when explicitly using AI features (Gemini API for translation/proofreading, Google TTS audio synthesis, or online dictionary search).

---

### 2. Windows Installation Path & Permissions Rationale

During installation on Microsoft Windows, SUBaka installs by default to the user profile directory:
`%LOCALAPPDATA%\Programs\SUBaka` (per-user installation mode).

#### Why this installation path is chosen:
1. **Least Privilege Principle (No Admin Rights Needed):** Installing to `%LOCALAPPDATA%` does not require Windows Administrator privileges (UAC elevation). This ensures that SUBaka runs with standard user rights and cannot modify critical system files or system registry hives (`HKLM`).
2. **User Data Isolation:** The application code, local databases, and temporary caches remain fully isolated within the authenticated Windows user profile, preventing unauthorized access from other non-administrator accounts on the same machine.
3. **Seamless Updates:** Per-user installation allows application updates without prompting for administrative UAC credentials.

*Note: If you specifically require installation into `C:\Program Files\`, simply run the installer (`SUBaka_1.0.0_x64-setup.exe`) via **Right Click -> "Run as Administrator"**.*

---

### 3. Process Isolation & Binary Sidecars

- **FFmpeg Integration:** Audio extraction and media probing utilize an isolated `externalBin` sidecar binary (`ffmpeg`).
- **Command Injection Prevention:** All system invocations in the Rust desktop layer (`src-tauri/src/commands.rs`) use parameterized argument arrays (`std::process::Command::new().args([...])`) instead of passing raw string commands to `cmd.exe` or `powershell.exe`. This completely eliminates command injection vectors.
- **Silent Background Execution:** Commands use the Windows `CREATE_NO_WINDOW` flag (`0x08000000`) to prevent unprivileged command prompt windows from spawning.

---

### 4. Input Sanitization & Anti-XSS Measures

- Subtitle files (`.srt`, `.ass`) often contain styling tags or raw text from external sources.
- Before rendering inside the WebView2 runtime, all subtitle strings are sanitized via `stripSrtTags` and strict HTML escaping.
- Inline JavaScript execution inside rendered cards is blocked, protecting the application against malicious cross-site scripting (XSS) via specially crafted subtitle files.

---

### 5. API Key Protection & Network Privacy

- **Gemini API Key:** Stored locally in the WebView2 user profile storage (`%LOCALAPPDATA%\com.subaka.desktop\EBWebView`).
- **Direct Endpoints:** API requests are sent directly to official Google API endpoints (`generativelanguage.googleapis.com`) using TLS 1.2/1.3 encrypted HTTPS. No intermediate proxy servers collect or inspect your API key or subtitle content.
- **Analytics & Web Telemetry:**
  - **Desktop Build (Tauri):** Google Analytics and tracking scripts are dynamically disabled and NOT loaded in desktop mode.
  - **Web Version (`subaka.ai.studio`):** Standard Google Analytics (`gtag.js`, `G-HFXMLHR2W4`) is used solely for measuring aggregate web visitor traffic. Subtitle content, media files, and API keys are strictly excluded from analytics.
- **Advertising:** Zero ad networks or tracking cookies exist in either version.
