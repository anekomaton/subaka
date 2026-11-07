# PowerShell script to download static Whisper.cpp binary and GGML model for SUBaka Desktop resources
$PSScriptRoot = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
$resDir = Join-Path (Split-Path -Parent -Path $PSScriptRoot) "resources"
New-Item -ItemType Directory -Force -Path $resDir | Out-Null

$whisperExeTarget = Join-Path $resDir "whisper.exe"
$cudaExeTarget = Join-Path $resDir "whisper-cuda.exe"
$modelTarget = Join-Path $resDir "ggml-small.bin"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# 1. Download CUDA cuBLAS Whisper binary + DLLs for NVIDIA GPU acceleration
if (-not (Test-Path $cudaExeTarget) -or (Get-Item $cudaExeTarget).Length -lt 100000) {
    Write-Host "Downloading CUDA cuBLAS Whisper binary into resources..."
    $cudaZipTarget = Join-Path $resDir "whisper-cublas-x64.zip"
    $cudaZipUrl = "https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.4/whisper-cublas-12.2.0-x64.zip"
    try {
        & curl.exe -s -S -f -L --retry 5 --retry-delay 2 $cudaZipUrl -o $cudaZipTarget
        if (Test-Path $cudaZipTarget) {
            Expand-Archive -Path $cudaZipTarget -DestinationPath $resDir -Force
            Remove-Item $cudaZipTarget -Force -ErrorAction SilentlyContinue
            $cliExe = Join-Path $resDir "whisper-cli.exe"
            $mainExe = Join-Path $resDir "main.exe"
            if (Test-Path $cliExe) {
                Move-Item $cliExe $cudaExeTarget -Force
            } elseif (Test-Path $mainExe) {
                Move-Item $mainExe $cudaExeTarget -Force
            }
            Write-Host "CUDA Whisper binary ready: $cudaExeTarget"
        }
    } catch {
        Write-Host "Notice: CUDA download skipped or failed: $_"
    }
}

# 2. Download standard Whisper CPU binary if missing or invalid (< 100 KB)
if (-not (Test-Path $whisperExeTarget) -or (Get-Item $whisperExeTarget).Length -lt 100000) {
    Write-Host "Downloading standard whisper.exe binary into resources..."
    $zipTarget = Join-Path $resDir "whisper-bin-x64.zip"
    $whisperZipUrl = "https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.4/whisper-bin-x64.zip"
    
    try {
        & curl.exe -s -S -f -L --retry 5 --retry-delay 2 $whisperZipUrl -o $zipTarget
        if (Test-Path $zipTarget) {
            Expand-Archive -Path $zipTarget -DestinationPath $resDir -Force
            Remove-Item $zipTarget -Force -ErrorAction SilentlyContinue
            $cliExe = Join-Path $resDir "whisper-cli.exe"
            $mainExe = Join-Path $resDir "main.exe"
            if (Test-Path $cliExe) {
                Move-Item $cliExe $whisperExeTarget -Force
            } elseif (Test-Path $mainExe) {
                Move-Item $mainExe $whisperExeTarget -Force
            }
        }
    } catch {
        Write-Host "Warning: Failed downloading whisper zip: $_"
    }
}

# 2. Download ggml-small.bin model if missing or invalid (< 10 MB)
if (-not (Test-Path $modelTarget) -or (Get-Item $modelTarget).Length -lt 10000000) {
    Write-Host "Downloading ggml-small.bin model (~460MB) into resources..."
    $modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
    try {
        & curl.exe -s -S -f -L --retry 5 --retry-delay 3 $modelUrl -o $modelTarget
    } catch {
        Write-Host "Warning: Failed downloading ggml-small.bin: $_"
    }
}

if (Test-Path $whisperExeTarget) {
    Write-Host "Whisper executable ready: $whisperExeTarget ($((Get-Item $whisperExeTarget).Length) bytes)"
} else {
    Write-Host "Notice: whisper.exe not present in resources."
}

if (Test-Path $modelTarget) {
    Write-Host "Whisper GGML model ready: $modelTarget ($([math]::Round((Get-Item $modelTarget).Length / 1MB, 2)) MB)"
} else {
    Write-Host "Notice: ggml-small.bin not present in resources."
}
