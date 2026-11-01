# Progress

Resumable state of the integration. Update it at the end of every step; a new session starts by reading it.

## Game

- Name: Pokemon X
- Store and build: the user's own 3DS copy with its update, dumped from their console; never shipped here
- Engine and route: the native PC port in `../portage` (static recompilation, Rust runtime). The client is built into the runtime: `crates/apclient` (protocol) and `crates/runtime/src/archipelago.rs` (game side)
- Online features or anti-cheat: none in the port; network services are stubs

## Steps

Numbered as in the archipelago-mod skill, so a session can resume at the first unchecked step.

- [ ] 0. Interview: game, platform, install, online features, checks, items and goal
- [x] 1. Prior art searched (results below; the Discord channels are left to the user)
- [x] 2. Engine identified and route chosen (native port, no engine detection needed)
- [x] 3. Repository scaffolded
- [x] 4. Proof of concept: one location detected, one item granted, one server round trip
- [ ] 5. Game map: locations, items, goal and logic gates proven in game-map.md
- [ ] 6. APWorld generates with the real map, tests and checks green
- [ ] 7. Client complete: reconnection, offline resync, save binding, no double grants, goal, DeathLink
- [ ] 8. End-to-end seed played locally from start to goal, adversarial review done, findings fixed
- [ ] 9. Released and tagged

## Prior art

One web search on 2026-11-01 for an X/Y apworld found none: only Pokemon Red/Blue and Emerald in Archipelago, and manual romfs randomizers for X/Y. Not searched: the `#apworld-index` channels of the Archipelago and After Dark Discords, which only the user can read.

## Decisions

2026-11-01: a location ID is the event flag that marks it and an item ID is the game's item number, so the client needs no table: it watches the `missing_locations` the server sends.

2026-11-01: `data.py` is a proof of concept with three checks and three items, not the game map.

## Open questions

Only the user can answer:
- Which checks? Ground items (207), hidden items (151, of which 30 reset at random), trainers (231 IDs), gifts, badges?
- Which items are progression? Badges and rides gate the map; nothing is decided yet.
- What is the goal? The proof of concept uses a badge count; the Elite Four is the obvious alternative.

Still unproven or missing:
- The proof ran headless on a recorded game: checks were flags already set in the save. Picking up a ground item in play has not been traced.
- The applied-item count is a file next to the save, not inside it: reloading an older save does not re-apply what it lacks. `references/client-protocol.md` asks for it to live in the save.
- The server warns that the client does not support compressed WebSockets: `tungstenite` has no permessage-deflate.
- `wss://` is built but only `ws://` on a local server has been run.
- No DeathLink. No in-game display of received items: messages only go to the console.

Proof, 2026-11-01, Archipelago 0.6.9 with its `MultiServer.py`: the server logged `Kris sent Potion to Kris (Ground Item 0)`, `has completed their goal`; the saved bag went from Poke Ball 11, Potion 5 to Poke Ball 12, Potion 6, Honor Ball 1. A second connection with the same save granted nothing. World tests: 9 passed, `check_apworld.py` OK.
