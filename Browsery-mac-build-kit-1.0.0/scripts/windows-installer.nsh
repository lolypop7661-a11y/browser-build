!macro customInstall
  ; Do not report success or create links to a missing application.
  ${IfNot} ${FileExists} "$appExe"
    MessageBox MB_OK|MB_ICONSTOP "Browsery.exe could not be installed. Run this installer again."
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\resources\app.asar"
    MessageBox MB_OK|MB_ICONSTOP "Browsery's application files could not be installed. Run this installer again."
    SetErrorLevel 2
    Quit
  ${EndIf}

  ; Refresh same-name links during an upgrade too. The standard keepShortcuts
  ; behavior can otherwise preserve a shortcut from the incomplete 1.0.3 build.
  SetOutPath "$INSTDIR"
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
!macroend
