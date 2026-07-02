# Geektastic Realms Foundry Connect

A Foundry VTT module that connects a world to a [Geektastic
Realms](https://github.com/Geektasticdad/geektastic-realms) instance — read/match
existing compendium content (skills, features, items, spells) and create clean NPCs
pulled directly from your Geektastic Realms worldbuilding data, instead of hand-copying
stat blocks.

**Direction of the connection:** Geektastic Realms is the server; this module is the
client. It calls out to your Geektastic Realms instance's API — Geektastic Realms never
reaches into your Foundry world over the network.

This module is being built in stages alongside the API it depends on. See
[ROADMAP.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/Docs/ROADMAP.md)
in the main repo for what's shipped and what's next, and
[FOUNDRY_API.md](https://github.com/Geektasticdad/geektastic-realms/blob/main/Docs/FOUNDRY_API.md)
for the API contract this module talks to.

## Current stage: Stage 6 — icon pipeline

This version registers your Geektastic Realms server URL and API token (Stage 2), syncs
your world's Item-type compendiums so Geektastic Realms can match stat block features/
items against what already exists (Stage 3), creates a real Actor in your world
directly from a Geektastic Realms stat block (Stage 5) — reusing any compendium matches
you've confirmed on the Geektastic Realms side instead of duplicating that content —
and now gives unmatched features/items a real icon (Stage 6) if one's attached on the
Geektastic Realms side, instead of Foundry's blank default.

## Requirements

- Foundry VTT **v13** (verified). Not yet tested against v14.
- A running Geektastic Realms instance, with an API token generated from a world's
  **Foundry VTT Connection** panel (its dashboard page, requires the `setting.manage`
  permission on that world).

## Installation

**Manual install** (no release/manifest-URL flow yet):

1. Download or clone this repository.
2. Copy the whole folder into your Foundry `Data/modules/` directory, so you end up
   with `Data/modules/geektastic-realms-foundry-connect/module.json`.
3. Restart Foundry (or refresh the Setup page) and enable **Geektastic Realms Foundry
   Connect** in your world's Manage Modules screen.

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

## Creating an NPC

In Module Settings, click **Create NPC**. A dialog lists every stat block from your
connected Geektastic Realms world — type in the search box to filter the list by name.
Click **Create** next to the one you want — it appears as a new Actor in your world's
Actors tab. Any feature or item you've confirmed a match for on the Geektastic Realms
stat block editor (its **Foundry Compendium** column) is cloned from your compendium
rather than recreated from scratch — icon included; anything unmatched is built fresh
from the stat block's own data, and now picks up a real icon too if the DM attached one
in the feature/item's **Icon** field on Geektastic Realms. Progress is shown live per
step (actor, then features/icons, then equipment/icons).

## Development notes

- Plain vanilla JavaScript, native ES modules — no bundler/build step. Edit
  `scripts/main.js` directly and reload Foundry to test changes.
- Built against the classic `FormApplication`/`Application` v1 API rather than v13's
  newer `ApplicationV2` — v1 remains supported via Foundry's compatibility layer and is
  the better-documented, less version-fragile choice for a module this small.
- See the comment above `TestConnectionForm` in `scripts/main.js` for one detail that
  couldn't be verified without a live v13 instance (whether `FormApplication` is still a
  bare global or needs `foundry.appv1.api.FormApplication`) — fix noted inline if you hit
  it. `CompendiumSyncForm` shares the same base class and the same caveat.
- The `syncPacks` world setting (your saved pack selection) is intentionally not in the
  visible Module Settings list (`config: false`) — it's managed entirely through the
  Sync Compendiums dialog's checkboxes.

## License

MIT — see [LICENSE](LICENSE).
