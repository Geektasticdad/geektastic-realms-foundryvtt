# Changelog

All notable changes to **Geektastic Realms Foundry Connect** will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [0.4.0] - 2026-07-01

### Added
- **Search box in the Create NPC dialog** — filters the list by name as you type
  (client-side, case-insensitive substring match against the already-fetched list).
  Useful now that a world's full stat block list can run to 100+ entries.

---

## [0.3.2] - 2026-07-01

### Fixed
- **Create button stretched to fill the whole row**: Foundry's core stylesheet applies
  `width: 100%` to bare `<button>` elements (intended for the other dialogs' single
  full-width footer buttons). `flex: 0 0 auto` alone doesn't override that, since an
  `auto` flex-basis falls back to the element's `width`. Each row's Create button now
  sets an explicit `width: auto`.

---

## [0.3.1] - 2026-07-01

### Fixed
- **Create NPC dialog showed no names, only Create buttons**: each row's name/category
  text sat in a flex item with `min-width:0` next to a status indicator and a Create
  button that don't shrink — in the dialog's original 480px width, the name column
  could get squeezed to zero width while the button stayed visible. Widened the dialog
  (640×600, was 480×auto) and gave the name column a real `min-width` so it can't
  collapse to nothing.
- **Dialog opened very small**: `height: 'auto'` measured the tiny "Loading NPCs…"
  placeholder before the real list arrived. The dialog now opens at a fixed 640×600.
- NPC name/category/CR text is now passed through the module's existing `escapeHtml()`
  helper before being interpolated into the row markup (already used elsewhere in the
  module, missed here) — guards against a name containing `<`/`&` breaking the row's
  HTML structure.

---

## [0.3.0] - 2026-07-01

### Added
- **Stage 5 — NPC creation.** New **Create NPC** settings menu opens a dialog listing
  every stat block available in the connected Geektastic Realms world. Picking one
  fetches the prepare payload (`GET /api/foundry/v1/npc/{entryId}/prepare`) and builds a
  real Actor: `Actor.create()` for the base NPC (abilities, AC, HP, movement, senses,
  traits), then each feature/item is added via a new `addItemToActor()` — if the item
  carries a `compendium_ref`, it's resolved locally with `fromUuid()` and cloned onto the
  actor (no duplication); otherwise a fresh Item is built from the inline data via
  `featureItemData()`/`equipmentItemData()`. Per-row progress text shows each step
  (actor, then features, then equipment) as it happens.
- New helpers: `fetchNpcList()`, `prepareNpc()`, `SIZE_MAP`, `crToDecimal()`,
  `parseMovement()`, `parseSenses()`.

---

## [0.2.0] - 2026-07-01

### Added
- **Stage 3 — compendium indexing.** New **Sync Compendiums** settings menu lists every
  Item-type pack in `game.packs` (weapons, equipment, feats, spells, classes,
  backgrounds, species, ...) as checkboxes; selection persists to a `syncPacks` world
  setting (not shown in the visible settings list). Clicking Sync walks the checked
  packs via `pack.getDocuments()`, chunks each pack's entries (100 at a time), and POSTs
  them to `POST {url}/api/foundry/v1/compendium/sync` with live progress text and a
  final summary notification.
- Refactored the ping call behind a shared `apiFetch()` helper (auth header injection,
  error normalization) now used by both Test Connection and Sync Compendiums.

---

## [0.1.0] - 2026-07-01

### Added
- **Stage 2 — connection handshake.** World-scoped settings for the Geektastic Realms
  **Server URL** and **API Token**. A **Test Connection** settings menu opens a small
  dialog that calls `GET {url}/api/foundry/v1/ping` with the configured Bearer token and
  reports success (connected world name + Geektastic Realms version) or the specific
  failure reason (missing settings, network error, invalid/revoked token, non-2xx
  response).
- Verified against Foundry VTT v13. Not yet tested against v14.

[Unreleased]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/releases/tag/v0.1.0
