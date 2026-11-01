from test.bases import WorldTestBase

from ..world import PokemonXWorld


class PokemonXTestBase(WorldTestBase):
    game = "Pokemon X"
    world: PokemonXWorld
