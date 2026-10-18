; NSIS hooks for the NightFlow Windows installer (wired up via
; bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; Windows support is in beta and limited to Windows 11, which starts at build
; 22000. Refuse to install on anything older instead of shipping an app we
; haven't tested there. If the build number can't be read, let it through.

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R9 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  ${If} $R9 != ""
  ${AndIf} $R9 < 22000
    MessageBox MB_ICONSTOP|MB_OK "NightFlow for Windows is in beta and requires Windows 11 (build 22000 or later).$\r$\n$\r$\nThis PC is running Windows build $R9." /SD IDOK
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend
