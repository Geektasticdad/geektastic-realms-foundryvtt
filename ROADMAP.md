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

## Stage 16 — Structured Activities on Features & Weapons ✅ code shipped (v2.1.0; live verification still open)

*Makes a synced Feature/Weapon actually rollable instead of inert flavor text.*

- [x] GR dependency: Roadmap 2.8 (`stat_block_activities` table, Feature Detail
      columns, new fields on the `/api/foundry/v1/npc/{entryId}/prepare` payload —
      see that repo's ROADMAP.md for the full field list). Shipped in GR v2.0.0.
- [x] `featureItemData()`/`equipmentItemData()` gain the new GR fields and bake a
      real `system.activities` map directly into the item payload passed to
      `Item.create()`/`addItemToActor()`, per dnd5e's real schema (no
      `createEmbeddedDocuments('Activity', …)` — activities are a keyed map on
      `system`, not an embedded-document collection). Shared `buildActivities(rows)`
      helper converts GR's flat activity rows into per-type
      `system.activities.{id}` objects (Attack/Check/Damage/Heal/Save + the
      separate Cast builder below), generating ids via `foundry.utils.randomID()`.
- [x] New `parseDamageFormula(text)` helper (mirrors the existing
      `parseMovement()`/`parseSenses()` free-text-parsing convention) — turns a
      DM-typed `"2d6 + 4"` string into dnd5e's structured damage-part shape
      (`{number, denomination, bonus, types}`), falling back to dnd5e's own
      custom-formula field for anything that isn't a simple `NdM [+/- bonus]`.
- [x] Feature Details: `system.type.value` stays hardcoded `'monster'` (no
      change); added `system.prerequisites.{level, repeatable}` and
      `system.properties` (`['mgc']`/`['trait']` per the new GR flags — **not**
      "Passive," which dnd5e derives automatically from an activity having no
      activation type) and `system.uses` from the new GR fields.
- [x] **Compendium-matched items keep their own activities as-is** — GR-specified
      activities only apply to the fresh-create (unmatched) path, consistent with
      the existing "trust the compendium match" philosophy already used for
      icons/full item shape elsewhere in this module.
- [x] **Cast activities**: after the spell-cloning loop in `createNpcInFoundry()`
      finishes, the fresh-created (unmatched) spellcasting feature — tracked while
      the features loop runs — gets one auto-generated Cast activity per cloned
      spell Item, each pointing at that spell's real Foundry UUID (`spell.uuid`).
      GR itself never sends Cast activities (`stat_block_activities.activity_type`
      deliberately excludes `cast`), so there's nothing DM-entered to preserve —
      only the general compendium-match rule applies (a matched spellcasting
      feature is skipped, same as everything else).
- [x] **Multi-part damage (v2.1.1)** — an Attack/Save/Damage activity's
      `damage.parts[]` can now hold more than one entry (e.g. a poisoned dagger's
      `1d4` piercing plus `3d6` poison), via GR's own multi-part follow-up
      (`activities[].damage_parts[]` on the prepare payload). New
      `parseDamageParts()` maps each part through `parseDamageFormula()`. A Heal
      activity still only ever uses the first part, since dnd5e's `healing` field
      is a single value, not an array.
- [ ] **Live verification** (not yet done — no live Foundry v14 world available in
      this pass): import a feature with an Attack activity (e.g. "Bite: +5 to hit,
      1d6+3 piercing"), a Save-based action (e.g. a breath weapon, "DC 15 Dex save,
      half damage"), and a weapon with a Damage activity; confirm each rolls
      correctly from the Actor sheet. Separately verify the auto-generated Cast
      activities on a spellcaster's Innate Spellcasting feature actually cast the
      linked spell. This is a best-effort translation of dnd5e's real Activity
      schema (not independently re-verified against source for this pass, unlike
      the original Stage 8-14 builds) — treat every field name here as "worth
      double-checking" until a live run confirms it.

**GR dependency:** Roadmap 2.8 — shipped in GR v2.0.0.

---

## Stage 17 — Foundry Chat Archive ✅ code shipped (v2.2.0; live verification still open)

*The session actually happened in this world's chat log. Give the DM a one-click way to
carry it into Geektastic Realms before it's gone.*

- [x] `captureChatLogHtml()` — reads the chat sidebar's rendered DOM (each
      `li.chat-message`'s own `outerHTML`, in order), not a reconstruction from
      `ChatMessage.content`, so on-screen formatting (dice-roll cards included)
      survives untouched.
- [x] `ArchiveChatForm` (new `ApplicationV2` dialog, same shape as
      `TestConnectionForm`) — Module/Title/Date of Session/Description fields plus
      a "delete all chat messages after archiving" checkbox. POSTs to GR's new
      `POST /api/foundry/v1/modules/{moduleId}/chat-archives` (reuses the existing
      `foundry` token scope — no new scope needed).
- [x] `renderChatLog` hook + `addArchiveChatButton()` — adds an "Archive Chat"
      button to the chat sidebar's controls row, same defensive-selector-fallback
      shape as `addImportHubButton()`'s directory-header button.
- [x] Delete-after-archive safety: the checkbox alone never deletes anything — a
      *second*, separate `DialogV2.confirm()` is required, and only appears after
      the archive POST has actually succeeded.
- [ ] **Live verification** (not yet done — no live Foundry v14 world available in
      this pass): confirm the `#chat-controls`/`.chat-controls` selector and the
      `renderChatLog` hook actually fire and place the button somewhere sensible;
      confirm `captureChatLogHtml()` captures a long/scrolled chat history
      completely rather than only what's currently rendered/paginated; confirm the
      bulk `ChatMessage.deleteDocuments()` call clears the log for every connected
      client, not just the GM; spot-check the GR-side stylesheet's visual fidelity
      against a real chat log with dice-roll cards.

**GR dependency:** Roadmap 2.9 — shipped in GR v2.1.0.

## Stage 18 — Bestiary Import (Roadmap 3.5) ✅ code shipped (v2.3.0; live verification still open)

*GR's first roadmap 3.5 pass bundled a static SRD monster dataset — replaced entirely
once it turned out not to match the user's actual SRD content. A DM's own Foundry world
already has accurate, system-maintained creature data; there's no reason for GR to
independently curate a copy when this module can just read it.*

- [x] `actorPacks()` — mirrors the existing `itemPacks()`, filtered to
      `documentName === 'Actor'` instead of `'Item'`.
- [x] New "Bestiary" tab in `ImportHubForm` — pack picker (`actorPacks()`, client-side)
      + GR category picker (`GET /api/foundry/v1/categories`, new endpoint, existing
      `foundry` token scope) → **Load Creatures** reads the chosen pack's index
      (name/type only, no full document load) into a checkbox list with a live name
      filter (adapts `CompendiumSyncForm`'s checkbox-list pattern, the only existing
      per-item picker in this module, since none of the other four hub tabs select
      individual items) → **Import Selected** loads only the checked entries in full
      (`fromUuid()` per selection), chunks them, and POSTs to GR's new
      `POST /api/foundry/v1/compendium/import-actors`.
- [x] `serializeActorForImport()` / `importActorsToGr()` — new top-level helpers
      alongside `syncCompendiums()`; `IMPORT_ACTORS_CHUNK_SIZE = 25` (smaller than
      `SYNC_CHUNK_SIZE = 100` since each actor's payload — full `system` data plus
      every embedded Item — is much heavier than compendium sync's raw index
      passthrough).
- [ ] **Phase 2/3 (GR-side, `FoundryActorImportMapper`):** the first pass covers core
      stat block fields (abilities, AC, HP, speed, saves, skills, senses, languages,
      damage/condition lists, CR) and flavor-text features (traits/actions as plain
      description text). Mechanical Activities (attack/save/check/heal/damage rolls)
      and equipment items aren't mapped yet — every imported feature lands as a
      passive Trait until that follow-up pass ships.
- [ ] **Live verification** (not yet done — no live Foundry v14 world available in
      this pass): confirm `pack.getIndex()`/`fromUuid()` behave as expected against a
      real Actor-type compendium (the dnd5e system's own SRD monsters pack is the
      obvious first target); confirm `actor.toObject()` actually carries `items[]`
      (may need the `actor.items.map(i => i.toObject())` fallback `serializeActorForImport()`
      already has); most importantly, confirm `FoundryActorImportMapper`'s field
      mapping produces accurate stat blocks against real creatures — this was the
      entire reason for this pivot, so treat a handful of real imports (a simple
      creature, a skill-heavy one, a spellcaster) as the actual acceptance test, not
      just "did it run without erroring."

**GR dependency:** Roadmap 3.5 — shipped in GR v2.4.0 (removed the old bundled
dataset, added the `import-actors`/`categories` endpoints and
`FoundryActorImportMapper`).

---

## Sequencing

Stage 8 gates everything (verify before building). Stages 9 → 10 are strictly ordered
(encounter deploy reuses re-sync). Stages 11 and 12 are independent of each other and
of 10, but all three precede 13. Stages 14–17 float — schedule opportunistically
alongside GR-side releases, matching the milestone table in the main repo's
[ROADMAP.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/ROADMAP.md).
Stage 16's GR dependency (Roadmap 2.8) shipped in GR v2.0.0; only its own live
verification remains open. Stage 17 floats independently of Stage 16, gated only on
GR's Roadmap 2.9 shipping first (it has, in GR v2.1.0).
