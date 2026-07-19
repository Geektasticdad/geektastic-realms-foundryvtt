/**
 * Geektastic Realms Foundry Connect — Stages 2–7 (handshake, compendium indexing,
 * NPC/Actor creation, icon pipeline, and precise item typing; Stage 4's matching
 * engine is entirely GR-side, no module changes).
 *
 * Registers the server URL / API token this world uses to reach a Geektastic Realms
 * instance, a "Test Connection" action (GET /api/foundry/v1/ping), a "Sync
 * Compendiums" action that walks this world's Item-type compendium packs and POSTs an
 * index of their contents to GR (POST /api/foundry/v1/compendium/sync) for matching,
 * and a "Create Actor" action that pulls a prepared stat block (GET
 * /api/foundry/v1/npc/{entryId}/prepare — from any GR category with a stat block, not
 * just one literally named "NPCs") and builds a real Actor in this world — cloning
 * confirmed-matched features/items from local compendiums via `fromUuid()` and
 * creating fresh Items (via Foundry's own `Item.create()`, which fills in schema
 * defaults natively) for anything unmatched. Unmatched items/features that have an
 * icon attached on the GR side get it pulled via GET /api/foundry/v1/media/{id} and
 * uploaded into this world's own Data directory (Stage 6), instead of Foundry's blank
 * default icon. See Docs/FOUNDRY_API.md and Docs/ROADMAP.md in the geektastic-realms
 * repo for the full API contract and staged plan.
 *
 * Deliberately built against the classic FormApplication/Application v1 API rather
 * than v13's newer ApplicationV2 — v1 remains supported via Foundry's compatibility
 * layer and is the better-documented, less version-fragile choice for a module this
 * small. Revisit if/when ApplicationV2 becomes the only supported path.
 */

const MODULE_ID = 'geektastic-realms-foundry-connect';

/**
 * v13 moved several v1 Application classes under a `foundry.appv1.api` namespace but
 * (as of v13) kept a bare global alias for backward compatibility, with a deprecation
 * warning on use. Rather than hardcode one form and risk breaking on whichever variant
 * a given build doesn't have, resolve defensively at load time: prefer the namespaced
 * class if present (silences the deprecation warning, and keeps working if a future
 * release drops the bare global), falling back to the bare global for older v13
 * builds that predate the namespace. This removes the need to verify which form a
 * live instance expects — both are covered.
 */
const FormApplicationBase = globalThis.foundry?.appv1?.api?.FormApplication ?? globalThis.FormApplication;

/** Entries per POST to /compendium/sync — keeps individual requests small for large packs. */
const SYNC_CHUNK_SIZE = 100;

/** Minimal HTML escaping for the values we interpolate into the dialog markup. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function getServerConfig() {
  return {
    serverUrl: (game.settings.get(MODULE_ID, 'serverUrl') || '').trim().replace(/\/+$/, ''),
    token: (game.settings.get(MODULE_ID, 'apiToken') || '').trim(),
  };
}

/**
 * Calls a Geektastic Realms Foundry API endpoint with the configured server URL/token.
 * @param {string} path e.g. '/api/foundry/v1/ping'
 * @param {RequestInit} [options]
 * @returns {Promise<{ok: true, body: any} | {ok: false, error: string}>}
 */
async function apiFetch(path, options = {}) {
  const { serverUrl, token } = getServerConfig();
  if (!serverUrl || !token) {
    return { ok: false, error: 'Set both the Server URL and API Token first.' };
  }

  let response;
  try {
    response = await fetch(`${serverUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    return { ok: false, error: `Network error reaching ${serverUrl}: ${err.message}` };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    return { ok: false, error: body?.error || `HTTP ${response.status} from server` };
  }

  return { ok: true, body };
}

/**
 * Calls the Geektastic Realms ping endpoint.
 * @returns {Promise<{ok: true, settingName: string, version: string} | {ok: false, error: string}>}
 */
async function testConnection() {
  const result = await apiFetch('/api/foundry/v1/ping');
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    settingName: result.body.setting?.name ?? 'unknown world',
    version: result.body.gr_version ?? '?',
  };
}

/** Item-type compendium packs available in this world — the only ones GR indexes. */
function itemPacks() {
  return game.packs.filter((p) => p.documentName === 'Item');
}

/**
 * Syncs the given packs to Geektastic Realms, chunked per pack. Calls onProgress with
 * a short status string after each chunk so the dialog can show live progress.
 * @returns {Promise<{ok: true, totalSynced: number} | {ok: false, error: string}>}
 */
async function syncCompendiums(packIds, onProgress) {
  let totalSynced = 0;

  for (const packId of packIds) {
    const pack = game.packs.get(packId);
    if (!pack) continue;

    onProgress?.(`Loading "${pack.metadata.label}"…`);
    const documents = await pack.getDocuments();

    const entries = documents.map((doc) => ({
      uuid: doc.uuid,
      name: doc.name,
      type: doc.type ?? '',
      subtype: doc.system?.type?.value ?? null,
      img: doc.img ?? null,
      system: doc.system ?? null,
    }));

    for (let i = 0; i < entries.length; i += SYNC_CHUNK_SIZE) {
      const chunk = entries.slice(i, i + SYNC_CHUNK_SIZE);
      onProgress?.(`Syncing "${pack.metadata.label}" — ${Math.min(i + chunk.length, entries.length)}/${entries.length}…`);

      const result = await apiFetch('/api/foundry/v1/compendium/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack_id: packId, pack_label: pack.metadata.label, entries: chunk }),
      });

      if (!result.ok) {
        return { ok: false, error: `${pack.metadata.label}: ${result.error}` };
      }
      totalSynced += result.body.synced ?? 0;
    }
  }

  return { ok: true, totalSynced };
}

/** Fetches the list of stat-block-bearing entries available to create as NPCs (Stage 5). */
async function fetchNpcList() {
  return apiFetch('/api/foundry/v1/npc/list');
}

/** Fetches the creation payload for one entry's stat block. */
async function prepareNpc(entryId) {
  return apiFetch(`/api/foundry/v1/npc/${entryId}/prepare`);
}

/** Fetches every adventure module in the connected GR world (Stage 10, picker step 1). */
async function fetchModuleList() {
  return apiFetch('/api/foundry/v1/modules');
}

/** Fetches every encounter (with its adversary roster) in one module (Stage 10, picker step 2). */
async function fetchModuleEncounters(moduleId) {
  return apiFetch(`/api/foundry/v1/modules/${moduleId}/encounters`);
}

/** Fetches the deploy payload for one encounter: metadata + a prepare payload/hash per distinct adversary. */
async function prepareEncounter(encounterId) {
  return apiFetch(`/api/foundry/v1/encounter/${encounterId}/prepare`);
}

/** MIME type -> file extension, for icons downloaded from GR's media library. */
const ICON_MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * Fetches a GR media library icon as a Blob via the authenticated
 * /api/foundry/v1/media/{id} endpoint (Stage 6). Returns null on any failure —
 * a missing icon should never block NPC creation.
 */
async function fetchIconBlob(mediaId) {
  const { serverUrl, token } = getServerConfig();
  if (!serverUrl || !token) return null;
  try {
    const response = await fetch(`${serverUrl}/api/foundry/v1/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    return await response.blob();
  } catch (err) {
    console.warn(`Geektastic Realms Foundry Connect: failed to fetch icon ${mediaId}.`, err);
    return null;
  }
}

/**
 * Downloads a GR media library icon and uploads it into this world's own Data
 * directory so a freshly-created Item can reference it as its `img` (Stage 6).
 * Only used for unmatched items/features — a compendium-matched clone already
 * carries the source document's own icon. Results are cached by media id so
 * the same icon isn't re-uploaded once per item that shares it. Returns the
 * Foundry-local path, or null on any failure (non-fatal — the item is still
 * created, just with Foundry's default icon).
 */
async function uploadIconToFoundry(mediaId, cache) {
  if (!mediaId) return null;
  if (cache.has(mediaId)) return cache.get(mediaId);

  const blob = await fetchIconBlob(mediaId);
  if (!blob) {
    cache.set(mediaId, null);
    return null;
  }

  try {
    const dir = `worlds/${game.world.id}/grfc-icons`;
    await FilePicker.createDirectory('data', dir).catch(() => {});
    const ext = ICON_MIME_EXT[blob.type] || 'png';
    const file = new File([blob], `icon-${mediaId}.${ext}`, { type: blob.type });
    const result = await FilePicker.upload('data', dir, file, {}, { notify: false });
    const path = result?.path || null;
    cache.set(mediaId, path);
    return path;
  } catch (err) {
    console.warn(`Geektastic Realms Foundry Connect: failed to upload icon ${mediaId}.`, err);
    cache.set(mediaId, null);
    return null;
  }
}

/** GR size word -> Foundry dnd5e size code. */
const SIZE_MAP = { Tiny: 'tiny', Small: 'sm', Medium: 'med', Large: 'lg', Huge: 'huge', Gargantuan: 'grg' };

/** "1/2", "1/4", "1/8", or a plain number -> decimal CR. */
function crToDecimal(cr) {
  cr = String(cr ?? '').trim();
  if (cr === '') return 0;
  if (cr.includes('/')) {
    const [n, d] = cr.split('/').map(Number);
    return d ? n / d : 0;
  }
  return Number(cr) || 0;
}

/** Parses a free-text speed string ("30 ft., fly 60 ft., swim 30 ft.") into Foundry's movement shape. */
function parseMovement(speed) {
  const out = { units: 'ft', walk: 0, burrow: 0, climb: 0, fly: 0, swim: 0 };
  const re = /(burrow|climb|fly|swim)?\s*(\d+)\s*ft/gi;
  let m;
  while ((m = re.exec(speed || '')) !== null) {
    out[(m[1] || 'walk').toLowerCase()] = Number(m[2]);
  }
  return out;
}

/** Parses a free-text senses string ("darkvision 60 ft., passive Perception 15") into Foundry's senses shape. */
function parseSenses(senses) {
  const ranges = { darkvision: null, blindsight: null, tremorsense: null, truesight: null };
  for (const key of Object.keys(ranges)) {
    const m = new RegExp(`${key}\\s*(\\d+)\\s*ft`, 'i').exec(senses || '');
    if (m) ranges[key] = Number(m[1]);
  }
  return { ...ranges, units: 'ft' };
}

/**
 * Creates or reuses one Item on the actor: clones from a synced compendium entry via
 * fromUuid() when a Stage 4 match was confirmed (compendium_ref present), otherwise
 * creates a fresh Item from GR's data via Foundry's own Item.create() — which fills in
 * every schema default itself, so there's no need to hand-construct a fully-shaped
 * Foundry document the way the static export (FoundryExport::toActorArray in GR) has to.
 */
async function addItemToActor(actor, compendiumRef, freshItemData) {
  if (compendiumRef && compendiumRef.entry_uuid) {
    const source = await fromUuid(compendiumRef.entry_uuid);
    if (source) {
      const itemData = source.toObject();
      delete itemData._id;
      await actor.createEmbeddedDocuments('Item', [itemData]);
      return;
    }
    // Fall through to fresh creation if the compendium entry no longer resolves
    // (e.g. deleted from the pack since the last sync).
  }
  await actor.createEmbeddedDocuments('Item', [freshItemData]);
}

function featureItemData(feature, imgPath) {
  const data = {
    name: feature.name,
    type: 'feat',
    system: {
      description: { value: feature.description || '' },
      type: { value: 'monster' },
    },
  };
  if (imgPath) data.img = imgPath;
  return data;
}

/**
 * Foundry item type -> a { value, key } subtype grounded in real Foundry exports
 * (Docs/ROADMAP.md "Stage 7"), not guessed: 'trinket' matches a real trinket export,
 * 'gear' matches a real adventuring-gear export, 'potion' is a direct match since
 * potion is GR's own category name. Anything GR can't determine (armor tier,
 * simple/martial weapon classification) is left blank rather than asserted.
 */
function equipmentSubtype(foundryType, category) {
  if (foundryType === 'equipment') return { value: category === 'trinket' ? 'trinket' : '', key: 'baseItem' };
  if (foundryType === 'consumable') return { value: 'potion', key: 'baseItem' };
  if (foundryType === 'loot') return { value: category === 'adventuring_gear' ? 'gear' : '', key: 'subtype' };
  return { value: '', key: 'baseItem' };
}

function equipmentItemData(item, imgPath) {
  const description = [item.properties, item.notes].filter(Boolean).join('\n\n');
  const foundryType = item.foundry_type || 'loot';
  const isMagic = !!item.requires_attunement || item.category === 'magic_item';
  const subtype = equipmentSubtype(foundryType, item.category);

  const data = {
    name: item.name,
    type: foundryType,
    system: {
      description: { value: description },
      quantity: item.quantity || 1,
      weight: { value: item.weight || 0, units: 'lb' },
      price: { value: item.value_amount || 0, denomination: item.value_unit || 'gp' },
      attunement: item.requires_attunement ? 'required' : '',
      attuned: false,
      identified: true,
      unidentified: { description: '' },
      properties: isMagic ? ['mgc'] : [],
      type: { value: subtype.value, [subtype.key]: '' },
    },
  };
  if (foundryType === 'equipment') data.system.armor = { value: null, dex: null };
  if (imgPath) data.img = imgPath;
  return data;
}

/**
 * Every Actor in this world previously created by this module, keyed by the GR entry
 * id it was built from (Stage 9's `grEntryId` flag) — shared by the Create Actor
 * picker (New / Up to date / Changed per row) and the Deploy Encounter picker (Stage
 * 10, same status logic per adversary).
 */
function syncedActorsByEntryId() {
  const map = new Map();
  for (const actor of game.actors) {
    const entryId = actor.getFlag(MODULE_ID, 'grEntryId');
    if (entryId != null) map.set(entryId, actor);
  }
  return map;
}

/**
 * Finds or creates the top-level "Encounters" Actor folder, and within it a subfolder
 * named after this encounter (Stage 10) — every adversary Actor a Deploy Encounter
 * run creates lands in `Encounters/{name}`, the same organization a DM would build by
 * hand. Existing folders are reused (by name + parent), so re-deploying the same
 * encounter later doesn't scatter duplicate folders.
 * @returns {Promise<string>} the encounter subfolder's id
 */
async function findOrCreateEncounterFolder(encounterName) {
  let parent = game.folders.find((f) => f.type === 'Actor' && !f.folder && f.name === 'Encounters');
  if (!parent) {
    parent = await Folder.create({ name: 'Encounters', type: 'Actor', folder: null });
  }
  let child = game.folders.find((f) => f.type === 'Actor' && f.folder === parent.id && f.name === encounterName);
  if (!child) {
    child = await Folder.create({ name: encounterName, type: 'Actor', folder: parent.id });
  }
  return child.id;
}

/**
 * Places `count` copies of an actor's token on the currently viewed scene, arranged
 * in a simple wrapping grid so an encounter actually lands ready to run instead of
 * needing every token dragged on by hand afterward. `slotOffset`/`totalInEncounter`
 * let the caller place several different creatures into one shared, non-overlapping
 * layout (see the deploy loop below) rather than each creature's copies starting
 * over at the same spot.
 *
 * Returns `[]` (placing nothing) if there's no active scene — Deploy Encounter still
 * creates the Actors and, if requested, an actor-only Combat in that case; there's
 * just no canvas to put tokens on.
 *
 * @param {Actor} actor
 * @param {number} count
 * @param {number} slotOffset - how many tokens have already been placed for this encounter so far
 * @param {number} totalInEncounter - grand total tokens being placed across every adversary, for grid sizing
 * @returns {Promise<TokenDocument[]>}
 */
async function placeTokensForActor(actor, count, slotOffset, totalInEncounter) {
  if (!canvas?.ready || !canvas.scene) return [];

  const gridSize = canvas.scene.grid.size;
  const spacing = gridSize * 1.5;
  const perRow = Math.max(1, Math.ceil(Math.sqrt(totalInEncounter)));
  const rows = Math.ceil(totalInEncounter / perRow);
  // Center the whole grid on wherever the DM is currently looking, falling back to
  // the scene's own center if the canvas hasn't reported a pivot yet.
  const center = canvas.stage?.pivot ?? { x: canvas.scene.width / 2, y: canvas.scene.height / 2 };
  const originX = center.x - ((perRow - 1) * spacing) / 2;
  const originY = center.y - ((rows - 1) * spacing) / 2;

  const tokenData = [];
  for (let i = 0; i < count; i++) {
    const slot = slotOffset + i;
    const col = slot % perRow;
    const row = Math.floor(slot / perRow);
    const tokenDoc = await actor.getTokenDocument({
      x: originX + col * spacing,
      y: originY + row * spacing,
    });
    const data = tokenDoc.toObject();
    delete data._id;
    tokenData.push(data);
  }
  if (tokenData.length === 0) return [];
  return canvas.scene.createEmbeddedDocuments('Token', tokenData);
}

/**
 * Builds a real Actor in this world from a GR "prepare" payload (Stage 5), resolving
 * confirmed compendium matches and creating fresh Items for everything else — or, if
 * `existingActor` is given (Stage 9), updates that Actor in place instead of creating
 * a new one. Either way the entry has a featured image on the GR side
 * (`portrait_media_id`), it's uploaded and set as the Actor's own portrait `img` (not
 * the prototype token's texture, which is left at Foundry's default).
 *
 * Update rewrites `name`/`img`/`system` and the `grContentHash`/`grSyncedAt` flags,
 * then clears and rebuilds every embedded Item from GR's current data — the same
 * convergent rebuild the create path does, so re-syncing after a GR edit always
 * matches GR exactly rather than merging or drifting. It deliberately does **not**
 * touch the Actor's folder, prototype token config, ownership, or active effects —
 * those are Foundry-side state GR has no opinion on, left alone by simply never
 * including them in the update payload.
 *
 * @param {object} npc - the prepare payload (`GET .../npc/{id}/prepare`'s `npc` field)
 * @param {(msg: string) => void} [onProgress]
 * @param {string} [folderId] - Actors-directory folder for a **new** Actor; ignored when updating.
 * @param {Actor} [existingActor] - update this Actor instead of creating a new one.
 * @param {{entryId: number, contentHash: string}} [syncInfo] - Stage 9 stamp (`GET
 *   .../npc/{id}/prepare`'s top-level `content_hash`, paired with the entry id).
 * @returns {Promise<Actor>}
 */
async function createNpcInFoundry(npc, onProgress, folderId, existingActor, syncInfo) {
  const iconCache = new Map();

  let portraitPath = null;
  if (npc.portrait_media_id) {
    onProgress?.('Uploading portrait…');
    portraitPath = await uploadIconToFoundry(npc.portrait_media_id, iconCache);
  }

  const abilities = {};
  for (const [key, value] of Object.entries(npc.abilities || {})) {
    abilities[key] = { value };
  }

  const systemData = {
    abilities,
    attributes: {
      ac: { calc: 'flat', flat: npc.armor_class },
      hp: { value: npc.hit_points, max: npc.hit_points, formula: npc.hit_dice },
      movement: parseMovement(npc.speed),
      senses: parseSenses(npc.senses),
    },
    details: {
      alignment: npc.alignment,
      cr: crToDecimal(npc.challenge_rating),
      type: { value: (npc.type || '').toLowerCase(), subtype: npc.subtype || '' },
    },
    traits: {
      size: SIZE_MAP[npc.size] || 'med',
      languages: { value: [], custom: npc.languages || '' },
      dr: { value: [], custom: npc.damage_resistances || '' },
      di: { value: [], custom: npc.damage_immunities || '' },
      dv: { value: [], custom: npc.damage_vulnerabilities || '' },
      ci: { value: [], custom: npc.condition_immunities || '' },
    },
  };

  const flags = syncInfo
    ? { [MODULE_ID]: { grEntryId: syncInfo.entryId, grContentHash: syncInfo.contentHash, grSyncedAt: new Date().toISOString() } }
    : undefined;

  let actor;
  if (existingActor) {
    onProgress?.('Updating actor…');
    await existingActor.update({
      name: npc.name,
      ...(portraitPath ? { img: portraitPath } : {}),
      ...(flags ? { flags } : {}),
      system: systemData,
    });
    actor = existingActor;

    const staleItemIds = actor.items.map((i) => i.id);
    if (staleItemIds.length) {
      onProgress?.('Clearing existing items…');
      await actor.deleteEmbeddedDocuments('Item', staleItemIds);
    }
  } else {
    onProgress?.('Creating actor…');
    actor = await Actor.create({
      name: npc.name,
      type: 'npc',
      folder: folderId || null,
      ...(portraitPath ? { img: portraitPath } : {}),
      ...(flags ? { flags } : {}),
      system: systemData,
    });
  }

  const features = npc.features || [];
  for (let i = 0; i < features.length; i++) {
    onProgress?.(`Adding features/actions… (${i + 1}/${features.length})`);
    let imgPath = null;
    if (!features[i].compendium_ref && features[i].icon_media_id) {
      onProgress?.(`Uploading icon… (${i + 1}/${features.length})`);
      imgPath = await uploadIconToFoundry(features[i].icon_media_id, iconCache);
    }
    await addItemToActor(actor, features[i].compendium_ref, featureItemData(features[i], imgPath));
  }

  const items = npc.items || [];
  for (let i = 0; i < items.length; i++) {
    onProgress?.(`Adding equipment… (${i + 1}/${items.length})`);
    let imgPath = null;
    if (!items[i].compendium_ref && items[i].icon_media_id) {
      onProgress?.(`Uploading icon… (${i + 1}/${items.length})`);
      imgPath = await uploadIconToFoundry(items[i].icon_media_id, iconCache);
    }
    await addItemToActor(actor, items[i].compendium_ref, equipmentItemData(items[i], imgPath));
  }

  return actor;
}

/**
 * Small dialog with a "Test Connection" button, opened from the module settings menu.
 */
class TestConnectionForm extends FormApplicationBase {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'grfc-test-connection',
      title: 'Geektastic Realms — Test Connection',
      width: 420,
      height: 'auto',
      closeOnSubmit: false,
      resizable: false,
    });
  }

  getData() {
    return {
      serverUrl: game.settings.get(MODULE_ID, 'serverUrl') || '',
      hasToken: !!game.settings.get(MODULE_ID, 'apiToken'),
    };
  }

  async _renderInner(data) {
    const serverUrl = escapeHtml(data.serverUrl || '(not set)');
    const tokenStatus = data.hasToken ? 'configured' : 'not set';
    const html = `
      <form class="grfc-test-connection" style="padding:.5rem;">
        <p style="margin:.25rem 0;">Server URL: <strong>${serverUrl}</strong></p>
        <p style="margin:.25rem 0;">API token: <strong>${tokenStatus}</strong></p>
        <p id="grfc-result" style="min-height:1.4em;font-weight:600;margin:.75rem 0 .25rem;"></p>
        <footer style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:.5rem;">
          <button type="button" class="grfc-test-btn">
            <i class="fas fa-plug"></i> Test Connection
          </button>
        </footer>
      </form>
    `;
    return $(html);
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('.grfc-test-btn').on('click', async (event) => {
      event.preventDefault();
      const result = html.find('#grfc-result');
      result.text('Testing…').css('color', '');

      const outcome = await testConnection();
      if (outcome.ok) {
        result
          .text(`✔ Connected — world "${outcome.settingName}", Geektastic Realms v${outcome.version}`)
          .css('color', '#2e7d32');
        ui.notifications.info(`Geektastic Realms Foundry Connect: connected to "${outcome.settingName}".`);
      } else {
        result.text(`✘ ${outcome.error}`).css('color', '#c62828');
        ui.notifications.error(`Geektastic Realms Foundry Connect: ${outcome.error}`);
      }
    });
  }
}

/**
 * Choose which Item-type compendium packs to sync, and sync them. Selection is
 * persisted to the `syncPacks` world setting; syncing reads whatever is checked at
 * click time (not necessarily saved first) so "check a few boxes and go" works in
 * one step.
 */
class CompendiumSyncForm extends FormApplicationBase {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'grfc-compendium-sync',
      title: 'Geektastic Realms — Sync Compendiums',
      width: 480,
      height: 'auto',
      closeOnSubmit: false,
      resizable: true,
    });
  }

  getData() {
    const selected = new Set(game.settings.get(MODULE_ID, 'syncPacks') || []);
    return {
      packs: itemPacks().map((p) => ({
        id: p.metadata.id,
        label: p.metadata.label,
        checked: selected.has(p.metadata.id),
      })),
    };
  }

  async _renderInner(data) {
    const rows = data.packs.length
      ? data.packs.map((p) => `
          <label style="display:flex;align-items:center;gap:.5rem;padding:.2rem 0;">
            <input type="checkbox" class="grfc-pack-check" value="${escapeHtml(p.id)}" ${p.checked ? 'checked' : ''}>
            ${escapeHtml(p.label)}
          </label>
        `).join('')
      : '<p>No Item-type compendium packs found in this world.</p>';

    const html = `
      <form class="grfc-compendium-sync" style="padding:.5rem;">
        <p style="margin:.25rem 0 .5rem;color:var(--color-text-dark-secondary,#666);">
          Choose which compendiums to sync to Geektastic Realms. Only Item-type packs
          (weapons, equipment, feats, spells, classes, backgrounds, species, etc.) are
          listed — this is what stat block features/items get matched against.
        </p>
        <div class="grfc-pack-list" style="max-height:260px;overflow-y:auto;border:1px solid #7773;border-radius:4px;padding:.4rem .6rem;">
          ${rows}
        </div>
        <p id="grfc-sync-result" style="min-height:1.4em;font-weight:600;margin:.75rem 0 .25rem;"></p>
        <footer style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:.5rem;">
          <button type="button" class="grfc-sync-btn">
            <i class="fas fa-sync"></i> Sync Compendiums
          </button>
        </footer>
      </form>
    `;
    return $(html);
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('.grfc-sync-btn').on('click', async (event) => {
      event.preventDefault();
      const checked = html.find('.grfc-pack-check:checked').map((_, el) => el.value).get();
      const result = html.find('#grfc-sync-result');

      if (checked.length === 0) {
        result.text('Select at least one compendium first.').css('color', '#c62828');
        return;
      }

      await game.settings.set(MODULE_ID, 'syncPacks', checked);

      const outcome = await syncCompendiums(checked, (status) => {
        result.text(status).css('color', '');
      });

      if (outcome.ok) {
        result.text(`✔ Synced ${outcome.totalSynced} entries from ${checked.length} pack(s).`).css('color', '#2e7d32');
        ui.notifications.info(`Geektastic Realms Foundry Connect: synced ${outcome.totalSynced} entries.`);
      } else {
        result.text(`✘ ${outcome.error}`).css('color', '#c62828');
        ui.notifications.error(`Geektastic Realms Foundry Connect: ${outcome.error}`);
      }
    });
  }
}

/**
 * Lists stat-block-bearing entries available in the connected GR world — from *any*
 * GR category, not just one literally named "NPCs" — and creates one as a real Actor
 * here on request (Stage 5) — a "pull" model, so GR never needs this Foundry instance
 * to be reachable over the network; the module only ever calls out to GR.
 */
class CreateNpcForm extends FormApplicationBase {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'grfc-create-npc',
      title: 'Geektastic Realms — Create Actor',
      width: 640,
      height: 600,
      closeOnSubmit: false,
      resizable: true,
    });
  }

  getData() {
    return {};
  }

  async _renderInner() {
    const html = `
      <form class="grfc-create-npc" style="padding:.5rem;">
        <div style="display:flex; gap:.5rem; margin-bottom:.5rem;">
          <input type="text" class="grfc-npc-search" placeholder="Search by name…"
            style="flex:1 1 auto;min-width:0;box-sizing:border-box;" disabled>
          <select class="grfc-category-filter" style="flex:0 0 auto;" disabled>
            <option value="">All categories</option>
          </select>
        </div>
        <div style="display:flex; align-items:center; gap:.5rem; margin-bottom:.5rem;">
          <label style="white-space:nowrap;color:var(--color-text-dark-secondary,#666);font-size:.85em;">Create in folder:</label>
          <select class="grfc-folder-select" style="flex:1 1 auto;min-width:0;">
            <option value="">(No folder)</option>
          </select>
        </div>
        <p id="grfc-npc-status" style="color:var(--color-text-dark-secondary,#666);margin:.25rem 0 .5rem;">Loading actors…</p>
        <ul class="grfc-npc-list" style="list-style:none;margin:0;padding:0;height:450px;overflow-y:auto"></ul>
      </form>
    `;
    return $(html);
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._loadList(html);
    this._populateFolders(html);

    html.find('.grfc-npc-search').on('input', () => this._applyFilters(html));
    html.find('.grfc-category-filter').on('change', () => this._applyFilters(html));
  }

  /** Populates the target-folder dropdown from this world's Actor folders — purely local, no GR round-trip needed. */
  _populateFolders(html) {
    const select = html.find('.grfc-folder-select');
    const folders = game.folders
      .filter((f) => f.type === 'Actor')
      .map((f) => ({ id: f.id, name: f.name, depth: f.depth || 1 }))
      .sort((a, b) => a.name.localeCompare(b.name));

    folders.forEach((f) => {
      const prefix = f.depth > 1 ? '—'.repeat(f.depth - 1) + ' ' : '';
      select.append(`<option value="${escapeHtml(f.id)}">${prefix}${escapeHtml(f.name)}</option>`);
    });
  }

  _applyFilters(html) {
    const query = html.find('.grfc-npc-search').val().trim().toLowerCase();
    const category = html.find('.grfc-category-filter').val();
    const rows = html.find('.grfc-npc-list > li');
    let visible = 0;

    rows.each((_, el) => {
      const row = $(el);
      const matches = (query === '' || row.data('name').includes(query))
        && (category === '' || row.data('category') === category);
      row.toggle(matches);
      if (matches) visible++;
    });

    const total = rows.length;
    const filters = [];
    if (query) filters.push(`name matches "${query}"`);
    if (category) filters.push(`category is "${category}"`);
    html.find('#grfc-npc-status').text(
      filters.length === 0 ? `${total} available — click Create to build one here.` : `${visible} of ${total} match (${filters.join(', ')}).`
    );
  }

  async _loadList(html) {
    const status = html.find('#grfc-npc-status');
    const list = html.find('.grfc-npc-list');
    const search = html.find('.grfc-npc-search');
    const categoryFilter = html.find('.grfc-category-filter');

    const result = await fetchNpcList();
    if (!result.ok) {
      status.text(`✘ ${result.error}`).css('color', '#c62828');
      return;
    }

    const npcs = result.body.npcs || [];
    if (npcs.length === 0) {
      status.text('No stat blocks found in this Geektastic Realms world.');
      return;
    }

    status.text(`${npcs.length} available — click Create to build one here.`);
    search.prop('disabled', false);

    const categories = [...new Set(npcs.map((n) => n.category).filter(Boolean))].sort();
    categories.forEach((c) => categoryFilter.append(`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`));
    categoryFilter.prop('disabled', false);

    const syncedActors = syncedActorsByEntryId();

    list.empty();
    npcs.forEach((npc) => {
      const existingActor = syncedActors.get(npc.entry_id) || null;
      const isChanged = !!existingActor && existingActor.getFlag(MODULE_ID, 'grContentHash') !== npc.content_hash;
      const badge = (label, color) => `<span class="grfc-npc-sync-badge" style="flex:0 0 auto;font-size:.8em;color:${color};white-space:nowrap;">${label}</span>`;
      const syncBadgeHtml = !existingActor ? '' : isChanged ? badge('↻ Changed', '#b26a00') : badge('✓ Up to date', '#2e7d32');

      const li = $(`
        <li data-name="${escapeHtml((npc.name || '').toLowerCase())}" data-category="${escapeHtml(npc.category || '')}" style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid #7773;">
          <span style="flex:1 1 auto;min-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            <strong>${escapeHtml(npc.name)}</strong>
            <span style="color:var(--color-text-dark-secondary,#666);font-size:.85em;"> — ${escapeHtml(npc.category || '')}${npc.challenge_rating ? ' · CR ' + escapeHtml(npc.challenge_rating) : ''}</span>
          </span>
          ${syncBadgeHtml}
          <span class="grfc-npc-row-status" style="flex:0 0 auto;min-width:1.5em;"></span>
          <button type="button" class="grfc-create-btn" style="flex:0 0 auto;width:auto;white-space:nowrap;padding:0 .75rem;">${existingActor ? 'Update' : 'Create'}</button>
        </li>
      `);

      // Reassigned after a successful create/update below, so a second click in the
      // same dialog session (no reopen needed) updates in place rather than creating
      // a duplicate — importing/updating twice never produces two actors.
      let rowActor = existingActor;

      li.find('.grfc-create-btn').on('click', async () => {
        const rowStatus = li.find('.grfc-npc-row-status');
        const btn = li.find('.grfc-create-btn');
        const isUpdate = !!rowActor;
        btn.prop('disabled', true);
        rowStatus.text('Preparing…');

        const prepared = await prepareNpc(npc.entry_id);
        if (!prepared.ok) {
          rowStatus.text('✘').attr('title', prepared.error).css('color', '#c62828');
          btn.prop('disabled', false);
          return;
        }

        try {
          const folderId = html.find('.grfc-folder-select').val();
          const syncInfo = { entryId: npc.entry_id, contentHash: prepared.body.content_hash };
          rowActor = await createNpcInFoundry(prepared.body.npc, (msg) => rowStatus.text(msg), folderId, rowActor, syncInfo);

          rowStatus.text(isUpdate ? '✔ Updated' : '✔ Created').css('color', '#2e7d32');
          ui.notifications.info(`Geektastic Realms Foundry Connect: ${isUpdate ? 'updated' : 'created'} "${npc.name}".`);

          btn.text('Update');
          li.find('.grfc-npc-sync-badge').remove();
          li.find('.grfc-npc-row-status').before(badge('✓ Up to date', '#2e7d32'));
        } catch (err) {
          rowStatus.text('✘').attr('title', err.message).css('color', '#c62828');
          ui.notifications.error(`Geektastic Realms Foundry Connect: failed to ${isUpdate ? 'update' : 'create'} "${npc.name}" — ${err.message}`);
        } finally {
          btn.prop('disabled', false);
        }
      });
      list.append(li);
    });
  }
}

/**
 * Deploys a whole GR encounter's adversary roster into Foundry in one action
 * (Stage 10) — pick a module, then one of its encounters, and every adversary's
 * Actor is created-or-updated (reusing the Stage 9 pipeline) into an
 * `Encounters/{name}` folder, optionally with a Foundry Combat pre-populated with
 * one combatant per quantity (an "unlinked" combatant — actorId only, no placed
 * token — the same shape Foundry's own Combat Tracker "add non-token combatant"
 * flow produces; the DM drags tokens onto the scene later and the tracker links
 * them up). A failure on one adversary doesn't abort the rest — this deploys as
 * much of the roster as it can rather than being all-or-nothing.
 */
class ImportEncounterForm extends FormApplicationBase {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'grfc-import-encounter',
      title: 'Geektastic Realms — Deploy Encounter',
      width: 640,
      height: 600,
      closeOnSubmit: false,
      resizable: true,
    });
  }

  getData() {
    return {};
  }

  async _renderInner() {
    const html = `
      <form class="grfc-import-encounter" style="padding:.5rem;display:flex;flex-direction:column;height:100%;box-sizing:border-box;">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;">
          <label style="white-space:nowrap;color:var(--color-text-dark-secondary,#666);font-size:.85em;">Module:</label>
          <select class="grfc-module-select" style="flex:1 1 auto;min-width:0;" disabled>
            <option value="">Loading modules…</option>
          </select>
        </div>
        <label style="display:flex;align-items:center;gap:.4rem;margin-bottom:.3rem;font-size:.9em;">
          <input type="checkbox" class="grfc-place-tokens" checked>
          Place tokens on the current scene (one per creature)
        </label>
        <label style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem;font-size:.9em;">
          <input type="checkbox" class="grfc-create-combat" checked>
          Also create a Combat encounter, linked to the placed tokens
        </label>
        <p id="grfc-encounter-status" style="color:var(--color-text-dark-secondary,#666);margin:.25rem 0 .5rem;">Loading modules…</p>
        <ul class="grfc-encounter-list" style="list-style:none;margin:0;padding:0;flex:1 1 auto;overflow-y:auto"></ul>
      </form>
    `;
    return $(html);
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._loadModules(html);
    html.find('.grfc-module-select').on('change', () => this._loadEncounters(html));
  }

  async _loadModules(html) {
    const select = html.find('.grfc-module-select');
    const status = html.find('#grfc-encounter-status');

    const result = await fetchModuleList();
    if (!result.ok) {
      status.text(`✘ ${result.error}`).css('color', '#c62828');
      return;
    }

    const modules = result.body.modules || [];
    select.empty();
    if (modules.length === 0) {
      select.append('<option value="">No modules in this world</option>');
      status.text('No adventure modules found in this Geektastic Realms world.');
      return;
    }

    select.append('<option value="">Choose a module…</option>');
    modules.forEach((m) => select.append(`<option value="${m.id}">${escapeHtml(m.title)}</option>`));
    select.prop('disabled', false);
    status.text('Choose a module to see its encounters.');
  }

  async _loadEncounters(html) {
    const moduleId = html.find('.grfc-module-select').val();
    const list = html.find('.grfc-encounter-list');
    const status = html.find('#grfc-encounter-status');
    list.empty();

    if (!moduleId) {
      status.text('Choose a module to see its encounters.');
      return;
    }

    status.text('Loading encounters…');
    const result = await fetchModuleEncounters(moduleId);
    if (!result.ok) {
      status.text(`✘ ${result.error}`).css('color', '#c62828');
      return;
    }

    const encounters = result.body.encounters || [];
    if (encounters.length === 0) {
      status.text('No encounters in this module.');
      return;
    }
    status.text(`${encounters.length} encounter${encounters.length === 1 ? '' : 's'} in this module.`);

    const syncedActors = syncedActorsByEntryId();

    encounters.forEach((encounter) => {
      const adversaries = encounter.adversaries || [];
      const rosterText = adversaries.length === 0
        ? 'No adversaries attached.'
        : adversaries.map((a) => `${a.quantity}× ${a.name}`).join(', ');
      const totalCreatures = adversaries.reduce((sum, a) => sum + a.quantity, 0);

      const li = $(`
        <li style="padding:.5rem 0;border-bottom:1px solid #7773;">
          <div style="display:flex;align-items:center;gap:.5rem;">
            <span style="flex:1 1 auto;min-width:0;">
              <strong>${escapeHtml(encounter.name)}</strong>
              <span style="color:var(--color-text-dark-secondary,#666);font-size:.85em;">
                — ${escapeHtml(encounter.encounter_type || '')}${encounter.difficulty ? ' · ' + escapeHtml(encounter.difficulty) : ''}${encounter.section_title ? ' · ' + escapeHtml(encounter.section_title) : ''}
              </span>
            </span>
            <span class="grfc-encounter-row-status" style="flex:0 0 auto;min-width:1.5em;text-align:right;"></span>
            <button type="button" class="grfc-deploy-btn" style="flex:0 0 auto;width:auto;white-space:nowrap;padding:0 .75rem;" ${adversaries.length === 0 ? 'disabled' : ''}>Deploy</button>
          </div>
          <div style="color:var(--color-text-dark-secondary,#666);font-size:.85em;margin-top:.15rem;">${escapeHtml(rosterText)}${totalCreatures ? ` (${totalCreatures} total)` : ''}</div>
        </li>
      `);

      li.find('.grfc-deploy-btn').on('click', async () => {
        const rowStatus = li.find('.grfc-encounter-row-status');
        const btn = li.find('.grfc-deploy-btn');
        btn.prop('disabled', true);
        rowStatus.text('Preparing…');

        const prepared = await prepareEncounter(encounter.id);
        if (!prepared.ok) {
          rowStatus.text('✘').attr('title', prepared.error).css('color', '#c62828');
          btn.prop('disabled', false);
          return;
        }

        const placeTokens = html.find('.grfc-place-tokens').is(':checked');
        const createCombat = html.find('.grfc-create-combat').is(':checked');
        const preparedAdversaries = prepared.body.adversaries || [];
        const folderId = await findOrCreateEncounterFolder(prepared.body.encounter?.name || encounter.name);

        const deployed = [];
        const failed = [];
        for (let i = 0; i < preparedAdversaries.length; i++) {
          const adv = preparedAdversaries[i];
          rowStatus.text(`Deploying… (${i + 1}/${preparedAdversaries.length})`);
          try {
            const existingActor = syncedActors.get(adv.entry_id) || null;
            const syncInfo = { entryId: adv.entry_id, contentHash: adv.content_hash };
            const actor = await createNpcInFoundry(
              adv.npc,
              (msg) => rowStatus.text(`${adv.name}: ${msg}`),
              folderId,
              existingActor,
              syncInfo
            );
            syncedActors.set(adv.entry_id, actor);
            deployed.push({ actor, quantity: adv.quantity });
          } catch (err) {
            failed.push({ name: adv.name, error: err.message });
          }
        }

        // Placed tokens, keyed by actor id — used both to report "no active scene"
        // and to link the Combat below to real tokens instead of bare actor refs.
        const tokensByActorId = new Map();
        let noActiveScene = false;
        if (placeTokens && deployed.length > 0) {
          rowStatus.text('Placing tokens…');
          const grandTotal = deployed.reduce((sum, d) => sum + d.quantity, 0);
          let slot = 0;
          for (const { actor, quantity } of deployed) {
            try {
              const tokens = await placeTokensForActor(actor, quantity, slot, grandTotal);
              if (tokens.length === 0) noActiveScene = true;
              tokensByActorId.set(actor.id, tokens);
            } catch (err) {
              failed.push({ name: `${actor.name} (token placement)`, error: err.message });
            }
            slot += quantity;
          }
        }

        if (createCombat && deployed.length > 0) {
          rowStatus.text('Building combat…');
          try {
            const combat = await Combat.create({ scene: canvas?.scene?.id ?? null });
            const combatants = [];
            for (const { actor, quantity } of deployed) {
              const tokens = tokensByActorId.get(actor.id) || [];
              if (tokens.length > 0) {
                // Linked to a real placed token — appears on the map and in the
                // tracker together, ready to run immediately.
                for (const token of tokens) combatants.push({ tokenId: token.id, sceneId: token.parent.id, actorId: actor.id });
              } else {
                // No token placed (box unchecked, or no active scene) — still add
                // an actor-only combatant so the roster is at least in the tracker;
                // the DM links it to a token manually later.
                for (let n = 0; n < quantity; n++) combatants.push({ actorId: actor.id });
              }
            }
            if (combatants.length) await combat.createEmbeddedDocuments('Combatant', combatants);
            await combat.activate();
          } catch (err) {
            failed.push({ name: '(combat tracker)', error: err.message });
          }
        }

        btn.prop('disabled', false);
        const parts = [`${deployed.length} adversar${deployed.length === 1 ? 'y' : 'ies'}`];
        if (placeTokens) parts.push(noActiveScene ? 'no active scene to place tokens on' : 'tokens placed');
        if (createCombat) parts.push('combat created');
        if (failed.length === 0) {
          rowStatus.text('✔ Deployed').css('color', '#2e7d32');
          ui.notifications.info(`Geektastic Realms Foundry Connect: deployed "${encounter.name}" (${parts.join(', ')}).`);
        } else {
          rowStatus.text(`⚠ ${failed.length} failed`).attr('title', failed.map((f) => `${f.name}: ${f.error}`).join('\n')).css('color', '#b26a00');
          ui.notifications.warn(`Geektastic Realms Foundry Connect: deployed "${encounter.name}" (${parts.join(', ')}) with ${failed.length} failure(s) — see row for details.`);
        }
      });

      list.append(li);
    });
  }
}

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'serverUrl', {
    name: 'Geektastic Realms Server URL',
    hint: 'Base URL of your Geektastic Realms instance, e.g. https://realms.example.com (no trailing slash).',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    restricted: true,
  });

  game.settings.register(MODULE_ID, 'apiToken', {
    name: 'API Token',
    hint: 'Generated from the "Foundry VTT Connection" panel on a world’s dashboard page in Geektastic Realms.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, 'testConnectionMenu', {
    name: 'Test Connection',
    label: 'Test Connection',
    hint: 'Verify Geektastic Realms is reachable with the settings above.',
    icon: 'fas fa-plug',
    type: TestConnectionForm,
    restricted: true,
  });

  // Not `config: true` — this is managed entirely through the Sync Compendiums
  // dialog's checkboxes, not the default settings list.
  game.settings.register(MODULE_ID, 'syncPacks', {
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });

  game.settings.registerMenu(MODULE_ID, 'syncCompendiumsMenu', {
    name: 'Sync Compendiums',
    label: 'Sync Compendiums',
    hint: 'Choose which compendiums to sync to Geektastic Realms for stat block matching.',
    icon: 'fas fa-sync',
    type: CompendiumSyncForm,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, 'createNpcMenu', {
    name: 'Create Actor',
    label: 'Create Actor',
    hint: 'Pull a stat block from any category in Geektastic Realms — including custom ones like Monsters — and create it as an Actor in this world.',
    icon: 'fas fa-user-plus',
    type: CreateNpcForm,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, 'importEncounterMenu', {
    name: 'Deploy Encounter',
    label: 'Deploy Encounter',
    hint: 'Pick a module and one of its encounters, and create/update every adversary\'s Actor in this world in one action — optionally with a pre-built Combat.',
    icon: 'fas fa-people-group',
    type: ImportEncounterForm,
    restricted: true,
  });
});

Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | ready`);
});
