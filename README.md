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

## Current stage: Stage 10 — Deploy Encounter

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
(Stage 9) — see [Re-syncing an Actor](#re-syncing-an-actor), and (Stage 10) can now
**deploy a whole encounter's adversary roster in one action** — see
[Deploying an Encounter](#deploying-an-encounter) below.

## Requirements

- Foundry VTT **v13** (verified). Not yet tested against v14.
- A running Geektastic Realms instance, with an API token generated from a world's
  **Foundry VTT Connection** panel (its dashboard page, requires the `setting.manage`
  permission on that world). **v1.20.0+** is needed for Actor re-sync status (New /
  Up to date / Changed) — older versions still work, but every entry with a matching
  Actor will show as "Changed" rather than "Up to date". **v1.21.0+** is needed for
  Deploy Encounter's module/encounter pickers.

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

## Creating an Actor

In Module Settings, click **Create Actor**. A dialog lists every stat block from your
connected Geektastic Realms world — from *any* GR category, not just one named "NPCs"
(a custom category like "Monsters" or "Villains" works the same way). Type in the
search box to filter by name, or use the category dropdown to narrow the list to one
category. Pick a destination from the **Create in folder** dropdown (lists this
world's Actors-directory folders; leave it on "(No folder)" to create at the root) —
this applies to whichever entry you click Create on next. Click **Create** next to the
one you want — it appears as a new Actor in your world's Actors tab, in the folder you
picked. If the entry has a featured image set on the Geektastic Realms side, it's used
as the created Actor's portrait (not the token image, which stays at Foundry's
default). Any feature or item you've confirmed a match for on the Geektastic Realms
stat block editor (its **Foundry Compendium** column) is cloned from your compendium
rather than recreated from scratch — icon included; anything unmatched is built fresh
from the stat block's own data, picks up a real icon if the DM attached one in the
feature/item's **Icon** field on Geektastic Realms, and gets accurate Foundry item
typing where GR's data supports it. Progress is shown live per step (actor, then
features/icons, then equipment/icons).

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

Clicking **Update** rewrites the Actor's stats, portrait, and every feature/item from
Geektastic Realms' current data — but never touches the Actor's folder, its prototype
token configuration, ownership, or any active effects you've added at the table. Those
are yours; Geektastic Realms doesn't manage them. Re-running Create/Update on the same
entry never produces a second Actor.

## Deploying an Encounter

In Module Settings, click **Deploy Encounter**. Pick a **Module** from the dropdown,
and every encounter in it appears below — name, type, difficulty, which section it's
in, and its full adversary roster (e.g. "3× Goblin, 1× Goblin Boss") right in the list,
so you can see what you're about to deploy before committing to anything.

Before clicking Deploy, make sure the scene you actually want to run the fight on is
the one currently open — that's where tokens get placed.

Click **Deploy** next to the one you want. Every adversary's Actor is created (or
updated in place, per [Re-syncing an Actor](#re-syncing-an-actor) above, if it already
exists somewhere in this world) into an `Encounters/{encounter name}` folder — created
on demand, and reused rather than duplicated if you deploy the same encounter again
later. A failure on one creature doesn't stop the rest; you'll see how many succeeded
and, if any failed, which ones and why.

Leave **"Place tokens on the current scene"** checked (the default) and one token per
creature is dropped onto whichever scene you currently have open, arranged in a
simple grid centered on wherever you're looking — 6 hobgoblins in the roster means 6
tokens on the map. If no scene is open, this is skipped and the result tells you so;
the Actors are still created either way.

Leave **"Also create a Combat encounter"** checked (the default) too, and a Combat is
built alongside them, with one combatant per placed token — linked to the real token
on the map, so the tracker and the scene agree from the moment you click Deploy, no
manual linking needed. If token placement was skipped (box unchecked, or no scene
open), the Combat still gets an actor-only combatant per quantity instead — you'll
need to link those to tokens yourself later, the same as adding any non-token
combatant by hand.

## Development notes

- Plain vanilla JavaScript, native ES modules — no bundler/build step. Edit
  `scripts/main.js` directly and reload Foundry to test changes.
- Built against the classic `FormApplication`/`Application` v1 API rather than v13's
  newer `ApplicationV2` — v1 remains supported via Foundry's compatibility layer and is
  the better-documented, less version-fragile choice for a module this small. All three
  dialogs extend a `FormApplicationBase` constant (`scripts/main.js`) that resolves to
  `foundry.appv1.api.FormApplication` if present, falling back to the bare
  `FormApplication` global otherwise — covers both v13 variants without needing to know
  ahead of time which one a given build exposes.
- The `syncPacks` world setting (your saved pack selection) is intentionally not in the
  visible Module Settings list (`config: false`) — it's managed entirely through the
  Sync Compendiums dialog's checkboxes.

## License

MIT — see [LICENSE](LICENSE).
