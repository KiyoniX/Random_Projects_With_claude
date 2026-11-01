from dataclasses import dataclass

from Options import DeathLink, PerGameCommonOptions


@dataclass
class PokemonXOptions(PerGameCommonOptions):
    death_link: DeathLink
