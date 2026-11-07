; Jollof Studio — crochets de l'installateur Windows (NSIS).
; L'installateur propose le français ou l'anglais. La langue choisie devient celle de
; l'application : elle est écrite dans language.txt, à côté de l'exécutable, et lue au
; démarrage (commande install_language, src-tauri/src/lib.rs).
; 1036 = identifiant Windows du français ; toute autre langue donne l'anglais.

!macro NSIS_HOOK_POSTINSTALL
  FileOpen $0 "$INSTDIR\language.txt" w
  ${If} $LANGUAGE == 1036
    FileWrite $0 "fr"
  ${Else}
    FileWrite $0 "en"
  ${EndIf}
  FileClose $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\language.txt"
!macroend
