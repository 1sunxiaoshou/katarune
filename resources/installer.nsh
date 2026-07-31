!ifdef BUILD_UNINSTALLER
  # NSIS 3.0.4.1 needs the UTF-8 BOM on this include to compile Chinese strings.
  LangString KataruneUninstallApplication 1033 "Remove Katarune and disposable caches"
  LangString KataruneUninstallApplication 2052 "删除言奏程序和可丢弃缓存"
  LangString KataruneDeleteAllLocalData 1033 "Also delete all local data (cannot be undone)"
  LangString KataruneDeleteAllLocalData 2052 "同时删除全部本地数据（无法恢复）"
  LangString KataruneCleanupPageText 1033 "Choose whether to keep your characters, conversations, settings, assets, and encrypted credentials. Personal data is preserved by default."
  LangString KataruneCleanupPageText 2052 "请选择是否保留角色、会话、设置、资产和加密凭据。默认保留个人数据。"
  LangString KataruneCleanupPageList 1033 "Cleanup scope:"
  LangString KataruneCleanupPageList 2052 "清理范围："
  LangString KataruneCleanupFailed 1033 "Katarune could not remove this directory. Close programs that may be using it and choose Retry, or choose Cancel to leave it for manual cleanup:"
  LangString KataruneCleanupFailed 2052 "言奏无法删除以下目录。请关闭可能正在使用它的程序并选择“重试”，或选择“取消”并稍后手动清理："

  !define UNINSTALL_SECTION_NAME "$(KataruneUninstallApplication)"
  !define MUI_COMPONENTSPAGE_TEXT_TOP "$(KataruneCleanupPageText)"
  !define MUI_COMPONENTSPAGE_TEXT_COMPLIST "$(KataruneCleanupPageList)"

  Function un.KataruneRemoveDirectory
    Exch $R0
    Push $R1

    KataruneRemoveDirectoryRetry:
      ClearErrors
      RMDir /r "$R0"
      IfFileExists "$R0\*.*" 0 KataruneRemoveDirectoryDone
      IfSilent KataruneRemoveDirectoryDone

      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON1 "$(KataruneCleanupFailed)$\r$\n$R0" IDRETRY KataruneRemoveDirectoryRetry

    KataruneRemoveDirectoryDone:
      Pop $R1
      Pop $R0
  FunctionEnd

  !macro KataruneRemoveDirectory path
    Push "${path}"
    Call un.KataruneRemoveDirectory
  !macroend

  !macro KataruneRemoveDisposableData
    !insertmacro KataruneRemoveDirectory "$APPDATA\${APP_FILENAME}\tts-cache"
    !insertmacro KataruneRemoveDirectory "$APPDATA\${APP_FILENAME}\asset-staging"

    !ifdef APP_PRODUCT_FILENAME
      !insertmacro KataruneRemoveDirectory "$APPDATA\${APP_PRODUCT_FILENAME}\tts-cache"
      !insertmacro KataruneRemoveDirectory "$APPDATA\${APP_PRODUCT_FILENAME}\asset-staging"
    !endif

    !ifdef APP_PACKAGE_NAME
      !insertmacro KataruneRemoveDirectory "$APPDATA\${APP_PACKAGE_NAME}\tts-cache"
      !insertmacro KataruneRemoveDirectory "$APPDATA\${APP_PACKAGE_NAME}\asset-staging"
      !insertmacro KataruneRemoveDirectory "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
    !endif
  !macroend

  !macro KataruneRemoveAllLocalData
    !insertmacro KataruneRemoveDirectory "$APPDATA\${APP_FILENAME}"

    !ifdef APP_PRODUCT_FILENAME
      !insertmacro KataruneRemoveDirectory "$APPDATA\${APP_PRODUCT_FILENAME}"
    !endif

    !ifdef APP_PACKAGE_NAME
      !insertmacro KataruneRemoveDirectory "$APPDATA\${APP_PACKAGE_NAME}"
      !insertmacro KataruneRemoveDirectory "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
    !endif
  !macroend

  !macro customUnInit
    ${IfNot} ${isUpdated}
      ${GetParameters} $R0
      ClearErrors
      ${GetOptions} $R0 "/S" $R1
      ${If} ${Errors}
        SetSilent normal
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customUnInstall
    ${IfNot} ${isUpdated}
      SetOutPath "$TEMP"
      !insertmacro KataruneRemoveDisposableData
    ${EndIf}
  !macroend

  !macro customUnInstallSection
    Section /o "un.$(KataruneDeleteAllLocalData)" KataruneDeleteAllLocalDataSection
      ${IfNot} ${isUpdated}
        SetOutPath "$TEMP"
        !insertmacro KataruneRemoveAllLocalData
      ${EndIf}
    SectionEnd
  !macroend
!endif
