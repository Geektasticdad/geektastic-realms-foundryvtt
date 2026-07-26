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

- v14 compatibility is still unverified (`compatibility.verified` stays at `13` until
  actually tested there).

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
- [ ] **ApplicationV2 migration + v14 compatibility** — migrate off the v1
  `FormApplication` API when v14's deprecation pressure makes it worthwhile; bump
  `compatibility.verified` after real testing (currently `"minimum": "13",
  "verified": "13"` in `module.json`, no `maximum`).
  - Scope: `FormApplicationBase` (`scripts/main.js:39`, resolves
    `foundry.appv1.api.FormApplication ?? FormApplication`) is extended by exactly
    three classes — `TestConnectionForm` (`:1178`), `CompendiumSyncForm` (`:1242`),
    and the consolidated `ImportHubForm` (`:1349`, Stage 15's 5-tab hub: actors /
    encounters / handouts / tables / adventure). Migrating means porting these
    three to ApplicationV2's render/parts/action model — not five separate
    dialogs, since Stage 15 already consolidated them into one.
  - **Reminder — Foundry v14 removes TinyMCE; ProseMirror becomes the only
    supported rich-text editor** for Journal Entry pages (and other HTML
    fields). GR itself isn't changing — it stays on Tiptap — this is purely
    about what happens on the Foundry side to the HTML this module writes.
    `TextEditor.enrichHTML` renders raw HTML fine regardless of editor, so
    first-view display isn't the risk; the risk is the moment a DM opens an
    imported page in Foundry's own page editor to tweak it — ProseMirror parses
    the existing HTML through its own schema, and content it doesn't recognize
    doesn't survive that round-trip.
    - GR's editor has six custom "callout" block types built from one factory,
      `makeWrapperNode(name, cssClass)` (`geektastic-realms/public/assets/js/
      block-editor.js:148-168`): `read-aloud`, `dm-note`, `encounter-block`,
      `treasure-block`, `boxed-text`, `dm-secret` (registered at `:272-277`).
      Each renders as `<div class="{cssClass}">...normal paragraphs/lists...
      </div>` — a plain wrapper `<div>` is not a node type in ProseMirror's
      schema, and ProseMirror's default behavior for an unrecognized element is
      to recurse into its children and drop the wrapper. Expected outcome: the
      inner text likely survives a Foundry-side edit + save, but the callout's
      distinguishing class/styling likely doesn't — **needs an actual test**
      (import a page with each callout type, open it in Foundry's v14 editor,
      save without changing anything, diff the resulting HTML) rather than
      assuming either way.
    - `rewriteAdventureRefs()` (`scripts/main.js:426-462`, used by Stage 13's
      Adventure → Journal export) rewrites `eid-`/`hid-`/`rtid-` chips into
      `@UUID` links but has **no handling for `qid-` (quest-ref)** — GR's newer
      "Insert Quest" slash command chips pass through unrewritten today. Add a
      `qid-{N}`/`qkind-{quest|secret}` case alongside the existing three, or
      explicitly log it as a known gap if descoped. (`@UUID` links are
      Foundry-native anchor syntax once rewritten, so they're not a ProseMirror
      compatibility risk the way the callout `<div>`s above are.)
    - `handoutPageContent()` (`scripts/main.js:264-266`, Stage 11's Handouts →
      Journal) passes `handout.body_html` straight through with **no
      ref-rewriting at all** — same callout-block survival question applies
      here too if a handout body uses one of GR's six callout types, plus the
      same unhandled `qid-` gap if a handout ever embeds a quest-ref.
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
