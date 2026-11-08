; NSIS Custom Hooks for SUBaka Desktop
; Ensures no dangling SUBaka background processes remain before installing or uninstalling.
; Resources reside cleanly inside $INSTDIR\resources\ without root duplication.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Checking for running SUBaka processes..."
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
    DetailPrint "Whisper offline engine ready."
  ${Else}
    DetailPrint "Lite edition installed without Whisper offline engine."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Closing any running SUBaka instances before uninstall..."
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
