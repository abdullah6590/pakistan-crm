; Pakistan CRM installer hooks (inserted by Tauri into its NSIS installer).
;
; Business data is never deleted by uninstalling. Tauri's uninstaller offers a "Delete the application data" box
; that would remove %APPDATA%\pk.pakistancrm.desktop: the database, entries not yet sent to the server, this
; computer's keys and any backups kept there. Here that choice is overridden before the uninstaller acts on it, and
; the user is told where the data is. Deleting it stays a deliberate, manual step.

; Program files of an older version (D-037). The bundled server's file names change with every version, so
; installing over an older one would leave its files behind, and the uninstaller (which removes only the files of
; its own version) would leave them too. They are removed first, but only when this folder really holds a Pakistan
; CRM program (app\app-entry.cjs is there), and only its "app" and "node" program folders. Business data lives in
; %APPDATA%, never in the program folder, and is not touched. This also clears the old page cache (D-036, D-030).
Var /GLOBAL CrmProgramFiles

!macro NSIS_HOOK_PREINSTALL
  ${If} ${FileExists} "$INSTDIR\app\app-entry.cjs"
    RMDir /r "$INSTDIR\app"
    RMDir /r "$INSTDIR\node"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Remember, before the uninstaller removes app-entry.cjs, that this is a Pakistan CRM program folder
  StrCpy $CrmProgramFiles 0
  ${If} ${FileExists} "$INSTDIR\app\app-entry.cjs"
    StrCpy $CrmProgramFiles 1
  ${EndIf}
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
  ; Files of older versions left in the program folder (D-037): only in a Pakistan CRM program folder
  ${If} $CrmProgramFiles = 1
    RMDir /r "$INSTDIR\app"
    RMDir /r "$INSTDIR\node"
  ${EndIf}
  RMDir "$INSTDIR"
!macroend
