!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!ifndef KATARUNE_DATA_NAME
  !define KATARUNE_DATA_NAME "katarune"
!endif
!ifndef KATARUNE_UNITY_PRODUCT
  !define KATARUNE_UNITY_PRODUCT "Katarune Avatar Desktop"
!endif
!ifndef KATARUNE_HELPER_DIR
  !define KATARUNE_HELPER_DIR "${BUILD_RESOURCES_DIR}\installer"
!endif

Var KataruneDialog
!ifndef BUILD_UNINSTALLER
  Var KataruneChoice
  Var KataruneTarget
!else
  Var KataruneDeleteAll
!endif

!ifndef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_GUIINIT KataruneGuiInit
!else
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.KataruneGuiInit
!endif
!define MUI_ABORTWARNING ""
!define MUI_UNABORTWARNING ""
!undef MUI_ABORTWARNING
!undef MUI_UNABORTWARNING

!macro KataruneAssets
  InitPluginsDir
  ; GUI callbacks and the worker share the same files. Never overwrite a
  ; loaded visual DLL when validating a target or starting removal.
  ${IfNot} ${FileExists} "$PLUGINSDIR\prepare.ps1"
    File /oname=$PLUGINSDIR\KataruneSkin.dll "${BUILD_RESOURCES_DIR}\..\build\installer-nsis\KataruneSkin.dll"
    File /oname=$PLUGINSDIR\background.png "${BUILD_RESOURCES_DIR}\installer-background.png"
    File /oname=$PLUGINSDIR\logo.png "${BUILD_RESOURCES_DIR}\katarune-logo.png"
    File /oname=$PLUGINSDIR\cleanup.ps1 "${KATARUNE_HELPER_DIR}\cleanup.ps1"
    File /oname=$PLUGINSDIR\prepare.ps1 "${KATARUNE_HELPER_DIR}\prepare.ps1"
  ${EndIf}
!macroend

!macro KataruneGui PREFIX
Function ${PREFIX}KataruneGuiInit
  !insertmacro KataruneAssets
  System::Call '$PLUGINSDIR\KataruneSkin.dll::Attach(p $HWNDPARENT, w "$PLUGINSDIR", w "${VERSION}") v c'
FunctionEnd
!macroend
!ifndef BUILD_UNINSTALLER
  !insertmacro KataruneGui ""
!else
  !insertmacro KataruneGui "un."
!endif

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customWelcomePage
  Page custom KataruneOptions KataruneOptionsLeave
!macroend
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW KataruneProgress
!macroend
!macro customFinishPage
  Page custom KataruneFinished KataruneLaunch
!macroend
!macro customUnWelcomePage
  UninstPage custom un.KataruneOptions un.KataruneOptionsLeave
!macroend
!macro customUninstallPage
  UninstPage custom un.KataruneFinished
  !define MUI_PAGE_CUSTOMFUNCTION_PRE un.KataruneSkipNativeFinish
!macroend

!macro KatarunePage MODE
  nsDialogs::Create 1018
  Pop $KataruneDialog
  System::Call '$PLUGINSDIR\KataruneSkin.dll::HideNativePage(p $KataruneDialog) v c'
  System::Call '$PLUGINSDIR\KataruneSkin.dll::Page(i ${MODE}, w "$INSTDIR") v c'
  nsDialogs::Show
!macroend
!ifndef BUILD_UNINSTALLER
Function KataruneOptions
  !insertmacro KatarunePage 0
FunctionEnd
Function KataruneOptionsLeave
  System::Call '$PLUGINSDIR\KataruneSkin.dll::ReadPath(w .r0, i ${NSIS_MAX_STRLEN}) v c'
  StrCpy $INSTDIR $0
  StrCpy $KataruneTarget $0
  System::Call '$PLUGINSDIR\KataruneSkin.dll::ReadChoice() i .r0 c'
  StrCpy $KataruneChoice $0
  Call KataruneValidateTarget
FunctionEnd
Function KataruneValidateTarget
  !insertmacro KataruneAssets
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\prepare.ps1" -TargetDir "$INSTDIR" -Product "${PRODUCT_NAME}"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$1"
    Abort
  ${EndIf}
FunctionEnd
Function KataruneProgress
  StrCpy $INSTDIR $KataruneTarget
  FindWindow $KataruneDialog "#32770" "" $HWNDPARENT
  System::Call '$PLUGINSDIR\KataruneSkin.dll::HideNativePage(p $KataruneDialog) v c'
  System::Call '$PLUGINSDIR\KataruneSkin.dll::Page(i 1, w "$INSTDIR") v c'
FunctionEnd
Function KataruneFinished
  !insertmacro KatarunePage 2
FunctionEnd
Function KataruneLaunch
  System::Call '$PLUGINSDIR\KataruneSkin.dll::ReadLaunch() i .r0 c'
  ${If} $0 == 1
    ExecShell "open" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  ${EndIf}
FunctionEnd
!else
Function un.KataruneOptions
  !insertmacro KatarunePage 3
FunctionEnd
Function un.KataruneOptionsLeave
  System::Call '$PLUGINSDIR\KataruneSkin.dll::ReadChoice() i .r0 c'
  StrCpy $KataruneDeleteAll "false"
  ${If} $0 == 1
    StrCpy $KataruneDeleteAll "true"
  ${EndIf}
  Call un.KataruneProgress
FunctionEnd
Function un.KataruneProgress
  FindWindow $KataruneDialog "#32770" "" $HWNDPARENT
  System::Call '$PLUGINSDIR\KataruneSkin.dll::HideNativePage(p $KataruneDialog) v c'
  System::Call '$PLUGINSDIR\KataruneSkin.dll::Page(i 4, w "$INSTDIR") v c'
FunctionEnd
Function un.KataruneFinished
  !insertmacro KatarunePage 5
FunctionEnd
Function un.KataruneSkipNativeFinish
  Abort
FunctionEnd
!endif

!macro customInit
  StrCpy $KataruneChoice "1"
  StrCpy $KataruneTarget $INSTDIR
  ${If} ${Silent}
    Call KataruneValidateTarget
  ${EndIf}
!macroend
!macro customInstall
  SetDetailsPrint both
  DetailPrint "正在写入安装信息…"
  ${If} $KataruneChoice == "0"
    Delete "$newDesktopLink"
  ${EndIf}
  CreateDirectory "$INSTDIR\.installer"
  FileOpen $0 "$INSTDIR\.installer\identity.json" w
  FileWrite $0 '{"product":"${PRODUCT_NAME}","engine":"nsis"}'
  FileClose $0
!macroend
; electron-builder suppresses file details before extraction. Resume its
; native detail stream at the supported post-extraction hook.
!macro customFiles_x64
  SetDetailsPrint both
  DetailPrint "正在配置应用和快捷方式…"
!macroend
!macro customUnInit
  StrCpy $KataruneDeleteAll "false"
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--delete-all-data" $1
  ${IfNot} ${Errors}
    StrCpy $KataruneDeleteAll "true"
  ${EndIf}
!macroend
!macro customUnInstall
  ${IfNot} ${isUpdated}
    !insertmacro KataruneAssets
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cleanup.ps1" -Action Validate -DeleteAll "$KataruneDeleteAll" -DataName "${KATARUNE_DATA_NAME}" -UnityProduct "${KATARUNE_UNITY_PRODUCT}"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      SetErrorLevel 2
      MessageBox MB_OK|MB_ICONEXCLAMATION "$1" /SD IDOK
      Quit
    ${EndIf}
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cleanup.ps1" -Action Clean -DeleteAll "$KataruneDeleteAll" -DataName "${KATARUNE_DATA_NAME}" -UnityProduct "${KATARUNE_UNITY_PRODUCT}"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      SetErrorLevel 2
      MessageBox MB_OK|MB_ICONEXCLAMATION "$1" /SD IDOK
      Quit
    ${EndIf}
  ${EndIf}
!macroend
