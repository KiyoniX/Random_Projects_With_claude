# mcu, le microcontrôleur de la console

`mcu` est le module qui parle au microcontrôleur de la console : batterie, chargeur, couvercle, boutons POWER et HOME, curseurs de volume et de 3D, voyants, horloge à pile, accéléromètre. Le microcontrôleur est une puce à part, branchée sur un bus I2C et reliée au processeur par **une seule broche d'interruption**. `mcu` n'écrit donc dans aucun registre matériel du processeur : il lit et écrit les registres du microcontrôleur par le service `i2c::MCU` (appareil 3), commande trois broches par `gpio:MCU`, et attend la broche d'interruption. Neuf services offrent 161 commandes en tout ; les 92 de `mcu::RTC` en portent la moitié.

Il fait aussi un travail rare : au démarrage, s'il trouve un microcontrôleur plus ancien que la version qu'il porte (3.65 pour la New 3DS), il **réécrit son micrologiciel** par I2C depuis une copie rangée dans sa section en lecture seule.

Fiche du 16 octobre 2026, produite avec Ghidra (`outils/ghidra_direct.py`), sept aiguillages rejoués par `outils/emulate_dispatch.py`, l'assembleur de devkitPro et une copie de 3dbrew (voir la fin). Les adresses sont celles du module chargé à `0x00100000`. Le contenu du micrologiciel n'est ni recopié ni décrit au-delà de son adresse et de sa taille.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013020001f02`, version 9.0.0 (`v9216`), un titre de la CTRNAND (lu dans l'exheader ; nom `mcu`) ; la NAND porte aussi `mcu-safe` (mode sans échec, `v9217`, non lu) |
| Fichier lu | `local/extrait/mcu/exefs/code.bin` et `exheader.bin` |
| Taille | 33 580 octets de code (`0x832c`), 16 960 de données en lecture seule (`0x4240`, dont 16 387 octets de micrologiciel), 216 de données (`0xd8`), 11 816 de mémoire à zéro (`0x2e28`) ; pile de 4 096 octets ; priorité de départ 9 |
| Fonctions | 301 (285 pour Ghidra et 16 entrées manquées), 8 en Thumb, 293 en ARM |
| Services offerts | neuf, une session au plus chacun : `mcu::CAM`, `mcu::GPU`, `mcu::HID`, `mcu::RTC`, `mcu::SND`, `mcu::NWM`, `mcu::HWC`, `mcu::PLS`, `mcu::CDC` (partie 2) |
| Services appelés | `i2c::MCU` et `gpio:MCU`, plus `srv:` et le port `err:f`. L'exheader déclare en plus `ptm:s`, que le code n'ouvre pas : le nom n'est pas dans le module |
| Autres accès | **aucun** : pas de page matérielle, pas d'interruption déclarée, et le masque d'appels système de l'exheader n'a ni `BindInterrupt` ni `UnbindInterrupt` (les interruptions passent par `gpio:MCU`) |
| Dépendances déclarées | aucune |
| Fils | le fil principal, **un fil par session ouverte** (priorité 20, pile de `0x400` octets), et un fil d'interruption (priorité 11) |

## Partie 1 : le démarrage

`entry` (`0x100000`) enchaîne `clear_bss`, les constructeurs et `run_init_array`, puis appelle `mcu_main` (`0x1000e8`, 1 464 octets). `mcu_main` :

1. **Se déclarer à `sm`.** Constructeurs puis `srv_init` (`0x1044e4`) et `SRV_RegisterClient`.
2. **Les noms.** Neuf `SRV_RegisterService` (`0x100ed4`) dans l'ordre de la table de `0x10e034`. Chaque service a **1** session au plus.
3. **Les notifications.** Un seul objet, la notification `0x100` (arrêt), par `register_notification_handler` ; pas de `SRV_Subscribe`.
4. **Le matériel.** `mcu_init_interrupts` (`0x10086c`), une seule fois (octet `0x10e004`) :
   - ouvre `i2c::MCU` (`srv_get_service_handle_by_name`, `0x103cbc`) et `gpio:MCU` (`srv_get_service_handle`, `0x103ce8`) ;
   - initialise ses verrous : deux pour les accès au microcontrôleur (`0x10e0e4` et `0x10e0f0`) et celui des interruptions (`0x10e508`) ;
   - crée l'événement d'interruption (`0x10e008`) puis, sous le verrou, autorise l'interruption de la broche `0x8000` de `gpio:MCU` et l'accroche à cet événement par `GPIOMCU_BindInterrupt` (`0x10140c`, priorité 8) ;
   - efface l'alarme de l'horloge (`mcu_SetRTCAlarm` avec cinq zéros, registre `0x38`), lit les interruptions déjà en attente (registre `0x10`), lit le registre libre d'indice 0 et en remet à zéro le bit 2 (ce bit est mis à 1 par le traitement du bouton POWER maintenu, voir la partie 4). Si ce bit était à 1 ou si le bit 1 des interruptions en attente est à 1, et que l'octet `0x1FF80016` de la page de configuration partagée a son bit 0, ou que le bit 1 est à 1, l'octet `0x10E006` est levé (condition lue dans le pseudo-code, sens interprété) ;
   - crée le **fil d'interruption** `mcu_interrupt_thread_main` (`0x1012a8`, priorité 11, processeur par défaut) ;
   - écrit le masque d'interruptions **`0xC3FF`** (bits 0 à 9, 14 et 15 : bouton POWER, HOME, WiFi, couvercle, chargeur, batterie qui charge ou non) ; les autres bits sont allumés plus tard, par les sessions (partie 3).
5. **La version du microcontrôleur.** Lit les registres 0 et 1 (`mcu_read_regs`). Si le premier est inférieur à `0x13`, ou égal à `0x13` avec le second inférieur à `0x41`, `mcu` **réécrit le micrologiciel** (partie 5).
6. **Après.** Si l'octet `0x10e006` est levé, traite l'interruption 2 (bouton POWER maintenu) comme reçue ; si le niveau de batterie lu est 0, traite l'interruption `0x2000`.
7. **L'attente.** Boucle sur `WaitSynchronizationN` de dix poignées (neuf ports, un sémaphore) :
   - indice 9 (sémaphore) : `handle_srv_notification` ;
   - indices 0 à 8 : `svcAcceptSession` puis **un fil de session** pour ce service (priorité 20, processeur par défaut, pile de `0x400` octets à `0x10e560` + `0x400` fois l'indice). Si le service avait déjà un fil terminé, il est joint d'abord.
8. **La sortie.** À la notification `0x100` : `mcu_shutdown_interrupts` (`0x100c14`, retire l'interruption de `gpio:MCU`, lève l'événement pour que le fil d'interruption sorte, le joint, ferme `i2c::MCU` et `gpio:MCU`), jointure des fils de session, retrait des neuf services, `srv_exit`.

## Partie 2 : les services et les fils de session

Chaque service a sa propre boucle de session et, sauf pour `mcu::CAM` et `mcu::CDC`, sa fonction d'aiguillage ; les commandes de ces deux-là sont écrites dans la boucle. Tous les fils de session ont la même forme : `mcu_<service>_session_thread` (une fonction de 80 à 400 octets) appelle `mcu_<service>_session_loop` (`svcReplyAndReceive` puis l'aiguillage) et décrémente le compteur de sessions (`0x10e030`).

| N° | Service | Fil de session | Boucle | Aiguillage | Bits du masque d'interruptions allumés à l'ouverture |
| --- | --- | --- | --- | --- | --- |
| 0 | `mcu::CAM` | `0x107e74` | `0x102350` | dans la boucle (2 commandes) | aucun |
| 1 | `mcu::GPU` | `0x107f7c` | `0x101eec` | `0x102558` | `0x3F000000` (retirés à la fermeture) |
| 2 | `mcu::HID` | `0x108078` | `0x101f98` | `0x10294c` | `0x800` (accéléromètre), puis `0x1800` retirés à la fermeture |
| 3 | `mcu::RTC` | `0x1081c8` | `0x1020f0` | `0x10498c` | `0x2E702` (jamais retirés) |
| 4 | `mcu::SND` | `0x1082d4` | `0x1022a4` | `0x10649c` | aucun |
| 5 | `mcu::NWM` | `0x108170` | `0x102044` | `0x1046e4` | aucun |
| 6 | `mcu::HWC` | `0x107ecc` | `0x1024ac` | `0x10659c` | aucun |
| 7 | `mcu::PLS` | `0x107f24` | `0x1063f0` | `0x106b38` | aucun |
| 8 | `mcu::CDC` | `0x10827c` | `0x10219c` | dans la boucle (1 commande) | aucun |

Les masques sont ceux du module : un bit à 1 veut dire « interruption autorisée », ce qui est l'inverse du registre 0x18 du microcontrôleur (0 = autorisée, d'après 3dbrew) ; `mcu_GetInterruptMask` (`0x103134`) et `mcu_SetInterruptMask` (`0x103b4c`) inversent et gardent 30 bits. Ils sont écrits ou lus sous le verrou `0x10e0e4`.

## Partie 3 : les commandes

Les 161 commandes sont dans les neuf tableaux qui suivent. Pour toutes, seul le numéro compte dans l'en-tête, sauf pour celles qui prennent un tampon (HWC 1 à 3, RTC 34, 56 à 58 : en-tête entier comparé). Un numéro inconnu rend `0x00000040` et `0xD900182F`. Chaque aiguillage prend le verrou `0x10e0e4` (`lock_enter`), appelle la fonction de travail, rend le verrou (`lock_leave`). Les noms de commande sont ceux de 3dbrew (page « MCU Services ») ; l'adresse de la fonction de travail est lue dans l'aiguillage par `emulate_dispatch.py`, et les registres du microcontrôleur dans le pseudo-code de la fonction de travail (un script lit les constantes passées à `mcu_read_regs` et `mcu_write_regs`). Le nombre de commandes de chaque aiguillage est celui de 3dbrew : 2, 14, 15, 92, 3, 8, 17, 9, 1.

### mcu::CAM

| N° | Commande (3dbrew) | Fonction | Adresse | Réponse | Registres du MCU |
| --- | --- | --- | --- | --- | --- |
| 1 | WriteCameraLedState | `mcu_WriteCameraLedState` | `0x103238` | `0x00010040` | écrit 0x2B |
| 2 | ReadCameraLedState | `mcu_ReadCameraLedState` | `0x107728` | `0x00020080` | lit 0x2B |

### mcu::GPU

| N° | Commande (3dbrew) | Fonction | Adresse | Réponse | Registres du MCU |
| --- | --- | --- | --- | --- | --- |
| 1 | GetLcdPowerState | `mcu_GetLcdPowerState` | `0x107674` | `0x000100c0` | lit 0xf |
| 2 | SetLcdPowerState | `mcu_SetLcdPowerState` | `0x107278` | `0x00020040` | écrit 0x22 |
| 3 | GetGpuLcdInterfaceState | `mcu_GetGpuLcdInterfaceState` | `0x1071a0` | `0x00030080` | lit 0xf |
| 4 | SetGpuLcdInterfaceState | `mcu_SetGpuLcdInterfaceState` | `0x107a28` | `0x00040040` | écrit 0x22 |
| 5 | SetTopScreenFlicker | `mcu_SetScreenFlickerTop` | `0x10321c` | `0x00050040` | écrit 3 |
| 6 | GetTopScreenFlicker | `mcu_GetScreenFlickerTop` | `0x10320c` | `0x00060080` | lit 3 |
| 7 | SetBottomScreenFlicker | `mcu_SetScreenFlickerBottom` | `0x1031f0` | `0x00070040` | écrit 4 |
| 8 | GetBottomScreenFlicker | `mcu_GetScreenFlickerBottom` | `0x1031e0` | `0x00080080` | lit 4 |
| 9 | GetMcuFwVerHigh | `mcu_GetMcuFwVerHigh` | `0x104418` | `0x00090080` | lit 0x0 |
| 10 | GetMcuFwVerLow | `mcu_GetMcuFwVerLow` | `0x104408` | `0x000a0080` | lit 0x1 |
| 11 | Set3dLedState | `mcu_Set3dLedState` | `0x1031c4` | `0x000b0040` | écrit 0x2c |
| 12 | Get3dLedState | `mcu_Get3dLedState` | `0x107620` | `0x000c0080` | lit 0x2c |
| 13 | GetMcuGpuEventHandle | dans l'aiguillage |  | `0x000d0042` | rend la poignée de l'événement 0x10E0FC |
| 14 | GetMcuGpuEventReason | dans l'aiguillage |  | `0x000e0080` | rend l'état 0x10E0D8 |

### mcu::HID

| N° | Commande (3dbrew) | Fonction | Adresse | Réponse | Registres du MCU |
| --- | --- | --- | --- | --- | --- |
| 1 | (sans nom) | `mcu_SetRegister40Bit0` | `0x107464` | `0x00010040` | SetRegisterBits8 sur le registre 0x40, bit 0 |
| 2 | (sans nom) | `mcu_GetRegister40Bit0` | `0x1073c4` | `0x00020080` | lit 0x40 |
| 3 | (sans nom) | `mcu_WriteRegister41h` | `0x1031a8` | `0x00030040` | écrit 0x41 |
| 4 | (sans nom) | `mcu_ReadRegister44h` | `0x103198` | `0x00040080` | lit 0x44 |
| 5 | (sans nom) | `mcu_WriteRegisters43h44h` | `0x103178` | `0x00050040` | écrit 0x43 |
| 6 | ReadGyroscopeValues | `mcu_ReadGyroscopeValues` | `0x106ec8` | `0x000600c0` | lit 0x45 |
| 7 | GetRaw3DSliderPosition | `mcu_GetRaw3DSliderPosition` | `0x107368` | `0x00070080` | lit 8 |
| 8 | (sans nom) | `mcu_SetAccelRegister23h` | `0x1074fc` | `0x00080040` | registres 0x43 et 0x44 : accès indirect au registre 0x23, bits 4 et 5 |
| 9 | (sans nom) | `mcu_GetAccelRegister23h` | `0x1074ac` | `0x00090080` | registres 0x43 et 0x44 : accès indirect au registre 0x23, bits 4 et 5 |
| 10 | (sans nom) | `mcu_SetAccelRegister21hBit4` | `0x102e2c` | `0x000a0040` | registres 0x43 et 0x44 : accès indirect au registre 0x21, bit 4 (écriture) |
| 11 | (sans nom) | `mcu_GetAccelRegister21hBit4` | `0x107908` | `0x000b0080` | registres 0x43 et 0x44 : accès indirect au registre 0x21, bit 4 (lecture) |
| 12 | GetMcuHidEventHandle | dans l'aiguillage |  | `0x000c0042` | rend la poignée de l'événement 0x10E100 |
| 13 | GetMcuHidEventReason | dans l'aiguillage |  | `0x000d0080` | rend l'état 0x10E0DC |
| 14 | GetSoundVolume | `mcu_GetSoundVolume` | `0x103168` | `0x000e0080` | lit 9 |
| 15 | EnableAccelerometerInterrupt | dans l'aiguillage |  | `0x000f0040` | bit 0x800 du masque d'interruptions (registre 0x18) : lit, change le bit selon le paramètre, réécrit |

### mcu::RTC

| N° | Commande (3dbrew) | Fonction | Adresse | Réponse | Registres du MCU |
| --- | --- | --- | --- | --- | --- |
| 1 | SetRTC | `mcu_SetRTC` | `0x107a68` | `0x00010040` | écrit 0x30 |
| 2 | GetRTC | `mcu_GetRTC` | `0x1030e0` | `0x00020140` | lit 0x30 |
| 3 | SetRTCSeconds | `mcu_SetRTCSeconds` | `0x1072f4` | `0x00030040` | écrit 0x30 |
| 4 | GetRTCSeconds | `mcu_GetRTCSeconds` | `0x1030ac` | `0x00040100` | lit 0x30 |
| 5 | SetRTCMinutes | `mcu_SetRTCMinutes` | `0x1072bc` | `0x00050040` | écrit 0x31 |
| 6 | GetRTCMinutes | `mcu_GetRTCMinutes` | `0x103078` | `0x00060100` | lit 0x31 |
| 7 | SetRTCHours | `mcu_SetRTCHours` | `0x106f1c` | `0x00070040` | écrit 0x32 |
| 8 | GetRTCHours | `mcu_GetRTCHours` | `0x103044` | `0x00080100` | lit 0x32 |
| 9 | SetRTCDayOfWeek | `mcu_SetRTCDayOfWeek` | `0x106f54` | `0x00090040` | écrit 0x33 |
| 10 | GetRTCDayOfWeek | `mcu_GetRTCDayOfWeek` | `0x103010` | `0x000a0100` | lit 0x33 |
| 11 | SetRTCDayOfMonth | `mcu_SetRTCDayOfMonth` | `0x107abc` | `0x000b0040` | écrit 0x34 |
| 12 | GetRTCDayOfMonth | `mcu_GetRTCDayOfMonth` | `0x102fdc` | `0x000c0100` | lit 0x34 |
| 13 | SetRTCMonth | `mcu_SetRTCMonth` | `0x1070f0` | `0x000d0040` | écrit 0x35 |
| 14 | GetRTCMonth | `mcu_GetRTCMonth` | `0x102fa8` | `0x000e0100` | lit 0x35 |
| 15 | SetRTCYear | `mcu_SetRTCYear` | `0x106f8c` | `0x000f0040` | écrit 0x36 |
| 16 | GetRTCYear | `mcu_GetRTCYear` | `0x102f74` | `0x00100100` | lit 0x36 |
| 17 | SetRTCLeapYearCounter | `mcu_SetRTCLeapYearCounter` | `0x1076e4` | `0x00110040` | écrit 0x37 |
| 18 | GetRTCLeapYearCounter | `mcu_GetRTCLeapYearCounter` | `0x1076d4` | `0x00120080` | lit 0x37 |
| 19 | SetRTCAlarm | `mcu_SetRTCAlarm` | `0x103be8` | `0x00130040` | écrit 0x38 |
| 20 | GetRTCAlarm | `mcu_GetRTCAlarm` | `0x106fc4` | `0x001400c0` | lit 0x38 |
| 21 | SetRTCAlarmComponent | `mcu_SetRTCAlarmComponent0` | `0x107474` | `0x00150040` | écrit 0x38 |
| 22 | GetRTCAlarmComponent | `mcu_GetRTCAlarmComponent0` | `0x1073f4` | `0x00160080` | lit 0x38 |
| 23 | SetRTCAlarmComponent | `mcu_SetRTCAlarmComponent1` | `0x107208` | `0x00170040` | écrit 0x39 |
| 24 | GetRTCAlarmComponent | `mcu_GetRTCAlarmComponent1` | `0x107128` | `0x00180080` | lit 0x39 |
| 25 | SetRTCAlarmComponent | `mcu_SetRTCAlarmComponent2` | `0x1070b8` | `0x00190040` | écrit 0x3a |
| 26 | GetRTCAlarmComponent | `mcu_GetRTCAlarmComponent2` | `0x107068` | `0x001a0080` | lit 0x3a |
| 27 | SetRTCAlarmComponent | `mcu_SetRTCAlarmComponent3` | `0x107378` | `0x001b0040` | écrit 0x3b |
| 28 | GetRTCAlarmComponent | `mcu_GetRTCAlarmComponent3` | `0x10732c` | `0x001c0080` | lit 0x3b |
| 29 | SetRTCAlarmComponent | `mcu_SetRTCAlarmComponent4` | `0x107240` | `0x001d0040` | écrit 0x3c |
| 30 | GetRTCAlarmComponent | `mcu_GetRTCAlarmComponent4` | `0x107164` | `0x001e0080` | lit 0x3c |
| 31 | SetPedometerRecordingMode | `mcu_SetPedometerRecordingMode` | `0x102f28` | `0x001f0040` | SetRegisterBits8 sur le registre 0x40, bit 1 |
| 32 | GetPedometerRecordingMode | `mcu_GetPedometerRecordingMode` | `0x1071d4` | `0x00200080` | lit 0x40 |
| 33 | GetStepCount | `mcu_GetStepCount` | `0x1075d8` | `0x00210080` | lit 0x4b |
| 34 | ReadRegister4Fh | `mcu_ReadRegister4Fh` | `0x107740` | `0x00220042` | lit le registre 0x4F (0x156 octets) |
| 35 | (sans nom) | `mcu_WriteRegister4Eh` | `0x1073b0` | `0x00230040` | écrit 1 dans le registre 0x4E |
| 36 | GetPowerEventHandle | dans l'aiguillage |  | `0x00240042` | rend la poignée de l'événement 0x10E104 |
| 37 | GetPowerInterruptHistory | dans l'aiguillage |  | `0x00250080` | rend l'historique 0x10E0E0 |
| 38 | CheckRegister02hBit0 | `mcu_CheckRegister02hBit0` | `0x1075b0` | `0x00260080` | lit 2 |
| 39 | ClearRegister02hBit0 | `mcu_ClearRegister02hBit0` | `0x107710` | `0x00270040` | DisableRegisterBits8 sur le registre 2, bit 0 |
| 40 | CheckRegister02hBit1 | `mcu_CheckRegister02hBit1` | `0x107638` | `0x00280080` | lit 2 |
| 41 | ClearRegister02hBit1 | `mcu_ClearRegister02hBit1` | `0x10771c` | `0x00290040` | DisableRegisterBits8 sur le registre 2, bit 1 |
| 42 | GetShellState | `mcu_GetShellState` | `0x107430` | `0x002a0080` | lit 0xf |
| 43 | GetAdapterState | `mcu_GetAdapterState` | `0x107530` | `0x002b0080` | lit 0xf |
| 44 | GetBatteryChargeState | `mcu_GetBatteryChargeState` | `0x107808` | `0x002c0080` | lit 0xf |
| 45 | GetBatteryLevel | `mcu_GetBatteryLevel` | `0x103f40` | `0x002d0080` | lit 0xb |
| 46 | SetPowerModeIndicatorState | `mcu_SetPowerModeIndicatorState` | `0x102f58` | `0x002e0040` | écrit 0x29 |
| 47 | GetBatteryEmptyPatternByte0_safe | `mcu_GetBatteryEmptyPatternByte0_safe` | `0x1076bc` | `0x002f0080` | lit 0x29 |
| 48 | SetLEDBrightness | `mcu_SetLEDBrightness` | `0x10784c` | `0x00300040` | écrit 0x28 |
| 49 | GetLEDBrightness | `mcu_GetLEDBrightness` | `0x10783c` | `0x00310080` | lit 0x28 |
| 50 | PowerOff | `mcu_PowerOff` | `0x107a54` | `0x00320040` | écrit 1 dans le registre 0x20 |
| 51 | HardwareReboot | `mcu_HardwareReboot` | `0x1070a4` | `0x00330040` | écrit 4 dans le registre 0x20 |
| 52 | ResetMcu | `mcu_ResetMcu` | `0x106eb4` | `0x00340040` | écrit 0x72 dans le registre 0x23 |
| 53 | (sans nom) | `mcu_WriteRegister20_bit4` | `0x106f08` | `0x00350040` | écrit 0x10 dans le registre 0x20 |
| 54 | SetWatchdogTimer | `mcu_SetWatchdogTimer` | `0x107584` | `0x00360040` | écrit 0x24 |
| 55 | GetWatchdogTimer | `mcu_GetWatchdogTimer` | `0x107564` | `0x00370080` | lit 0x24 |
| 56 | GetInfoRegisters | `mcu_GetInfoRegisters` | `0x103a94` | `0x00380042` | lit 0x7f |
| 57 | SetPlayCountRegisters | `mcu_write_bank_register` | `0x104240` | `0x00390042` | écrit 0x60 écrit 0x61 |
| 58 | GetPlayCountRegisters | `mcu_read_bank_register` | `0x1042d8` | `0x003a0042` | écrit 0x60 lit 0x61 |
| 59 | SetInfoLEDPattern | `mcu_SetInfoLEDPattern` | `0x103a64` | `0x003b0040` | écrit 0x2d |
| 60 | SetInfoLEDPatternHeader | `mcu_SetInfoLEDPatternHeader` | `0x103a34` | `0x003c0040` | écrit 0x2d |
| 61 | GetInfoLEDStatus | `mcu_GetInfoLEDStatus` | `0x107574` | `0x003d0080` | lit 0x2e |
| 62 | WriteRegister50h | `mcu_WriteRegister50h` | `0x1079b8` | `0x003e0040` | écrit 0x50 |
| 63 | ReadRegister50h | `mcu_ReadRegister50h` | `0x107940` | `0x003f0080` | lit 0x50 |
| 64 | WriteRegister51h | `mcu_WriteRegister51h` | `0x1079f0` | `0x00400040` | écrit 0x51 |
| 65 | ReadRegister51h | `mcu_ReadRegister51h` | `0x10797c` | `0x00410080` | lit 0x51 |
| 66 | SetBatteryEmptyLEDPattern | `mcu_SetBatteryEmptyLEDPattern` | `0x1078a0` | `0x00420040` | lit 0x29 écrit 0x29 |
| 67 | SetScreenFlickerTop | `mcu_SetScreenFlickerTop` | `0x10321c` | `0x00430040` | écrit 3 |
| 68 | GetScreenFlickerTop | `mcu_GetScreenFlickerTop` | `0x10320c` | `0x00440080` | lit 3 |
| 69 | SetScreenFlickerBottom | `mcu_SetScreenFlickerBottom` | `0x1031f0` | `0x00450040` | écrit 4 |
| 70 | GetScreenFlickerBottom | `mcu_GetScreenFlickerBottom` | `0x1031e0` | `0x00460080` | lit 4 |
| 71 | SetVolumeSliderBounds | `mcu_SetVolumeSliderBounds` | `0x1078e8` | `0x00470040` | écrit 0x58 |
| 72 | GetVolumeSliderBounds | `mcu_GetVolumeSliderBounds` | `0x107868` | `0x004800c0` | lit 0x58 |
| 73 | SetInterruptMask | `mcu_SetInterruptMask` | `0x103b4c` | `0x00490040` | écrit 0x18 |
| 74 | GetInterruptMask | `mcu_GetInterruptMask` | `0x103134` | `0x004a0080` | lit 0x18 |
| 75 | ExitExclusiveInterruptMode | `mcu_ExitExclusiveInterruptMode` | `0x106e74` | `0x004b0040` | rend le verrou des interruptions (0x10E508) |
| 76 | EnterExclusiveInterruptMode | `mcu_EnterExclusiveInterruptMode` | `0x106e8c` | `0x004c0040` | prend le verrou des interruptions (0x10E508) |
| 77 | ReadInterrupt | `mcu_ReadInterrupt` | `0x106e2c` | `0x004d0080` | lit le registre 0x10 (quatre octets) |
| 78 | TriggerInterrupt | `mcu_TriggerInterrupt` | `0x106e18` | `0x004e0040` | traite les bits comme une interruption reçue (sans toucher au MCU) |
| 79 | SetMCUFirmUpdated | dans l'aiguillage |  | `0x004f0040` | écrit l'octet d'état 0x10E000 |
| 80 | IsMCUFirmUpdated | dans l'aiguillage |  | `0x00500080` | lit l'octet d'état 0x10E000 |
| 81 | SetSoftwareClosedFlag | dans l'aiguillage |  | `0x00510040` | banque de registres libres : indice dans le registre 0x60, valeur dans le registre 0x61 |
| 82 | GetSoftwareClosedFlag | dans l'aiguillage |  | `0x00520080` | banque de registres libres : indice dans le registre 0x60, valeur dans le registre 0x61 |
| 83 | SetLgyLcdData | dans l'aiguillage |  | `0x00530040` | banque de registres libres : indice dans le registre 0x60, valeur dans le registre 0x61 |
| 84 | GetLgyLcdData | dans l'aiguillage |  | `0x00540080` | banque de registres libres : indice dans le registre 0x60, valeur dans le registre 0x61 |
| 85 | SetLgyNativeResolutionFlag | dans l'aiguillage |  | `0x00550040` | banque de registres libres : indice dans le registre 0x60, valeur dans le registre 0x61 |
| 86 | GetLgyNativeResolutionFlag | dans l'aiguillage |  | `0x00560080` | banque de registres libres : indice dans le registre 0x60, valeur dans le registre 0x61 |
| 87 | SetLocalFriendCodeCounter | dans l'aiguillage |  | `0x00570040` | banque de registres libres : indice dans le registre 0x60, valeur dans le registre 0x61 |
| 88 | GetLocalFriendCodeCounter | dans l'aiguillage |  | `0x00580080` | banque de registres libres : indice dans le registre 0x60, valeur dans le registre 0x61 |
| 89 | SetLegacyJumpProhibitedFlag | dans l'aiguillage |  | `0x00590040` | banque de registres libres : indice dans le registre 0x60, valeur dans le registre 0x61 |
| 90 | GetLegacyJumpProhibitedFlag | dans l'aiguillage |  | `0x005a0080` | banque de registres libres : indice dans le registre 0x60, valeur dans le registre 0x61 |
| 91 | SetUUIDClockSequence | dans l'aiguillage |  | `0x005b0040` | banque de registres libres : indice dans le registre 0x60, valeur dans le registre 0x61 |
| 92 | GetUUIDClockSequence | dans l'aiguillage |  | `0x005c0080` | banque de registres libres : indice dans le registre 0x60, valeur dans le registre 0x61 |

### mcu::SND

| N° | Commande (3dbrew) | Fonction | Adresse | Réponse | Registres du MCU |
| --- | --- | --- | --- | --- | --- |
| 1 | GetSoundVolume | `mcu_GetSoundVolume` | `0x103168` | `0x00010080` | lit 9 |
| 2 | (sans nom) | `mcu_SetRegister25hBits` | `0x107664` | `0x00020040` | SetRegisterBits8 sur le registre 0x25, six bits du bas |
| 3 | GetRegister25h | `mcu_GetRegister25h` | `0x1075f0` | `0x00030080` | lit 0x25 |

### mcu::NWM

| N° | Commande (3dbrew) | Fonction | Adresse | Réponse | Registres du MCU |
| --- | --- | --- | --- | --- | --- |
| 1 | SetWirelessLedState | `mcu_SetWirelessLedState` | `0x1042bc` | `0x00010040` | écrit 0x2a |
| 2 | GetWirelessLedState | `mcu_GetWirelessLedState` | `0x1043b8` | `0x00020080` | lit 0x2a |
| 3 | (sans nom) | `GPIOMCU_SetData` | `0x104284` | `0x00030040` | gpio:MCU SetData |
| 4 | (sans nom) | `GPIOMCU_GetData` | `0x104354` | `0x00040080` | gpio:MCU GetData |
| 5 | SetEnableWifiGpio | dans l'aiguillage |  | `0x00050040` | gpio:MCU SetDirection puis SetData (broche 0x40000) |
| 6 | GetEnableWifiGpio | dans l'aiguillage |  | `0x00060080` | gpio:MCU SetDirection puis GetData (broche 0x40000) |
| 7 | SetWirelessDisabledFlag | dans l'aiguillage |  | `0x00070040` | banque de registres libres (registres 0x60 et 0x61) |
| 8 | GetWirelessDisabledFlag | dans l'aiguillage |  | `0x00080080` | banque de registres libres (registres 0x60 et 0x61) |

### mcu::HWC

| N° | Commande (3dbrew) | Fonction | Adresse | Réponse | Registres du MCU |
| --- | --- | --- | --- | --- | --- |
| 1 | ReadRegister | `mcu_read_regs_cmd12` | `0x1036a0` | `0x00010042` | lit un tampon depuis le registre donné (i2c 0x001200C2) |
| 2 | WriteRegister | `mcu_write_regs_cmd11` | `0x103a74` | `0x00020042` | écrit un tampon dans le registre donné (i2c 0x001100C2) |
| 3 | GetInfoRegisters | `mcu_GetInfoRegisters` | `0x103a94` | `0x00030042` | lit 0x7f |
| 4 | GetBatteryVoltage | `mcu_GetBatteryVoltage` | `0x1075a0` | `0x00040080` | lit 0xd |
| 5 | GetBatteryLevel | `mcu_GetBatteryLevel` | `0x103f40` | `0x00050080` | lit 0xb |
| 6 | SetPowerLEDPattern | `mcu_SetPowerModeIndicatorState` | `0x102f58` | `0x00060040` | écrit 0x29 |
| 7 | SetWifiLEDState | `mcu_SetWirelessLedState` | `0x1042bc` | `0x00070040` | écrit 0x2a |
| 8 | SetCameraLEDPattern | `mcu_WriteCameraLedState` | `0x103238` | `0x00080040` | écrit 0x2b |
| 9 | Set3DLEDState | `mcu_Set3dLedState` | `0x1031c4` | `0x00090040` | écrit 0x2c |
| 10 | SetInfoLEDPattern | `mcu_SetInfoLEDPattern` | `0x103a64` | `0x000a0040` | écrit 0x2d |
| 11 | GetSoundVolume | `mcu_GetSoundVolume` | `0x103168` | `0x000b0080` | lit 9 |
| 12 | SetTopScreenFlicker | `mcu_SetScreenFlickerTop` | `0x10321c` | `0x000c0040` | écrit 3 |
| 13 | SetBottomScreenFlicker | `mcu_SetScreenFlickerBottom` | `0x1031f0` | `0x000d0040` | écrit 4 |
| 14 | GetBatteryTemperature | `mcu_GetBatteryTemperature` | `0x1077f8` | `0x000e0080` | lit 10 |
| 15 | GetRtcTime | `mcu_GetRTC` | `0x1030e0` | `0x000f00c0` | lit 0x30 |
| 16 | GetMcuFwVerHigh | `mcu_GetMcuFwVerHigh` | `0x104418` | `0x00100080` | lit 0x0 |
| 17 | GetMcuFwVerLow | `mcu_GetMcuFwVerLow` | `0x104408` | `0x00110080` | lit 0x1 |

### mcu::PLS

| N° | Commande (3dbrew) | Fonction | Adresse | Réponse | Registres du MCU |
| --- | --- | --- | --- | --- | --- |
| 1 | GetDatetime | `mcu_GetRTC` | `0x1030e0` | `0x000100c0` | lit 0x30 |
| 2 | GetSeconds | `mcu_GetRTCSeconds` | `0x1030ac` | `0x00020080` | lit 0x30 |
| 3 | GetMinutes | `mcu_GetRTCMinutes` | `0x103078` | `0x00030080` | lit 0x31 |
| 4 | GetHour | `mcu_GetRTCHours` | `0x103044` | `0x00040080` | lit 0x32 |
| 5 | GetDayOfWeek | `mcu_GetRTCDayOfWeek` | `0x103010` | `0x00050080` | lit 0x33 |
| 6 | GetDay | `mcu_GetRTCDayOfMonth` | `0x102fdc` | `0x00060080` | lit 0x34 |
| 7 | GetMonth | `mcu_GetRTCMonth` | `0x102fa8` | `0x00070080` | lit 0x35 |
| 8 | GetYear | `mcu_GetRTCYear` | `0x102f74` | `0x00080080` | lit 0x36 |
| 9 | GetTickCounter | `mcu_GetTickCounter` | `0x1074ec` | `0x00090080` | lit 0x3d |

### mcu::CDC

| N° | Commande (3dbrew) | Fonction | Adresse | Réponse | Registres du MCU |
| --- | --- | --- | --- | --- | --- |
| 1 | (sans nom) | `mcu_SetRegister26hBit4` | `0x107700` | `0x00010040` | SetRegisterBits8 sur le registre 0x26, bit 4 |

Notes sur les tableaux :

- **Les registres du microcontrôleur** sont des numéros sur l'appareil 3 du bus I2C (`i2c::MCU`). « lit 0xf » veut dire que la fonction lit le registre `0xf` et en extrait un ou deux bits (voir la partie 4).
- **Les fonctions partagées.** La même fonction de travail sert plusieurs commandes de services différents (par exemple `mcu_GetBatteryLevel` pour `mcu::RTC` 45 et `mcu::HWC` 5). Le nom est celui de la première commande par ordre RTC, GPU, HWC, HID, PLS, NWM, SND.
- **mcu::HID 6.** 3dbrew nomme cette commande `ReadGyroscopeValues`. Le code lit les six octets des registres `0x45` à `0x4A` et décale chaque mot de 16 bits de 4 : trois valeurs de 12 bits, et la fiche de [hid](hid.md) les range dans la section de l'accéléromètre. Le nom du module (`mcu_ReadGyroscopeValues`) suit 3dbrew pour ne pas multiplier les noms ; le sens est celui de l'accéléromètre (interprété).
- **mcu::HID 1 à 5, 8 à 11 et mcu::SND 2.** Sans nom dans 3dbrew. Les noms du module disent les registres. Les commandes 8 à 11 passent par la paire de registres `0x43` (index) et `0x44` (valeur), un accès indirect à des registres internes de l'accéléromètre (`0x21` et `0x23`) : c'est ce que montrent les trois fonctions qui y accèdent (interprété).
- **mcu::NWM 3 et 4** appellent `GPIOMCU_SetData` et `GPIOMCU_GetData` ; 5 et 6 passent par `GPIOMCU_SetDirection` puis ces deux-là, sur la broche `0x40000` de `gpio:MCU` (WiFi activé, d'après la fiche de [gpio](gpio.md)). 3dbrew écrit « GPIO 0x20 » pour 3 et 4.
- **mcu::RTC 53** écrit `0x10` dans le registre `0x20` (3dbrew le décrit sans nom : « writes 0x10 to i2c MCU device, reg 0x20 »). **mcu::RTC 35** écrit 1 dans le registre `0x4E` (« not writable » dit 3dbrew).
- **mcu::RTC 79 et 80** (SetMCUFirmUpdated, IsMCUFirmUpdated) : l'octet `0x10E000` est celui que `mcu_main` met à 1 après avoir réécrit le micrologiciel ; je lis la commande 79 comme celle qui l'écrit (interprété).
- **mcu::RTC 81 à 92** : une banque de 16 octets de registres libres, atteinte par la paire `0x60` (indice) et `0x61` (valeur) ; chaque commande a son indice. 3dbrew les décrit sans registre.
- **Les noms `GPIOMCU_*`** sont ceux des commandes de [gpio](gpio.md) que la fonction envoie.
- **L'écriture d'heure** (`mcu_SetRTC`, `mcu_SetRTC*`) convertit chaque champ en BCD (dizaines dans les quatre bits du haut) avant de l'écrire ; la lecture fait l'inverse. `mcu::PLS` rend les mêmes champs en décimal (« Beg the sysmodule to return the datetime registers in decimal form instead of as a Binary Coded Decimal » dit 3dbrew).
- **Les commandes de mcu::HID 12 et 13, mcu::GPU 13 et 14, mcu::RTC 36 et 37** ne touchent pas au microcontrôleur : elles rendent la poignée de l'événement ou l'état accumulé par le fil d'interruption (partie 4).

## Partie 4 : le fil d'interruption et les notifications

La broche d'interruption du microcontrôleur est la broche `0x8000` de `gpio:MCU` (interruption `0x71`, « interruption MCU » d'après [gpio](gpio.md)). `mcu_interrupt_thread_main` (`0x1012a8`) :

1. attend l'événement `0x10e008` (`WaitSynchronization1`, sans délai) ;
2. prend le verrou des interruptions (`0x10e508`, celui que `EnterExclusiveInterruptMode` et `ExitExclusiveInterruptMode` prennent et rendent à la demande de `ptm`) ;
3. sous le verrou du bus, lit les **quatre octets du registre 0x10** (`mcu_read_pending_interrupts`, `0x103bb8`) : les interruptions en attente, un bit chacune. En cas d'erreur de lecture, la valeur est 0 ;
4. appelle `mcu_dispatch_interrupts` (`0x103f50`, 708 octets) avec ces bits ;
5. rend le verrou et reboucle.

`mcu_dispatch_interrupts(bits)` fait deux choses :

**Les trois événements des clients.** Trois masques sont rangés à `0x109000` (`0x3F000000`, `0x1800`, `0x2E702`). Pour chacun, si `bits` en contient, la fonction les ajoute au mot « raison » du service (`0x10E0D8` pour `mcu::GPU`, `0x10E0DC` pour `mcu::HID`, `0x10E0E0` pour `mcu::RTC`, qui sont ce que rendent GetMcuGpuEventReason, GetMcuHidEventReason et GetPowerInterruptHistory) et signale l'événement du service (`0x10E0FC`, `0x10E100`, `0x10E104`, ce que rendent GetMcuGpuEventHandle, GetMcuHidEventHandle et GetPowerEventHandle). Le bit `0x1000` est aussi ajouté à la raison de `mcu::HID`. Les masques sont ceux de 3dbrew : « MCU notifications 24 to 29 » pour le GPU, « 11 and 12 » pour le HID, « 1, 8, 9, 10, 13, 14 and 15 » (plus 17) pour l'énergie.

**Les notifications système.** Pour chaque bit connu, `publish_notification` (`0x1036c4`, appelle `SRV_PublishToSubscriber`, `0x101934`, en-tête `0x000C0080`) envoie à `sm` un numéro de notification que ses abonnés recevront. Le second paramètre (0 ou 1) est un drapeau dont le sens n'est pas lu.

| Bit de l'interruption | Sens (3dbrew, registre 0x10) | Notification publiée | Drapeau | Abonné connu |
| --- | --- | --- | --- | --- |
| 0 | bouton POWER pressé | `0x202` | 0 | [ns](ns.md) (fiche : « notification 8 ») |
| 1 | bouton POWER maintenu | `0x203` | 0 | [ns](ns.md) (arrêt, `PTMSYSM_ShutdownAsync`) ; avant, met aussi à 1 le bit 2 du registre libre d'indice 0 |
| 2 | HOME pressé | `0x204` | 1 | [ns](ns.md) |
| 3 | HOME relâché | `0x205` | 0 | [ns](ns.md) |
| 4 | commutateur WiFi | `0x206` | 1 | (non lu) |
| 5 et 6 | couvercle fermé ou ouvert | `0x200` | 1 | [ns](ns.md) (minuterie de 200 ms) |
| 7 | condition matérielle fatale (chien de garde) | `0x20C` | 0 | [ptm](ptm.md) (inscrit à `0x20C`) |
| 8 | chargeur retiré | `0x20D` | 0 | (non lu) |
| 9 | chargeur branché | `0x20E` | 0 | (non lu) |
| 14 | batterie arrête de charger | `0x210` | 0 | (non lu) |
| 15 | batterie commence à charger | `0x20F` | 0 | (non lu) |
| 11 (`0x800`) | accéléromètre | (réveille la file d'attente interne `0x10E020`, `0x10156c`) | | le fil de la session `mcu::HID` |

Les sens des bits sont ceux de 3dbrew ; les numéros de notification sont lus dans `mcu_dispatch_interrupts`. Les fiches de `ns` et de `ptm` donnent le reste de la chaîne. **Les notifications `0x213` et `0x214` (couvercle ouvert et fermé), que reçoivent `ptm`, `hid` et `gsp`, ne sont pas publiées par `mcu`** : la question de leur éditeur reste ouverte (la fiche de `ptm` la pose déjà).

### Les registres du microcontrôleur

Registres lus ou écrits (appareil 3, bus 2 d'après la table de [i2c](i2c.md)), avec ce que le code en fait. Les noms et sens sont ceux de 3dbrew quand ils tombent sur les mêmes registres, ce qui est le cas de toutes les lignes qui les citent :

| Registre | Largeur | Ce que fait le code |
| --- | --- | --- |
| `0x00`, `0x01` | 1 | version haute et basse du micrologiciel (comparées à `0x13` et `0x41` au démarrage ; GetMcuFwVerHigh et Low) |
| `0x02` | 1 | bits 0 et 1 : événements d'horloge réinitialisée et de chien de garde ; vérifiés et effacés par `ptm` (commandes RTC 38 à 41) |
| `0x03`, `0x04` | 1 | tension de référence des écrans haut et bas (les « flicker ») |
| `0x08` | 1 | position brute du curseur 3D |
| `0x09` | 1 | niveau du curseur de volume (0 à 63) |
| `0x0A`, `0x0B`, `0x0D` | 1 | température, niveau et tension de la batterie |
| `0x0F` | 1 | bits d'état : 1 couvercle, 3 chargeur, 4 charge de la batterie, 5 et 6 écrans allumés, 7 lien GPU-écrans |
| `0x10` à `0x13` | 4 | interruptions en attente (lu par le fil d'interruption) |
| `0x18` à `0x1B` | 4 | masque d'interruptions (0 = autorisée) |
| `0x20` | 1 | commande d'alimentation : 1 éteindre, 4 redémarrer ; `0x10` écrit par RTC 53 |
| `0x22`, `0x23`, `0x24` | 1 | allumage des écrans, remise à zéro du microcontrôleur (valeur `0x72`), chien de garde |
| `0x25`, `0x26` | 1 | six bits du volume, bit 4 du codec |
| `0x28` à `0x2E` | 1 ou plus | luminosité de la LED, indicateur de mode, LED WiFi, LED des caméras, LED 3D, motif de la LED d'information (100 octets) et son état |
| `0x30` à `0x36` | 7 | l'horloge (secondes, minutes, heures, jour de la semaine, jour, mois, année) en BCD |
| `0x37` à `0x3C` | | compteur d'année bissextile, alarme (5 composantes) ; `0x3D` : compteur de ticks (deux octets) |
| `0x40`, `0x41`, `0x43`, `0x44`, `0x4B`, `0x4E`, `0x4F` | | podomètre et accéléromètre (mode d'enregistrement, fenêtre d'accès indirect, nombre de pas, historique de 0x156 octets) |
| `0x45` à `0x4A` | 6 | trois valeurs de 12 bits |
| `0x50`, `0x51`, `0x58` | 1 | registres libres du système et bornes du curseur de volume |
| `0x60`, `0x61` | 1 | indice et valeur de la banque de registres libres |
| `0x7F` | 10 | registres d'information (rendus à `ptm`, voir sa fiche) |
| `0x05` (ou `0x3B`) | 16 387 | zone d'écriture du micrologiciel (partie 5) |

## Partie 5 : la réécriture du micrologiciel

Quand le microcontrôleur annonce une version inférieure à celle que porte le module (registre 0 inférieur à `0x13`, ou égal avec le registre 1 inférieur à `0x41` : en retirant le `0x10` de l'octet haut que 3dbrew signale, 3.65, la version de 3dbrew pour la New 3DS v9216), `mcu_main` :

1. prend le verrou, sauvegarde l'état de la LED WiFi (registre `0x2A`), de la broche `0x20` de `gpio:MCU` et de la broche `0x40000` (qu'il passe en entrée), et le contenu d'un registre libre (indice 0) ;
2. appelle `mcu_upload_firmware(…, 0x1090E0, 0x4003)` (`0x10102c`) : lit les registres `0x0F` et `0x10` ; **le tampon de `0x4003` octets** (les trois octets `jhl` suivis de `0x4000` octets de micrologiciel) est écrit par un seul `WriteRegisterBuffer` (`0x00110...`) dans le registre `0x05` (ou `0x3B` si `0x0F` est nul et `0x10` vaut 1, le chemin « très ancien » de 3dbrew) ; les trois premiers octets tombent dans les registres `0x05`, `0x06`, `0x07`, et c'est l'écriture du dernier qui déclenche la réécriture, d'après 3dbrew (non vérifié dans le module : le microcontrôleur n'est pas lu) ;
3. attend **une seconde** (`0x3B9ACA00` ns) que le microcontrôleur redémarre ;
4. remet à 1 l'octet `0x10E000` (« micrologiciel mis à jour »), restaure la LED, les deux broches et le registre libre, et rend le verrou.

Autour de la réécriture, 3dbrew dit que les interruptions externes du microcontrôleur sont coupées puis rétablies par `gpio:MCU` (valeur 0 puis `0x40000` sur le masque `0x40000` de SetDirection) : c'est ce que montrent les appels à `GPIOMCU_SetDirection` et `GPIOMCU_SetData` de `mcu_main`.

## Partie 6 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x109000` | les trois masques d'événements (`0x3F000000`, `0x1800`, `0x2E702`) ; `0x10906F` à `0x10907C` des petites constantes d'écriture (valeurs envoyées à `0x20`, `0x23`, `0x4E`, `0x22`) |
| `0x10900C` | `i2c::MCU`, `gpio:MCU`, puis les neuf noms de service (`mcu::CAM` ... `mcu::CDC`, `0x10901E` à `0x109066`), `srv:` (`0x109098`), `srv:pm` (`0x10909D`, jamais ouvert), `err:f` (`0x1090D8`) |
| `0x1090E0` | la copie du micrologiciel (`0x4003` octets) |
| `0x10E000` | octet « micrologiciel mis à jour » ; `0x10E004` octet « interruptions initialisées » ; `0x10E006` octet levé par la lecture du niveau de batterie |
| `0x10E008` | l'événement d'interruption (lié à la broche `0x8000`) |
| `0x10E00C` | la poignée de `i2c::MCU` ; `0x10E018` l'objet qui la porte ; `0x10E080` la poignée de `gpio:MCU` |
| `0x10E020` | la file d'attente du fil d'accéléromètre |
| `0x10E030` | le nombre de sessions en cours |
| `0x10E034` | la table des neuf services ; `0x10E058` celle des neuf fonctions de fil |
| `0x10E0AC` | la poignée de `srv:` |
| `0x10E0D8` à `0x10E0E0` | les trois mots « raison » (GPU, HID, énergie) ; `0x10E0FC` à `0x10E104` les trois événements |
| `0x10E0E4` | les verrous du bus ; `0x10E508` le verrou des interruptions |
| `0x10E560` | les piles des neuf fils de session |

## Partie 7 : les services que mcu appelle

| Service | Poignée | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- | --- |
| `srv:` | `0x10E0AC` | `0x00010002`, `0x00020000`, `0x00030100`, `0x000400C0`, `0x000B0000` | les cinq de [sm](sm.md) | `0x101358`, `0x101394`, `0x100ed4`, `0x100f30`, `0x1013d0` | RegisterClient, EnableNotification, RegisterService (9 appels), UnregisterService, ReceiveNotification |
| | | `0x00050100` | `SRV_GetServiceHandle` | `0x1018d8` | ouvrir `i2c::MCU` et `gpio:MCU` (enrobage `srv_get_service_handle` `0x103ce8`) |
| | | `0x000C0080` | `SRV_PublishToSubscriber` | `0x101934` | publier une notification système (partie 4) |
| `i2c::MCU` | `0x10E00C` | `0x000D00C0` | `I2CMCU_ReadRegisterBuffer8` | `0x101760` | lire des registres (commande 13 d'[i2c](i2c.md)) |
| | | `0x000B00C2` | `I2CMCU_WriteRegisterBuffer8` | `0x1017cc` | écrire des registres (11) |
| | | `0x001100C2` | `I2CMCU_WriteRegisterBuffer_cmd11` | `0x101828` | écrire un tampon (17), pour le micrologiciel et HWC 2 |
| | | `0x001200C2` | `I2CMCU_ReadRegisterBuffer_cmd12` | `0x101880` | lire un tampon (18), pour HWC 1 |
| | | `0x00010100` | `I2CMCU_SetRegisterBits8` | `0x101e9c` | changer des bits d'un registre (1) |
| | | `0x000300C0` | `I2CMCU_DisableRegisterBits8` | `0x101e54` | mettre des bits à 0 (3) |
| `gpio:MCU` | `0x10E080` | `0x00090082` | `GPIOMCU_BindInterrupt` | `0x10140c` | accrocher la broche `0x8000` à l'événement |
| | | `0x000A0042` | `GPIOMCU_UnbindInterrupt` | `0x101450` | la décrocher à la sortie |
| | | `0x00060080` | `GPIOMCU_SetInterruptEnable` | `0x101494` | autoriser l'interruption de la broche |
| | | `0x00020080` | `GPIOMCU_SetDirection` | `0x10431c` | direction des broches `0x20` et `0x40000` |
| | | `0x00080080` | `GPIOMCU_SetData` | `0x104284` | niveau de ces broches |
| | | `0x00070040` | `GPIOMCU_GetData` | `0x104354` | les lire |
| `err:f` (port) | | `0x00010800` | `ERRF_Throw` | `0x101a68` | signaler une erreur fatale |

Les noms `I2CMCU_*` et `GPIOMCU_*` sont ceux de ce fichier ; les en-têtes sont ceux de 3dbrew et des fiches de [i2c](i2c.md) et de [gpio](gpio.md), qui les reçoivent. Les noms des commandes de `srv:` sont ceux de [sm](sm.md).

## Partie 8 : les appels système utilisés

`ControlMemory` (`0x01`, le tas), `ExitProcess` (`0x03`), `CreateThread` (`0x08`), `ExitThread` (`0x09`), `SleepThread` (`0x0A`, `svcSleepThread` à `0x101aa8`), `CreateEvent` (`0x17`, `svcCreateEvent` à `0x103d50`), `SignalEvent` (`0x18`, trois endroits : les trois événements des clients), `CreateAddressArbiter` (`0x21`), `ArbitrateAddress` (`0x22`), `CloseHandle` (`0x23`, 24 endroits), `WaitSynchronization1` (`0x24`, 6), `WaitSynchronizationN` (`0x25`), `DuplicateHandle` (`0x27`), `GetSystemTick` (`0x28`, 8 endroits : les lectures de l'horloge pour les commandes RTC), `GetProcessInfo` (`0x2B`), `ConnectToPort` (`0x2D`), `SendSyncRequest` (`0x32`, 20 endroits), `GetProcessId` (`0x35`), `Break` (`0x3C`), `AcceptSession` (`0x4A`), `ReplyAndReceive` (`0x4F`). **Ni `BindInterrupt` ni `UnbindInterrupt`.**

## Partie 9 : qui appelle mcu

| Client | Service | Commandes (d'après sa fiche) |
| --- | --- | --- |
| [ptm](ptm.md) | `mcu::RTC` | batterie (45), chargeur (43, 44), couvercle (42), horloge (1, 2, 17, 19, 20), podomètre (31 à 34), événements (36, 37), registres d'info (56), mode exclusif (75, 76), extinction (50) |
| [hid](hid.md) | `mcu::HID` | 1, 6, 7, 12, 13, 14, 15 |
| [gsp](gsp.md) | `mcu::GPU` | 1 à 4, 9, 10, 11, 13, 14 |
| [camera](camera.md) | `mcu::CAM` | (la fiche de `camera` ne nomme que la LED) |
| [nwm](nwm.md) | `mcu::NWM` | (les commandes de WiFi, d'après l'exheader de `nwm`) |
| [ps](ps.md) | `mcu::PLS` | (l'horloge en décimal, d'après l'exheader de `ps`) |
| [codec](codec.md) | `mcu::CDC` | la seule commande |
| (aucun lu) | `mcu::SND`, `mcu::HWC` | `mcu::SND` : volume ; `mcu::HWC` : outils de mise au point |

## Les désaccords relevés

- **3dbrew, `mcu::HID` 6.** Nommée `ReadGyroscopeValues` ; le code lit des mots de 12 bits dans les registres `0x45` à `0x4A`, que la fiche de `hid` range dans l'accéléromètre.
- **3dbrew, `mcu::HID` 15.** Décrite comme « EnableAccelerometerInterrupt(int enable) » : c'est bien un changement du bit `0x800` du masque d'interruptions (registre 0x18).
- **3dbrew, `mcu::NWM`.** 3dbrew écrit « Sets GPIO 0x20 high/low ? » pour 3 et 4 ; les fonctions de travail appellent `gpio:MCU` sans masque fixe (le masque vient de la requête, non lu ici).
- **Carte des services.** À vérifier avec `carte-des-services/donnees.js` (voir le rapport).

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 161 commandes (2, 14, 15, 92, 3, 8, 17, 9, 1 par service), leur fonction de travail et leur en-tête de réponse : les pseudo-codes des sept aiguillages et des deux boucles d'un côté, `emulate_dispatch.py` de l'autre ; les nombres de commandes par service sont ceux de 3dbrew.
- Les registres du microcontrôleur des commandes : le pseudo-code de la fonction de travail, et la description de 3dbrew pour celles qui en donnent un (LED des caméras `0x2B`, écrans `0x22` et `0x0F`, LED `0x28` et `0x29`, horloge `0x30` à `0x36`, interruptions `0x10` et `0x18`, extinction et redémarrage `0x20`, volume `0x09`, batterie `0x0B`...).
- Les neuf noms de service et la limite d'une session : 3dbrew et la table de `0x10E034`.
- L'absence de matériel direct : l'exheader (pas de page, pas d'interruption, pas de `BindInterrupt` dans le masque d'appels système) et le code (aucun accès hors de la pile, des globales et des tampons du fil).
- Les services appelés : l'exheader autorise `gpio:MCU`, `i2c::MCU` et `ptm:s`, et les deux premiers sont ceux que le code ouvre.
- La version du micrologiciel : le seuil `0x13` et `0x41` tombe sur 3.65 (3dbrew, New 3DS v9216), la version que la fiche de 3dbrew donne à ce module.
- La table des notifications publiées : le code de `mcu_dispatch_interrupts` et les fiches de `ns` (notifications `0x200`, `0x202` à `0x205`) et de `ptm` (`0x20C`).

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le sens du second paramètre de `SRV_PublishToSubscriber` (0 ou 1).
- Que l'accès par `0x43` et `0x44` soit une fenêtre sur des registres de l'accéléromètre (il écrit un index puis lit ou écrit une valeur).
- Les rôles des commandes sans nom dans 3dbrew (`mcu::HID` 1 à 5 et 8 à 11, `mcu::SND` 2, `mcu::CDC` 1).
- Le sens de `mcu::RTC` 79 (qui écrit l'octet `0x10E000`).
- Le rôle de l'octet `0x10E006` (levé, il fait traiter l'interruption 2 au démarrage).
- Que le chemin de réécriture déclenche la réécriture par la dernière écriture du tampon, comme le dit 3dbrew : le module n'a pas de code qui le dise.
- Les valeurs des constantes de `0x10906F` à `0x10907C` : vues, associées aux commandes (`0x20` reçoit 1, 4 ou `0x10` ; `0x23` reçoit `0x72` ; `0x4E` reçoit 1).
- Le détail de l'initialisation (`mcu_init_interrupts`) : la condition qui lève l'octet `0x10E006`, et ce que l'octet `0x1FF80016` de la page de configuration désigne.
- Les noms des fonctions de la bibliothèque, reconnus par l'identité du code avec des fonctions déjà nommées dans d'autres modules.

**Pas lu**
- Le contenu du micrologiciel (`0x4003` octets à `0x1090E0`) : volontairement.
- Le détail de `mcu_SetBatteryEmptyLEDPattern`, des routines de motif de la LED d'information, et des conversions de `mcu_SetRTC` et de `mcu_GetRTC` au-delà de leur forme (BCD sur sept octets).
- Le corps des fonctions de bibliothèque : tas, gestionnaire d'adresses, thread local, files d'attente (`0x10156c`).
- 68 fonctions de Ghidra et 15 entrées manquées n'avaient pas de nom ; toutes en ont un (haute dans la fiche ou moyenne en proposition) ; la plupart viennent de la bibliothèque.
- L'envoi de `0x213` et `0x214`, que `mcu` ne fait pas.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Pseudo-code des 285 fonctions, projet Ghidra | `outils/ghidra_direct.py mcu` | une minute |
| Tables des sept aiguillages | `outils/emulate_dispatch.py mcu 0x102558=mcu::GPU 0x10294c=mcu::HID 0x10498c=mcu::RTC 0x10649c=mcu::SND 0x1046e4=mcu::NWM 0x10659c=mcu::HWC 0x106b38=mcu::PLS` | plusieurs minutes (92 commandes pour RTC) |
| Assembleur du module | objdump de devkitPro (`code.asm`) | immédiat |
| Registres du MCU de chaque commande | `local/analyse/mcu/regs.py` (lit les constantes passées aux enveloppes `mcu_read_regs` et `mcu_write_regs` dans le pseudo-code) | immédiat |
| Noms de commande | `local/analyse/mcu/names3db.py`, `gen_doc.py` (3dbrew + registres) | immédiat |
| Noms de la bibliothèque | `local/analyse/gpio/match.py` (code identique aux adresses près dans d'autres modules) | immédiat |
| 3dbrew : « MCU Services » et « I2C Registers » | web.archive.org, capture de 2022 | |

Les scripts et le brut sont dans `local/analyse/mcu/` et `local/analyse/gpio/` (non versionné).

**Pour reprendre.** `mcu.noms.tsv` est le fichier de graines. Les noms en `mcu_` sont les fonctions de travail (nom de la commande de 3dbrew), les boucles et les fils ; `I2CMCU_` et `GPIOMCU_` les requêtes envoyées aux deux autres services. Endroits à relire en premier : `mcu_dispatch_interrupts`, `mcu_init_interrupts` et la commande RTC 34 (`0x22`, `ReadRegister4Fh`).
