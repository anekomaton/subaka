; NSIS Custom Hooks for SUBaka Desktop
; Ensures no dangling SUBaka and Whisper background processes remain before installing or uninstalling.
; Whisper executables, runtime DLLs, and models reside cleanly inside $INSTDIR\resources\ without root duplication.

Var WhisperOptChoice

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Checking for running SUBaka and Whisper processes..."
  nsExec::Exec 'taskkill /F /IM SUBaka.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper-cuda.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper-cli.exe /T'
  Sleep 500

  ; Initialize choice as 0 (skip download by default)
  StrCpy $WhisperOptChoice "0"

  ; Check if model is already present on system or bundled in this installer
  ${If} ${FileExists} "$INSTDIR\resources\ggml-small.bin"
    DetailPrint "Offline Whisper model already present."
  ${Else}
    DetailPrint "Prompting for optional offline Whisper model and CUDA acceleration download..."
    Delete "$TEMP\subaka_whisper_choice.txt"
    Delete "$TEMP\subaka_whisper_prompt.ps1"
    Delete "$TEMP\subaka_whisper_launcher.vbs"

    ; Generate PowerShell script with clean Windows Form modal dialog
    FileOpen $0 "$TEMP\subaka_whisper_prompt.ps1" w
    FileWrite $0 "Add-Type -AssemblyName System.Windows.Forms$\r$\n"
    FileWrite $0 "Add-Type -AssemblyName System.Drawing$\r$\n"
    FileWrite $0 "[System.Windows.Forms.Application]::EnableVisualStyles()$\r$\n"
    FileWrite $0 "function Get-Utf8($$b) { return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($$b)) }$\r$\n"
    FileWrite $0 "$$choice = Join-Path $$env:TEMP 'subaka_whisper_choice.txt'$\r$\n"
    FileWrite $0 "Set-Content -Path $$choice -Value '0' -Encoding ASCII -Force$\r$\n"
    FileWrite $0 "$$f = New-Object Windows.Forms.Form$\r$\n"
    FileWrite $0 "$$f.Text = Get-Utf8 '0KPRgdGC0LDQu9GR0Z7QutCwIFNVQmFrYSAoTGl0ZSk='$\r$\n"
    FileWrite $0 "$$f.Size = New-Object Drawing.Size(520, 310)$\r$\n"
    FileWrite $0 "$$f.StartPosition = 'CenterScreen'$\r$\n"
    FileWrite $0 "$$f.FormBorderStyle = 'FixedDialog'$\r$\n"
    FileWrite $0 "$$f.MaximizeBox = $$false$\r$\n"
    FileWrite $0 "$$f.MinimizeBox = $$false$\r$\n"
    FileWrite $0 "$$f.TopMost = $$true$\r$\n"
    FileWrite $0 "$$lbl = New-Object Windows.Forms.Label$\r$\n"
    FileWrite $0 "$$lbl.Text = Get-Utf8 'U1VCYWthINC/0LDQtNGC0YDRi9C80LvRltCy0LDQtSDRhdGD0YLQutCw0LUg0LDRhNC70LDQudC9LdGA0LDRgdC/0LDQt9C90LDQstCw0L3QvdC1INC80LDRntC70LXQvdC90Y8gKFdoaXNwZXIpINC3INC/0LDQtNGC0YDRi9C80LrQsNC5IE5WSURJQSBDVURBLg=='$\r$\n"
    FileWrite $0 "$$lbl.Location = New-Object Drawing.Point(24, 18)$\r$\n"
    FileWrite $0 "$$lbl.Size = New-Object Drawing.Size(460, 38)$\r$\n"
    FileWrite $0 "$$lbl.Font = New-Object Drawing.Font('Segoe UI', 9.5)$\r$\n"
    FileWrite $0 "$$f.Controls.Add($$lbl)$\r$\n"
    FileWrite $0 "$$cb = New-Object Windows.Forms.CheckBox$\r$\n"
    FileWrite $0 "$$cb.Text = Get-Utf8 '0KHQv9Cw0LzQv9Cw0LLQsNGG0Ywg0LzQsNC00Y3Qu9GMIFdoaXNwZXIg0ZYg0LrQsNC80L/QsNC90LXQvdGC0YsgQ1VEQSAofjUwMCDQnNCRKQ=='$\r$\n"
    FileWrite $0 "$$cb.Location = New-Object Drawing.Point(24, 62)$\r$\n"
    FileWrite $0 "$$cb.Size = New-Object Drawing.Size(460, 32)$\r$\n"
    FileWrite $0 "$$cb.Font = New-Object Drawing.Font('Segoe UI', 9.5, [Drawing.FontStyle]::Bold)$\r$\n"
    FileWrite $0 "$$cb.Checked = $$false$\r$\n"
    FileWrite $0 "$$f.Controls.Add($$cb)$\r$\n"
    FileWrite $0 "$$sub = New-Object Windows.Forms.Label$\r$\n"
    FileWrite $0 "$$sub.Text = Get-Utf8 '0JHRg9C00YPRhtGMINGB0L/QsNC80L/QsNCy0LDQvdGL0Y8g0LzQsNC00Y3Qu9GMIChnZ21sLXNtYWxsLmJpbiksINCx0ZbQvdCw0YDQvdGW0LrRliBXaGlzcGVyINGWINCx0ZbQsdC70ZbRj9GC0Y3QutGWIE5WSURJQSBDVURBINC00LvRjyDRhdGD0YLQutCw0LPQsCDRgNCw0YHQv9Cw0LfQvdCw0LLQsNC90L3RjyDQvdCwINCy0ZbQtNGN0LDQutCw0YDRhtC1LgoK0JrQsNC70ZYg0L3QtSDQsNC00LfQvdCw0YfQsNGG0YwsINGD0YHRgtCw0LvRjtC10YbRhtCwINC/0LDQu9C10LPRh9Cw0L3QsNGPINCy0LXRgNGB0ZbRjyBTVUJha2EgTGl0ZS4g0JzQsNC00Y3Qu9GMINC30LDRntGB0ZHQtNGLINC80L7QttC90LAg0YHQv9Cw0LzQv9Cw0LLQsNGG0Ywg0L/QsNC30L3QtdC5INC90LXQv9Cw0YHRgNGN0LTQvdCwINGeINC/0YDQsNCz0YDQsNC80LUu'$\r$\n"
    FileWrite $0 "$$sub.Location = New-Object Drawing.Point(44, 98)$\r$\n"
    FileWrite $0 "$$sub.Size = New-Object Drawing.Size(440, 105)$\r$\n"
    FileWrite $0 "$$sub.ForeColor = [Drawing.Color]::FromArgb(90, 90, 90)$\r$\n"
    FileWrite $0 "$$sub.Font = New-Object Drawing.Font('Segoe UI', 8.5)$\r$\n"
    FileWrite $0 "$$f.Controls.Add($$sub)$\r$\n"
    FileWrite $0 "$$btn = New-Object Windows.Forms.Button$\r$\n"
    FileWrite $0 "$$btn.Text = Get-Utf8 '0J/RgNCw0YbRj9Cz0L3Rg9GG0Yw='$\r$\n"
    FileWrite $0 "$$btn.Location = New-Object Drawing.Point(370, 215)$\r$\n"
    FileWrite $0 "$$btn.Size = New-Object Drawing.Size(120, 34)$\r$\n"
    FileWrite $0 "$$btn.DialogResult = [Windows.Forms.DialogResult]::OK$\r$\n"
    FileWrite $0 "$$btn.Font = New-Object Drawing.Font('Segoe UI', 9.5)$\r$\n"
    FileWrite $0 "$$f.Controls.Add($$btn)$\r$\n"
    FileWrite $0 "$$f.AcceptButton = $$btn$\r$\n"
    FileWrite $0 "$$f.Add_Shown({ $$f.Activate(); $$f.BringToFront() })$\r$\n"
    FileWrite $0 "[void]$$f.ShowDialog()$\r$\n"
    FileWrite $0 "if ($$cb.Checked) { Set-Content -Path $$choice -Value '1' -Encoding ASCII -Force } else { Set-Content -Path $$choice -Value '0' -Encoding ASCII -Force }$\r$\n"
    FileWrite $0 "$$f.Dispose()$\r$\n"
    FileClose $0

    ; Write VBS launcher to run powershell cleanly without console window popup
    FileOpen $0 "$TEMP\subaka_whisper_launcher.vbs" w
    FileWrite $0 'Set sh = CreateObject("WScript.Shell")$\r$\n'
    FileWrite $0 'sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File """ & WScript.Arguments(0) & """", 0, True$\r$\n'
    FileClose $0

    ; Execute launcher and wait for user interaction
    ExecWait 'wscript.exe "$TEMP\subaka_whisper_launcher.vbs" "$TEMP\subaka_whisper_prompt.ps1"' $0

    ; Read user decision from result file
    ${If} ${FileExists} "$TEMP\subaka_whisper_choice.txt"
      FileOpen $0 "$TEMP\subaka_whisper_choice.txt" r
      FileRead $0 $1 1
      FileClose $0
      ${If} $1 == "1"
        StrCpy $WhisperOptChoice "1"
        DetailPrint "User selected to download Whisper model and CUDA components."
      ${Else}
        StrCpy $WhisperOptChoice "0"
        DetailPrint "User chose standard Lite installation."
      ${EndIf}
    ${Else}
      ; Safe fallback: native NSIS prompt if external script execution was blocked
      MessageBox MB_YESNO|MB_ICONQUESTION "SUBaka падтрымлівае афлайн-распазнаванне маўлення (Whisper).$\r$\n$\r$\nСпампаваць мадэль Whisper і кампаненты CUDA зараз (~500 МБ)?$\r$\n$\r$\n[Так] - Спампаваць мадэль і бінарнікі з CUDA$\r$\n[Не] - Усталяваць Lite-версію (мадэль можна спампаваць пазней у праграме)" IDYES opt_dl_yes IDNO opt_dl_no
      opt_dl_yes:
        StrCpy $WhisperOptChoice "1"
        DetailPrint "User selected Whisper download via fallback prompt."
        Goto opt_dl_done
      opt_dl_no:
        StrCpy $WhisperOptChoice "0"
        DetailPrint "User declined Whisper download via fallback prompt."
        Goto opt_dl_done
      opt_dl_done:
    ${EndIf}

    ; Clean up temporary dialog assets
    Delete "$TEMP\subaka_whisper_choice.txt"
    Delete "$TEMP\subaka_whisper_prompt.ps1"
    Delete "$TEMP\subaka_whisper_launcher.vbs"
  ${EndIf}
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

