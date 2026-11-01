from collections.abc import Mapping
from typing import Any, ClassVar

from BaseClasses import Item, Location, Region
from rule_builder.rules import Has
from worlds.AutoWorld import World

from . import data
from .options import PokemonXOptions
from .web_world import PokemonXWebWorld

VICTORY_EVENT = "Victory"


class PokemonXItem(Item):
    game = "Pokemon X"


class PokemonXLocation(Location):
    game = "Pokemon X"


class PokemonXWorld(World):
    """Pokemon X randomizer for Archipelago."""

    game = "Pokemon X"
    web = PokemonXWebWorld()
    options_dataclass = PokemonXOptions
    options: PokemonXOptions
    origin_region_name = data.ORIGIN_REGION

    item_name_to_id: ClassVar[dict[str, int]] = {name: item.id for name, item in data.ITEMS.items()}
    location_name_to_id: ClassVar[dict[str, int]] = {name: loc.id for name, loc in data.LOCATIONS.items()}

    def create_regions(self) -> None:
        regions = {name: Region(name, self.player, self.multiworld) for name in data.REGIONS}
        self.multiworld.regions += regions.values()

        for entrance in data.ENTRANCES:
            self.create_entrance(regions[entrance.source], regions[entrance.target], entrance.rule)

        for name, location in data.LOCATIONS.items():
            region = regions[location.region]
            region.locations.append(PokemonXLocation(self.player, name, location.id, region))

        regions[data.GOAL_REGION].add_event(
            "Goal Reached", VICTORY_EVENT, location_type=PokemonXLocation, item_type=PokemonXItem
        )

    def create_items(self) -> None:
        pool: list[Item] = [self.create_item(name) for name, item in data.ITEMS.items() for _ in range(item.pool_count)]
        free_slots = len(self.multiworld.get_unfilled_locations(self.player)) - len(pool)
        pool += [self.create_filler() for _ in range(free_slots)]
        self.multiworld.itempool += pool

    def set_rules(self) -> None:
        for name, location in data.LOCATIONS.items():
            self.set_rule(self.get_location(name), location.rule)
        self.set_completion_rule(Has(VICTORY_EVENT))

    def create_item(self, name: str) -> PokemonXItem:
        item = data.ITEMS[name]
        return PokemonXItem(name, item.classification, item.id, self.player)

    def get_filler_item_name(self) -> str:
        return data.FILLER_ITEM

    def fill_slot_data(self) -> Mapping[str, Any]:
        # Everything the client needs to adapt the game to this seed. Keep it small and JSON-serializable.
        return {**self.options.as_dict("death_link"), "goal_badges": data.GOAL_BADGES}
