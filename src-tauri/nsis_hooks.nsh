; NSIS Custom Hooks for SUBaka Desktop
; Ensures no dangling SUBaka background processes remain before installing or uninstalling.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Checking for running SUBaka processes..."
  nsExec::Exec 'taskkill /F /IM SUBaka.exe /T'
  Sleep 500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Closing any running SUBaka instances before uninstall..."
  nsExec::Exec 'taskkill /F /IM SUBaka.exe /T'
  Sleep 1000
!macroend
