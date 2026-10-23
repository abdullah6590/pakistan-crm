; Pakistan CRM installer hooks (inserted by Tauri into its NSIS installer).
;
; Business data is never deleted by uninstalling. Tauri's uninstaller offers a "Delete the application data" box
; that would remove %APPDATA%\pk.pakistancrm.desktop: the database, entries not yet sent to the server, this
; computer's keys and any backups kept there. Here that choice is overridden before the uninstaller acts on it, and
; the user is told where the data is. Deleting it stays a deliberate, manual step.

; The local server's page cache in the program folder belongs to the version that made it (D-036): removed before
; installing over an older version, and on uninstall so nothing is left behind (D-030). Only this cache folder
; is removed recursively; its parents are removed only if empty.
!macro NSIS_HOOK_PREINSTALL
  RMDir /r "$INSTDIR\app\.next-desktop\server\route-cache"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
    StrCpy $DeleteAppDataCheckboxState 0
    IfSilent +2
      MessageBox MB_OK|MB_ICONINFORMATION "Pakistan CRM does not delete business data when it is uninstalled.$\r$\n$\r$\nYour data was kept in:$\r$\n$APPDATA\${BUNDLEID}$\r$\n$\r$\nIf you really want to remove it, first make sure you have a verified backup, then delete that folder yourself."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; A full uninstall (not an upgrade) forgets the old install folder, so the next install offers the normal location
  ; instead of a folder that no longer exists. Data is not touched.
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" ""
  ${EndIf}
  RMDir /r "$INSTDIR\app\.next-desktop\server\route-cache"
  RMDir "$INSTDIR\app\.next-desktop\server"
  RMDir "$INSTDIR\app\.next-desktop"
  RMDir "$INSTDIR\app"
  RMDir "$INSTDIR"
!macroend
