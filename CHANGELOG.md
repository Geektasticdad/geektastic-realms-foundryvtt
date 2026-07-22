# Changelog

All notable changes to **Geektastic Realms Foundry Connect** will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [1.6.1] - 2026-07-22

### Added
- **Spellcasting summary imported as a feature.** GR v1.28.0 added a plain-text
  spellcasting summary (e.g. "Eryssa is a 10th-level warlock…") to the structured
  spellcasting profile — `createNpcInFoundry()` now turns it into its own
  "Spellcasting" feature Item on the created/re-synced Actor (same feat-type shape
  every other GR feature imports as), since Foundry's Actor sheet has nowhere else to
  put this prose. Runs before the spell-cloning step, matching GR's own field order.
  If a stat block still has the old free-text "spellcasting" trait too, both Items
  appear on the Actor — expected during the transition to structured spell lists, not
  a bug to work around. See `spellcastingSummaryItemData()` in `scripts/main.js`.

## [1.6.0] - 2026-07-22

### Added
- **Stage 14 — Spellcasting fidelity.** When a stat block's prepare payload carries
  GR's new structured spell list, `createNpcInFoundry()` now clones every exactly-
  matched spell onto the created/re-synced Actor as a real, rollable Item — reusing
  the same compendium-clone path (`fromUuid()`) Stages 5/9 already use for
  features/items, so it works for both **Create Actor** and **Deploy Encounter**
  automatically.
  - Sets `system.attributes.spellcasting` to the stat block's spellcasting ability so
    Foundry's own DC/attack derivation is correct.
  - A DM-entered printed DC/attack override is reproduced exactly by computing the
    delta from the standard 5e formula and applying it as dnd5e's bonus-formula
    fields — dnd5e has no raw "set this exact DC" field, only the ability +
    derivation, so this is the only way to land on the DM's stated value. See
    `spellcastingBonuses()` in `scripts/main.js`.
  - Unmatched spell names are left alone — the existing free-text "Spellcasting"
    trait still imports exactly as before — and a toast tells the DM how many names
    had no exact compendium match, so nothing silently disappears.
  - Matching is **exact-name-only** (case-insensitive), not GR's Stage 4 fuzzy
    fallback — there's no per-spell review step here, so a wrong fuzzy guess would
    silently clone the wrong spell with no human catching it.
  - **Pact Magic and Innate Spellcasting (At Will / X per day), not just plain spell
    slots** — each spell on GR's list carries a `usage_type`
    (`slot`/`pact`/`at_will`/`per_day`), and `applySpellUsage()` maps it onto dnd5e's
    own preparation modes (`always`/`pact`/`atwill`/`innate`) before the clone is
    created, plus a best-effort daily-recovery `system.uses` counter for `per_day`.
    Without this, e.g. a devil's at-will *Invisibility* would've cloned in looking
    like an ordinary prepared spell that costs a slot it doesn't.
  - **GR dependency:** `stat_blocks.spellcasting_ability`/`spell_save_dc_override`/
    `spell_attack_override` + `stat_block_spells` (incl. `usage_type`/`uses_per_day`),
    and `spellcasting`/`spells` on `GET /api/foundry/v1/npc/{entryId}/prepare` — ✅
    shipped (GR v1.26.0). See
    [Tech_Docs/FOUNDRY_API.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/Tech_Docs/FOUNDRY_API.md)
    "Spellcasting fidelity" in the main repo.

## [1.5.0] - 2026-07-22

### Added
- **Stage 13 — Adventure → Journal export, the capstone composing Stages 9–12.**
  New **Import Adventure** settings menu: pick a module, preview its title/summary/
  section count, and click **Import Adventure** to build one Journal Entry for the
  whole thing — one page per Act/Chapter/Scene/Appendix, in the same order the run
  view reads top-to-bottom.
  - Reuses the same per-module Journal Entry Stage 11 already creates for handouts
    — a module's narrative and its handouts end up in one place, not two competing
    journals.
  - `encounter-ref`/`handout-ref`/`roll-table-ref` chips already embedded in a
    section's body are rewritten into `@UUID` links to whatever Actors, handout
    pages, and RollTables Stages 10–12 already created for them — falling back to
    plain, undecorated text for anything not yet imported, rather than a broken
    link.
  - Each page's Related Articles (entry mentions) are appended as a footer,
    linked to a matching Actor where Stage 9 already created one.
  - Re-runnable: every page keeps a `content_hash`, so re-importing only rebuilds
    pages whose section actually changed — an unchanged page's position (`sort`)
    is still kept current in case sections were added, removed, or reordered, but
    its content is left untouched.
  - This stage deliberately creates **no** new Actors/RollTables/handout pages
    itself — only Stages 9–12 do that; here they're just linked to.
  - New helpers: `fetchModulePrepare()`, `flattenSectionTree()`,
    `rewriteAdventureRefs()`, `relatedEntriesFooter()`, `importAdventurePage()`,
    `importAdventure()`.

### Changed
- **Requires Geektastic Realms v1.24.0+** for Import Adventure's
  `/api/foundry/v1/modules/{moduleId}/prepare` endpoint. Everything shipped before
  this release still works unchanged against older GR versions.

## [1.4.0] - 2026-07-19

### Added
- **Stage 12 — Roll Tables → native RollTables.** New **Import Roll Tables**
  settings menu: pick a module, preview each table's status (New / ✓ Up to date /
  ↻ Changed), and click **Import Roll Tables** to bring the whole module's tables
  into native Foundry RollTable documents. Once imported, table draws use
  Foundry's own dice + chat output — no GR run view needed mid-session.
  - Ranges map to `TableResult` ranges, the computed die maps to the table's
    roll formula (`1dN`), and each row's title + description become the result
    text. Mirrors GR's own "No result" padding (a synthetic row spanning any gap
    up to the die's full face count) so a roll never comes up empty.
  - DM-only note fields (`dm_notes`/`dm_note`) deliberately stay behind — kept
    conservative to rows only, per the roadmap's own scoping.
  - Re-import finds the same RollTable again (flagged with `grRollTableId`, not
    found by name) and only rebuilds tables whose content actually changed since
    (same flag/hash approach as Stage 9/11) — a private-note-only edit on the GR
    side never triggers a re-import here. A failure on one table doesn't abort
    the rest.
  - New helpers: `fetchModuleRollTables()`, `syncedRollTablesByGrId()`,
    `withPaddedRollTableRows()`, `rollTableRowText()`, `importRollTable()`.

### Changed
- **Requires Geektastic Realms v1.23.0+** for Import Roll Tables'
  `/api/foundry/v1/modules/{moduleId}/roll-tables` endpoint. Everything shipped
  before this release still works unchanged against older GR versions.

## [1.3.0] - 2026-07-19

### Added
- **Stage 11 — Handouts → Journal.** New **Import Handouts** settings menu: pick a
  module, preview each handout's status (New / ✓ Up to date / ↻ Changed), and click
  **Import Handouts** to bring the whole module's handouts into one Journal Entry —
  a page per handout, image embedded above the rich-text body — ready for
  Foundry's native **Show to Players** at the table.
  - One Journal Entry per module, flagged with `grModuleId` so it's found and
    reused (not duplicated) on re-import, even if the module or journal gets
    renamed afterward.
  - Each page is flagged with `grHandoutId`/`grContentHash`; re-importing only
    touches pages whose handout actually changed since last time (same
    change-detection approach as Stage 9/10) — unchanged handouts are left alone
    entirely, not re-uploaded or re-written.
  - A failure on one handout doesn't abort the rest; the result reports how many
    were created/updated/already up to date, and which (if any) failed and why.
  - Handout images reuse the existing Stage 6 icon-fetch/upload pipeline
    (`uploadIconToFoundry()`) — no new download path needed.
  - New helpers: `fetchModuleHandouts()`, `findModuleJournal()`,
    `handoutPageContent()`, `importHandouts()`. `populateModuleSelect()` extracted
    from Deploy Encounter (Stage 10) so both module pickers share one
    implementation.

### Changed
- **Requires Geektastic Realms v1.22.0+** for Import Handouts'
  `/api/foundry/v1/modules/{moduleId}/handouts` endpoint. Everything shipped
  before this release still works unchanged against older GR versions.

## [1.2.1] - 2026-07-18

### Fixed
- **Deploy Encounter now actually places tokens.** v1.2.0 shipped Deploy Encounter
  creating an "unlinked" Combat (actor-only combatants, no placed tokens) with a note
  that the DM would drag tokens on and link them up manually — in practice that left
  an encounter uncreated on the actual battle map, not ready to run. Deploy Encounter
  now places a real token per creature on the currently viewed scene (arranged in a
  simple wrapping grid centered on wherever the DM is looking), and the Combat's
  combatants are linked to those tokens directly, so the tracker and the map agree
  from the moment you click Deploy.
  - New **"Place tokens on the current scene"** checkbox (checked by default,
    alongside the existing Combat checkbox).
  - If there's no active scene open, Deploy Encounter still creates the Actors and
    (if requested) an actor-only Combat exactly as before — it just can't place
    tokens without a canvas to put them on, and says so in the result notification.
  - New `placeTokensForActor()` helper, using `Actor#getTokenDocument()` +
    `Scene#createEmbeddedDocuments('Token', ...)`.

## [1.2.0] - 2026-07-18

### Added
- **Stage 10 — Deploy Encounter.** New **Deploy Encounter** settings menu: pick a
  module, then one of its encounters (roster shown right in the picker — creature
  names, quantities, type, difficulty, section), and click **Deploy** to
  create-or-update every adversary's Actor in one action instead of pulling them in
  one at a time via Create Actor.
  - Deployed Actors land in an `Encounters/{name}` folder (created on demand;
    reused on re-deploy rather than duplicated).
  - Reuses the Stage 9 pipeline per adversary — an already-synced creature (e.g.
    also used elsewhere in the module) is updated in place, not duplicated.
  - Optional **"Also create a Combat encounter"** checkbox (checked by default)
    pre-populates the Combat Tracker with one combatant per quantity (6 hobgoblins
    = 6 combatant entries referencing the one hobgoblin Actor) and activates it —
    a DM drags tokens onto the scene afterward and the tracker links them up.
  - A failure on one adversary doesn't abort the rest — deploys as much of the
    roster as it can and reports which creatures (if any) didn't come through.
  - New helpers: `fetchModuleList()`, `fetchModuleEncounters()`,
    `prepareEncounter()`, `findOrCreateEncounterFolder()`; `syncedActorsByEntryId()`
    (Stage 9) extracted to a shared top-level function so both pickers use the
    same New/Up to date/Changed logic.

### Changed
- **Requires Geektastic Realms v1.21.0+** for Deploy Encounter's three new
  `/api/foundry/v1/*` endpoints (module list, per-module encounter list,
  encounter prepare). Everything shipped before this release still works
  unchanged against older GR versions.

## [1.1.0] - 2026-07-18

### Added
- **Stage 9 — Actor re-sync.** Re-importing an entry that's already been created
  in this world now **updates it in place** instead of creating a duplicate.
  - Every Actor created (or updated) by this module is stamped with three flags:
    `grEntryId`, `grContentHash`, and `grSyncedAt`.
  - The Create Actor dialog now shows a per-row status — **New**, **✓ Up to
    date**, or **↻ Changed** — by comparing each entry's `content_hash` (from
    the GR API, requires Geektastic Realms v1.20.0+) against the hash stamped
    on any Actor already built from it. The button reads **Update** instead of
    **Create** wherever a matching Actor already exists.
  - **Update** rewrites the Actor's `name`/`img`/`system` data and rebuilds
    every embedded Item from GR's current data, but never touches the Actor's
    folder, prototype token configuration, ownership, or active effects —
    Foundry-side state GR has no opinion on.
  - A second click in the same dialog session (no reopen needed) now updates
    in place rather than creating a duplicate, immediately after a successful
    create or update.

### Changed
- **Requires Geektastic Realms v1.20.0+** for the sync-status feature — older
  GR versions don't return `content_hash`, so every entry with a matching
  Actor will show as "Changed" (the safe default when the module can't confirm
  otherwise) rather than "Up to date". Everything else in this release works
  unchanged against older GR versions.

## [1.0.0] - 2026-07-17

### Added
- **Stage 8 — first real release.** A GitHub Actions workflow
  (`.github/workflows/release.yml`) builds `module.zip` and publishes a
  GitHub Release on every `vX.Y.Z` tag push, so `module.json`'s `download`
  URL (Foundry's "Install Module → Manifest URL" flow) resolves to a real
  artifact instead of 404ing — previously the only install path was a manual
  folder copy. See [RELEASING.md](RELEASING.md) for the release checklist.

### Fixed
- **Resolved the long-flagged `FormApplication` global-vs-namespaced question**
  without needing a live v13 instance to test both branches: all three
  dialogs (`TestConnectionForm`, `CompendiumSyncForm`, `CreateNpcForm`) now
  extend a `FormApplicationBase` constant that resolves to
  `foundry.appv1.api.FormApplication` if present, falling back to the bare
  `FormApplication` global otherwise — covers both v13 variants rather than
  gambling on one.

---

## [0.9.0] - 2026-07-01

### Added
- **Actor portrait from GR's featured image.** If the entry has a featured image on
  the Geektastic Realms side, it's now uploaded and set as the created Actor's own
  portrait `img` (the prototype token's texture is left at Foundry's default — only
  the portrait is set). Reuses the existing icon fetch/upload pipeline from Stage 6;
  the new `portrait_media_id` field on the prepare payload is distinct from a
  feature/item's `icon_media_id`.

---

## [0.8.0] - 2026-07-01

### Added
- **Destination folder dropdown** in the Create Actor dialog — lists this world's
  Actors-directory folders (populated locally from `game.folders`, no GR round-trip
  needed) so a created Actor can land directly in the folder you pick instead of
  always going to the root of the Actors directory. Applies to whichever entry you
  click Create on next; `Actor.create()` now takes a `folder` id.

---

## [0.7.0] - 2026-07-01

### Changed
- **"Create NPC" renamed to "Create Actor"** (settings menu, dialog title) — the
  picker already pulled from every GR category with a stat block attached, not just
  ones named "NPCs" (`StatBlock::forSetting()` on the GR side has no category filter),
  so the old name undersold it. No GR-side change was needed for this — GR already
  returns each entry's `category` in `/api/foundry/v1/npc/list`.

### Added
- **Category filter** in the Create Actor dialog — a dropdown (populated from the
  categories actually present in the fetched list) narrows the list alongside the
  existing name search. Useful once a world has stat blocks spread across several GR
  categories (e.g. a custom "Monsters" category alongside "NPCs").

---

## [0.6.0] - 2026-07-01

### Added
- **Stage 7 — precise item typing.** Fresh (unmatched) equipment items created for an
  NPC now get an accurate `system.type` value/subtype and a `properties: ['mgc']` flag
  when magical, grounded in real Foundry item exports rather than guessed — a new
  `equipmentSubtype()` helper maps GR's item category to the correct dnd5e type/subtype
  (e.g. `adventuring_gear` → loot/`gear`, `trinket` → equipment/`trinket`, `potion` →
  consumable/`potion`). Also fixed a missing `weight.units: 'lb'` on every fresh item.
  Matched items (with a compendium link) were already fully accurate, since they clone
  the real document instead of building one.

---

## [0.5.0] - 2026-07-01

### Added
- **Stage 6 — icon pipeline.** When creating an NPC, any feature or equipment item
  that has no Stage 4 compendium match but does have an icon attached on the
  Geektastic Realms side now gets that icon in Foundry too, instead of the engine's
  blank default. New `fetchIconBlob()` (authenticated GET against
  `/api/foundry/v1/media/{id}`) and `uploadIconToFoundry()` (uploads the downloaded
  icon into this world's own Data directory at `worlds/{world-id}/grfc-icons/` via
  `FilePicker.upload()`, cached per NPC creation so a shared icon isn't re-uploaded
  once per item). Any failure along the way (network, upload permissions, etc.) is
  swallowed — the item is still created, just without a custom icon.

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

[Unreleased]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/releases/tag/v0.1.0
