!macro customInit
  ; Existing users upgrade in place; new installations use the branded directory.
  !insertmacro GetDParameter $R0
  ${If} $R0 == ""
    ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $R1 == ""
      ReadRegStr $R1 HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${EndIf}
    ${If} $R1 != ""
      StrCpy $INSTDIR $R1
    ${Else}
    IfFileExists "$LOCALAPPDATA\Programs\Xiaoyu\Xiaoyu.exe" legacyPath brandedPath
    legacyPath:
      StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Xiaoyu"
      Goto pathSelected
    brandedPath:
      StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Zhixu"
    pathSelected:
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  ; Remove only the previous executable after the branded executable was installed.
  IfFileExists "$INSTDIR\Zhixu.exe" 0 +2
    Delete "$INSTDIR\Xiaoyu.exe"
!macroend
