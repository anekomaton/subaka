# PowerShell script to download static FFmpeg for Windows build
$PSScriptRoot = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
Set-Location -Path $PSScriptRoot

$target = "ffmpeg-x86_64-pc-windows-msvc.exe"
$url = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64"

if (Test-Path $target) {
    $size = (Get-Item $target).Length
    if ($size -gt 5000000) {
        Write-Host "FFmpeg binary $target already exists ($size bytes). Skipping download."
        exit 0
    }
}

Write-Host "Downloading static FFmpeg for Windows ($target)..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile $target
$size = (Get-Item $target).Length
if ($size -lt 5000000) {
    Write-Error "Downloaded file is smaller than expected ($size bytes). Download failed or returned 404."
    exit 1
}
Write-Host "Downloaded successfully: $target ($size bytes)"
