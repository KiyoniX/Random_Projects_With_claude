from .bases import PokemonXTestBase


class TestLogic(PokemonXTestBase):
    # The proof of concept has no gate: every check is reachable from the start. Real gates get one test each.
    def test_every_check_is_reachable(self) -> None:
        for location in ("Ground Item 0", "Ground Item 1", "Ground Item 3"):
            self.assertTrue(self.can_reach_location(location))
