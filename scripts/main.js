/**
 * Geektastic Realms Foundry Connect — Stages 2–6 (handshake, compendium indexing,
 * NPC creation, and icon pipeline; Stage 4's matching engine is entirely GR-side,
 * no module changes).
 *
 * Registers the server URL / API token this world uses to reach a Geektastic Realms
 * instance, a "Test Connection" action (GET /api/foundry/v1/ping), a "Sync
 * Compendiums" action that walks this world's Item-type compendium packs and POSTs an
 * index of their contents to GR (POST /api/foundry/v1/compendium/sync) for matching,
 * and a "Create NPC" action that pulls a prepared stat block (GET
 * /api/foundry/v1/npc/{entryId}/prepare) and builds a real Actor in this world —
 * cloning confirmed-matched features/items from local compendiums via `fromUuid()`
 * and creating fresh Items (via Foundry's own `Item.create()`, which fills in schema
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
 * Builds a real Actor in this world from a GR "prepare" payload (Stage 5), resolving
 * confirmed compendium matches and creating fresh Items for everything else.
 * @returns {Promise<Actor>}
 */
async function createNpcInFoundry(npc, onProgress) {
  onProgress?.('Creating actor…');

  const abilities = {};
  for (const [key, value] of Object.entries(npc.abilities || {})) {
    abilities[key] = { value };
  }

  const actor = await Actor.create({
    name: npc.name,
    type: 'npc',
    system: {
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
    },
  });

  const iconCache = new Map();

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
 *
 * NOTE (unverified against a live v13 instance): if this throws
 * "FormApplication is not defined" or logs a deprecation warning on your Foundry
 * install, change the line below to
 * `class TestConnectionForm extends foundry.appv1.api.FormApplication {` — v13
 * namespaced several v1 Application classes but has historically kept a bare
 * global alias for backward compatibility; which form your specific build expects
 * can only be confirmed by loading the module for real.
 */
class TestConnectionForm extends FormApplication {
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
 * one step. See the FormApplication/ApplicationV2 note above TestConnectionForm —
 * the same caveat applies here.
 */
class CompendiumSyncForm extends FormApplication {
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
 * Lists NPCs (stat-block-bearing entries) available in the connected GR world and
 * creates one as a real Actor here on request (Stage 5) — a "pull" model, so GR never
 * needs this Foundry instance to be reachable over the network; the module only ever
 * calls out to GR.
 */
class CreateNpcForm extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'grfc-create-npc',
      title: 'Geektastic Realms — Create NPC',
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
        <input type="text" class="grfc-npc-search" placeholder="Search NPCs by name…"
          style="width:100%;box-sizing:border-box;margin-bottom:.5rem;" disabled>
        <p id="grfc-npc-status" style="color:var(--color-text-dark-secondary,#666);margin:.25rem 0 .5rem;">Loading NPCs…</p>
        <ul class="grfc-npc-list" style="list-style:none;margin:0;padding:0;height:450px;overflow-y:auto"></ul>
      </form>
    `;
    return $(html);
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._loadList(html);

    html.find('.grfc-npc-search').on('input', (event) => this._filterList(html, event.target.value));
  }

  _filterList(html, query) {
    const needle = query.trim().toLowerCase();
    const rows = html.find('.grfc-npc-list > li');
    let visible = 0;

    rows.each((_, el) => {
      const row = $(el);
      const matches = needle === '' || row.data('name').includes(needle);
      row.toggle(matches);
      if (matches) visible++;
    });

    const total = rows.length;
    html.find('#grfc-npc-status').text(
      needle === '' ? `${total} available — click Create to build one here.` : `${visible} of ${total} match "${query.trim()}".`
    );
  }

  async _loadList(html) {
    const status = html.find('#grfc-npc-status');
    const list = html.find('.grfc-npc-list');
    const search = html.find('.grfc-npc-search');

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
    list.empty();
    npcs.forEach((npc) => {
      const li = $(`
        <li data-name="${escapeHtml((npc.name || '').toLowerCase())}" style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid #7773;">
          <span style="flex:1 1 auto;min-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            <strong>${escapeHtml(npc.name)}</strong>
            <span style="color:var(--color-text-dark-secondary,#666);font-size:.85em;"> — ${escapeHtml(npc.category || '')}${npc.challenge_rating ? ' · CR ' + escapeHtml(npc.challenge_rating) : ''}</span>
          </span>
          <span class="grfc-npc-row-status" style="flex:0 0 auto;min-width:1.5em;"></span>
          <button type="button" class="grfc-create-btn" style="flex:0 0 auto;width:auto;white-space:nowrap;padding:0 .75rem;">Create</button>
        </li>
      `);
      li.find('.grfc-create-btn').on('click', async () => {
        const rowStatus = li.find('.grfc-npc-row-status');
        const btn = li.find('.grfc-create-btn');
        btn.prop('disabled', true);
        rowStatus.text('Preparing…');

        const prepared = await prepareNpc(npc.entry_id);
        if (!prepared.ok) {
          rowStatus.text('✘').attr('title', prepared.error).css('color', '#c62828');
          btn.prop('disabled', false);
          return;
        }

        try {
          await createNpcInFoundry(prepared.body.npc, (msg) => rowStatus.text(msg));
          rowStatus.text('✔ Created').css('color', '#2e7d32');
          ui.notifications.info(`Geektastic Realms Foundry Connect: created "${npc.name}".`);
        } catch (err) {
          rowStatus.text('✘').attr('title', err.message).css('color', '#c62828');
          ui.notifications.error(`Geektastic Realms Foundry Connect: failed to create "${npc.name}" — ${err.message}`);
          btn.prop('disabled', false);
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
    name: 'Create NPC',
    label: 'Create NPC',
    hint: 'Pull a stat block from Geektastic Realms and create it as an Actor in this world.',
    icon: 'fas fa-user-plus',
    type: CreateNpcForm,
    restricted: true,
  });
});

Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | ready`);
});
