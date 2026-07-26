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
v1.2.1 token-placement fix), 11 (Handouts → Journal), 12 (Roll Tables → native
RollTables), and 13 (Adventure → Journal export) are now **✅ confirmed working in a
live world** too. Known debts, in rough order of risk:

- v14 compatibility: the ApplicationV2 migration and ProseMirror-safety fixes shipped
  in v2.0.0 (Stage 15), but neither has been live-tested against a real Foundry v14
  instance yet — `compatibility.verified` stays at `13` until that happens.

---

## Completed stages

Stages 8–14 are fully shipped and confirmed working in a live world — moved to
[ROADMAP_Completed.md](ROADMAP_Completed.md) to keep this file focused on what's still
open. That covers the release pipeline, Actor re-sync, Deploy Encounter (including
token placement), Handouts → Journal, Roll Tables → native RollTables, Adventure →
Journal export, and spellcasting fidelity (summary feature, spell cloning, caster
level, save proficiencies).

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
- [x] **ApplicationV2 migration + v14 compatibility (v2.0.0, live verification
  still open)** — migrated off the v1 `FormApplication` API, which Foundry v14
  removes entirely. `compatibility.verified` stays `"13"` in `module.json` —
  ApplicationV2 already works on v13 (that's what made doing this ahead of v14's
  forcing deadline possible), and `verified` isn't bumped to `14` until this is
  actually tested there.
  - Scope: the new shared `GrfcApplication` base (`scripts/main.js`, extends
    `foundry.applications.api.ApplicationV2`) is extended by the same three
    classes that used to extend `FormApplicationBase` — `TestConnectionForm`,
    `CompendiumSyncForm`, and the consolidated `ImportHubForm` (Stage 15's 5-tab
    hub: actors / encounters / handouts / tables / adventure). Every dialog's
    HTML-building and jQuery event-wiring code (all five tabs' worth) is
    unchanged — only the class-level lifecycle hooks were ported:
    `defaultOptions` → `static DEFAULT_OPTIONS`, `getData()`/`_renderInner()` →
    `_prepareContext()`/`_renderHTML()`, `activateListeners()` → `_onRender()`.
  - **Foundry v14 also makes ProseMirror the only supported rich-text editor**
    for Journal Entry pages. GR itself isn't changing (still Tiptap) — this is
    purely about what survives on the Foundry side when a DM opens an imported
    page in Foundry's own editor to tweak it, since ProseMirror re-parses the
    existing HTML through its own schema on load. Two fixes landed in v2.0.0:
    - GR's six custom Tiptap "callout" block types (`read-aloud`, `dm-note`,
      `encounter-block`, `treasure-block`, `boxed-text`, `dm-secret` — all built
      from GR's `makeWrapperNode()` factory) are now rewritten
      (`rewriteCalloutBlocks()`) from a plain `<div class="...">` — not a
      ProseMirror schema node, and previously left to be silently unwrapped —
      into a `<blockquote>` with a bold label identifying the callout type.
      Best-effort: **still needs an actual test** (import a page with each
      callout type, open it in Foundry's v14 editor, save without changing
      anything, diff the resulting HTML) before trusting it fully.
    - `rewriteAdventureRefs()` now also handles `qid-` (quest-ref) chips from
      GR's "Insert Quest" slash command, alongside the existing
      `eid-`/`hid-`/`rtid-` cases — always a plain icon + title label, never an
      `@UUID` link, since there's no Foundry document a quest item could link
      to (no "deploy a quest" stage).
    - `handoutPageContent()` (Stage 11's Handouts → Journal) now runs both
      rewrites too, instead of passing `handout.body_html` straight through
      untouched. No cross-module document data is fetched for a handout
      import, so an embedded encounter-ref/handout-ref/roll-table-ref chip
      still falls back to its plain-label case there, same as before.
  - **Still open**: a real click-through of all three dialogs against a live
    Foundry v14 instance — every tab of the Import Hub, Test Connection, Sync
    Compendiums — plus the callout-block round-trip test above, before this is
    trusted in an actual game and `compatibility.verified` gets bumped to `14`.
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
