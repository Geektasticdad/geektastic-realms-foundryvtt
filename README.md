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

## Current stage: Stage 2 — connection handshake

This version registers your Geektastic Realms server URL and API token, and lets you
verify the connection. It does not yet read compendiums, match content, or create NPCs
— that's Stages 3 onward.

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

## Development notes

- Plain vanilla JavaScript, native ES modules — no bundler/build step. Edit
  `scripts/main.js` directly and reload Foundry to test changes.
- Built against the classic `FormApplication`/`Application` v1 API rather than v13's
  newer `ApplicationV2` — v1 remains supported via Foundry's compatibility layer and is
  the better-documented, less version-fragile choice for a module this small.
- See the comment above `TestConnectionForm` in `scripts/main.js` for one detail that
  couldn't be verified without a live v13 instance (whether `FormApplication` is still a
  bare global or needs `foundry.appv1.api.FormApplication`) — fix noted inline if you hit
  it.

## License

MIT — see [LICENSE](LICENSE).
