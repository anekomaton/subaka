; NSIS Custom Hooks for SUBaka Desktop
; Ensures no dangling SUBaka and Whisper background processes remain before installing or uninstalling.
; Whisper executables, runtime DLLs, and models reside cleanly inside $INSTDIR\resources\ without root duplication.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Checking for running SUBaka and Whisper processes..."
  nsExec::Exec 'taskkill /F /IM SUBaka.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper-cuda.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper-cli.exe /T'
  Sleep 500
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Configuring SUBaka resources..."
  ; Clean up legacy root binaries
  Delete /REBOOTOK "$INSTDIR\whisper.exe"
  Delete /REBOOTOK "$INSTDIR\whisper-cuda.exe"
  Delete /REBOOTOK "$INSTDIR\whisper-cli.exe"
  Delete /REBOOTOK "$INSTDIR\whisper.dll"
  Delete /REBOOTOK "$INSTDIR\ggml*.dll"
  Delete /REBOOTOK "$INSTDIR\cublas*.dll"
  Delete /REBOOTOK "$INSTDIR\cudart*.dll"
  Delete /REBOOTOK "$INSTDIR\nvrtc*.dll"
  Delete /REBOOTOK "$INSTDIR\SDL2.dll"

  ; Ensure resources directory exists
  CreateDirectory "$INSTDIR\resources"

  ${If} ${FileExists} "$INSTDIR\resources\ggml-small.bin"
    DetailPrint "Whisper offline model already present."
  ${ElseIf} $WhisperOptChoice == "1"
    DetailPrint "Downloading Whisper model (ggml-small.bin, ~460 MB) and CUDA acceleration binaries..."
    DetailPrint "This may take a few minutes depending on your internet connection..."

    Delete "$TEMP\subaka_download_whisper.ps1"
    FileOpen $0 "$TEMP\subaka_download_whisper.ps1" w
    FileWrite $0 '$$resDir = Join-Path "$INSTDIR" "resources"$\r$\n'
    FileWrite $0 'New-Item -ItemType Directory -Force -Path $$resDir | Out-Null$\r$\n'
    FileWrite $0 '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12$\r$\n'
    ; 1. CUDA Whisper binaries + CUDA cuBLAS DLLs
    FileWrite $0 '$$cudaExe = Join-Path $$resDir "whisper-cuda.exe"$\r$\n'
    FileWrite $0 'if (-not (Test-Path $$cudaExe) -or (Get-Item $$cudaExe).Length -lt 100000) {$\r$\n'
    FileWrite $0 '  Write-Host "Downloading CUDA cuBLAS Whisper binary and DLLs for GPU acceleration..."$\r$\n'
    FileWrite $0 '  $$cudaZip = Join-Path $$resDir "whisper-cublas-x64.zip"$\r$\n'
    FileWrite $0 '  $$cudaUrls = @("https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-cublas-12.4.0-bin-x64.zip", "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-cublas-11.8.0-bin-x64.zip", "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-cublas-12.4.0-bin-x64.zip")$\r$\n'
    FileWrite $0 '  foreach ($$u in $$cudaUrls) {$\r$\n'
    FileWrite $0 '    Write-Host "Connecting to $$u..."$\r$\n'
    FileWrite $0 '    try { & curl.exe -s -S -f -L --retry 3 $$u -o $$cudaZip } catch {}$\r$\n'
    FileWrite $0 '    if ((Test-Path $$cudaZip) -and (Get-Item $$cudaZip).Length -gt 1000000) { break }$\r$\n'
    FileWrite $0 '    try { Invoke-WebRequest -Uri $$u -OutFile $$cudaZip -UserAgent "Mozilla/5.0" -TimeoutSec 120 } catch {}$\r$\n'
    FileWrite $0 '    if ((Test-Path $$cudaZip) -and (Get-Item $$cudaZip).Length -gt 1000000) { break }$\r$\n'
    FileWrite $0 '  }$\r$\n'
    FileWrite $0 '  if ((Test-Path $$cudaZip) -and (Get-Item $$cudaZip).Length -gt 1000000) {$\r$\n'
    FileWrite $0 '    $$tempCuda = Join-Path $$resDir "temp_cuda"$\r$\n'
    FileWrite $0 '    New-Item -ItemType Directory -Force -Path $$tempCuda | Out-Null$\r$\n'
    FileWrite $0 '    Expand-Archive -Path $$cudaZip -DestinationPath $$tempCuda -Force$\r$\n'
    FileWrite $0 '    $$exe = Get-ChildItem -Path $$tempCuda -Recurse -Filter "*.exe" | Where-Object { $$_.Name -match "whisper-cli|whisper|main" } | Select-Object -First 1$\r$\n'
    FileWrite $0 '    if (-not $$exe) { $$exe = Get-ChildItem -Path $$tempCuda -Recurse -Filter "*.exe" | Select-Object -First 1 }$\r$\n'
    FileWrite $0 '    if ($$exe) { Copy-Item $$exe.FullName $$cudaExe -Force; Write-Host "CUDA Whisper binary installed: whisper-cuda.exe" }$\r$\n'
    FileWrite $0 '    Get-ChildItem -Path $$tempCuda -Recurse -Filter "*.dll" | ForEach-Object { Copy-Item $$_.FullName $$resDir -Force }$\r$\n'
    FileWrite $0 '    Remove-Item $$tempCuda -Recurse -Force -ErrorAction SilentlyContinue$\r$\n'
    FileWrite $0 '    Remove-Item $$cudaZip -Force -ErrorAction SilentlyContinue$\r$\n'
    FileWrite $0 '  }$\r$\n'
    FileWrite $0 '}$\r$\n'
    ; 2. Standard CPU Whisper binaries + CPU DLLs
    FileWrite $0 '$$cpuExe = Join-Path $$resDir "whisper.exe"$\r$\n'
    FileWrite $0 'if (-not (Test-Path $$cpuExe) -or (Get-Item $$cpuExe).Length -lt 100000) {$\r$\n'
    FileWrite $0 '  Write-Host "Downloading standard CPU Whisper binary and DLLs..."$\r$\n'
    FileWrite $0 '  $$cpuZip = Join-Path $$resDir "whisper-bin-x64.zip"$\r$\n'
    FileWrite $0 '  $$cpuUrls = @("https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip", "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip")$\r$\n'
    FileWrite $0 '  foreach ($$u in $$cpuUrls) {$\r$\n'
    FileWrite $0 '    Write-Host "Connecting to $$u..."$\r$\n'
    FileWrite $0 '    try { & curl.exe -s -S -f -L --retry 3 $$u -o $$cpuZip } catch {}$\r$\n'
    FileWrite $0 '    if ((Test-Path $$cpuZip) -and (Get-Item $$cpuZip).Length -gt 500000) { break }$\r$\n'
    FileWrite $0 '    try { Invoke-WebRequest -Uri $$u -OutFile $$cpuZip -UserAgent "Mozilla/5.0" -TimeoutSec 120 } catch {}$\r$\n'
    FileWrite $0 '    if ((Test-Path $$cpuZip) -and (Get-Item $$cpuZip).Length -gt 500000) { break }$\r$\n'
    FileWrite $0 '  }$\r$\n'
    FileWrite $0 '  if ((Test-Path $$cpuZip) -and (Get-Item $$cpuZip).Length -gt 500000) {$\r$\n'
    FileWrite $0 '    $$tempCpu = Join-Path $$resDir "temp_cpu"$\r$\n'
    FileWrite $0 '    New-Item -ItemType Directory -Force -Path $$tempCpu | Out-Null$\r$\n'
    FileWrite $0 '    Expand-Archive -Path $$cpuZip -DestinationPath $$tempCpu -Force$\r$\n'
    FileWrite $0 '    $$exe = Get-ChildItem -Path $$tempCpu -Recurse -Filter "*.exe" | Where-Object { $$_.Name -match "whisper-cli|whisper|main" } | Select-Object -First 1$\r$\n'
    FileWrite $0 '    if (-not $$exe) { $$exe = Get-ChildItem -Path $$tempCpu -Recurse -Filter "*.exe" | Select-Object -First 1 }$\r$\n'
    FileWrite $0 '    if ($$exe) { Copy-Item $$exe.FullName $$cpuExe -Force; Write-Host "Standard CPU Whisper binary installed: whisper.exe" }$\r$\n'
    FileWrite $0 '    Get-ChildItem -Path $$tempCpu -Recurse -Filter "*.dll" | ForEach-Object { Copy-Item $$_.FullName $$resDir -Force }$\r$\n'
    FileWrite $0 '    Remove-Item $$tempCpu -Recurse -Force -ErrorAction SilentlyContinue$\r$\n'
    FileWrite $0 '    Remove-Item $$cpuZip -Force -ErrorAction SilentlyContinue$\r$\n'
    FileWrite $0 '  }$\r$\n'
    FileWrite $0 '}$\r$\n'
    ; 3. GGML model
    FileWrite $0 '$$modelTarget = Join-Path $$resDir "ggml-small.bin"$\r$\n'
    FileWrite $0 'if (-not (Test-Path $$modelTarget) -or (Get-Item $$modelTarget).Length -lt 10000000) {$\r$\n'
    FileWrite $0 '  Write-Host "Downloading Whisper GGML model (ggml-small.bin, ~460 MB)..."$\r$\n'
    FileWrite $0 '  $$modelUrls = @("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin", "https://huggingface.co/datasets/ggerganov/whisper.cpp/resolve/main/ggml-small.bin")$\r$\n'
    FileWrite $0 '  foreach ($$mUrl in $$modelUrls) {$\r$\n'
    FileWrite $0 '    Write-Host "Connecting to $$mUrl..."$\r$\n'
    FileWrite $0 '    try { & curl.exe -s -S -f -L --retry 5 --retry-delay 2 -H "User-Agent: Mozilla/5.0" $$mUrl -o $$modelTarget } catch {}$\r$\n'
    FileWrite $0 '    if ((Test-Path $$modelTarget) -and (Get-Item $$modelTarget).Length -gt 10000000) { break }$\r$\n'
    FileWrite $0 '    try { Invoke-WebRequest -Uri $$mUrl -OutFile $$modelTarget -UserAgent "Mozilla/5.0" -TimeoutSec 300 } catch {}$\r$\n'
    FileWrite $0 '    if ((Test-Path $$modelTarget) -and (Get-Item $$modelTarget).Length -gt 10000000) { break }$\r$\n'
    FileWrite $0 '  }$\r$\n'
    FileWrite $0 '}$\r$\n'
    FileWrite $0 'Write-Host "Whisper offline engine setup complete."$\r$\n'
    FileClose $0

    ; Execute download script with live logging in installer details
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$TEMP\subaka_download_whisper.ps1"'
    Delete "$TEMP\subaka_download_whisper.ps1"

    DetailPrint "Whisper model and CUDA acceleration binaries ready."
  ${Else}
    DetailPrint "Lite edition installed without offline Whisper model. You can download it inside SUBaka at any time."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Closing any running SUBaka and Whisper instances before uninstall..."
  nsExec::Exec 'taskkill /F /IM SUBaka.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper-cuda.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper-cli.exe /T'
  Sleep 1000
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Switch working directory out of $INSTDIR so Windows allows directory removal
  SetOutPath "$TEMP"

  ; Clean up any legacy root files and resources on uninstall
  Delete /REBOOTOK "$INSTDIR\whisper.exe"
  Delete /REBOOTOK "$INSTDIR\whisper-cuda.exe"
  Delete /REBOOTOK "$INSTDIR\whisper-cli.exe"
  Delete /REBOOTOK "$INSTDIR\*.dll"
  RMDir /r /REBOOTOK "$INSTDIR\resources"

  ; If uninstall was invoked by setup.exe, uninstall.exe might still be open in memory.
  ; Spawn a lightweight background helper that waits for all processes to close and cleanly deletes $INSTDIR.
  nsExec::Exec 'cmd.exe /C start /min "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; if (Test-Path -LiteralPath \"$INSTDIR\") { Remove-Item -LiteralPath \"$INSTDIR\" -Recurse -Force -ErrorAction SilentlyContinue }"'
!macroend

