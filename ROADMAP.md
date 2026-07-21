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

## Current state (v1.4.0)

Shipped: connection handshake (Stage 2), compendium sync (Stage 3), Actor creation from
any GR stat block with compendium-match reuse (Stage 5), custom icons on fresh items
(Stage 6), precise dnd5e item typing (Stage 7), a real release pipeline (Stage 8),
Actor re-sync (Stage 9), Deploy Encounter with token placement (Stage 10), Handouts →
Journal (Stage 11), Roll Tables → native RollTables (Stage 12), plus search/category
filters, a destination-folder picker, and Actor portraits from GR featured images
(v0.7–v0.9).

All seven build-out stages (handshake, compendium sync, matching, Actor creation,
icons, item typing) are now **✅ confirmed against a real Foundry world** — see the main
repo's build log. Stages 9 (Actor re-sync), 10 (Deploy Encounter, including the
v1.2.1 token-placement fix), and 11 (Handouts → Journal) are now **✅ confirmed
working in a live world** too. Known debts, in rough order of risk:

- **Stage 12 (Roll Tables → native RollTables) hasn't been verified against a live
  GR instance yet** — the round-trip described in its own "Verification" line below
  hasn't actually been run.
- v14 compatibility is still unverified (`compatibility.verified` stays at `13` until
  actually tested there).

---

## Stage 8 — First real release ✅ shipped

*No new features. Make what exists installable the normal way.*

- [x] Resolved the long-flagged `FormApplication` global-vs-`foundry.appv1.api`
  question — rather than pick one and require live-instance verification, all three
  dialogs now extend a `FormApplicationBase` constant that resolves to the namespaced
  class if present, falling back to the bare global otherwise. Covers both v13
  variants; no longer a known gap.
- [x] Release pipeline: `.github/workflows/release.yml` builds `module.zip` (files at
  the zip root, matching the folder-name-must-equal-id lesson from Stage 2) and
  publishes a GitHub Release on every `vX.Y.Z` tag push. [RELEASING.md](RELEASING.md)
  is the minimal checklist. `module.json` bumped to `1.0.0`.
- [x] **v1.0.0 published** — [the release](https://github.com/Geektasticdad/geektastic-realms-foundryvtt/releases/tag/v1.0.0)
  is live with `module.zip` attached, and `releases/latest/download/module.zip`
  (the URL `module.json`'s `download` field points at) resolves with a real `200`.
  One bootstrapping wrinkle hit along the way: the very first tag push raced ahead of
  GitHub's registration of the brand-new workflow file (pushed ~14s after the workflow
  was fully indexed — a known GitHub Actions gotcha for a workflow's first-ever
  trigger) and silently didn't fire. Fixed by deleting and re-pushing the tag once the
  workflow was confirmed live on `main`; every release after this one won't hit it,
  since the workflow will already be well-established before any future tag push.
  Verified: manifest-URL install fetches `module.json`, resolves `download` to the
  published `module.zip`, and the zip's `module.json` sits at the root as required.

**GR dependency:** none. **Verification:** fresh Foundry world installs the module via
manifest URL alone and completes an end-to-end Actor creation.

## Stage 9 — Actor re-sync (update instead of duplicate) ✅ shipped and confirmed working in a live world

- [x] GR dependency shipped first, in GR v1.20.0: `content_hash` on both
  `/npc/list` (per row) and `/npc/{id}/prepare` (top-level) — a change-detection
  fingerprint over the exact prepare payload, computed fresh per request so it can
  never drift from what `/prepare` actually returns. See
  [Tech_Docs/FOUNDRY_API.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/Tech_Docs/FOUNDRY_API.md)
  in the main repo.
- [x] Every created **or updated** Actor is stamped with module flags: `grEntryId`,
  `grContentHash`, `grSyncedAt`.
- [x] The Create Actor dialog compares each row's `content_hash` against any Actor
  already flagged with that `grEntryId`, and shows per-row status — **New** /
  **✓ Up to date** / **↻ Changed** — with the button reading **Update** instead of
  **Create** wherever a match exists.
- [x] **Update** rewrites `name`/`img`/`system` and rebuilds every embedded Item from
  GR's current data, but never touches the Actor's folder, prototype token config,
  ownership, or active effects — those keys are simply never included in the update
  payload. A second click in the same dialog session (no reopen needed) now updates
  in place instead of creating a duplicate.
- [x] **Live verification — ✅ confirmed working in a live world.**

**GR dependency:** `content_hash` on `/npc/list` and `/npc/{id}/prepare` — ✅ shipped
(GR v1.20.0). **Verification: ✅ confirmed** — imported an NPC, edited its stat block
in GR, confirmed the dialog flagged it Changed, clicked Update, and confirmed it
converged without a duplicate.

## Stage 10 — Deploy Encounter ✅ shipped and confirmed working in a live world

*The reason Adversaries exist. One click turns a GR encounter into a ready fight.*

- [x] GR dependency shipped first, in GR v1.21.0: `GET /api/foundry/v1/modules`
  (module picker), `GET /api/foundry/v1/modules/{moduleId}/encounters` (encounter
  picker, roster shown inline), and `GET /api/foundry/v1/encounter/{id}/prepare`
  (batched prepare payload + content_hash per distinct adversary — no separate
  `npc/{id}/prepare` round trip per creature). See
  [Tech_Docs/FOUNDRY_API.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/Tech_Docs/FOUNDRY_API.md)
  in the main repo.
- [x] New **Deploy Encounter** dialog: pick a module → encounter (name, type,
  difficulty, adversary roster shown inline in the picker before committing to
  anything).
- [x] Each adversary's Actor is created-or-updated via the Stage 9 pipeline
  (`syncedActorsByEntryId()` extracted to a shared helper so both pickers agree on
  New/Up to date/Changed), filed in an `Encounters/{name}` folder (created on
  demand, reused rather than duplicated on re-deploy).
- [x] Optional **token placement** (checked by default) — one token per creature,
  placed on whichever scene is currently open, arranged in a simple grid centered
  on the DM's current view. Skipped (with a note in the result) if no scene is
  open; the Actors are still created either way.
- [x] Optional **Combat** creation (checked by default) — one combatant per
  quantity (6 hobgoblins = 6 combatant entries referencing the one hobgoblin
  Actor), linked to the placed tokens above so the tracker and the map agree
  immediately; falls back to actor-only combatants if token placement was
  skipped. The combat is activated so the tracker shows it immediately.
- [x] Per-step progress like the existing Create Actor flow; a failure on one
  adversary doesn't abort the rest — the dialog reports how many deployed and,
  if any failed, which ones and why.
- [x] **First live test surfaced a real gap, now fixed (v1.2.1):** v1.2.0's first
  real run confirmed Actor creation and Combat creation both worked, but the
  Combat's combatants had no placed tokens — "create the encounter" didn't mean
  "ready to run" yet, just "referenced in the tracker." Token placement (above)
  closes that gap.
- [x] **Live re-verification of v1.2.1's token placement — ✅ confirmed working in
  a live world.**

**GR dependency:** `GET /api/foundry/v1/encounter/{id}/prepare` plus the module/
encounter list endpoints — ✅ shipped (GR v1.21.0). **Verification: ✅ confirmed** —
deployed against a live Foundry world with v1.2.1's token placement; Actors, placed
tokens, and the linked Combat all came through correctly.

## Stage 11 — Handouts → Journal ✅ shipped and confirmed working in a live world

- [x] GR dependency shipped first, in GR v1.22.0:
  `GET /api/foundry/v1/modules/{moduleId}/handouts` — every handout in a module with
  a `content_hash` over its own display fields, reusing the existing
  `Handout::forModule()` and the generic `FoundryExport::contentHash()` helper. See
  [Tech_Docs/FOUNDRY_API.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/Tech_Docs/FOUNDRY_API.md)
  in the main repo.
- [x] New **Import Handouts** dialog: pick a module → preview every handout's status
  (New / ✓ Up to date / ↻ Changed) → one **Import Handouts** button creates one
  Journal Entry per module with a page per handout (title, rich-text body, and image
  embedded above it — fetched through the existing Stage 6 icon pipeline and
  uploaded to the world's Data directory).
- [x] Re-import finds the same Journal Entry again (flagged with `grModuleId`, not
  found by name — survives a rename) and only touches pages whose handout actually
  changed since (flag/hash approach from Stage 9/10), so unchanged handouts are left
  completely alone rather than refreshed or duplicated. A failure on one handout
  doesn't abort the rest.
- [x] The journal opens automatically once import finishes; at the table the DM
  uses Foundry's native **Show to Players** on any page.
- [x] **Live verification — ✅ confirmed working in a live world.**

**GR dependency:** `GET /api/foundry/v1/modules/{moduleId}/handouts` — ✅ shipped (GR
v1.22.0). **Verification: ✅ confirmed** — imported a module's handouts against a
live Foundry world and GR deployment; pages rendered correctly.

## Stage 12 — Roll Tables → native RollTables ✅ shipped (code-complete; live verification still open)

- [x] GR dependency shipped first, in GR v1.23.0: a Foundry-prefixed equivalent,
  `GET /api/foundry/v1/modules/{moduleId}/roll-tables` — every table in a module
  with full rows and a `content_hash` computed over only `title` + row
  `range_start`/`range_end`/`title`/`type`/`description`, deliberately excluding
  `dm_notes`/`dm_note`. See
  [Tech_Docs/FOUNDRY_API.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/Tech_Docs/FOUNDRY_API.md)
  in the main repo.
- [x] New **Import Roll Tables** dialog: pick a module → preview every table's
  status (New / ✓ Up to date / ↻ Changed) → one **Import Roll Tables** button
  imports the whole set. Ranges map to result ranges, the computed die maps to the
  table's roll formula (`1dN`), and each row's title + description become the
  result text. The DM-only note fields stay behind — kept conservative to rows
  only, per this stage's own scoping.
- [x] A synthetic "No result" row is added client-side to span any gap between the
  highest authored range and the die's full face count, mirroring GR's own
  `RollTables::withPadding()` — a roll never comes up empty.
- [x] Same idempotent update-in-place behavior as Stages 9/11: re-import finds the
  same RollTable (flagged with `grRollTableId`, not found by name) and only
  rebuilds tables whose content actually changed; a failure on one table doesn't
  abort the rest.
- [ ] **Live verification** — hasn't been run against a real Foundry world + GR
  v1.23.0+ instance yet.

**GR dependency:** `GET /api/foundry/v1/modules/{moduleId}/roll-tables` — ✅ shipped
(GR v1.23.0). **Verification:** import a module with a table whose die has unused
faces above its highest authored range, confirm the padded "No result" span rolls
correctly in chat; edit a row in GR and re-import, confirming only that table
rebuilds; edit only a DM note and re-import, confirming the table is left alone
(still shows Up to date, not Changed).

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
