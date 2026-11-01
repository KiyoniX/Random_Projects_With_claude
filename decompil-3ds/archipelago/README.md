# Pokemon X Archipelago

An [Archipelago](https://archipelago.gg) multiworld integration for Pokemon X: the apworld that generates seeds,
and the client that connects the game to the multiworld server.

This project contains only original code. It ships no game files: you need your own legally obtained copy.

## Install

Download the latest release, then follow [the setup guide](apworld/pokemon_x/docs/setup_en.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `apworld/pokemon_x/` | The world package built into `pokemon_x.apworld` |
| `client/` | The in-game client |
| `docs/dev/` | Development notes: progress and the proven game map |
| `tools/` | Project checks run by CI |

## Development

Archipelago is never forked or copied here. Clone the official repository next to this one at the release CI pins
(`ARCHIPELAGO_REF` in `.github/workflows/ci.yml`), then link the world into it:

```sh
git clone --branch 0.6.9 https://github.com/ArchipelagoMW/Archipelago ../Archipelago
# Windows (administrator or developer mode): mklink /D ..\Archipelago\worlds\pokemon_x <this repo>\apworld\pokemon_x
ln -s "$(pwd)/apworld/pokemon_x" ../Archipelago/worlds/pokemon_x
cd ../Archipelago && python ModuleUpdate.py --yes --append "WebHostLib/requirements.txt"
AP_TEST_WORLDS=pokemon_x python -m pytest
```

## Releasing

1. Bump `world_version` in `apworld/pokemon_x/archipelago.json`.
2. Tag the commit `v<world_version>` and push the tag: CI tests, builds and publishes the `.apworld`.
3. Attach the client build to that release with `gh release upload v<world_version> <file>`.
