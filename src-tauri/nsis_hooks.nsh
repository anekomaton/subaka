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
    ; This is SUBaka-Lite. Prompt user with checkbox to download Whisper model & CUDA
    DetailPrint "Prompting for optional offline Whisper model download..."
    nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "[void][System.Reflection.Assembly]::LoadWithPartialName(\"System.Windows.Forms\"); [void][System.Reflection.Assembly]::LoadWithPartialName(\"System.Drawing\"); $f = New-Object Windows.Forms.Form; $f.Text = \"Усталёўка SUBaka (Lite)\"; $f.Size = New-Object Drawing.Size(460, 240); $f.StartPosition = \"CenterScreen\"; $f.FormBorderStyle = \"FixedDialog\"; $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.TopMost = $true; $lbl = New-Object Windows.Forms.Label; $lbl.Text = \"SUBaka падтрымлівае афлайн-распазнаванне маўлення (Whisper). Каб карыстацца ім без падключэння да інтэрнэту, патрабуецца мадэль (~460 МБ).\"; $lbl.Location = New-Object Drawing.Point(20, 15); $lbl.Size = New-Object Drawing.Size(400, 48); $f.Controls.Add($lbl); $cb = New-Object Windows.Forms.CheckBox; $cb.Text = \"Спампаваць мадэль афлайн-распазнавання Whisper (~460 МБ)\"; $cb.Location = New-Object Drawing.Point(20, 75); $cb.Size = New-Object Drawing.Size(400, 30); $cb.Font = New-Object Drawing.Font(\"Segoe UI\", 9, [Drawing.FontStyle]::Bold); $cb.Checked = $false; $f.Controls.Add($cb); $sub = New-Object Windows.Forms.Label; $sub.Text = \"Калі не адзначаць, паставіцца хуткая Lite-версія. Мадэль можна спампаваць пазней у самім дадатку.\"; $sub.Location = New-Object Drawing.Point(20, 110); $sub.Size = New-Object Drawing.Size(400, 35); $sub.ForeColor = [Drawing.Color]::Gray; $f.Controls.Add($sub); $btn = New-Object Windows.Forms.Button; $btn.Text = \"Працягнуць\"; $btn.Location = New-Object Drawing.Point(320, 155); $btn.Size = New-Object Drawing.Size(100, 30); $btn.DialogResult = [Windows.Forms.DialogResult]::OK; $f.Controls.Add($btn); $f.AcceptButton = $btn; $f.ShowDialog() | Out-Null; if ($cb.Checked) { exit 1 } else { exit 0 }"'
    Pop $0 ; Exit code from PowerShell command
    Pop $1 ; Command output (if any)
    ${If} $0 == "1"
      StrCpy $WhisperOptChoice "1"
      DetailPrint "User selected to download Whisper model during installation."
    ${Else}
      StrCpy $WhisperOptChoice "0"
      DetailPrint "User selected standard Lite installation."
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Configuring SUBaka resources..."
  ; All Whisper executables, runtime DLLs, and models reside exclusively in $INSTDIR\resources\
  ; Clean up any legacy duplicates in root from older versions to prevent duplication and save disk space
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
    DetailPrint "Downloading Whisper model (ggml-small.bin, ~460 MB)..."
    DetailPrint "This may take a few minutes depending on your internet connection..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$target = Join-Path \"$INSTDIR\" \"resources\ggml-small.bin\"; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $urls = @(\"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin\", \"https://huggingface.co/datasets/ggerganov/whisper.cpp/resolve/main/ggml-small.bin\"); foreach ($u in $urls) { Write-Host \"Connecting to $u...\"; try { & curl.exe -s -S -f -L --retry 5 --retry-delay 2 -H \"User-Agent: Mozilla/5.0\" $u -o $target } catch { Write-Host \"curl error: $_\" }; if ((Test-Path $target) -and (Get-Item $target).Length -gt 10000000) { break }; try { Invoke-WebRequest -Uri $u -OutFile $target -UserAgent \"Mozilla/5.0\" -TimeoutSec 300 } catch { Write-Host \"Web error: $_\" }; if ((Test-Path $target) -and (Get-Item $target).Length -gt 10000000) { break } }"'

    ; Download CUDA / Whisper CPU binaries and DLLs if missing in resources
    ${If} ${FileExists} "$INSTDIR\resources\whisper.exe"
      DetailPrint "Whisper executable already present."
    ${Else}
      DetailPrint "Downloading Whisper executable binaries and DLLs..."
      nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$resDir = Join-Path \"$INSTDIR\" \"resources\"; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $zipUrl = \"https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip\"; $zipTarget = Join-Path $resDir \"whisper-bin.zip\"; & curl.exe -s -S -f -L --retry 3 $zipUrl -o $zipTarget; if (Test-Path $zipTarget) { Expand-Archive -Path $zipTarget -DestinationPath (Join-Path $resDir \"temp_cpu\") -Force; Get-ChildItem -Path (Join-Path $resDir \"temp_cpu\") -Recurse -Filter \"*.exe\" | Copy-Item -Destination (Join-Path $resDir \"whisper.exe\") -Force; Get-ChildItem -Path (Join-Path $resDir \"temp_cpu\") -Recurse -Filter \"*.dll\" | Copy-Item -Destination $resDir -Force; Remove-Item (Join-Path $resDir \"temp_cpu\") -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item $zipTarget -Force -ErrorAction SilentlyContinue }"'
    ${EndIf}
    DetailPrint "Whisper model setup completed."
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
  ; Clean up any legacy root files and resources on uninstall
  Delete /REBOOTOK "$INSTDIR\whisper.exe"
  Delete /REBOOTOK "$INSTDIR\whisper-cuda.exe"
  Delete /REBOOTOK "$INSTDIR\whisper-cli.exe"
  Delete /REBOOTOK "$INSTDIR\*.dll"
  RMDir /r /REBOOTOK "$INSTDIR\resources"
!macroend

