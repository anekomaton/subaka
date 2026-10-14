# PowerShell script to download static FFmpeg for Windows build
$PSScriptRoot = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
Set-Location -Path $PSScriptRoot

$target = "ffmpeg-x86_64-pc-windows-msvc.exe"
$url = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/win32-x64"

Write-Host "Downloading static FFmpeg for Windows ($target)..."
Invoke-WebRequest -Uri $url -OutFile $target
Write-Host "Downloaded successfully: $target"
