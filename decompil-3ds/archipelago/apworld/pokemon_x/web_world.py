from BaseClasses import Tutorial
from worlds.AutoWorld import WebWorld


class PokemonXWebWorld(WebWorld):
    game = "Pokemon X"
    tutorials = [  # noqa: RUF012 - WebWorld declares tutorials as a plain class attribute, as APQuest does
        Tutorial(
            "Multiworld Setup Guide",
            "How to set up Pokemon X for Archipelago.",
            "English",
            "setup_en.md",
            "setup/en",
            ["KiyoniX"],
        )
    ]
