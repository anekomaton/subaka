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

