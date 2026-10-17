# cfg, les réglages de la console

`cfg` garde les réglages de la console : la langue, le nom d'utilisateur, le pays, les étalonnages des capteurs, le modèle de la machine. Tout tient dans une table de « blocs de configuration » de 0x8000 octets, lue au démarrage dans un fichier de la sauvegarde système `0x00010017` et gardée en mémoire. Un jeu comme Pokémon X lui demande la langue, la région et une quinzaine d'autres réglages : presque toutes ces réponses sortent de cette table, ou de deux petits fichiers signés de la NAND. Il ne lui demande jamais le modèle, contrairement à ce que disait d'abord cette fiche : GetSystemModel ne fait pas partie des quatre commandes qu'il envoie ([contrat des petits services](contrat-petits-services.md), partie 3).

Fiche du 13 octobre 2026, produite avec Ghidra, REA et un émulateur sur le module dumpé de la console. Les adresses sont celles du module chargé à `0x00100000`.

## Carte d'identité

| | |
| --- | --- |
| Titre | `0004013000001702`, un titre de la CTRNAND (lu dans l'exheader) |
| Fichier lu | `local/extrait/cfg/exefs/code.elf` |
| Taille | 43 616 octets de code, 7 656 de données en lecture seule, 2 112 de données, 42 744 de mémoire à zéro |
| Fonctions | 686 pour Ghidra, dont 641 en Thumb ; 440 nommées dans `cfg.noms.tsv` |
| Services offerts | `cfg:u` (11 commandes), `cfg:s` (26), `cfg:i` (58), `cfg:nor` (20) : un aiguillage par service |
| Services appelés | `fs:USER`, `ps:ps`, `SPI::NOR`, `i2c::EEP`, plus `srv:` et le port `err:f` |
| Dépendances déclarées | `ps` (`0004013000003102`) et `spi` (`0004013000002302`) |
| Fils | un seul : le module ne contient ni `CreateThread` ni `ControlMemory` |

Les quatre noms de la ligne « Services appelés » sont exactement la liste que l'exheader autorise.

## Partie 1 : le démarrage

`entry` (`0x100000`) appelle six fonctions à la suite, puis `svcExitProcess` :

1. `clear_bss` (`0x100024`) met à zéro la mémoire de `0x10d840` à `0x117f38`.
2. Une fonction non lue (`0x1001cc`).
3. Une fonction (`0x100204`) qui crée l'arbitre d'adresses des verrous, fait d'autres préparatifs non lus, puis appelle `srv_init` (`0x106028`) : connexion au port `srv:` et `SRV_RegisterClient`.
4. `run_static_initializers` (`0x10389c`) appelle les 23 fonctions d'initialisation des objets globaux, par la table de distances de `0x10cd8c` à `0x10cde8`. Deux comptent ici : celle de `0x109aac` prépare le tampon de configuration et son verrou, et `init_service_names_and_tables` (`0x109780`) recopie les quatre noms de services dans la table `0x10d578`.
5. `run_init_array` (`0x1001b0`) parcourt une seconde table, vide dans ce module.
6. `cfg_main` (`0x100048`) : tout le reste.

**Dans `cfg_main` :**

1. **Les fichiers.** `fs_init` (`0x100370`) ouvre `fs:USER`, envoie `FSUSER_InitializeWithSdkVersion` (version `0x0B0502C8`) puis `FSUSER_SetPriority` (0).
2. **La sauvegarde système.** `mount_system_save` (`0x1003fe`) ouvre l'archive `0x00000008` (sauvegarde système) avec un chemin binaire de 8 octets, `{0, 0x00010017}`, et la range sous le nom `cfgdb:`. Si l'ouverture échoue, la sauvegarde est créée par `create_system_save` (`0x100420`), avec 0x40000 octets pour 10 dossiers et 10 fichiers, et on réessaie ; après plusieurs échecs elle est supprimée puis recréée. Le compteur d'essais est à `0x10d570`.
3. **La NAND.** `mount_nand_archive` (`0x1003d0`) ouvre les archives `0x1234567D` et `0x1234567E` sous les noms `nandrw:` et `nandro:`.
4. **La configuration.** `config_init` (`0x10048c`) range son objet à `0x10d6f0`, lit `cfgdb:/config` dans le tampon par `config_load_from_nand` (`0x105df0`), puis appelle `config_restore_from_evac` (`0x100ef8`) : voir la partie 5.
5. **Les deux fichiers signés.** `local_friend_code_seed_init` (`0x1004d0`) et `secure_info_init` (`0x1004b0`) rangent leurs objets à `0x10d6f8` et `0x10d6f4` et lisent chacun leur fichier (partie 6).
6. **La mémoire flash.** `nor_open_spi` (`0x1004f0`) ouvre `SPI::NOR` pour l'objet de `cfg:nor`, rangé à `0x10d6fc`.
7. **La mise à niveau.** `config_upgrade_locked` (`0x105ff8`) vérifie la version de la table et ajoute les blocs qui manquent (partie 5).
8. **Les identifiants.** `init_console_unique_ids` (`0x100210`) fabrique les blocs `0x00090001`, `0x00090002` et `0x00100003` s'ils sont vides.
9. **Le service.** `cfg_serve` (`0x100520`) ne revient qu'à l'arrêt du système.

Les quatre objets sont posés sur la pile de `cfg_main` : ils vivent aussi longtemps que le module.

## Partie 2 : la boucle de service

Comme dans `sm`, une seule fonction sert tout le monde, sur un seul fil : `cfg_serve` (`0x100520`). Elle est la seule à appeler `svcReplyAndReceive` et `svcAcceptSession`.

1. **L'enregistrement.** Pour chacun des quatre services, `SRV_RegisterService` avec le nom lu dans la table `0x10d578` et 25 sessions au plus (`0x19`). Les quatre ports vont dans la liste de poignées, de `0x117ec4` à `0x117ed0`.
2. **La notification d'arrêt.** `register_notification_handler` (`0x10107c`) inscrit `on_terminate_notification` (`0x109d00`) pour le numéro `0x100`, puis `SRV_EnableNotification` rend un sémaphore, rangé en tête de la liste (`0x117ec0`).
3. **L'attente.** `svcReplyAndReceive` répond au client précédent et attend sur la liste : le sémaphore, les quatre ports, puis les sessions ouvertes. La liste a 30 cases ; le nombre de cases prises est à `0x10d6b8` et vaut 5 au départ.
4. **Le tri de ce qui arrive.**
   - Le sémaphore (rang 0) : `handle_srv_notification` (`0x101040`) lit le numéro par `SRV_ReceiveNotification` et appelle la fonction inscrite.
   - Un port (rangs 1 à 4) : `svcAcceptSession` ouvre la session. S'il y a déjà 25 sessions, elle est refermée aussitôt. Sinon elle est ajoutée à la liste, et son type est noté dans la table `0x117d34` : 0 pour `cfg:u`, 1 pour `cfg:s`, 2 pour `cfg:i`, 3 pour `cfg:nor`.
   - Une session (rang 5 et plus) : la fonction appelle l'aiguillage de son type, par la table de quatre adresses à `0x10b054`. La réponse part au tour suivant.
   - Une session fermée (résultat `0xC920181A`) : `close_session` (`0x1012a4`) ferme la poignée et bouche le trou avec la dernière case.
5. **La sortie.** Quand l'octet `0x10d6c4` vaut 1 et qu'il ne reste aucune session, les quatre services sont retirés de `sm` et leurs ports fermés.

| Type | Service | Aiguillage | Adresse |
| --- | --- | --- | --- |
| 0 | `cfg:u` | `cfgu_handle_command` | `0x107d40` |
| 1 | `cfg:s` | `cfgs_handle_command` | `0x106db4` |
| 2 | `cfg:i` | `cfgi_handle_command` | `0x107288` |
| 3 | `cfg:nor` | `cfgnor_handle_command` | `0x1081f8` |

Les 25 sessions sont un total pour les quatre services réunis.

## Partie 3 : les commandes

Il n'y a pas de contrôle de droits par session. Chaque service a son propre aiguillage, qui ne connaît que ses commandes : `cfg:u` en a 11, `cfg:s` a les mêmes plus 15, `cfg:i` a celles de `cfg:s` plus 32. C'est donc `sm` qui fait le tri, en donnant ou non à un programme le droit d'ouvrir `cfg:s` ou `cfg:i`.

Chaque aiguillage lit l'en-tête dans le tampon du fil (à `+0x80` du stockage local), prend le numéro de commande dans les 16 bits du haut, et appelle une petite enveloppe propre au service. L'enveloppe appelle la fonction commune. Une même commande a donc jusqu'à trois enveloppes, une par service, et une seule fonction de travail.

La colonne « En-tête vérifié » dit ce que le code compare : « entier » veut dire que l'en-tête doit être exactement celui de 3dbrew et que le descripteur de tampon doit être du bon type, « numéro » que seul le numéro de commande compte. Un numéro inconnu rend `0xD900182F`, un en-tête ou un descripteur refusé `0xD9001830`, dans une réponse d'en-tête `0x00000040`.

Les noms et les en-têtes de requête viennent de 3dbrew ; les adresses et les en-têtes de réponse viennent du code.

**Les 11 commandes de tout le monde** (`cfg:u`, `cfg:s`, `cfg:i`) :

| N° | En-tête de requête | Commande | Fonction commune | Dans `cfg:u` | Dans `cfg:s` | Dans `cfg:i` | En-tête vérifié | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0x0001` | `0x00010082` | GetConfigInfoBlk2 | `config_get_block_locked` (`0x105fc4`) | `0x1069f8` | `0x10659c` | `0x106968` | entier | `0x00010042` |
| `0x0002` | `0x00020000` | SecureInfoGetRegion | `secure_info_get_region_locked` (`0x104e58`) | `0x106a0c` | `0x1065b0` | `0x10697c` | numéro | `0x00020080` |
| `0x0003` | `0x00030040` | GenHashConsoleUnique | `gen_hash_console_unique` (`0x105eac`) | `0x106998` | `0x1064b8` | `0x106690` | numéro | `0x000300C0` |
| `0x0004` | `0x00040000` | GetRegionCanadaUSA | `get_region_canada_usa` (`0x1043ac`) | `0x1069b2` | `0x1064d2` | `0x1066ca` | numéro | `0x00040080` |
| `0x0005` | `0x00050000` | GetSystemModel | `get_system_model` (`0x104454`) | `0x10698e` | `0x106454` | `0x1065e4` | numéro | `0x00050080` |
| `0x0006` | `0x00060000` | GetModelNintendo2DS | `get_model_nintendo_2ds` (`0x10440c`) | `0x1069a4` | `0x1064c4` | `0x1066bc` | numéro | `0x00060080` |
| `0x0007` | `0x00070040` | sans nom | `set_block_00160000_byte` (`0x104360`) | `0x1069c6` | `0x1064e6` | `0x10671c` | numéro | `0x00070040` |
| `0x0008` | `0x00080080` | TranslateCountryInfo | `translate_country_info` (`0x1042d0`) | `0x1069d0` | `0x106504` | `0x106780` | numéro | `0x00080080` |
| `0x0009` | `0x00090040` | GetCountryCodeString | `get_country_code_string` (`0x108038`) | `0x1069de` | `0x106544` | `0x106810` | numéro | `0x00090080` |
| `0x000A` | `0x000A0040` | GetCountryCodeID | `get_country_code_id` (`0x108074`) | `0x1069ea` | `0x106550` | `0x10681c` | numéro | `0x000A0080` |
| `0x000B` | `0x000B0000` | IsFangateSupported | `is_fangate_supported` (`0x1043a4`) | `0x1069bc` | `0x1064dc` | `0x1066d4` | numéro | `0x000B0080` |

**Les 15 commandes de `cfg:s`**, reprises par `cfg:i` :

| N° | En-tête de requête | Commande | Fonction commune | Dans `cfg:s` | Dans `cfg:i` | En-tête vérifié | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `0x0401` | `0x04010082` | GetConfigInfoBlk8 | `config_get_block_locked` (`0x105fc4`) | `0x106460` | `0x1065f0` | entier | `0x04010042` |
| `0x0402` | `0x04020082` | SetConfigInfoBlk4 | `config_set_block_locked` (`0x105f18`) | `0x106484` | `0x106624` | entier | `0x04020042` |
| `0x0403` | `0x04030000` | UpdateConfigNANDSavegame | `config_save_locked` (`0x105e88`) | `0x106498` | `0x106670` | numéro | `0x04030040` |
| `0x0404` | `0x04040042` | GetLocalFriendCodeSeedData | `signed_file_get_data_locked` (`0x1041e4`) | `0x10658c` | `0x106948` | entier | `0x04040042` |
| `0x0405` | `0x04050000` | GetLocalFriendCodeSeed | `local_friend_code_seed_get_seed_locked` (`0x105f9c`) | `0x106534` | `0x106800` | numéro | `0x040500C0` |
| `0x0406` | `0x04060000` | SecureInfoGetRegion | `secure_info_get_region_locked` (`0x104e58`) | `0x106474` | `0x106614` | numéro | `0x04060080` |
| `0x0407` | `0x04070000` | SecureInfoGetByte101 | `secure_info_get_byte101_locked` (`0x1044c0`) | `0x106444` | `0x1065d4` | numéro | `0x04070080` |
| `0x0408` | `0x04080042` | SecureInfoGetSerialNo | `secure_info_get_serial_locked` (`0x10442c`) | `0x1064a8` | `0x106680` | entier | `0x04080042` |
| `0x0409` | `0x04090000` | UpdateConfigBlk00040003 | `reset_block_00040003_from_hwcal` (`0x107fe0`) | `0x10657c` | `0x106928` | numéro | `0x04090040` |
| `0x040A` | `0x040A0000` | sans nom | `write_config_to_evac` (`0x108844`) | `0x106514` | `0x106790` | numéro | `0x040A0040` |
| `0x040B` | `0x040B0000` | sans nom | `delete_evac_save` (`0x108828`) | `0x10655c` | `0x106828` | numéro | `0x040B0040` |
| `0x040C` | `0x040C0000` | sans nom | `reset_block_00040002_from_hwcal` (`0x107f20`) | `0x10656c` | `0x1068b8` | numéro | `0x040C0040` |
| `0x040D` | `0x040D0040` | SetUUIDClockSequence | `set_uuid_clock_sequence` (`0x104314`) | `0x1064fa` | `0x106754` | numéro | `0x040D0040` |
| `0x040E` | `0x040E0000` | GetUUIDClockSequence | `get_uuid_clock_sequence` (`0x104334`) | `0x1064f0` | `0x106726` | numéro | `0x040E0080` |
| `0x040F` | `0x040F0000` | ClearParentalControls | `clear_parental_controls` (`0x107238`) | `0x106524` | `0x1067d0` | numéro | `0x040F0040` |

- GetConfigInfoBlk2 demande le droit 2, GetConfigInfoBlk8 le droit 8, SetConfigInfoBlk4 le droit 4 : le chiffre du nom est ce droit. Voir la partie 4.
- SetConfigInfoBlk4 publie en plus la notification `0x109` quand le bloc écrit est `0x00050001` ou `0x00050009`.
- Aucune écriture n'atteint le fichier avant UpdateConfigNANDSavegame : jusque-là seul le tampon en mémoire change.
- Les commandes `0x040A` et `0x040B` n'ont pas de nom dans 3dbrew. La première crée une seconde sauvegarde système `0x00010017`, la range sous le nom `evac:` et y écrit la table entière dans `evac:/config`. La seconde supprime cette sauvegarde. Voir la partie 5.
- La commande `0x040C` fait pour le bloc `0x00040002` ce que UpdateConfigBlk00040003 fait pour le bloc `0x00040003` : elle reprend la valeur du fichier d'étalonnage HWCAL et enregistre.

**Les 32 commandes propres à `cfg:i` :**

| N° | En-tête de requête | Commande | Enveloppe | Fonction de travail | Ce que fait le code | En-tête vérifié | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `0x0801` | `0x08010082` | GetConfigInfoBlk8 | `0x106638` | `config_get_block_locked` (`0x105fc4`) | Lit un bloc, avec le droit 8 : la même chose que `0x0401` | entier | `0x08010042` |
| `0x0802` | `0x08020082` | SetConfigInfoBlk4 | `0x10665c` | `config_set_block_locked` (`0x105f18`) | Écrit un bloc, avec le droit 4 : la même chose que `0x0402` | entier | `0x08020042` |
| `0x0803` | `0x08030000` | UpdateConfigNANDSavegame | `0x10669c` | `config_save_locked` (`0x105e88`) | Enregistre la configuration dans `cfgdb:/config` | numéro | `0x08030040` |
| `0x0804` | `0x080400C2` | CreateConfigInfoBlk | `0x1066e0` | `config_create_block_locked` (`0x106a20`) | Crée un bloc. Les droits demandés doivent valoir 8, 0xA, 0xC ou 0xE, sinon `0xE0E00BEE` | entier | `0x08040042` |
| `0x0805` | `0x08050000` | DeleteConfigNANDSavefile | `0x106760` | `config_delete_savefile` (`0x1053b8`) | Supprime `cfgdb:/config` et recharge : la table se retrouve vide | numéro | `0x08050040` |
| `0x0806` | `0x08060000` | FormatConfig | `0x106730` | `config_format` (`0x105b38`) | Remet tous les blocs à leur valeur par défaut (partie 5) | numéro | `0x08060040` |
| `0x0807` | `0x08070000` | sans nom | `0x1065c4` | `return_success_locked` (`0x106bdc`) | Ne fait rien, rend 0 | numéro | `0x08070040` |
| `0x0808` | `0x08080000` | sans nom | `0x106770` | `config_upgrade` (`0x1008c4`) | Refait la mise à niveau du démarrage (partie 5) | numéro | `0x08080040` |
| `0x0809` | `0x08090000` | sans nom | `0x106868` | `reset_block_00060000` (`0x104eb4`) | Recalcule le bloc `0x00060000`, enregistre, publie la notification `0x10B` | numéro | `0x08090040` |
| `0x080A` | `0x080A0000` | ResetAnalogStickCalibrationParam | `0x106908` | `reset_block_00040001` (`0x104e80`) | Recalcule le bloc `0x00040001`, enregistre | numéro | `0x080A0040` |
| `0x080B` | `0x080B0082` | SetGetLocalFriendCodeSeedData | `0x1068d8` | `local_friend_code_seed_get_data` (`0x1094dc`) | Si le paramètre n'est pas nul, redemande d'abord la graine à `ps:ps` (`local_friend_code_seed_fetch`). Rend 0x10 octets | entier | `0x080B0042` |
| `0x080C` | `0x080C0042` | SetLocalFriendCodeSeedSignature | `0x106938` | `local_friend_code_seed_set_signature` (`0x1094b4`) | Remplace les 0x100 octets de signature en mémoire | entier | `0x080C0042` |
| `0x080D` | `0x080D0000` | DeleteCreateNANDLocalFriendCodeSeed | `0x106898` | `signed_file_write` (`0x109432`) | Écrit le fichier `LocalFriendCodeSeed` qui n'est pas en service, puis bascule dessus | numéro | `0x080D0040` |
| `0x080E` | `0x080E0000` | VerifySigLocalFriendCodeSeed | `0x106918` | `local_friend_code_seed_verify` (`0x109534`) | Vérifie la signature RSA par `ps:ps` | numéro | `0x080E0040` |
| `0x080F` | `0x080F0042` | GetLocalFriendCodeSeedData | `0x106958` | `signed_file_get_data` (`0x109420`) | Copie les 0x110 octets du fichier | entier | `0x080F0042` |
| `0x0810` | `0x08100000` | GetLocalFriendCodeSeed | `0x106838` | `local_friend_code_seed_get_seed` (`0x1018f4`) | Rend la graine, 8 octets | numéro | `0x081000C0` |
| `0x0811` | `0x08110084` | SetSecureInfo | `0x106740` | `secure_info_set_locked` (`0x106c28`) | Remplace en mémoire la région, l'octet 0x101, le numéro de série et la signature | entier | `0x08110044` |
| `0x0812` | `0x08120000` | DeleteCreateNANDSecureInfo | `0x1067a0` | `signed_file_write` (`0x109432`) | Écrit le fichier `SecureInfo` qui n'est pas en service, puis bascule dessus | numéro | `0x08120040` |
| `0x0813` | `0x08130000` | VerifySigSecureInfo | `0x1067e0` | `secure_info_verify` (`0x10934c`) | Vérifie la signature RSA par `ps:ps` | numéro | `0x08130040` |
| `0x0814` | `0x08140042` | SecureInfoGetData | `0x1067c0` | `secure_info_get_data` (`0x1092bc`) | Copie les 0x11 octets signés (région, octet 0x101, numéro de série) | entier | `0x08140042` |
| `0x0815` | `0x08150042` | SecureInfoGetSignature | `0x106858` | `secure_info_get_signature` (`0x10926c`) | Copie les 0x100 octets de signature | entier | `0x08150042` |
| `0x0816` | `0x08160000` | SecureInfoGetRegion | `0x10664c` | `secure_info_get_region_locked` (`0x104e58`) | La région : la même chose que `0x0002` | numéro | `0x08160080` |
| `0x0817` | `0x08170000` | SecureInfoGetByte101 | `0x106604` | `secure_info_get_byte101_locked` (`0x1044c0`) | L'octet 0x101 du fichier | numéro | `0x08170080` |
| `0x0818` | `0x08180042` | SecureInfoGetSerialNo | `0x1066ac` | `secure_info_get_serial_locked` (`0x10442c`) | Le numéro de série, 0xF octets | entier | `0x08180042` |
| `0x0819` | en-tête incomplet sur 3dbrew | sans nom | `0x1067b0` | `write_config_to_evac` (`0x108844`) | La même chose que `0x040A` | numéro | `0x08190040` |
| `0x081A` | en-tête incomplet sur 3dbrew | sans nom | `0x1067f0` | `build_block_00060000` (`0x104d7c`) | Rend la valeur recalculée du bloc `0x00060000`, sans l'écrire | entier | `0x081A0042` |
| `0x081B` | en-tête incomplet sur 3dbrew | sans nom | `0x1068a8` | `build_block_00040001` (`0x104c74`) | Rend la valeur recalculée du bloc `0x00040001`, sans l'écrire | entier | `0x081B0042` |
| `0x081C` | en-tête incomplet sur 3dbrew | sans nom | `0x106878` | `delete_evac_save` (`0x108828`) | La même chose que `0x040B` | numéro | `0x081C0040` |
| `0x081D` | en-tête incomplet sur 3dbrew | sans nom | `0x1068f8` | `reset_block_00040004` (`0x107fac`) | Recalcule le bloc `0x00040004`, enregistre | numéro | `0x081D0040` |
| `0x081E` | en-tête incomplet sur 3dbrew | sans nom | `0x106888` | `build_block_00040004` (`0x1052b0`) | Rend la valeur recalculée du bloc `0x00040004` (tampon de 0x1C octets exigé) | entier | `0x081E0042` |
| `0x081F` | en-tête incomplet sur 3dbrew | sans nom | `0x1068c8` | `reset_block_00180001` (`0x107f78`) | Recalcule le bloc `0x00180001`, enregistre | numéro | `0x081F0040` |
| `0x0820` | en-tête incomplet sur 3dbrew | sans nom | `0x106848` | `build_block_00180001` (`0x104120`) | Rend la valeur recalculée du bloc `0x00180001` (tampon de 0x18 octets exigé) | entier | `0x08200042` |

Les huit dernières ne sont pas dans la Carte des services : l'aiguillage va jusqu'à `0x0820`.

**Les 20 commandes de `cfg:nor` :**

| N° | En-tête de requête | Commande | Enveloppe | Fonction de travail | Ce que fait le code | En-tête vérifié | En-tête de réponse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `0x0001` | `0x00010040` | Initialize | `0x1080b4` | `nor_initialize` (`0x108a48`) | `SPI_cmd0001` (périphérique 1, valeur 0), puis range l'octet reçu et règle le bus comme la commande 3 | numéro | `0x00010040` |
| `0x0002` | `0x00020000` | Shutdown | `0x108194` | `nor_shutdown` (`0x108be4`) | `SPI_cmd0002` (périphérique 1) | numéro | `0x00020040` |
| `0x0003` | `0x00030040` | sans nom | `0x1081c4` | `nor_set_bus_state` (`0x108c1e`) | Range l'octet reçu à `+4` de l'objet et appelle `SPI_EnableSpiBus` | numéro | `0x00030040` |
| `0x0004` | `0x00040000` | sans nom | `0x1081b4` | `nor_get_bus_state_locked` (`0x108788`) | Rend cet octet | numéro | `0x00040080` |
| `0x0005` | `0x00050082` | ReadData | `0x108174` | `nor_read_data` (`0x108b00`) | Attend la fin d'écriture, envoie l'ordre `0x03` et l'adresse sur 3 octets, lit les données | entier | `0x00050042` |
| `0x0006` | `0x00060082` | WriteData | `0x108184` | `nor_write_data` (`0x108b54`) | Écrit par pages de 0x100 octets : relit le début ou la fin de page si besoin, programme, attend | entier | `0x00060042` |
| `0x0007` | `0x00070000` | sans nom | `0x1080c4` | `nor_write_enable` (`0x104088`) | Ordre `0x06` | numéro | `0x00070040` |
| `0x0008` | `0x00080000` | sans nom | `0x1080e4` | `nor_write_disable` (`0x108a9c`) | Ordre `0x04` | numéro | `0x00080040` |
| `0x0009` | `0x00090000` | ReadIdentification | `0x1080f4` | `nor_read_identification` (`0x108aae`) | Ordre `0x9F`, rend 2 octets | numéro | `0x00090080` |
| `0x000A` | `0x000A0000` | sans nom | `0x1081d4` | `nor_wait_write_done` (`0x10403a`) | Boucle tant que le bit 0 du registre d'état est à 1 | numéro | `0x000A0040` |
| `0x000B` | `0x000B0000` | sans nom | `0x108114` | `nor_wait_write_enabled` (`0x104078`) | Boucle tant que le bit 1 du registre d'état est à 0 | numéro | `0x000B0040` |
| `0x000C` | `0x000C0000` | sans nom | `0x108104` | `nor_is_write_in_progress` (`0x108adc`) | Rend le bit 0 du registre d'état | numéro | `0x000C0080` |
| `0x000D` | `0x000D0000` | sans nom | `0x108144` | `nor_is_write_enabled` (`0x108b30`) | Rend le bit 1 du registre d'état | numéro | `0x000D0080` |
| `0x000E` | `0x000E0000` | ReadStatusRegister | `0x108154` | `nor_read_status_register` (`0x104052`) | Ordre `0x05`, rend 1 octet | numéro | `0x000E0080` |
| `0x000F` | `0x000F0082` | ReadDataOther | `0x108134` | `nor_read_data` (`0x108b00`) | La même lecture que la commande 5, appelée sans passer par le relais | entier | `0x000F0042` |
| `0x0010` | `0x00100082` | WriteDataOther | `0x1081e4` | `nor_page_program` (`0x108c3e`) | Ordre `0x0A` et adresse, après autorisation d'écriture : s'arrête à la fin de la page de 0x100 octets | entier | `0x00100042` |
| `0x0011` | `0x00110040` | sans nom | `0x1081a4` | `nor_erase_db` (`0x108bf0`) | Ordre `0xDB` et adresse, après autorisation d'écriture | numéro | `0x00110040` |
| `0x0012` | `0x00120040` | sans nom | `0x1080d4` | `nor_erase_d8` (`0x108a6e`) | Ordre `0xD8` et adresse, après autorisation d'écriture | numéro | `0x00120040` |
| `0x0013` | `0x00130000` | sans nom | `0x108124` | `nor_deep_power_down` (`0x108aee`) | Ordre `0xB9` | numéro | `0x00130040` |
| `0x0014` | `0x00140000` | sans nom | `0x108164` | `nor_release_power_down` (`0x108b42`) | Ordre `0xAB` | numéro | `0x00140040` |

`cfg:nor` ne touche pas aux blocs de configuration. Il pilote une mémoire flash série par le service `SPI::NOR`, toujours avec le numéro de périphérique 1. Les ordres envoyés (`0x03` lire, `0x05` état, `0x06` autoriser l'écriture, `0x9F` identité…) sont lus dans le code ; les commentaires de 3dbrew sur les commandes sans nom disent la même chose.

## Partie 4 : GetConfigInfoBlk2, pas à pas

C'est la commande par laquelle un jeu lit la langue ou le nom d'utilisateur. Requête : `0x00010082`, la taille, l'identifiant du bloc, un descripteur de tampon et l'adresse du tampon.

1. **L'aiguillage.** `cfgu_handle_command` (`0x107d40`) saute par la table d'un octet par case rangée à `0x107d62`, avec l'aide du compilateur `switch8_r3` (`0x104e40`). Le cas 1 est à `0x107d88`.
2. **L'en-tête.** `make_ipc_header` (`0x104e28`) fabrique `0x00010082` (commande 1, 2 mots, 2 mots de traduction) ; le code le compare à l'en-tête reçu. Différent : `0xD9001830`.
3. **Le descripteur.** Les 4 bits du bas du mot 3 doivent valoir `0xC` (« tampon où le service écrit »). Sinon `0xD9001830`.
4. **Les paramètres.** L'identifiant est le mot 2, l'adresse du tampon le mot 4. La taille est prise dans le descripteur (le mot 3 décalé de 4 bits) : le mot 1, où le client répète la taille, n'est jamais lu.
5. **L'enveloppe.** `cfgu_0001_GetConfigInfoBlk2` (`0x1069f8`) prend l'objet de configuration à `0x10d6f0`, pose le droit demandé, 2, sur la pile, et appelle `config_get_block_locked` (`0x105fc4`).
6. **Le verrou.** `lock_guard_enter` (`0x105e5e`) prend le verrou `0x115850`. Avec un seul fil, il n'est jamais disputé.
7. **La taille.** `config_get_block` (`0x105b80`) refuse une taille nulle ou supérieure à 0x8000 : `0xD90103EC`.
8. **La recherche.** `config_find_block` (`0x10526c`) parcourt les entrées une par une, de la première à la dernière, en comparant l'identifiant. Introuvable : `0xD90103FA`.
9. **Les droits.** Le droit demandé est réduit aux bits `0xA`, puis comparé aux droits de l'entrée. Aucun bit commun : `0xD90103EA`. Un jeu ne lit donc que les blocs qui portent le droit 2.
10. **La taille, encore.** La taille de l'entrée doit être exactement celle demandée. Sinon `0xD90103EC`.
11. **La copie.** Jusqu'à 4 octets, la donnée est dans l'entrée elle-même ; au-delà, l'entrée donne sa position dans le tampon. `__aeabi_memcpy` (`0x1050c4`, qui rend `dest+n` : ce n'est pas `memcpy`) copie vers le tampon de l'appelant.
12. **La réponse.** En-tête `0x00010042`, le résultat, puis le descripteur (`taille × 16 + 0xC`) et l'adresse du tampon, pour que le noyau le rende au client.

| Mot de la requête | Contenu | Lu par le code |
| --- | --- | --- |
| 0 | `0x00010082` | oui, comparé en entier |
| 1 | la taille | non |
| 2 | l'identifiant du bloc | oui |
| 3 | `taille × 16 + 0xC` | oui : le type et la taille |
| 4 | l'adresse du tampon | oui |

GetConfigInfoBlk8 suit le même chemin avec le droit 8. SetConfigInfoBlk4 passe par `config_set_block` (`0x105be4`), qui fait les mêmes vérifications avec les bits `0x5` et copie dans l'autre sens.

## Partie 5 : les blocs de configuration

**Le tampon.** Il occupe 0x8000 octets à `0x10d840`, au tout début de la mémoire à zéro. C'est l'image exacte du fichier `cfgdb:/config`.

| Décalage | Contenu |
| --- | --- |
| `+0x0000` | le nombre d'entrées, sur 2 octets |
| `+0x0002` | la position de la donnée la plus basse, sur 2 octets ; `0x8000` quand la table est vide |
| `+0x0004` | les entrées, 12 octets chacune, à la suite |
| vers `+0x8000` | les données de plus de 4 octets, rangées depuis la fin en descendant |

**Une entrée :**

| Décalage | Taille | Contenu |
| --- | --- | --- |
| `+0x0` | 4 | l'identifiant du bloc |
| `+0x4` | 4 | la donnée elle-même si elle fait 4 octets ou moins, sinon sa position dans le tampon |
| `+0x8` | 2 | la taille de la donnée |
| `+0xA` | 2 | les droits |

**Les droits :**

| Bit | Valeur | Sens | Demandé par |
| --- | --- | --- | --- |
| 1 | 2 | lisible par les jeux | GetConfigInfoBlk2 |
| 2 | 4 | modifiable | SetConfigInfoBlk4 |
| 3 | 8 | lisible par le système | GetConfigInfoBlk8 |

Le code ne crée que deux combinaisons : `0xC` (système seulement) et `0xE` (jeux et système). Le bit 0 est accepté à l'écriture, mais aucune commande ne le demande et aucun bloc ne le porte.

Trois pointeurs suivent le tampon, posés une fois pour toutes par l'initialisation de `0x109aac` : vers les entrées (`0x115840`), vers le nombre d'entrées (`0x115844`) et vers la position des données (`0x115848`). Le verrou est juste après, à `0x115850`.

**La création.** `config_create_block` (`0x105318`) vérifie qu'il reste de la place entre la fin des entrées et le début des données (sinon `0xC86103F3`), refuse un identifiant déjà présent (`0xD90103FC`), puis ajoute l'entrée à la fin. Si la donnée dépasse 4 octets, la position des données recule d'autant et la donnée y est copiée. Il n'y a pas de suppression d'un bloc seul.

**La lecture au démarrage.** `config_load_from_nand` (`0x105df0`) ouvre `cfgdb:/config` et lit 0x8000 octets d'un coup dans le tampon. Si le fichier manque ou si la lecture échoue, la table est déclarée vide (0 entrée, données à `0x8000`). L'enregistrement est le chemin inverse : `config_save_to_nand` (`0x105c78`) écrit les 0x8000 octets puis valide l'archive par `FSUSER_ControlArchive`.

**La copie de secours `evac:`.** Juste après la lecture, `config_restore_from_evac` (`0x100ef8`) essaie d'ouvrir une seconde sauvegarde système du même numéro, dont le chemin binaire est `{0x00000100, 0x00010017}` au lieu de `{0, 0x00010017}`. Si elle existe et contient un fichier `config`, celui-ci remplace la table en mémoire et est enregistré dans `cfgdb:/config`. Dans les deux cas, la sauvegarde `evac:` est ensuite supprimée. Les commandes `0x040A` et `0x040B` fabriquent et suppriment cette copie.

**La mise à niveau.** `config_upgrade` (`0x1008c4`) lit le bloc `0x00000000`, le numéro de version de la table.

| Version lue | Ce que fait le code |
| --- | --- |
| bloc absent | tout reformater (`config_format` (`0x105b38`)) |
| sous `0x0F` | tout reformater, puis continuer |
| sous `0x10` | corriger deux octets du bloc `0x00020000` |
| sous `0x11` | créer `0x000C0001` |
| sous `0x12` | créer `0x00070002` |
| sous `0x13` | donner les droits `0xE` au bloc `0x000E0000` |
| sous `0x14` | créer `0x00090002` à partir de `0x00090001` |
| sous `0x32` | créer `0x000F0004`, `0x00150000`, `0x00160000`, `0x00170000`, `0x00040004`, `0x00050008`, `0x00050007`, `0x00180000`, `0x00050009`, `0x00180001`, et reprendre quatre d'entre eux du fichier HWCAL |
| sous `0x33` | créer `0x000C0002` |
| sous `0x34` | créer `0x00150001` |
| sous `0x35` | créer `0x00190000` |
| sous `0x36` | créer `0x000F0005` |
| sous `0x37` | créer `0x000F0006` |
| sous `0x38` | créer `0x00150002` |
| sous `0x39` | donner les droits `0xE` au bloc `0x00150002`, écrire la version `0x39`, enregistrer |
| `0x39` et plus | rien |

Une table à jour porte donc la version `0x39`.

**Le formatage.** `config_format` (`0x105b38`) supprime le fichier, repart d'une table vide, crée le bloc `0x00000000` avec la version `0x39`, puis appelle `create_default_calibration_blocks` (`0x101b0c`) et `create_default_setting_blocks` (`0x101f40`) et enregistre. Ces deux fonctions donnent la liste des blocs que le code connaît : 65 identifiants, dont 24 lisibles par les jeux.

| Identifiant | Taille | Droits | Lisible par | Valeur de départ | Ce que le code en fait |
| --- | --- | --- | --- | --- | --- |
| `0x00000000` | 0x2 | `0xC` | système seulement | la constante `0x39` | Le numéro de version de la configuration, `0x39` dans ce module |
| `0x00010000` | 0x1 | `0xC` | système seulement | HWCAL, élément 0 |  |
| `0x00020000` | 0x134 | `0xC` | système seulement | HWCAL, élément 5 | Deux de ses octets sont corrigés par la mise à niveau depuis une version sous `0x10` |
| `0x00030000` | 0x1 | `0xC` | système seulement | HWCAL, élément 7 |  |
| `0x00030001` | 0x8 | `0xE` | jeux et système | constante à `0x10b530` |  |
| `0x00030002` | 0x8 | `0xC` | système seulement | constante à `0x10b538` |  |
| `0x00040000` | 0x10 | `0xC` | système seulement | HWCAL, élément 3 | Étalonnage tactile, lu par `hid` |
| `0x00040001` | 0x1C | `0xC` | système seulement | constante à `0x10b3c0`, puis `reset_block_00040001` | Étalonnage du pad circulaire, lu par `hid` ; recalculé par la commande `0x080A` |
| `0x00040002` | 0x12 | `0xC` | système seulement | HWCAL, élément 6 | Étalonnage du gyroscope, lu par `hid` ; repris de HWCAL par la commande `0x040C` |
| `0x00040003` | 0xC | `0xC` | système seulement | HWCAL, élément 8 | Étalonnage de l'accéléromètre, lu par `hid` ; repris de HWCAL par la commande `0x0409` |
| `0x00040004` | 0x1C | `0xC` | système seulement | calculée (`build_block_00040004`) | Recalculé par la commande `0x081D` |
| `0x00050000` | 0x2 | `0xC` | système seulement | HWCAL, élément 1 |  |
| `0x00050001` | 0x2 | `0xC` | système seulement | constante à `0x10b2a0` | Son écriture publie la notification `0x109` |
| `0x00050002` | 0x38 | `0xC` | système seulement | HWCAL, élément 12 |  |
| `0x00050003` | 0x20 | `0xC` | système seulement | HWCAL, élément 10 |  |
| `0x00050004` | 0x20 | `0xC` | système seulement | HWCAL, élément 15 |  |
| `0x00050005` | 0x20 | `0xE` | jeux et système | HWCAL, élément 11 |  |
| `0x00050006` | 0x2 | `0xC` | système seulement | HWCAL, élément 17 |  |
| `0x00050007` | 0x4 | `0xC` | système seulement | HWCAL, élément 22 |  |
| `0x00050008` | 0x10C | `0xC` | système seulement | HWCAL, élément 21 |  |
| `0x00050009` | 0x8 | `0xC` | système seulement | constante à `0x10b95c` | Son écriture publie la notification `0x109` |
| `0x00060000` | 0x96 | `0xC` | système seulement | constante à `0x10b328`, puis `reset_block_00060000` | Recalculé par la commande `0x0809`, qui publie la notification `0x10B` |
| `0x00070000` | 0x214 | `0xE` | jeux et système | HWCAL, élément 9 |  |
| `0x00070001` | 0x1 | `0xE` | jeux et système | constante à `0x10b831` |  |
| `0x00070002` | 0x8 | `0xE` | jeux et système | HWCAL, élément 18 |  |
| `0x00080000` | 0xC00 | `0xC` | système seulement | tampon à `0x115868` |  |
| `0x00080001` | 0xC00 | `0xC` | système seulement | tampon à `0x115868` |  |
| `0x00080002` | 0xC00 | `0xC` | système seulement | tampon à `0x115868` |  |
| `0x00090000` | 0x8 | `0xE` | jeux et système | constante à `0x10b758` |  |
| `0x00090001` | 0x8 | `0xE` | jeux et système | constante à `0x10b760` | Entre dans le calcul de GenHashConsoleUnique ; fabriqué au démarrage s'il est vide |
| `0x00090002` | 0x4 | `0xE` | jeux et système | constante à `0x10b768` | Fabriqué au démarrage avec le précédent |
| `0x000A0000` | 0x1C | `0xE` | jeux et système | constante à `0x10b300` | Le nom d'utilisateur |
| `0x000A0001` | 0x2 | `0xE` | jeux et système | constante à `0x10b31c` |  |
| `0x000A0002` | 0x1 | `0xE` | jeux et système | constante à `0x10b31e` | La langue |
| `0x000B0000` | 0x4 | `0xE` | jeux et système | constante à `0x10b320` | Le pays : son octet de poids fort est le numéro du pays, lu par GetRegionCanadaUSA |
| `0x000B0001` | 0x800 | `0xE` | jeux et système | tampon à `0x116468` |  |
| `0x000B0002` | 0x800 | `0xE` | jeux et système | tampon à `0x116c68` |  |
| `0x000B0003` | 0x4 | `0xE` | jeux et système | constante à `0x10b324` |  |
| `0x000C0000` | 0xC0 | `0xE` | jeux et système | constante à `0x10b76c` | Remis à sa valeur par défaut par ClearParentalControls |
| `0x000C0001` | 0x14 | `0xE` | jeux et système | zéros |  |
| `0x000C0002` | 0x200 | `0xE` | jeux et système | zéros | Remis à zéro par ClearParentalControls |
| `0x000D0000` | 0x4 | `0xE` | jeux et système | constante à `0x10b82c` |  |
| `0x000E0000` | 0x1 | `0xE` | jeux et système | constante à `0x10b830` |  |
| `0x000F0000` | 0x10 | `0xC` | système seulement | constante à `0x10b840` | Deux valeurs par défaut possibles, selon un octet de la page partagée du noyau |
| `0x000F0001` | 0x8 | `0xC` | système seulement | constante à `0x10b860` |  |
| `0x000F0003` | 0x1 | `0xC` | système seulement | constante à `0x10b868` |  |
| `0x000F0004` | 0x4 | `0xC` | système seulement | constante à `0x10b869` | Son premier octet est le modèle de console, lu par GetSystemModel |
| `0x000F0005` | 0x4 | `0xC` | système seulement | constante à `0x10b86d` |  |
| `0x000F0006` | 0x28 | `0xC` | système seulement | zéros |  |
| `0x00100000` | 0x2 | `0xC` | système seulement | constante à `0x10b908` |  |
| `0x00100001` | 0x94 | `0xC` | système seulement | constante à `0x10b874` |  |
| `0x00100002` | 0x1 | `0xC` | système seulement | constante à `0x10b90a` |  |
| `0x00100003` | 0x10 | `0xC` | système seulement | constante à `0x10b90b` | Fabriqué au démarrage s'il est vide |
| `0x00110000` | 0x4 | `0xC` | système seulement | constante à `0x10b91c` |  |
| `0x00110001` | 0x8 | `0xC` | système seulement | tampon à `0x10d5a8` | Six valeurs par défaut possibles, selon la région |
| `0x00120000` | 0x8 | `0xC` | système seulement | HWCAL, élément 16 | Bornes du curseur 3D, lues par `hid` |
| `0x00130000` | 0x4 | `0xE` | jeux et système | constante à `0x10b928` |  |
| `0x00150000` | 0x4 | `0xC` | système seulement | constante à `0x10b92c` | Lu et écrit par GetUUIDClockSequence et SetUUIDClockSequence |
| `0x00150001` | 0x8 | `0xC` | système seulement | constante à `0x10b930` |  |
| `0x00150002` | 0x4 | `0xE` | jeux et système | zéros |  |
| `0x00160000` | 0x4 | `0xE` | jeux et système | constante à `0x10b938` | Son premier octet est écrit par la commande `0x0007` |
| `0x00170000` | 0x4 | `0xE` | jeux et système | constante à `0x10b93c` |  |
| `0x00180000` | 0x4 | `0xC` | système seulement | constante à `0x10b958` |  |
| `0x00180001` | 0x18 | `0xC` | système seulement | HWCAL, élément 23 | Recalculé par la commande `0x081F` |
| `0x00190000` | 0x1 | `0xC` | système seulement | constante à `0x10b964` |  |

- « HWCAL, élément n » : la valeur vient du fichier d'étalonnage d'usine, lu par `hwcal_load` (`0x1059e0`) et `hwcal_get_item` (`0x1056c0`). Le module lit `nandro:/sys/HWCAL0.dat` et `nandro:/sys/HWCAL1.dat` (un en-tête de 0x200 octets, puis 2 000 octets). Sur certains matériels, reconnus par un octet de la page partagée du noyau (`0x1FF81006`), il lit à la place une mémoire EEPROM par `i2c::EEP`.
- Cette liste est celle d'un fichier HWCAL récent. Avec un fichier de version 0, onze des blocs repris de HWCAL prennent une constante du module à la place, et `0x00070000` reçoit les droits `0xC`.
- Les identifiants `0x00100001` et `0x00100003` ressemblent à des adresses du code, qui commence à `0x00100000`. Ce sont bien des identifiants de blocs.

## Partie 6 : les réponses calculées

Ces commandes ne rendent pas un bloc tel quel.

| Commande | Fonction | D'où vient la réponse |
| --- | --- | --- |
| SecureInfoGetRegion | `secure_info_get_region` (`0x102c38`) | L'octet `0x100` du fichier `nandrw:/sys/SecureInfo_A` (ou `_B`), si sa signature est bonne |
| SecureInfoGetByte101 | `secure_info_get_byte101` (`0x1092e4`) | L'octet `0x101` du même fichier |
| SecureInfoGetSerialNo | `secure_info_get_serial` (`0x1091f8`) | Les 0xF octets suivants, à partir de `0x102` |
| GetSystemModel | `get_system_model` (`0x104454`) | Le premier octet du bloc `0x000F0004`. Si la lecture échoue, 0 |
| GetModelNintendo2DS | `get_model_nintendo_2ds` (`0x10440c`) | 0 si GetSystemModel a réussi et rendu 3, sinon 1 |
| GetRegionCanadaUSA | `get_region_canada_usa` (`0x1043ac`) | 1 si la région vaut 1 et si l'octet de poids fort du bloc `0x000B0000` vaut `0x12` ou `0x31`, sinon 0. Le bloc est lu d'abord, la région ensuite (3dbrew dit l'inverse, le résultat est le même) ; si l'une des deux lectures échoue, l'octet rendu vaut 0 avec l'erreur de la lecture |
| IsFangateSupported | `is_fangate_supported` (`0x1043a4`) | Toujours 1 |
| GenHashConsoleUnique | `gen_hash_console_unique` (`0x105eac`) | Les 8 derniers octets du SHA-256 de 12 octets : le bloc `0x00090001`, puis les 20 bits du bas du paramètre |
| TranslateCountryInfo | `translate_country_info` (`0x1042d0`) | Une table de 5 paires à `0x10b000` ; le second paramètre choisit le sens de la traduction |
| GetCountryCodeString | `get_country_code_string` (`0x108038`) | La table de 187 pointeurs à `0x10d284` : un numéro de pays donne deux lettres |
| GetCountryCodeID | `get_country_code_id` (`0x108074`) | La même table, fouillée case par case : deux lettres donnent un numéro |
| GetLocalFriendCodeSeed | `local_friend_code_seed_get_seed` (`0x1018f4`) | 8 octets à `0x108` du fichier `nandrw:/sys/LocalFriendCodeSeed_A` (ou `_B`), si sa signature est bonne |
| GetUUIDClockSequence | `get_uuid_clock_sequence` (`0x104334`) | Les 2 premiers octets du bloc `0x00150000`, ou 0 si la lecture échoue |
| commande `0x0007` | `set_block_00160000_byte` (`0x104360`) | Rien : elle écrit son paramètre dans le premier octet du bloc `0x00160000` et enregistre |

**Les deux fichiers signés.** `SecureInfo` (0x111 octets) et `LocalFriendCodeSeed` (0x110 octets) commencent tous deux par 0x100 octets de signature RSA. `signed_file_load` (`0x1017e0`) les lit au démarrage : il supprime d'abord les fichiers `_A_invalid` et `_B_invalid` qui traîneraient, puis prend `_B` s'il existe, sinon `_A`. Si aucun n'existe, il en crée un rempli de zéros.

La signature n'est vérifiée qu'à la première question posée, par `secure_info_verify` (`0x10934c`) ou `local_friend_code_seed_verify` (`0x109534`) : elles ouvrent `ps:ps`, envoient `PS_VerifyRsaSha256` et gardent le verdict. La clé publique est une des deux rangées dans le module ; le choix dépend du bit 0 de l'octet `0x1FF80014` de la page de configuration du noyau.

| Résultat | Sens dans ces fonctions |
| --- | --- |
| `0xD8A103F8` | le fichier n'a pas été chargé |
| `0xD8A10001` | la signature a été refusée |

**GetSystemModel a un cas particulier.** Si le bloc dit 3 et si le numéro de série de `SecureInfo` ne commence ni par `A` ni par `P`, la fonction rend le modèle 0 et le résultat `0xD8A10006`.

**La table des pays.** Sur ses 187 cases, 133 portent un code de deux lettres. La case 1 vaut `JP`, la case 18 (`0x12`) vaut `CA`, la case 49 (`0x31`) vaut `US` : ce sont justement les deux numéros que GetRegionCanadaUSA cherche. Un numéro sans code, ou au-delà de la table, rend `0xD90103FA`.

**Les identifiants fabriqués au démarrage.** `init_console_unique_ids` (`0x100210`) regarde le bloc `0x00090001`. S'il est vide, il le compose avec la graine de `LocalFriendCodeSeed` et 2 octets tirés au hasard par `PS_GenerateRandomBytes`, et range ces 2 octets dans le bloc `0x00090002`. Il fait de même pour le bloc `0x00100003` : 8 octets au hasard, le résultat de GenHashConsoleUnique pour le paramètre 0, le tout combiné à une constante de 16 octets. Puis il enregistre.

## Partie 7 : les services que cfg appelle

Chaque requête a sa petite fonction, qui écrit un en-tête et appelle `svcSendSyncRequest`. Il y en a 35, autant que d'appels à cette enveloppe. Les noms viennent de 3dbrew quand la commande y est nommée. La dernière colonne est déduite de l'endroit d'où la fonction est appelée ; pour les commandes de fichiers, appelées à travers la bibliothèque, elle est déduite du nom de la commande.

| Service | Poignée | En-tête | Fonction | Adresse | Pour quoi faire |
| --- | --- | --- | --- | --- | --- |
| `srv:` | `0x10d670` | `0x00010002` | `SRV_RegisterClient` | `0x1016c0` | Se déclarer à `sm` |
| | | `0x00020000` | `SRV_EnableNotification` | `0x1016f8` | Obtenir le sémaphore des notifications |
| | | `0x00030100` | `SRV_RegisterService` | `0x101148` | Créer ses quatre services |
| | | `0x000400C0` | `SRV_UnregisterService` | `0x10119c` | Les retirer à l'arrêt |
| | | `0x00050100` | `SRV_GetServiceHandle` | `0x10238c` | Ouvrir les quatre services ci-dessous |
| | | `0x000B0000` | `SRV_ReceiveNotification` | `0x101734` | Lire le numéro de la notification arrivée |
| | | `0x000C0080` | `SRV_PublishToSubscriber` | `0x1023e0` | Publier `0x109` et `0x10B` |
| `fs:USER` | `0x10d614` | `0x08610042` | `FSUSER_InitializeWithSdkVersion` | `0x101a9c` | Au démarrage |
| | | `0x08620040` | `FSUSER_SetPriority` | `0x10149c` | Au démarrage |
| | | `0x080C00C2` | `FSUSER_OpenArchive` | `0x101a40` | Ouvrir `cfgdb:`, `evac:`, `nandrw:`, `nandro:` |
| | | `0x080E0080` | `FSUSER_CloseArchive` | `0x105d04` | Les refermer |
| | | `0x080D0144` | `FSUSER_ControlArchive` | `0x102768` | Valider une sauvegarde après écriture |
| | | `0x080201C2` | `FSUSER_OpenFile` | `0x103d18` | Ouvrir `config`, les fichiers signés, HWCAL |
| | | `0x08040142` | `FSUSER_DeleteFile` | `0x103bdc` | Supprimer `config` ou un fichier `_invalid` |
| | | `0x08050244` | `FSUSER_RenameFile` | `0x103c38` | Basculer entre un fichier signé et son `_invalid` |
| | | `0x08090182` | `FSUSER_CreateDirectory` | `0x103cb8` | Créer `nandrw:/sys` s'il manque |
| | | `0x08560240` | `FSUSER_CreateSystemSaveData` | `0x1014d4` | Créer la sauvegarde `0x00010017` |
| | | `0x08570080` | `FSUSER_DeleteSystemSaveData` | `0x10152c` | La supprimer |
| un fichier ouvert | dans l'objet du fichier | `0x080200C2` | `FSFILE_Read` | `0x106070` | Lire |
| | | `0x08030102` | `FSFILE_Write` | `0x1060f8` | Écrire |
| | | `0x08040000` | `FSFILE_GetSize` | `0x106154` | Connaître la taille |
| | | `0x08050080` | `FSFILE_SetSize` | `0x106190` | Fixer la taille |
| | | `0x08080000` | `FSFILE_Close` | `0x1060c8` | Fermer |
| `ps:ps` | `0x10d650` | `0x00020244` | `PS_VerifyRsaSha256` | `0x1063a0` | Vérifier les deux fichiers signés |
| | | `0x000A0000` | `PS_GetLocalFriendCodeSeed` | `0x106408` | Redemander la graine (commande `0x080B`) |
| | | `0x000D0042` | `PS_GenerateRandomBytes` | `0x101608` | Les octets au hasard des identifiants |
| `SPI::NOR` | dans l'objet de `0x10d6fc` | `0x00010080` | `SPI_cmd0001` | `0x108c86` | À l'ouverture de `cfg:nor` |
| | | `0x00020040` | `SPI_cmd0002` | `0x108e14` | À sa fermeture |
| | | `0x00030100` | `SPI_ReadWriteDevice` | `0x108db8` | Un ordre court et sa réponse |
| | | `0x000500C0` | `SPI_cmd0005` | `0x103fee` | Un ordre sans réponse |
| | | `0x00060102` | `SPI_ReadWriteDeviceArray` | `0x108d1c` | Lire des données |
| | | `0x00070102` | `SPI_ReadWriteDevice2Array` | `0x108cc4` | Programmer une page |
| | | `0x000800C0` | `SPI_EnableSpiBus` | `0x108d74` | Allumer ou éteindre le bus |
| `i2c::EEP` | dans l'objet HWCAL | `0x001000C0` | `I2CEEP_ReadEEPROM` | `0x1033c2` | Lire HWCAL dans l'EEPROM |
| `err:f` (port) | `0x10d60c` | `0x00010800` | `ERRF_Throw` | `0x102fbc` | Signaler une erreur fatale |

- `ps:ps` n'est pas gardé ouvert : `ps_open` (`0x105cd4`) l'ouvre avant chaque usage et `ps_close` (`0x105f68`) le referme.
- Trois commandes de `SPI::NOR` (`0x00010080`, `0x00020040`, `0x000500C0`) ne sont pas dans la Carte des services : elles gardent un nom neutre.
- `SPI::CD2`, `SPI::CS2`, `SPI::CS3` et `SPI::DEF` sont dans les chaînes du module, mais seul `SPI::NOR` est ouvert.

## Partie 8 : les tables en mémoire

| Adresse | Contenu |
| --- | --- |
| `0x10d840` | le tampon de configuration, 0x8000 octets |
| `0x115840`, `0x115844`, `0x115848` | les trois pointeurs dans ce tampon : entrées, nombre d'entrées, position des données |
| `0x115850` | le verrou des objets de configuration |
| `0x10d6f0` | pointeur vers l'objet de configuration (son premier mot vaut `0x10d840`) |
| `0x10d6f4` | pointeur vers l'objet `SecureInfo` |
| `0x10d6f8` | pointeur vers l'objet `LocalFriendCodeSeed` |
| `0x10d6fc` | pointeur vers l'objet de `cfg:nor` |
| `0x10b02c` | les quatre noms de services, dans l'ordre `cfg:u`, `cfg:s`, `cfg:i`, `cfg:nor` |
| `0x10d578` | la table des services : pour chacun, un pointeur vers le nom et le nombre de sessions (25) |
| `0x10b054` | les quatre aiguillages |
| `0x117ec0` | la liste des 30 poignées surveillées : le sémaphore, quatre ports, 25 sessions |
| `0x10d6b8` | le nombre de poignées dans cette liste |
| `0x117d34` | par session, 8 octets : son type (0 à 3) et un pointeur |
| `0x10d6c4` | le drapeau d'arrêt |
| `0x10d570` | le compteur d'essais d'ouverture de `cfgdb:` |
| `0x10d284` | la table des 187 codes de pays |
| `0x10b000` | les 5 paires de TranslateCountryInfo |
| `0x10d5dc` | pour `LocalFriendCodeSeed` : deux clés publiques, puis les quatre noms de fichiers |
| `0x10d5f4` | pour `SecureInfo` : la même chose |
| `0x10d5a8` | les six valeurs par défaut du bloc `0x00110001`, une par région |
| `0x10d654` | les cinq noms de services SPI |

Un objet de fichier signé (`SecureInfo` ou `LocalFriendCodeSeed`) :

| Décalage | Contenu |
| --- | --- |
| `+0x00` | la table de fonctions ; la première vérifie la signature |
| `+0x04`, `+0x08` | les noms des fichiers `_A` et `_B` |
| `+0x0C`, `+0x10` | les noms des fichiers `_A_invalid` et `_B_invalid` |
| `+0x14` | lequel des deux est en service (0 ou 1) |
| `+0x18`, `+0x1C` | la taille du fichier et l'adresse de sa copie en mémoire |
| `+0x20` | 1 si la signature est bonne |
| `+0x21` | 1 si le fichier a été chargé |
| `+0x22` | 1 si la signature a déjà été vérifiée |
| `+0x23` ou `+0x28` | le fichier lui-même |

## Partie 9 : les appels système utilisés

Les seize sont des enveloppes en ARM, chacune avec un seul `svc`.

| Appel | Numéro | Fonction | Adresse |
| --- | --- | --- | --- |
| QueryMemory | `0x02` | `svcQueryMemory` | `0x109f1c` |
| ExitProcess | `0x03` | `svcExitProcess` | `0x109d90` |
| SleepThread | `0x0A` | `svcSleepThread` | `0x109fa4` |
| CreateAddressArbiter | `0x21` | `svcCreateAddressArbiter` | `0x109f04` |
| ArbitrateAddress | `0x22` | `svcArbitrateAddress` | `0x10a79c` |
| CloseHandle | `0x23` | `svcCloseHandle` | `0x105d78` |
| WaitSynchronization1 | `0x24` | `svcWaitSynchronization1` | `0x10a8fc` |
| DuplicateHandle | `0x27` | `svcDuplicateHandle` | `0x10a8e4` |
| GetSystemTick | `0x28` | `svcGetSystemTick` | `0x109fcc` |
| GetProcessInfo | `0x2B` | `svcGetProcessInfo` | `0x109f58` |
| ConnectToPort | `0x2D` | `svcConnectToPort` | `0x109f8c` |
| SendSyncRequest | `0x32` | `svcSendSyncRequest` | `0x1054b4` |
| GetProcessId | `0x35` | `svcGetProcessId` | `0x109fb4` |
| Break | `0x3C` | `svcBreak` | `0x109fac` |
| AcceptSession | `0x4A` | `svcAcceptSession` | `0x109e34` |
| ReplyAndReceive | `0x4F` | `svcReplyAndReceive` | `0x109e4c` |

`svcDuplicateHandle` n'est appelée par personne. Les verrous (`lock_enter` (`0x10501a`), `lock_leave` (`0x105008`)) reposent sur `ArbitrateAddress`, comme dans `sm` et `hid`.

## Ce qui est sûr, ce qui est interprété, ce qui n'est pas lu

**Vérifié par deux voies indépendantes**
- Les 115 commandes, leur enveloppe et leur en-tête de réponse : chaque aiguillage a été exécuté dans un émulateur pour chaque numéro de `0x0000` à `0x0FFF`, en notant la première fonction appelée et la réponse écrite. Les 107 en-têtes de requête que donne 3dbrew tombent sur ces mêmes numéros, et le code compare bien l'en-tête entier pour les 29 commandes qui ont un tampon.
- L'ordre des services : les quatre noms à `0x10b02c` et les quatre aiguillages à `0x10b054` sont rangés pareil, et le nombre de commandes de chaque aiguillage (11, 26, 58, 20) colle aux listes de 3dbrew pour `cfg:u`, `cfg:s` et `cfg:nor`.
- La boucle : `svcReplyAndReceive` et `svcAcceptSession` n'ont qu'un appelant, `cfg_serve`.
- GetConfigInfoBlk2 : le chemin est lu dans l'assembleur de l'aiguillage, de l'enveloppe et de `config_get_block`, et retrouvé par l'émulateur (requête `0x00010082`, réponse `0x00010042`).
- La forme d'une entrée : `config_find_block`, `config_get_block`, `config_set_block` et `config_create_block` lisent toutes les mêmes quatre champs aux mêmes décalages.
- La liste des blocs : les deux fonctions de création ont été exécutées dans l'émulateur en notant chaque appel à `config_create_block`. Les tailles des blocs `0x00040000` à `0x00040003` et `0x00120000` sont celles que `hid` demande (voir `hid.md`).
- Les seuils de la mise à niveau : `config_upgrade` exécutée pour chaque version de `0x0C` à `0x3A`, et relue dans le pseudo-code.
- Les services appelés : l'exheader autorise quatre noms, ce sont les quatre que le code ouvre. Les 35 fonctions de requête correspondent aux 35 appels à `svcSendSyncRequest`, et leurs en-têtes ont été relevés en exécutant chacune.
- La sauvegarde système : l'archive `0x00000008` et son chemin binaire de 8 octets sont lus ici, et `fs.md` dit la même chose de son côté.
- Les ordres SPI de `cfg:nor` : lus dans le code, et décrits pareil dans les commentaires de 3dbrew.
- Les quatre commandes de `cfg:u` que Pokémon X envoie (GetConfigInfoBlk2, SecureInfoGetRegion, GenHashConsoleUnique, GetRegionCanadaUSA) : requête et réponse lues dans le jeu et dans ce module, mot pour mot ([contrat des petits services](contrat-petits-services.md), partie 3).
- Les 16 blocs que le jeu demande (23 appels dans 19 fonctions) : chacun est dans la table de la partie 5, avec exactement la taille que le jeu demande et les droits `0xE`. Le jeu ne demande aucun bloc réservé au système. Sur une console du commerce il n'en lit que 15 : les deux fonctions qui lisent `0x00130000` reviennent sans rien envoyer quand le bit 0 de `0x1FF80014` est levé (relu dans l'assembleur du jeu à `0x10ef6c`).
- L'ordre des deux lectures de GetRegionCanadaUSA (le bloc du pays, puis la région) : le contrat, et l'assembleur Thumb de `0x1043ac`.

**Interprété à la lecture du pseudo-code, à relire dans Ghidra**
- Le rôle de la sauvegarde `evac:`. Le code montre ce qu'il en fait ; ce que choisit l'octet à 1 de son chemin (un autre support, sans doute) est décidé dans `fs` et n'a pas été lu.
- Le détail des essais d'ouverture de `cfgdb:` : quelles erreurs font créer la sauvegarde, lesquelles la font supprimer.
- La composition des blocs `0x00090001`, `0x00090002` et `0x00100003` au démarrage.
- Le choix entre HWCAL en fichier et HWCAL en EEPROM, et entre les deux exemplaires du fichier (le code garde celui dont un compteur est le plus grand).
- Le sens des champs des objets de fichiers signés, et le choix de la clé publique par l'octet `0x1FF80014`.
- Le sens des droits (bit 1 pour les jeux, bit 3 pour le système) : c'est ce que demandent les commandes, le code ne le dit pas autrement.
- Ce que contiennent les blocs. La colonne « Ce que le code en fait » ne dit que ce qui se voit dans ce module ou dans `hid`. Trois noms (langue, nom d'utilisateur, pays) viennent de 3dbrew.
- Les noms des régions. Le code ne manipule qu'un numéro ; que 1 soit l'Amérique se devine par les pays `CA` et `US`.
- Les noms donnés aux fonctions de la bibliothèque de fichiers (`file_input_stream_…`, `fs_delete_file`, `fs_file_exists`) et à `hwcal_write_file`.
- Les résultats `0xD90103EA`, `0xD90103EC` et `0xD90103FA` : leur sens est déduit de la vérification qui les rend.

**Pas lu**
- Le calcul des quatre blocs « recalculés » (`build_block_00060000`, `build_block_00040001`, `build_block_00040004`, `build_block_00180001`) et le découpage du fichier HWCAL (`hwcal_get_item`, `hwcal_item_is_valid`, les deux grosses fonctions `0x1045e6` et `0x102a38`).
- Le contenu des constantes par défaut : le tableau donne leur adresse, pas leur sens.
- La bibliothèque de fichiers sous les fonctions nommées (les archives montées, les chemins), la gestion des erreurs fatales, le SHA-256 lui-même.
- `PS_VerifyRsaSha256` côté appelant : la mise en forme de la clé (`0x108f50`).
- 20 des 23 fonctions d'initialisation des objets globaux.
- 686 fonctions moins 440 nommées : le reste est sans nom.

## Pour faire tourner un jeu sans cfg

Ce que cette fiche permet d'affirmer pour répondre à la place de `cfg:u` :

- GetConfigInfoBlk2 doit rendre exactement la taille du bloc, et seulement pour les 24 blocs aux droits `0xE`. Une mauvaise taille rend `0xD90103EC`, un bloc absent `0xD90103FA`, un bloc réservé au système `0xD90103EA`.
- La langue est le bloc `0x000A0002`, 1 octet. Le nom d'utilisateur est `0x000A0000`, 0x1C octets. Le pays est `0x000B0000`, 4 octets.
- SecureInfoGetRegion rend un octet, GetSystemModel un octet, GenHashConsoleUnique deux mots : il suffit de valeurs fixes et cohérentes entre elles.
- La réponse de GetConfigInfoBlk2 doit reprendre le descripteur et l'adresse du tampon dans ses mots 2 et 3.
- Pour Pokémon X, la liste exacte est connue : les 15 blocs du tableau du [contrat des petits services](contrat-petits-services.md) (partie 3), et le bit 0 de `0x1FF80014` à 1, sans quoi le jeu se croit sur une console de développement et lit en plus le bloc `0x00130000` par `cfg:u`, `cfg:s` ou `cfg:i`. Seul `cfg:u` est à fournir.

## Comment cette fiche a été faite

| Étape | Qui | Durée |
| --- | --- | --- |
| Repérer les appels système et nommer leurs enveloppes | `outils/prescan.py` par le pont REA | court |
| Trouver les fonctions Thumb que Ghidra avait manquées | un script : pointeurs impairs et table des initialisations | immédiat |
| Analyser et décompiler les 686 fonctions | Ghidra lancé directement sous WSL, avec deux scripts | court, quatre passages |
| Dresser les tables de commandes | un script d'émulation (unicorn), sur les quatre aiguillages | quelques minutes |
| Relever les blocs par défaut, les seuils de version, les 35 en-têtes de requête | trois autres scripts d'émulation | immédiat |
| Lire le pseudo-code et nommer | Claude | le gros du temps |
| Recouper avec la Carte des services, l'exheader, `hid.md` et `fs.md` | des scripts | immédiat |

**Le piège rencontré : presque tout est en Thumb.** Sur 686 fonctions, 641 sont en Thumb et 45 en ARM. `prescan.py` ne lit que l'ARM : il a annoncé « aucune fonction manquée » alors que Ghidra n'en voyait que 469. Il manquait trois des quatre aiguillages (ils ne sont appelés que par la table `0x10b054`), tout ce qui n'est appelé que par eux, et 20 des 23 fonctions d'initialisation. Avec les graines Thumb, Ghidra arrive à 686.

**Par le pont REA, la fiche n'est qu'à moitié visible.** Une graine de REA ne sait créer qu'une fonction ARM. Les fonctions Thumb sont donc écrites en lignes `label` dans `cfg.noms.tsv` : le nom se pose, mais REA ne crée pas la fonction. Par le pont, on voit 471 fonctions et 296 des 440 noms ; les 144 autres noms désignent des fonctions que REA ne connaît pas. Pour tout voir, il faut lancer Ghidra par `local/analyse/cfg/ghidra/run.sh` (scripts `CfgPre.java` et `CfgDump.java`, repris de ceux de `fs`) : les 440 noms y prennent tous.

**Quatre autres choses à savoir en relisant dans Ghidra.**
- Les « switch » des quatre aiguillages ne sont pas reconstruits : Ghidra reconnaît l'aide `switch8_r3` mais abandonne (« Too many branches »), comme dans 10 autres fonctions. Le pseudo-code des aiguillages est donc faux ou tronqué. Les tables de la partie 3 viennent de l'émulateur, pas du pseudo-code.
- Deux identifiants de blocs, `0x00100001` et `0x00100003`, ressemblent à des pointeurs Thumb vers le début du code. Un balayage des pointeurs impairs s'y trompe : le script de graines l'a fait au premier passage, et `entry` est sorti désassemblé en Thumb. Ils sont aussi comptés dans les 155 « pointeurs impairs » qu'annonce `prescan.py`.
- Ghidra crée une fausse fonction à `0x102278` : c'est la réserve de constantes de `create_default_setting_blocks`, où se lisent justement les identifiants des blocs.
- Le pseudo-code perd le dernier argument des enveloppes, passé par la pile : le droit (2, 4 ou 8) se lit dans l'assembleur, à l'instruction `movs r4, #…` de chaque enveloppe.

**Pour reprendre.** `cfg.noms.tsv` est le fichier de noms : une adresse, `function` (ARM) ou `label` (Thumb), un nom. Les noms en `cfgu_`, `cfgs_`, `cfgi_`, `cfgnor_` suivis d'un numéro sont les enveloppes des commandes reçues ; ceux en majuscules (`SRV_`, `FSUSER_`, `PS_`, `SPI_`…) sont les requêtes envoyées ; ceux en `_locked` prennent le verrou puis appellent la fonction du même nom. Le pseudo-code, l'assembleur et les scripts sont dans `local/analyse/cfg/`, non versionné : `gh/pseudo/` pour le pseudo-code de Ghidra direct, `scripts/emu_*.py` pour les émulations, `scripts/mkfiche.py` pour les tableaux de cette fiche.
