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

## Current state (v1.5.0)

Shipped: connection handshake (Stage 2), compendium sync (Stage 3), Actor creation from
any GR stat block with compendium-match reuse (Stage 5), custom icons on fresh items
(Stage 6), precise dnd5e item typing (Stage 7), a real release pipeline (Stage 8),
Actor re-sync (Stage 9), Deploy Encounter with token placement (Stage 10), Handouts →
Journal (Stage 11), Roll Tables → native RollTables (Stage 12), Adventure → Journal
export (Stage 13, the capstone composing Stages 9–12), plus search/category filters, a
destination-folder picker, and Actor portraits from GR featured images (v0.7–v0.9).

All seven build-out stages (handshake, compendium sync, matching, Actor creation,
icons, item typing) are now **✅ confirmed against a real Foundry world** — see the main
repo's build log. Stages 9 (Actor re-sync), 10 (Deploy Encounter, including the
v1.2.1 token-placement fix), 11 (Handouts → Journal), and 12 (Roll Tables → native
RollTables) are now **✅ confirmed working in a live world** too. Known debts, in
rough order of risk:

- **Stage 13 (Adventure → Journal export) hasn't been verified against a live GR
  instance yet** — the round-trip described in its own "Verification" line below
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

## Stage 12 — Roll Tables → native RollTables ✅ shipped and confirmed working in a live world

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
- [x] **Live verification — ✅ confirmed working in a live world.**

**GR dependency:** `GET /api/foundry/v1/modules/{moduleId}/roll-tables` — ✅ shipped
(GR v1.23.0). **Verification: ✅ confirmed** — imported a module's roll tables
against a live Foundry world and GR deployment; tables rolled correctly.

## Stage 13 — Adventure → Journal export ✅ shipped (code-complete; live verification still open)

*The capstone: composes Stages 9–12.*

- [x] GR dependency shipped first, in GR v1.24.0: a module-prepare endpoint,
  `GET /api/foundry/v1/modules/{moduleId}/prepare` — the module's overview plus
  its full section tree (real `body_html`, not the lightweight general-purpose-API
  outline) with a `content_hash` per section, plus each section's Related Articles.
  Deliberately does **not** resolve ref IDs into Foundry document ids itself (GR
  has no way to know what Stages 10–12 created locally in a given world) — see
  [Tech_Docs/FOUNDRY_API.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/Tech_Docs/FOUNDRY_API.md)
  in the main repo.
- [x] New **Import Adventure** dialog: pick a module, preview title/summary/section
  count, click **Import Adventure** once. Imports a whole module as one structured
  Journal Entry — Acts/Chapters/Scenes/Appendices as pages in depth-first tree
  order (Foundry's page model has no true page-within-page nesting, so "nested" is
  achieved via ordering + per-type heading level, matching the web run view's own
  Act=H1/Chapter=H2/Scene=H3/Appendix=H2 convention).
- [x] `encounter-ref`/`handout-ref`/`roll-table-ref` chips in section bodies are
  rewritten into `@UUID` links to the documents Stages 10–12 already created,
  using the same `eid-`/`hid-`/`rtid-` class-token trick the web run view's own
  ref-expansion helpers key off. Anything not yet imported for that specific item
  falls back to plain text instead of a broken link.
- [x] Entry mentions (each section's Related Articles) are linked to a matching
  Actor where Stage 9 already created one — using the structured Related Articles
  data rather than parsing GR's inline `@`-mention anchors, which would depend on
  whether `data-entry-id` survives HTMLPurifier sanitization (see the GR-side
  reasoning linked above).
- [x] Reuses the same per-module Journal Entry Stage 11 already creates — a
  module's narrative and its handouts end up in one journal, not two.
- [x] Re-runnable: page-level `content_hash` comparison means only sections that
  actually changed get rebuilt; every page's `sort` is still kept current even
  when unchanged, so reordered/added/removed sections don't leave the journal out
  of order. A failure on one section doesn't abort the rest.
- [x] Explicitly built **after** 10–12 shipped and were confirmed live — this
  stage creates no new Actors/RollTables/handout pages itself, only links to what
  already exists, matching the "mostly plumbing" scoping.
- [ ] **Live verification** — hasn't been run against a real Foundry world + GR
  v1.24.0+ instance yet.

**GR dependency:** `GET /api/foundry/v1/modules/{moduleId}/prepare` — ✅ shipped (GR
v1.24.0). **Verification:** run a session entirely from the imported journal —
narrative, one fight via its linked encounter (deployed beforehand via Deploy
Encounter), one handout shown to players (imported beforehand via Import Handouts),
one table rolled (imported beforehand via Import Roll Tables); edit one section in
GR, re-import, and confirm only that page rebuilds.

## Stage 14 — Spellcasting fidelity ✅ shipped and confirmed working in a live world (spellcasting-summary feature in v1.6.1/v1.6.2, caster level + save proficiencies in v1.6.3, all three still unverified)

- [ ] **Spellcasting summary imported as a feature (v1.6.1, cloned from a
  compendium in v1.6.2)** — GR's plain-text spellcasting summary
  (`npc.spellcasting.description`) becomes its own "Spellcasting" feature Item on
  the Actor. Foundry's Actor sheet has nowhere else to put this prose. Runs right
  before spell cloning. If the stat block still has the old free-text "spellcasting"
  trait too, both Items appear — expected during the transition, not a bug.
  - First live test showed the imported feature not appearing at all — turned out to
    be a **GR-side bug**, not this module's: `FoundryExport::toPreparePayload()`
    only included the whole `spellcasting` object (summary included) when the
    spellcasting *ability* dropdown was also set, so a stat block with just a
    summary and no ability chosen yet sent `spellcasting: null` and this module's
    code never ran. Fixed in GR v1.28.1 — the object is now included whenever
    either `ability` or `description` is present. No module-side code change
    needed; this module's handling of a null/missing `ability` was already correct.
  - After that fix, the feature *was* importing correctly — but as a bare
    hand-built feat (`featureItemData()`), not the game system's own "Spellcasting"
    feat. v1.6.2's `spellcastingSummaryItemData()` now looks that entry up by name
    across the world's Item-type compendiums first (`findCompendiumItemByName()`)
    and clones it, overriding only its description with GR's summary — falling back
    to the bare feat when no such compendium entry exists.
- [x] When a prepare payload carries GR's structured spell list, match spell names
  against the world's synced spell compendiums and clone matched spells onto the
  created Actor — reuses the same `resolveCompendiumItem()`/`fromUuid()` clone path
  Stages 5/9 already use for features/items, applied in `createNpcInFoundry()` so both
  Create Actor and Deploy Encounter get it for free.
- [x] Sets `system.attributes.spellcasting` to the stat block's spellcasting ability,
  so Foundry's own DC/attack derivation is correct even with no override.
- [x] A DM-entered printed DC/attack override (an absolute value, e.g. "Spellcasting
  DC 15") is applied as the *delta* from the standard `8 + proficiency + modifier` /
  `proficiency + modifier` formula, set via dnd5e's bonus-formula fields
  (`system.bonuses.spell.dc`, `.msak.attack`/`.rsak.attack`) — dnd5e has no raw
  override field, so this is how the printed value is reproduced exactly. See
  `spellcastingBonuses()`.
- [x] Unmatched names keep today's free-text feature fallback (the existing
  `spellcasting`-typed trait imports unchanged) — nothing is guessed, and a toast
  tells the DM how many names had no exact match.
- [x] GR-side matching only ever accepts an **exact** name match, not Stage 4's fuzzy
  fallback — there's no per-spell review step, so a wrong fuzzy match would silently
  clone the wrong spell with nothing to catch it.
- [x] **Pact Magic and Innate Spellcasting (At Will / X-per-day), not just plain spell
  slots** — each spell's `usage_type` (`slot`/`pact`/`at_will`/`per_day`) is mapped
  onto dnd5e's own preparation modes (`always`/`pact`/`atwill`/`innate`) via
  `applySpellUsage()`, plus a best-effort daily-recovery `system.uses` counter for
  `per_day`, so these don't clone in looking like ordinary slot-based spells.
- [ ] **Spellcaster level + explicit ability save proficiencies (v1.6.3, GR v1.29.0
  dependency)** — `spellcasting.caster_level` (1-20) sets `system.details.spellLevel`
  (dnd5e's automatic spell-slot-table field — best-effort schema mapping, not
  live-verified) and `npc.saving_throw_proficiencies` (six explicit booleans, not
  spellcasting-specific) sets `abilities.*.proficient` on every ability — something
  neither the create nor update path ever did before, since the only prior signal
  (the free-text `saving_throws` line) was never read on the live-connection path at
  all.
- [x] **Live verification — ✅ confirmed working in a live world (except the
  spellcasting-summary feature and this bullet — see their own status above/below).**

**GR dependency:** structured spellcasting on stat blocks (main roadmap 2.6) — ✅
shipped (GR v1.26.0, usage types included; `description` field for the summary
feature above in GR v1.28.0). **Verification:** the original ability/DC/attack/spell-
matching/usage-type behavior is **✅ confirmed** — including tracking down an early
false alarm where two spells reported as unmatched turned out to be a Sync
Compendiums gap (the world's spell pack had never been ticked/synced, so
`foundry_compendium_entries` had zero `item_type = 'spell'` rows to match against) —
once synced, matching and cloning worked as designed. The v1.6.1 spellcasting-summary
feature is **not yet verified** live — check that the "Spellcasting" feature Item
appears with the expected text and doesn't collide oddly with an existing free-text
trait of the same name.

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
