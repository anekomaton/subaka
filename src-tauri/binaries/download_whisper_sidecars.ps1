# PowerShell script to download static Whisper.cpp binary and GGML model for SUBaka Desktop resources
$PSScriptRoot = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
$resDir = Join-Path (Split-Path -Parent -Path $PSScriptRoot) "resources"
New-Item -ItemType Directory -Force -Path $resDir | Out-Null

$whisperExeTarget = Join-Path $resDir "whisper.exe"
$modelTarget = Join-Path $resDir "ggml-small.bin"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# 1. Download Whisper binary if missing or invalid (< 100 KB)
if (-not (Test-Path $whisperExeTarget) -or (Get-Item $whisperExeTarget).Length -lt 100000) {
    Write-Host "Downloading whisper.exe binary into resources..."
    $zipTarget = Join-Path $resDir "whisper-bin-x64.zip"
    $whisperZipUrl = "https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.4/whisper-bin-x64.zip"
    
    try {
        & curl.exe -s -S -f -L --retry 5 --retry-delay 2 $whisperZipUrl -o $zipTarget
        if (Test-Path $zipTarget) {
            Expand-Archive -Path $zipTarget -DestinationPath $resDir -Force
            Remove-Item $zipTarget -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Host "Warning: Failed downloading whisper zip: $_"
    }

    # Ensure binary is named whisper.exe
    if (-not (Test-Path $whisperExeTarget)) {
        $cliExe = Join-Path $resDir "whisper-cli.exe"
        $mainExe = Join-Path $resDir "main.exe"
        if (Test-Path $cliExe) {
            Move-Item $cliExe $whisperExeTarget -Force
        } elseif (Test-Path $mainExe) {
            Move-Item $mainExe $whisperExeTarget -Force
        }
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
