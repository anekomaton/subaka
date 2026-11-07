; NSIS Custom Hooks for SUBaka Desktop
; Ensures no dangling SUBaka and Whisper background processes remain before installing or uninstalling,
; and ensures Whisper executables and DLLs are placed in both $INSTDIR and $INSTDIR\resources.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Checking for running SUBaka and Whisper processes..."
  nsExec::Exec 'taskkill /F /IM SUBaka.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper-cuda.exe /T'
  nsExec::Exec 'taskkill /F /IM whisper-cli.exe /T'
  Sleep 500
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Configuring SUBaka binaries and runtime DLLs..."
  ; Copy DLLs and Whisper binaries to main application folder if present in resources
  IfFileExists "$INSTDIR\resources\whisper.exe" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\whisper.exe" "$INSTDIR\whisper.exe"
  IfFileExists "$INSTDIR\resources\whisper-cuda.exe" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\whisper-cuda.exe" "$INSTDIR\whisper-cuda.exe"
  IfFileExists "$INSTDIR\resources\*.dll" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\*.dll" "$INSTDIR\"
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
  ; Clean up copied DLLs and binaries on uninstall
  Delete /REBOOTOK "$INSTDIR\whisper.exe"
  Delete /REBOOTOK "$INSTDIR\whisper-cuda.exe"
  Delete /REBOOTOK "$INSTDIR\*.dll"
!macroend
