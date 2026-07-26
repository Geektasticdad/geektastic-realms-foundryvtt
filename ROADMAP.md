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

## Completed stages

Stages 8–12 and 14 are fully shipped and confirmed working in a live world — moved to
[ROADMAP_Completed.md](ROADMAP_Completed.md) to keep this file focused on what's still
open. That covers the release pipeline, Actor re-sync, Deploy Encounter (including
token placement), Handouts → Journal, Roll Tables → native RollTables, and
spellcasting fidelity (summary feature, spell cloning, caster level, save
proficiencies).

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

## Stage 15 — UX & platform ✅ partially shipped (v1.7.1, unverified)

Quality-of-life once the feature set stabilizes:

- [x] **Move entry points out of Module Settings (v1.7.0, tab-switching fixed in
  v1.7.1)** — a Geektastic Realms button in the Actors/Journal directory headers
  opening one consolidated import dialog with tabs (Actors / Encounters / Handouts /
  Tables / Adventure). Settings is now only Server URL/API Token/Test
  Connection/Sync Compendiums. Every tab's markup/behavior is the unchanged code from
  the five original dialogs, just reached from one window instead of five settings
  menu entries.
  - First live test: the directory-header button appeared and opened the hub
    correctly, but clicking a tab never switched away from Actors. v1.7.0 relied on
    `FormApplication`'s built-in `options.tabs` binding, which didn't actually fire
    the panel switch on click. Fixed in v1.7.1 with a small self-contained click
    handler instead — no longer depends on that Foundry-internal mechanism at all.
  - The directory-header button placement is still a best-effort DOM-selector guess
    (with fallback levels); confirmed to work in the live test above, so this part is
    now considered verified.
- [x] **Token image support (v1.7.0)** — a stat block's own dedicated
  **Prototype token image** field (GR `token_media_id`) sets the created/re-synced
  Actor's `prototypeToken.texture.src`; falls back to the same featured image already
  used for the portrait when no dedicated token image is set (GR resolves this
  fallback server-side, so the module doesn't need its own fallback logic). Applied
  on both Create and Update, touching only the texture — every other prototype token
  setting is left alone, same as before.
- [ ] **ApplicationV2 migration + v14 compatibility** — migrate off the v1
  `FormApplication` API when v14's deprecation pressure makes it worthwhile; bump
  `compatibility.verified` after real testing.
- [ ] **Localization scaffolding** (`lang/en.json`) if the module is headed for the
  official package listing.

**GR dependency:** `stat_blocks.token_media_id` and `token_media_id` on
`GET /api/foundry/v1/npc/{entryId}/prepare` — ✅ shipped (GR v1.30.0). **Verification:**
opening the hub from the Actors directory-header button and seeing all five tabs is
**✅ confirmed** (the bug report that led to v1.7.1). Still open: re-confirm tab
switching actually works now (click through all five, not just Actors), confirm the
Journal directory-header button too, and confirm each tab's behavior matches its old
standalone dialog. Separately, set a dedicated token image on a stat block with a
different image than its portrait, create/re-sync its Actor, and confirm the token
(not just the portrait) uses that image; then clear the token image and confirm
re-syncing falls back to the portrait image for the token too.

---

## Sequencing

Stage 8 gates everything (verify before building). Stages 9 → 10 are strictly ordered
(encounter deploy reuses re-sync). Stages 11 and 12 are independent of each other and
of 10, but all three precede 13. Stages 14–15 float — schedule opportunistically
alongside GR-side releases, matching the milestone table in the main repo's
[ROADMAP.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/ROADMAP.md).
