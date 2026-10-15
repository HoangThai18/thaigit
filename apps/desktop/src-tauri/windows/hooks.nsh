; The app was renamed from "Thaigit" to "Gitlane". NSIS keys the install folder, uninstall entry and shortcuts on the
; product name, so without this the first Gitlane install would sit next to the old Thaigit one. Silently run the old
; uninstaller first: it removes the old files, shortcuts and Add/Remove entry but keeps app data (settings, accounts),
; which lives under the unchanged bundle identifier.
!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R0 HKCU "Software\${MANUFACTURER}\Thaigit" ""
  ${If} $R0 != ""
  ${AndIf} $R0 != $INSTDIR
  ${AndIf} ${FileExists} "$R0\uninstall.exe"
    ExecWait '"$R0\uninstall.exe" /S _?=$R0'
    Delete "$R0\uninstall.exe"
    RMDir "$R0"
  ${EndIf}
  DeleteRegKey HKCU "Software\${MANUFACTURER}\Thaigit"
!macroend
