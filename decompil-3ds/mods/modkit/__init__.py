"""Le moteur de mods de Pokémon X : lire les données du jeu, appliquer des mods empilés, produire la console et le PC."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODS_DIR = os.path.dirname(HERE)
PROJECT = os.path.dirname(MODS_DIR)
LOCAL = os.path.join(PROJECT, 'local')

# Les outils existants (garc, lz11, texte) sont des modules à plat dans outils/.
_OUTILS = os.path.join(PROJECT, 'outils')
if _OUTILS not in sys.path:
    sys.path.insert(0, _OUTILS)

TITLE_ID = '0004000000055D00'          # Pokémon X, version européenne (exheader de la mise à jour : même identifiant)
UPDATE_TITLE_ID = '0004000E00055D00'
GAME_ID = 'pokemon-x-eu'
