"""Static description of Pokemon X: every item, location, region and entrance the world can create.

This is the only file that should change when the game map grows. Everything here is plain data checked into the
apworld: generation never reads the game, a ROM, a user file or the network to build it.
Each entry should be backed by a row in docs/dev/game-map.md (address, flag, or save field, plus how it was proven).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from BaseClasses import ItemClassification
from rule_builder.rules import Has, Rule, True_

# IDs are part of the network contract with the client: once released, an ID never changes meaning.
# Keep them in [1, 2**31 - 1]. Items and locations may share numbers, they live in separate namespaces.


@dataclass(frozen=True)
class ItemData:
    id: int
    classification: ItemClassification
    pool_count: int = 1
    """Copies placed in the item pool. 0 means the item exists (e.g. as filler) but is not pre-placed."""


@dataclass(frozen=True)
class LocationData:
    id: int
    region: str
    rule: Rule = field(default_factory=True_)


@dataclass(frozen=True)
class EntranceData:
    source: str
    target: str
    rule: Rule = field(default_factory=True_)


ORIGIN_REGION = "Menu"

# PROOF OF CONCEPT, not the game map: three checks and three items to prove the round trip with the native port.
# An item ID is the game's item number. A location ID is the event flag that marks it: a ground item is 0x51A + n
# (docs/dev/game-map.md and fiches/pokemon-x-archipelago.md in the main project).
ITEMS: dict[str, ItemData] = {
    "Honor Ball": ItemData(12, ItemClassification.useful),
    "Potion": ItemData(17, ItemClassification.useful),
    "Poke Ball": ItemData(4, ItemClassification.filler),
}

FILLER_ITEM = "Poke Ball"

REGIONS: tuple[str, ...] = (ORIGIN_REGION, "Kalos")

ENTRANCES: tuple[EntranceData, ...] = (EntranceData(ORIGIN_REGION, "Kalos"),)

LOCATIONS: dict[str, LocationData] = {
    "Ground Item 0": LocationData(0x51A + 0, "Kalos"),
    "Ground Item 1": LocationData(0x51A + 1, "Kalos"),
    "Ground Item 3": LocationData(0x51A + 3, "Kalos"),
}

GOAL_BADGES = 1
"""The client reports the goal once the player has this many badges."""

GOAL_REGION = "Kalos"
"""Region holding the victory event; the client reports the goal with StatusUpdate when the game is beaten."""
