!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Browsery"
  !define MUI_WELCOMEPAGE_TEXT "This setup will install Browsery for your Windows account and create Start menu and desktop shortcuts.$\r$\n$\r$\nProton VPN is optional. After setup, you can open Proton's official download page if you want to install it separately. Browsery will never ask for your Proton password or VPN keys."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_RUN "Launch Browsery"
  !define MUI_FINISHPAGE_RUN_FUNCTION "LaunchBrowsery"
  !define MUI_FINISHPAGE_RUN_NOTCHECKED
  !define MUI_FINISHPAGE_LINK "Optional: get Proton VPN from its official website"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://protonvpn.com/download-windows"

  Function LaunchBrowsery
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  FunctionEnd

  !insertmacro MUI_PAGE_FINISH
!macroend

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
