#!/usr/bin/env bash
set -e

# Script to fetch static FFmpeg builds for the current build target triplet
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "Detecting host architecture..."
ARCH="$(uname -m)"
OS="$(uname -s)"

if [ "$OS" = "Linux" ]; then
    TARGET="ffmpeg-x86_64-unknown-linux-gnu"
    echo "Downloading static FFmpeg for Linux ($TARGET)..."
    curl -L "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/linux-x64" -o "$TARGET"
    chmod +x "$TARGET"
    echo "Successfully downloaded $TARGET"
elif [ "$OS" = "Darwin" ]; then
    if [ "$ARCH" = "arm64" ]; then
        TARGET="ffmpeg-aarch64-apple-darwin"
        echo "Downloading static FFmpeg for macOS ARM64 ($TARGET)..."
        curl -L "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/darwin-arm64" -o "$TARGET"
    else
        TARGET="ffmpeg-x86_64-apple-darwin"
        echo "Downloading static FFmpeg for macOS x64 ($TARGET)..."
        curl -L "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/darwin-x64" -o "$TARGET"
    fi
    chmod +x "$TARGET"
    echo "Successfully downloaded $TARGET"
elif [[ "$OS" == *"MINGW"* ]] || [[ "$OS" == *"MSYS"* ]] || [[ "$OS" == *"CYGWIN"* ]]; then
    TARGET="ffmpeg-x86_64-pc-windows-msvc.exe"
    echo "Downloading static FFmpeg for Windows ($TARGET)..."
    curl -L "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/win32-x64" -o "$TARGET"
    echo "Successfully downloaded $TARGET"
else
    echo "Unsupported OS: $OS. Please download FFmpeg binary manually."
fi
