#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RES_DIR="$(cd "$DIR/../resources" && pwd)"
mkdir -p "$RES_DIR"

WHISPER_EXE="$RES_DIR/whisper.exe"
CUDA_EXE="$RES_DIR/whisper-cuda.exe"
MODEL_FILE="$RES_DIR/ggml-small.bin"

# 1. Download CUDA cuBLAS Whisper binary + DLLs
if [ ! -f "$CUDA_EXE" ] || [ "$(wc -c < "$CUDA_EXE" 2>/dev/null || echo 0)" -lt 100000 ]; then
    echo "Downloading CUDA cuBLAS Whisper binary into resources..."
    ZIP_CUDA="$RES_DIR/whisper-cublas-x64.zip"
    TEMP_CUDA="$RES_DIR/temp_cuda"
    
    CUDA_URLS=(
        "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-cublas-12.4.0-bin-x64.zip"
        "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-cublas-11.8.0-bin-x64.zip"
        "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-cublas-12.4.0-bin-x64.zip"
    )

    for curl_url in "${CUDA_URLS[@]}"; do
        echo "Attempting CUDA download from $curl_url..."
        if curl -s -S -f -L --retry 5 -H "User-Agent: Mozilla/5.0" "$curl_url" -o "$ZIP_CUDA"; then
            if [ -f "$ZIP_CUDA" ] && [ "$(wc -c < "$ZIP_CUDA" 2>/dev/null || echo 0)" -gt 1000000 ]; then
                break
            fi
        fi
    done

    if [ -f "$ZIP_CUDA" ] && [ "$(wc -c < "$ZIP_CUDA" 2>/dev/null || echo 0)" -gt 1000000 ]; then
        mkdir -p "$TEMP_CUDA"
        unzip -o "$ZIP_CUDA" -d "$TEMP_CUDA" || true
        rm -f "$ZIP_CUDA"
        FOUND_CLI="$(find "$TEMP_CUDA" -type f \( -name "whisper-cli.exe" -o -name "main.exe" -o -name "whisper.exe" \) | head -n 1)"
        if [ -n "$FOUND_CLI" ]; then
            cp "$FOUND_CLI" "$CUDA_EXE"
            echo "Extracted CUDA binary: $CUDA_EXE"
        fi
        # Copy all DLLs (whisper.dll, ggml*.dll, cublas*.dll, etc.)
        find "$TEMP_CUDA" -type f -name "*.dll" -exec cp {} "$RES_DIR/" \; 2>/dev/null || true
        rm -rf "$TEMP_CUDA"
    fi
fi

# 2. Download standard Whisper CPU binary + CPU DLLs
if [ ! -f "$WHISPER_EXE" ] || [ "$(wc -c < "$WHISPER_EXE" 2>/dev/null || echo 0)" -lt 100000 ]; then
    echo "Downloading standard Whisper binary into resources..."
    ZIP_CPU="$RES_DIR/whisper-bin-x64.zip"
    TEMP_CPU="$RES_DIR/temp_cpu"

    CPU_URLS=(
        "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip"
        "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip"
    )

    for cpu_url in "${CPU_URLS[@]}"; do
        echo "Attempting CPU download from $cpu_url..."
        if curl -s -S -f -L --retry 5 -H "User-Agent: Mozilla/5.0" "$cpu_url" -o "$ZIP_CPU"; then
            if [ -f "$ZIP_CPU" ] && [ "$(wc -c < "$ZIP_CPU" 2>/dev/null || echo 0)" -gt 500000 ]; then
                break
            fi
        fi
    done

    if [ -f "$ZIP_CPU" ] && [ "$(wc -c < "$ZIP_CPU" 2>/dev/null || echo 0)" -gt 500000 ]; then
        mkdir -p "$TEMP_CPU"
        unzip -o "$ZIP_CPU" -d "$TEMP_CPU" || true
        rm -f "$ZIP_CPU"
        FOUND_CLI="$(find "$TEMP_CPU" -type f \( -name "whisper-cli.exe" -o -name "main.exe" -o -name "whisper.exe" \) | head -n 1)"
        if [ -n "$FOUND_CLI" ]; then
            cp "$FOUND_CLI" "$WHISPER_EXE"
            echo "Extracted CPU binary: $WHISPER_EXE"
        fi
        # Copy all CPU DLLs (whisper.dll, ggml*.dll, SDL2.dll)
        find "$TEMP_CPU" -type f -name "*.dll" -exec cp {} "$RES_DIR/" \; 2>/dev/null || true
        rm -rf "$TEMP_CPU"
    fi
fi

# 3. Download ggml-small.bin model
if [ ! -f "$MODEL_FILE" ] || [ "$(wc -c < "$MODEL_FILE" 2>/dev/null || echo 0)" -lt 10000000 ]; then
    echo "Downloading ggml-small.bin model into resources..."
    curl -f -L --retry 5 -H "User-Agent: Mozilla/5.0" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" -o "$MODEL_FILE" || true
fi

if [ -f "$WHISPER_EXE" ]; then
    chmod +x "$WHISPER_EXE" 2>/dev/null || true
    echo "Whisper CPU binary ready: $WHISPER_EXE"
fi

if [ -f "$CUDA_EXE" ]; then
    chmod +x "$CUDA_EXE" 2>/dev/null || true
    echo "Whisper CUDA binary ready: $CUDA_EXE"
fi

echo "DLL files in resources:"
ls -lh "$RES_DIR"/*.dll 2>/dev/null || echo "None found yet."

if [ -f "$MODEL_FILE" ]; then
    echo "Whisper GGML model ready: $MODEL_FILE"
fi
