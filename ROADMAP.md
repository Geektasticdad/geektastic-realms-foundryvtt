# Geektastic Realms Foundry Connect — Roadmap

The forward plan for this module. It continues the staged build documented in the main
repo's build log
([Tech_Docs/ROADMAP.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/Tech_Docs/ROADMAP.md),
Stages 1–7 shipped) and implements the Foundry-facing half of the product roadmap in
[geektastic-realms/ROADMAP.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/ROADMAP.md).
Most stages below have a Geektastic Realms API dependency — each stage notes it, and the
GR side always ships (and is curl-verified) first, per the sequencing rule that has held
since Stage 1.

**DM-first framing:** the game is played in Foundry. This module's job is to make a
DM's Geektastic Realms prep arrive at the table ready to run — the unit of import should
grow from *one Actor* (today) to *one encounter*, then *one session's handouts and
tables*, then *the whole adventure*.

---

## Current state (v0.9.0)

Shipped: connection handshake (Stage 2), compendium sync (Stage 3), Actor creation from
any GR stat block with compendium-match reuse (Stage 5), custom icons on fresh items
(Stage 6), precise dnd5e item typing (Stage 7), plus search/category filters, a
destination-folder picker, and Actor portraits from GR featured images (v0.7–v0.9).

All seven build-out stages (handshake, compendium sync, matching, Actor creation,
icons, item typing) are now **✅ confirmed against a real Foundry world** — see the main
repo's build log. Known debts, in rough order of risk:

- **No release pipeline** — install is manual folder-copy; `module.json` advertises a
  `manifest`/`download` URL that has no published release behind it yet.
- **Actor creation is create-only** — re-importing an entry duplicates the Actor.
- Built on the v1 `FormApplication` API (fine on v13 via the compatibility layer; a
  known migration cost when v14 arrives), including a long-flagged unresolved question
  (inline comment in `scripts/main.js`) about whether it's still a bare global in v13.

---

## Stage 8 — First real release

*No new features. Make what exists installable the normal way.*

- Resolve the long-flagged `FormApplication` global-vs-`foundry.appv1.api` question
  (one-line fix noted inline in `scripts/main.js`) while touching this code.
- Cut **v1.0.0**: a GitHub release with a `module.zip` matching the `download` URL in
  `module.json`, so Foundry's "Install Module → Manifest URL" flow works. Add a minimal
  release checklist (bump `module.json` version, zip with correct folder name, tag).

**GR dependency:** none. **Verification:** fresh Foundry world installs the module via
manifest URL alone and completes an end-to-end Actor creation.

## Stage 9 — Actor re-sync (update instead of duplicate)

- Stamp every created Actor with module flags: `grEntryId`, `grContentHash`,
  `grSyncedAt`.
- The Create Actor dialog compares list-payload hashes against world actors and shows
  per-row status — **New** / **Up to date** / **Changed** — with **Update** replacing
  Create where an actor already exists. Update rewrites system data and re-builds
  items, but preserves Foundry-side customization that GR knows nothing about
  (prototype token config, ownership, active effects added at the table).
- A re-run is idempotent: importing twice never produces two actors.

**GR dependency:** `content_hash` on `/npc/list` and `/npc/{id}/prepare`.
**Verification:** import an NPC, edit its stat block in GR, confirm the dialog flags it
Changed and Update converges without a duplicate.

## Stage 10 — Deploy Encounter

*The reason Adversaries exist. One click turns a GR encounter into a ready fight.*

- New **Import Encounter** dialog: pick a module → encounter (name, type, difficulty,
  adversary roster shown), then the module creates/updates each adversary's Actor via
  the Stage 9 pipeline, files them in an `Encounters/{name}` folder, and — optionally —
  creates a Foundry **Combat** with one combatant per quantity (6 hobgoblins = 6
  combatant entries referencing the one hobgoblin Actor).
- Per-step progress like the existing Create Actor flow; failures on one adversary
  don't abort the rest.

**GR dependency:** `GET /api/foundry/v1/encounter/{id}/prepare` (encounter metadata +
per-adversary prepare payloads with quantities); an encounter-list endpoint per module.
**Verification:** a 3-adversary encounter lands as a folder of actors and a pre-built
Combat in the tracker.

## Stage 11 — Handouts → Journal

- **Import Handouts** dialog per module: creates one Journal Entry per module with a
  page per handout (v13 multi-page journals) — title, rich-text body, and image
  (fetched through the existing authenticated media endpoint and uploaded to the
  world's Data directory, same pipeline as Stage 6 icons).
- Re-import updates pages in place (flag/hash approach from Stage 9), so edited
  handouts refresh rather than duplicate.
- At the table the DM uses Foundry's native **Show to Players** on any page.

**GR dependency:** `GET /api/foundry/v1/module/{id}/handouts`.
**Verification:** image + text handout renders correctly as a journal page and can be
shown to a player account.

## Stage 12 — Roll Tables → native RollTables

- Import a GR roll table as a Foundry **RollTable** document: ranges map to result
  ranges, the computed die maps to the table formula, descriptions to result text. The
  DM-only note fields stay behind (GM-visible documents anyway, but keep the mapping
  conservative: rows only).
- Same idempotent update-in-place behavior as Stages 9/11.
- Once native, table draws use Foundry's own dice + chat output — no GR run-view needed
  mid-session.

**GR dependency:** the Roll Tables API (planned as Priority 1.2 in the main roadmap) or
a Foundry-prefixed equivalent.
**Verification:** a d20 table with a padded "No result" span rolls correctly in chat.

## Stage 13 — Adventure → Journal export

*The capstone: composes Stages 9–12.*

- Import a whole module as a structured Journal Entry: Acts/Chapters/Scenes as nested
  pages in tree order; `encounter-ref`/`handout-ref`/`roll-table-ref` chips in section
  bodies rewritten as `@UUID` links to the documents created by Stages 10–12; entry
  mentions linked where a matching Actor exists.
- Re-runnable: page-level hash comparison updates only changed sections.
- Explicitly **after** 10–12 ship — this stage should be mostly plumbing, not new
  document logic.

**GR dependency:** a module-prepare endpoint that serializes the section tree with
resolved ref IDs.
**Verification:** run a session entirely from the imported journal — narrative, one
fight via its linked encounter, one handout shown to players, one table rolled.

## Stage 14 — Spellcasting fidelity

- When a prepare payload carries GR's structured spell list (planned GR-side), match
  spell names against the world's synced spell compendiums and clone matched spells
  onto the created Actor with the right spellcasting ability/DC; unmatched names keep
  today's free-text feature fallback.

**GR dependency:** structured spellcasting on stat blocks (main roadmap 2.6).

## Stage 15 — UX & platform

Quality-of-life once the feature set stabilizes:

- **Move entry points out of Module Settings** — a Geektastic Realms button in the
  Actors/Journal directory headers (or a scene-controls tool) opening one consolidated
  import dialog with tabs (Actors / Encounters / Handouts / Tables / Adventure).
  Settings should be for settings.
- **Token image support** — optional: use the GR featured image (or a dedicated token
  image field, if GR adds one) for the prototype token, not just the portrait.
- **ApplicationV2 migration + v14 compatibility** — migrate off the v1
  `FormApplication` API when v14's deprecation pressure makes it worthwhile; bump
  `compatibility.verified` after real testing.
- **Localization scaffolding** (`lang/en.json`) if the module is headed for the
  official package listing.

---

## Sequencing

Stage 8 gates everything (verify before building). Stages 9 → 10 are strictly ordered
(encounter deploy reuses re-sync). Stages 11 and 12 are independent of each other and
of 10, but all three precede 13. Stages 14–15 float — schedule opportunistically
alongside GR-side releases, matching the milestone table in the main repo's
[ROADMAP.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/ROADMAP.md).
