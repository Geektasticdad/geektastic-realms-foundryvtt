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
  in v2.0.0 (Stage 15); `compatibility.verified` is now `14` (v2.0.2) on the strength
  of real Actors-tab usage, but the other four Import Hub tabs, the two settings
  dialogs, and the callout-block round-trip haven't been specifically confirmed yet.

---

## Completed stages

Stages 8–14 are fully shipped and confirmed working in a live world — moved to
[ROADMAP_Completed.md](ROADMAP_Completed.md) to keep this file focused on what's still
open. That covers the release pipeline, Actor re-sync, Deploy Encounter (including
token placement), Handouts → Journal, Roll Tables → native RollTables, Adventure →
Journal export, and spellcasting fidelity (summary feature, spell cloning, caster
level, save proficiencies).

## Stage 15 — UX & platform ✅ partially shipped (v1.7.1–v2.0.2)

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
- [x] **ApplicationV2 migration + v14 compatibility (v2.0.0, `compatibility.verified`
  bumped to `"14"` in v2.0.2)** — migrated off the v1 `FormApplication` API, which
  Foundry v14 removes entirely. `compatibility.minimum` stays `"13"` — ApplicationV2
  already worked there too, so v13 installs are unaffected.
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
  - **Confirmed**: all five Import Hub tabs (not just Actors) click through
    correctly and match their old standalone-dialog behavior, and the Journal
    directory-header button opens the hub the same as the Actors one — see the
    "Move entry points"/"Token image support" verification note below.
  - **Still open**: Test Connection and Sync Compendiums (the two remaining
    `GrfcApplication` dialogs, reached from Settings rather than a directory
    header button) and the callout-block ProseMirror round-trip test above
    haven't been specifically confirmed yet.
- [ ] **Localization scaffolding** (`lang/en.json`) if the module is headed for the
  official package listing.

**GR dependency:** `stat_blocks.token_media_id` and `token_media_id` on
`GET /api/foundry/v1/npc/{entryId}/prepare` — ✅ shipped (GR v1.30.0). **Verification:
✅ confirmed** — tab switching works correctly across all five Import Hub tabs (not
just Actors), the Journal directory-header button opens the hub the same as the
Actors one, and each tab's behavior matches its old standalone dialog. Separately
confirmed: a dedicated token image (different from the stat block's own portrait) is
used for the token on both Create and re-sync Update, and clearing the token image
falls back to the portrait image on re-sync, exactly as designed.

## Stage 16 — Structured Activities on Features & Weapons

*Makes a synced Feature/Weapon actually rollable instead of inert flavor text.*

- [ ] GR dependency: Roadmap 2.8 (`stat_block_activities` table, Feature Detail
      columns, new fields on the `/api/foundry/v1/npc/{entryId}/prepare` payload —
      see that repo's ROADMAP.md for the full field list).
- [ ] `featureItemData()`/`equipmentItemData()` (`scripts/main.js:860-871`/
      `944-969`) gain an `activities` param — build the full `system.activities`
      map as plain data and bake it directly into the item payload passed to
      `Item.create()`/`addItemToActor()`, per dnd5e's real schema (no
      `createEmbeddedDocuments('Activity', …)` — activities are a keyed map on
      `system`, not an embedded-document collection). New shared
      `buildActivities(rows)` helper converts GR's flat activity rows into
      per-type `system.activities.{id}` objects (Attack/Cast/Check/Damage/Heal/
      Save), generating ids via `foundry.utils.randomID()`.
- [ ] New `parseDamageFormula(text)` helper (mirrors the existing
      `parseMovement()`/`parseSenses()` free-text-parsing convention) — turns a
      DM-typed `"2d6 + 4"` string into dnd5e's structured damage-part shape
      (`{number, denomination, bonus, types}`).
- [ ] Feature Details: `system.type.value` stays hardcoded `'monster'` (already
      correct, no change); add `system.prerequisites.{level, repeatable}` and
      `system.properties` (`['mgc']`/`['trait']` per the new GR flags — **not**
      "Passive," which dnd5e derives automatically from an activity having no
      activation type) and `system.uses` from the new GR fields.
- [ ] **Compendium-matched items keep their own activities as-is** — GR-specified
      activities only apply to the fresh-create (unmatched) path, consistent with
      the existing "trust the compendium match" philosophy already used for
      icons/full item shape elsewhere in this module.
- [ ] **Cast activities**: after the existing spell-cloning loop in
      `createNpcInFoundry()` finishes, if a feature is the designated spellcasting
      feature (`feature_type === 'spellcasting'`) and carries no manually-defined
      Cast activities of its own, auto-create one Cast activity per cloned spell
      Item, each pointing at that spell's real Foundry UUID
      (`spell.uuid`). Sequenced after Attack/Damage/Save/Check/Heal since it
      depends on spells already existing as real Items — can ship as a follow-up
      point release if it needs more runway than the rest.
- [ ] Live verification: import a feature with an Attack activity (e.g. "Bite: +5
      to hit, 1d6+3 piercing"), a Save-based action (e.g. a breath weapon, "DC 15
      Dex save, half damage"), and a weapon with a Damage activity; confirm each
      rolls correctly from the Actor sheet in a real Foundry v14 world. Separately
      verify the auto-generated Cast activities on a spellcaster's Innate
      Spellcasting feature actually cast the linked spell.

**GR dependency:** Roadmap 2.8 — not yet shipped.

---

## Sequencing

Stage 8 gates everything (verify before building). Stages 9 → 10 are strictly ordered
(encounter deploy reuses re-sync). Stages 11 and 12 are independent of each other and
of 10, but all three precede 13. Stages 14–16 float — schedule opportunistically
alongside GR-side releases, matching the milestone table in the main repo's
[ROADMAP.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/ROADMAP.md).
Stage 16 additionally depends on GR Roadmap 2.8 shipping first.
