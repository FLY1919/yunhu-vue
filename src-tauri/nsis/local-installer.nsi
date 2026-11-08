; Local Linux -> Windows x64 packaging for the same Tauri application and Node sidecar.
; makensis -DSTAGE=/absolute/stage -DOUTPUT=/absolute/setup.exe -DAPPVERSION=1.0.8 local-installer.nsi
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user
!include MUI2.nsh
!include x64.nsh

Name "云湖牢大版"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\YunhuLaoda"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\YunhuLaoda"
!define MUI_ICON "..\icons\icon.ico"
!define MUI_UNICON "..\icons\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\yunhulaoda-desktop.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
VIProductVersion "${APPVERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "云湖牢大版"
VIAddVersionKey /LANG=2052 "FileDescription" "云湖牢大版 Windows x64 安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${APPVERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${APPVERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "YunhuLaoda contributors"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "此安装包需要 64 位 Windows 10 或更新版本。"
    Abort
  ${EndIf}
  SetRegView 64
  ReadRegStr $0 HKCU "${UNINSTKEY}" "InstallLocation"
  ${If} $0 != ""
    StrCpy $1 $0 1
    ${If} $1 == '$\"'
      StrCpy $0 $0 -1 1
    ${EndIf}
    StrCpy $INSTDIR $0
  ${EndIf}
FunctionEnd

Section "云湖牢大版" Main
  SetShellVarContext current
  ; Existing files may be locked by the running app. Do not silently skip them.
  SetOverwrite on
  SetOutPath "$INSTDIR"
  File "${STAGE}/yunhulaoda-desktop.exe"
  File "${STAGE}/WebView2Loader.dll"
  File "${STAGE}/node.exe"
  File "${STAGE}/server-bundle.mjs"
  File "${STAGE}/MicrosoftEdgeWebview2Setup.exe"
  SetOutPath "$INSTDIR\dist"
  File /r "${STAGE}/dist/*"
  SetOutPath "$INSTDIR"
  ; Install the Microsoft Evergreen WebView2 runtime if the machine has none.
  ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ReadRegStr $1 HKLM "Software\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
  ${AndIf} $1 == ""
    DetailPrint "正在安装 Microsoft WebView2 运行时…"
    ExecWait '$\"$INSTDIR\MicrosoftEdgeWebview2Setup.exe$\" /silent /install' $2
  ${EndIf}
  Delete "$INSTDIR\MicrosoftEdgeWebview2Setup.exe"
  CreateShortcut "$DESKTOP\云湖牢大版.lnk" "$INSTDIR\yunhulaoda-desktop.exe"
  CreateShortcut "$SMPROGRAMS\云湖牢大版.lnk" "$INSTDIR\yunhulaoda-desktop.exe"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "YunhuLaoda"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${APPVERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\yunhulaoda-desktop.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "MainBinaryName" "yunhulaoda-desktop.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '$\"$INSTDIR\uninstall.exe$\"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  Delete "$DESKTOP\云湖牢大版.lnk"
  Delete "$SMPROGRAMS\云湖牢大版.lnk"
  Delete "$INSTDIR\yunhulaoda-desktop.exe"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\node.exe"
  Delete "$INSTDIR\server-bundle.mjs"
  RMDir /r "$INSTDIR\dist"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
SectionEnd
