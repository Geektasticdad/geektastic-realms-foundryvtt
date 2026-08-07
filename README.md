# Geektastic Realms Foundry Connect

A Foundry VTT module that connects a world to a [Geektastic
Realms](https://github.com/Geektasticdad/geektastic-realms) instance — read/match
existing compendium content (skills, features, items, spells) and create clean Actors
pulled directly from your Geektastic Realms worldbuilding data, instead of hand-copying
stat blocks.

**Direction of the connection:** Geektastic Realms is the server; this module is the
client. It calls out to your Geektastic Realms instance's API — Geektastic Realms never
reaches into your Foundry world over the network.

This module is being built in stages alongside the API it depends on. See
[ROADMAP.md](ROADMAP.md) for this module's forward plan (Stages 8+), the main repo's
[build log](https://github.com/Geektasticdad/geektastic-realms/blob/main/Tech_Docs/ROADMAP.md)
for the shipped Stages 1–7, and
[FOUNDRY_API.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/Tech_Docs/FOUNDRY_API.md)
for the API contract this module talks to.

## Current stage: Stage 15 — UX & platform

This version registers your Geektastic Realms server URL and API token (Stage 2), syncs
your world's Item-type compendiums so Geektastic Realms can match stat block features/
items against what already exists (Stage 3), creates a real Actor in your world
directly from a Geektastic Realms stat block (Stage 5) — reusing any compendium matches
you've confirmed on the Geektastic Realms side instead of duplicating that content —
gives unmatched features/items a real icon (Stage 6) if one's attached on the
Geektastic Realms side, gives unmatched equipment items an accurate Foundry
type/subtype and magic-item flag (Stage 7) instead of a generic placeholder, has a real
release pipeline (Stage 8) — see [RELEASING.md](RELEASING.md), updates a
previously-created Actor in place when you re-import it instead of duplicating it
(Stage 9) — see [Re-syncing an Actor](#re-syncing-an-actor), can deploy a whole
encounter's adversary roster in one action (Stage 10), import a whole module's
handouts as one Journal Entry (Stage 11), import a module's roll tables as native,
rollable Foundry RollTable documents (Stage 12), import a whole module's narrative as
one Journal Entry (Stage 13, the capstone), and (Stage 14) clone matched spells from a
stat block's structured spell list onto its Actor with the right spellcasting
ability/DC/level and save proficiencies — see [Creating an Actor](#creating-an-actor),
[Deploying an Encounter](#deploying-an-encounter),
[Importing Handouts](#importing-handouts),
[Importing Roll Tables](#importing-roll-tables), and
[Importing an Adventure](#importing-an-adventure) below. **Stage 15** moves all five of
those out of Module Settings into one consolidated, tabbed **import hub** opened from
a button in the Actors/Journal sidebar header — see
[Opening the import hub](#opening-the-import-hub) — and gives a stat block its own
optional prototype token image, separate from its portrait — see
[Creating an Actor](#creating-an-actor).

## Requirements

- Foundry VTT **v13** (verified). Not yet tested against v14.
- A running Geektastic Realms instance, with an API token generated from a world's
  **Foundry VTT Connection** panel (its dashboard page, requires the `setting.manage`
  permission on that world). **v1.20.0+** is needed for Actor re-sync status (New /
  Up to date / Changed) — older versions still work, but every entry with a matching
  Actor will show as "Changed" rather than "Up to date". **v1.21.0+** is needed for
  Deploy Encounter's module/encounter pickers. **v1.22.0+** is needed for Import
  Handouts. **v1.23.0+** is needed for Import Roll Tables. **v1.24.0+** is needed
  for Import Adventure. **v1.25.0+** is needed for spellcasting fidelity — older
  versions still create Actors fine, just without the `spellcasting`/`spells` fields
  in the prepare payload, so no spell Items are cloned. **v1.28.1+** is needed for
  the spellcasting summary feature to actually import (a bug in v1.28.0 silently
  dropped it whenever no spellcasting ability was set). **v1.29.0+** is needed for
  spellcaster level and ability save proficiencies to carry over. **v1.30.0+** is
  needed for a stat block's dedicated prototype token image to carry over — older
  versions still set the Actor's portrait, just never the token.

## Installation

**Manifest URL** (once a release has been published — see [RELEASING.md](RELEASING.md)):

1. In Foundry's Setup screen, go to **Add-on Modules → Install Module**.
2. Paste the manifest URL:
   `https://raw.githubusercontent.com/Geektasticdad/geektastic-realms-foundryvtt/main/module.json`
3. Click **Install** — Foundry fetches `module.json`, follows its `download` link to the
   latest GitHub Release's `module.zip`, and installs it for you.

**Manual install** (always available, no release required):

1. Download or clone this repository.
2. Copy the whole folder into your Foundry `Data/modules/` directory, so you end up
   with `Data/modules/geektastic-realms-foundry-connect/module.json`.
3. Restart Foundry (or refresh the Setup page) and enable **Geektastic Realms Foundry
   Connect** in your world's Manage Modules screen.

Either way, enable **Geektastic Realms Foundry Connect** in your world's Manage Modules
screen once installed.

## Configuration

In your world, go to **Game Settings → Configure Settings → Module Settings** and find
**Geektastic Realms Foundry Connect**:

- **Geektastic Realms Server URL** — the base URL of your instance, e.g.
  `https://realms.example.com` (no trailing slash).
- **API Token** — generated from the **Foundry VTT Connection** panel on that world's
  dashboard page in Geektastic Realms. Shown once at generation time — copy it
  somewhere safe if you need it again later (revoke and regenerate if lost).

Both settings are world-scoped and restricted to GMs.

## Testing the connection

Still in Module Settings, click **Test Connection** next to this module. A small dialog
opens with a **Test Connection** button — click it to ping your Geektastic Realms
instance. On success you'll see the connected world's name and Geektastic Realms
version; on failure, the specific error (missing settings, network error, invalid/
revoked token, etc.).

## Syncing compendiums

In Module Settings, click **Sync Compendiums**. A dialog lists every Item-type
compendium pack in your world (this is what feats, weapons, equipment, spells,
classes, backgrounds, and species all are in the dnd5e system) — check the ones you
want Geektastic Realms to know about and click **Sync Compendiums** in the dialog.
Your selection is remembered for next time. Progress is shown live; a summary
notification appears when done. Sync is on-demand only — nothing happens in the
background, and re-syncing is safe any time (it upserts, it doesn't duplicate).

View, search, and remove synced entries from the **Foundry VTT Connection** panel's
"Synced Compendium" link on your world's dashboard page in Geektastic Realms. That page
is a read-only mirror of what's in Foundry — to fix a wrong entry, fix it in Foundry and
re-sync, rather than editing it in Geektastic Realms.

## Opening the import hub

Everything below this point — Creating an Actor, Deploying an Encounter, Importing
Handouts, Importing Roll Tables, Importing an Adventure — used to be its own entry in
Module Settings. As of Stage 15 they're all tabs in one window: click the
**Geektastic Realms** button in the header of the **Actors** or **Journal** sidebar
tab (either one opens the same window) to open the import hub, then pick the tab for
what you want to do. Settings now only holds actual configuration: Server URL, API
Token, Test Connection, and Sync Compendiums.

## Creating an Actor

The import hub's **Actors** tab lists every stat block from your
connected Geektastic Realms world — from *any* GR category, not just one named "NPCs"
(a custom category like "Monsters" or "Villains" works the same way). Type in the
search box to filter by name, or use the category dropdown to narrow the list to one
category. Pick a destination from the **Create in folder** dropdown (lists this
world's Actors-directory folders; leave it on "(No folder)" to create at the root) —
this applies to whichever entry you click Create on next. Click **Create** next to the
one you want — it appears as a new Actor in your world's Actors tab, in the folder you
picked. If the entry has a featured image set on the Geektastic Realms side, it's used
as the created Actor's portrait. The prototype token image (Stage 15) is set
separately — from the stat block's own dedicated **Prototype token image** field if
the DM set one, or the same featured image used for the portrait otherwise, so a
freshly-created Actor never lands with Foundry's blank default token unless the entry
itself has no image at all. Any feature or item you've confirmed a match for on the
Geektastic Realms
stat block editor (its **Foundry Compendium** column) is cloned from your compendium
rather than recreated from scratch — icon included; anything unmatched is built fresh
from the stat block's own data, picks up a real icon if the DM attached one in the
feature/item's **Icon** field on Geektastic Realms, and gets accurate Foundry item
typing where GR's data supports it. Progress is shown live per step (actor, then
features/icons, then equipment/icons, then spells).

If a feature or weapon has one or more **Activities** set up on the Geektastic Realms
side (Stage 16 — Attack/Check/Damage/Heal/Save), an unmatched one arrives as a real,
clickable rollable button on the Actor sheet instead of description text only, and a
feature's **Required level**/**Repeatable**/**Magical**/**Trait**/limited-uses fields
carry through too. A feature or weapon you've confirmed a compendium match for keeps
that compendium entry's own activities exactly as-is — GR-entered Activities only
apply to the fresh-created (unmatched) path, same as icons and item typing above. This
is a best-effort translation of Foundry's Activity schema, not independently
verified against a live Foundry v14 world — worth rolling a generated attack/save/
damage button once to confirm it works as expected before trusting it at the table.

If the stat block has a **Spell list** set up on the Geektastic Realms side (Stage 14),
any spell name that exactly matches a spell in your synced compendiums is cloned onto
the Actor as a real, rollable spell Item too, and the Actor's spellcasting ability
(and DC/attack, if the DM set a printed override) is set to match. Each spell lands in
the correct section of the Actor's spellbook based on how the DM tagged it on the
Geektastic Realms side — ordinary Spellcasting, Pact Magic, or Innate (At Will / X per
day) — instead of every cloned spell looking like it costs a slot it doesn't. A name
with no exact match isn't guessed at — it's simply skipped, and a notification tells
you how many. If the DM also filled in a plain-text **spellcasting summary** on the
Geektastic Realms side, it's added as its own "Spellcasting" feature Item — cloned
from your game system's own "Spellcasting" compendium feat when one exists (so it
carries the system's own icon/styling), with just its description replaced by GR's
summary text. The stat block's free-text "Spellcasting" trait still imports as a
regular feature either way, unaffected — if both are filled in, you'll see two
"Spellcasting"-ish features on the Actor until that trait is cleaned up on the
Geektastic Realms side.

Once every spell is cloned, the fresh-created Spellcasting feature (if any) gets one
auto-generated **Cast** activity per cloned spell — pick that feature on the Actor
sheet to cast any of the creature's spells right from it, instead of hunting each
spell down in the sidebar individually. Nothing to set up on the Geektastic Realms
side for this — it's entirely automatic once spells clone successfully. A
compendium-matched Spellcasting feature keeps its own activities as-is, same as any
other compendium-matched feature/item.

If the DM set a **Spellcaster level** (1-20), it's applied to the Actor's automatic
spell-slot table. If the DM checked any **Save prof.** boxes on the ability scores
(Geektastic Realms side, independent of the free-text Saving Throws line), those
abilities are marked proficient on the created/re-synced Actor.

## Re-syncing an Actor

Every Actor created by this module is stamped with a hidden fingerprint of the stat
block it came from. Reopen **Create Actor** any time after editing that stat block on
the Geektastic Realms side, and each row shows one of three statuses next to its
button:

- **(no badge), Create** — nothing in this world yet.
- **✓ Up to date, Update** — already created here, and nothing's changed on the
  Geektastic Realms side since.
- **↻ Changed, Update** — already created here, but the stat block has been edited
  since — click **Update** to bring it current.

Clicking **Update** rewrites the Actor's stats, portrait, token image (Stage 15), and
every feature/item from Geektastic Realms' current data — but never touches the
Actor's folder, ownership, active effects, or any prototype token setting *other than*
its image (position, scale, disposition, vision, etc. are all left as you've set them
at the table). Re-running Create/Update on the same entry never produces a second
Actor.

## Deploying an Encounter

In the import hub's **Encounters** tab, optionally narrow the **Module** dropdown to
one campaign with the **Campaign** filter above it, pick a module, and optionally
pick a **Select Folder** destination (this world's top-level Actor folders only —
leave it on "(Top level)" for none; this is where the whole `Encounters` group
folder below lives, not a per-encounter choice). Every encounter in the module
appears below — name, type, difficulty, which section it's in, and its full
adversary roster (e.g. "3× Goblin, 1× Goblin Boss") right in the list, so you can see
what you're about to deploy before committing to anything.

Before clicking Deploy, make sure the scene you actually want to run the fight on is
the one currently open — that's where tokens get placed.

Click **Deploy** next to the one you want. Every adversary's Actor is created (or
updated in place, per [Re-syncing an Actor](#re-syncing-an-actor) above, if it already
exists somewhere in this world) into an `Encounters/{encounter name}` folder —
created on demand under whichever Select Folder destination you chose, and reused
rather than duplicated if you deploy the same encounter again later (moved to match
if you pick a different destination on a later deploy, too). A failure on one
creature doesn't stop the rest; you'll see how many succeeded and, if any failed,
which ones and why.

Leave **"Place tokens on the current scene and create a linked Combat encounter"**
checked (the default) and one token per creature is dropped onto whichever scene you
currently have open, arranged in a simple grid centered on wherever you're looking —
6 hobgoblins in the roster means 6 tokens on the map — and a Combat is built
alongside them, with one combatant per placed token, linked to the real token on the
map so the tracker and the scene agree from the moment you click Deploy. If no scene
is open, token placement is skipped and the Combat falls back to an actor-only
combatant per quantity instead — the Actors are still created either way, you'll just
need to link those combatants to tokens yourself later.

**Encounter summary actor.** Every deploy also creates (or updates) one extra Actor
— a dnd5e "encounter" type, named after the encounter, in the same
`Encounters/{encounter name}` folder — summarizing the whole fight on one sheet:
- **Members** — every adversary you just deployed, with its quantity, so dnd5e's own
  Members tab can total XP/difficulty for you.
- **Loot** — each *distinct* creature's own weapons/equipment/consumables/etc.
  (dnd5e's usual definition of "physical" items) cloned onto this actor once per
  creature type — open its Loot tab after the fight to hand everything out without
  digging through five separate NPC sheets. Not multiplied by quantity; if you need
  three coin pouches instead of one, duplicate it by hand.
- **Description** — the encounter's own Setup/Tactics/Rewards/DM Notes from
  Geektastic Realms, so your prep notes are on the same sheet as the fight.

Re-deploying rebuilds Members/Loot/Description from scratch each time rather than
piling up duplicates. This needs a dnd5e system version that has the "encounter"
actor type — if yours doesn't, this step is silently skipped and everything else
above still works normally.

## Importing Handouts

In the import hub's **Handouts** tab, optionally narrow the **Module** dropdown to
one campaign with the **Campaign** filter above it, pick a module, and optionally
pick a **Select Folder** destination (this world's top-level Journal folders only —
leave it on "(Top level)" for none). Every handout in the module appears below with a
checkbox (checked by default — uncheck any you don't want this run) and a status —
**New**, **✓ Up to date**, or **↻ Changed**.

Click **Import Selected Handouts** and every checked handout becomes a page in one
Journal Entry named after the module, placed in whichever folder you chose — image
(if it has one) above the rich-text body, one page per handout. Re-running this later
finds that same Journal Entry again (even if you've renamed or moved it) and only
touches pages whose handout actually changed since — an unchanged handout's page is
left completely alone, not re-uploaded or rewritten. Leaving a handout unchecked just
means this run doesn't touch its page — it isn't removed if it was already imported.
A failure on one handout doesn't stop the rest; you'll see how many were created,
updated, or already current, and if any failed, which ones and why.

The journal opens automatically when the import finishes. From there, use Foundry's
native **Show to Players** on any page at the table — that's the whole point.

## Importing Roll Tables

In the import hub's **Tables** tab, optionally narrow the **Module** dropdown to one
campaign with the **Campaign** filter above it, pick a module, and optionally pick a
**Select Folder** destination (this world's top-level RollTable folders only — leave
it on "(Top level)" for none). Every roll table in the module appears below with a
checkbox (checked by default — uncheck any you don't want this run) — die size, row
count, which section it's in, and a status (**New**, **✓ Up to date**, or
**↻ Changed**).

Click **Import Selected Tables** and each checked one becomes a native Foundry
RollTable document, placed in whichever folder you chose: ranges become result
ranges, the computed die becomes the roll formula, and each row's title/description
become the result text. If the table's die has unused faces above its highest
authored range (e.g. 16 options rounding up to a d20), a "No result" row fills the
gap automatically, the same padding Geektastic Realms' own web view already shows —
a roll never comes up empty. DM notes stay behind on the Geektastic Realms side; only
the rows themselves are imported.

Re-running this later finds the same RollTable again (even if you've renamed or
moved it) and only rebuilds tables whose content or folder actually changed since —
an unchanged table left in the same folder is left completely alone. Editing a
DM-only note without changing any row never counts as a change. Leaving a table
unchecked just means this run doesn't touch it. A failure on one table doesn't stop
the rest.

Once imported, roll the table from Foundry's own Rollable Tables sidebar — real
dice, real chat output, no need to open Geektastic Realms mid-session.

## Importing an Adventure

*The capstone — run this after you've imported the encounters, handouts, and roll
tables you want linked; it composes what they already built rather than creating
anything new itself.*

In the import hub's **Adventure** tab, optionally narrow the **Module** dropdown to
one campaign with the **Campaign** filter above it ("All modules" shows everything,
same as before), pick a module, optionally pick a **Select Folder** destination
(this world's top-level Journal folders only — leave it on "(Top level)" for none),
and you'll see the module's title, summary, and how many acts/chapters/sections it
has. Click **Import Adventure**.

Rather than one flat Journal Entry, this builds a real folder tree matching how
you'd organize it by hand: a top-level Journal folder named after the module
(wherever Select Folder pointed), containing an **Overview** entry at its root — the
same journal Import Handouts uses for this module, so a module's narrative and its
handouts end up together — one **folder + Journal Entry per Act** (that Act's own
content only), and inside each Act's folder, one **folder + Journal Entry per
Chapter**, holding that Chapter's own content plus every Scene beneath it as
additional pages of the same entry. An Appendix (or anything else outside the
Act/Chapter/Scene shape) lands as a plain entry at the module folder's root.

Anywhere you used **⚔ Insert Encounter**, **📄 Insert Handout**, or **🎲 Insert Roll
Table** in Geektastic Realms, that reference becomes a real Foundry link — to the
Actors an encounter's adversaries were deployed as (if you've run Deploy Encounter
for it), the handout's page (if you've run Import Handouts), or the table (if
you've run Import Roll Tables). Anything you haven't imported yet still shows up as
plain text — a name, not a broken link — so nothing looks broken, it just isn't
clickable yet. Any lore entries linked to a section (its Related Articles) show up
the same way: linked if that entry has an Actor in this world, plain text otherwise.
GR's six styled callout blocks (Read Aloud, DM Note, Encounter, Treasure, Boxed
Text, DM Secret) also carry over — see **Callout block styling** below.

Re-running this later only rebuilds folders/entries/pages whose section actually
changed in Geektastic Realms since your last import — everything else is left
alone, and nothing gets duplicated even if you renamed a module/Act/Chapter in GR
first. A failure on one section doesn't stop the rest.

The Overview journal opens automatically when the import finishes — from there,
run the session straight from Foundry.

## Callout block styling

GR's block editor has six styled "callout" blocks — Read Aloud, DM Note, Encounter,
Treasure, Boxed Text, and DM Secret — used via its `/` slash-command menu. This
module ships a stylesheet (`styles/gr-callouts.css`) matching GR's own colors, so
anything imported through Import Handouts or Import Adventure that used one of
these looks the same in Foundry as it does on GR's own site: a colored left border
and tinted background, plus a bold label identifying the block type.

DM Secret is the one exception — it imports as Foundry's own native **Secret**
block (Journal Entries article, "Text Formatting") instead of a colored box:
GM/Owner-only visible by default, with Foundry's built-in reveal-to-players toggle,
which is a closer match to "hidden until the DM chooses to reveal it" than a
plainly-labeled box everyone with page access could read equally.

**To use these classes yourself** when writing fresh content directly in Foundry
(not just on import): open a Journal page, switch its editor to **Source/HTML**
mode (the `</>` button in ProseMirror's own toolbar), and wrap a block in one of:

```html
<blockquote class="read-aloud">Text to read aloud to players.</blockquote>
<blockquote class="dm-note">A private reminder for the DM only.</blockquote>
<blockquote class="encounter-block">Encounter setup notes.</blockquote>
<blockquote class="treasure-block">Loot and rewards.</blockquote>
<blockquote class="boxed-text">Neutral bordered box.</blockquote>
<section class="secret">Hidden from players until you reveal it.</section>
```

Switch back out of Source mode and it'll render styled immediately — the same
class-name convention GR's own MCP server documents for its own tools (see
`Docs/09-GR-Rich-Text-Formatting.md` in the Geektastic MCP Server repo), so the
same markup means the same thing on both sides.

## Development notes

- Plain vanilla JavaScript, native ES modules — no bundler/build step. Edit
  `scripts/main.js` directly and reload Foundry to test changes.
- Built against the classic `FormApplication`/`Application` v1 API rather than v13's
  newer `ApplicationV2` — v1 remains supported via Foundry's compatibility layer and is
  the better-documented, less version-fragile choice for a module this small. Every
  dialog (`TestConnectionForm`, `CompendiumSyncForm`, and the tabbed `ImportHubForm`)
  extends a `FormApplicationBase` constant (`scripts/main.js`) that resolves to
  `foundry.appv1.api.FormApplication` if present, falling back to the bare
  `FormApplication` global otherwise — covers both v13 variants without needing to know
  ahead of time which one a given build exposes. `ImportHubForm`'s tab switching is a
  small self-contained click handler, not `Application`'s built-in `options.tabs`
  binding — that was tried first but didn't actually switch panels on click, so it was
  replaced rather than chased down.
- The `syncPacks` world setting (your saved pack selection) is intentionally not in the
  visible Module Settings list (`config: false`) — it's managed entirely through the
  Sync Compendiums dialog's checkboxes.

## License

MIT — see [LICENSE](LICENSE).
