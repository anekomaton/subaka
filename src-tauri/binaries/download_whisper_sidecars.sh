#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RES_DIR="$(cd "$DIR/../resources" && pwd)"
mkdir -p "$RES_DIR"

WHISPER_EXE="$RES_DIR/whisper.exe"
MODEL_FILE="$RES_DIR/ggml-small.bin"

if [ ! -f "$WHISPER_EXE" ] || [ "$(wc -c < "$WHISPER_EXE" 2>/dev/null || echo 0)" -lt 100000 ]; then
    echo "Downloading Whisper binary into resources..."
    ZIP_TARGET="$RES_DIR/whisper-bin-x64.zip"
    curl -f -L --retry 5 "https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.4/whisper-bin-x64.zip" -o "$ZIP_TARGET" || true
    if [ -f "$ZIP_TARGET" ]; then
        unzip -o "$ZIP_TARGET" -d "$RES_DIR" || true
        rm -f "$ZIP_TARGET"
        if [ -f "$RES_DIR/whisper-cli.exe" ]; then
            mv "$RES_DIR/whisper-cli.exe" "$WHISPER_EXE"
        elif [ -f "$RES_DIR/main.exe" ]; then
            mv "$RES_DIR/main.exe" "$WHISPER_EXE"
        fi
    fi
fi

if [ ! -f "$MODEL_FILE" ] || [ "$(wc -c < "$MODEL_FILE" 2>/dev/null || echo 0)" -lt 10000000 ]; then
    echo "Downloading ggml-small.bin model into resources..."
    curl -f -L --retry 5 "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" -o "$MODEL_FILE" || true
fi

if [ -f "$WHISPER_EXE" ]; then
    chmod +x "$WHISPER_EXE" 2>/dev/null || true
    echo "Whisper binary ready: $WHISPER_EXE"
fi

if [ -f "$MODEL_FILE" ]; then
    echo "Whisper GGML model ready: $MODEL_FILE"
fi
