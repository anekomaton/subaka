#!/usr/bin/env bash
set -e

# Script to fetch static FFmpeg builds for Tauri externalBin sidecars
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

REQUESTED_TARGET="$1"

if [ -n "$REQUESTED_TARGET" ]; then
    echo "Using requested target: $REQUESTED_TARGET"
    case "$REQUESTED_TARGET" in
        *aarch64-apple-darwin*)
            TARGET="ffmpeg-aarch64-apple-darwin"
            URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64"
            ;;
        *x86_64-apple-darwin*)
            TARGET="ffmpeg-x86_64-apple-darwin"
            URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-x64"
            ;;
        *x86_64-unknown-linux*)
            TARGET="ffmpeg-x86_64-unknown-linux-gnu"
            URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64"
            ;;
        *windows*|*pc-windows-msvc*)
            TARGET="ffmpeg-x86_64-pc-windows-msvc.exe"
            URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64"
            ;;
        *)
            echo "Unknown target '$REQUESTED_TARGET', attempting auto-detection..."
            ;;
    esac
fi

if [ -z "$TARGET" ]; then
    ARCH="$(uname -m)"
    OS="$(uname -s)"
    echo "Detecting host architecture: OS=$OS, ARCH=$ARCH"

    if [ "$OS" = "Linux" ]; then
        TARGET="ffmpeg-x86_64-unknown-linux-gnu"
        URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64"
    elif [ "$OS" = "Darwin" ]; then
        if [ "$ARCH" = "arm64" ]; then
            TARGET="ffmpeg-aarch64-apple-darwin"
            URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64"
        else
            TARGET="ffmpeg-x86_64-apple-darwin"
            URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-x64"
        fi
    elif [[ "$OS" == *"MINGW"* ]] || [[ "$OS" == *"MSYS"* ]] || [[ "$OS" == *"CYGWIN"* ]] || [[ "$OS" == *"Windows"* ]]; then
        TARGET="ffmpeg-x86_64-pc-windows-msvc.exe"
        URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64"
    else
        echo "Error: Unsupported OS '$OS'. Cannot automatically determine FFmpeg binary."
        exit 1
    fi
fi

# Check if valid binary already exists (> 5 MB)
if [ -f "$TARGET" ] && [ "$(wc -c < "$TARGET" 2>/dev/null || stat -c%s "$TARGET" 2>/dev/null || echo 0)" -gt 5000000 ]; then
    echo "FFmpeg binary $TARGET already exists and is valid. Skipping download."
    chmod +x "$TARGET" 2>/dev/null || true
    exit 0
fi

echo "Downloading FFmpeg sidecar: $TARGET from $URL..."
# Remove any corrupted or stub files first
rm -f "$TARGET"
curl -f -L --retry 3 --retry-delay 2 "$URL" -o "$TARGET"

if [ ! -s "$TARGET" ]; then
    echo "Error: Downloaded file $TARGET is empty!"
    exit 1
fi

chmod +x "$TARGET" 2>/dev/null || true
echo "Successfully downloaded $TARGET ($(du -h "$TARGET" 2>/dev/null | cut -f1 || echo 'ok'))"
