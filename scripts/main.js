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

/** Fetches every handout in one module, each with a content_hash (Stage 11). */
async function fetchModuleHandouts(moduleId) {
  return apiFetch(`/api/foundry/v1/modules/${moduleId}/handouts`);
}

/** Fetches every roll table (with full rows) in one module, each with a content_hash (Stage 12). */
async function fetchModuleRollTables(moduleId) {
  return apiFetch(`/api/foundry/v1/modules/${moduleId}/roll-tables`);
}

/** Fetches a module's overview + full section tree (real body_html, content_hash per section) for Stage 13. */
async function fetchModulePrepare(moduleId) {
  return apiFetch(`/api/foundry/v1/modules/${moduleId}/prepare`);
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

/**
 * Finds this module's Journal Entry (Stage 11), if it's been imported before —
 * flagged with `grModuleId` rather than found by name, so renaming the module or
 * the journal afterward doesn't break re-import lookup.
 */
function findModuleJournal(moduleId) {
  return game.journal.find((j) => j.getFlag(MODULE_ID, 'grModuleId') === moduleId) || null;
}

/** One handout's page content: an uploaded image (if any) above the rich-text body. */
function handoutPageContent(handout, imgPath) {
  const imageHtml = imgPath ? `<p><img src="${imgPath}" style="max-width:400px;"></p>` : '';
  return imageHtml + (handout.body_html || '');
}

/**
 * Imports every handout in a module as pages of one Journal Entry (Stage 11) —
 * created on first import, found and reused (by `grModuleId` flag) on later ones.
 * Each page is flagged with `grHandoutId`/`grContentHash`; a page whose hash still
 * matches the handout's current `content_hash` is left untouched (not
 * re-uploaded/re-written), the same change-detection approach Stage 9/10 use for
 * Actors and encounters. A failure on one handout doesn't abort the rest.
 * @returns {Promise<{journal: JournalEntry, created: number, updated: number, unchanged: number, failed: {name: string, error: string}[]}>}
 */
async function importHandouts(moduleId, moduleTitle, handouts, onProgress) {
  const iconCache = new Map();

  let journal = findModuleJournal(moduleId);
  if (!journal) {
    onProgress?.('Creating journal…');
    journal = await JournalEntry.create({ name: moduleTitle, flags: { [MODULE_ID]: { grModuleId: moduleId } } });
  } else if (journal.name !== moduleTitle) {
    await journal.update({ name: moduleTitle });
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const failed = [];

  for (let i = 0; i < handouts.length; i++) {
    const handout = handouts[i];
    onProgress?.(`Importing "${handout.title}"… (${i + 1}/${handouts.length})`);
    try {
      const existingPage = journal.pages.find((p) => p.getFlag(MODULE_ID, 'grHandoutId') === handout.id);
      if (existingPage && existingPage.getFlag(MODULE_ID, 'grContentHash') === handout.content_hash) {
        unchanged++;
        continue;
      }

      const imgPath = handout.media_id ? await uploadIconToFoundry(handout.media_id, iconCache) : null;
      const content = handoutPageContent(handout, imgPath);
      const flags = { [MODULE_ID]: { grHandoutId: handout.id, grContentHash: handout.content_hash } };

      if (existingPage) {
        await existingPage.update({ name: handout.title, text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML }, flags });
        updated++;
      } else {
        await journal.createEmbeddedDocuments('JournalEntryPage', [{
          name: handout.title,
          type: 'text',
          text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
          flags,
        }]);
        created++;
      }
    } catch (err) {
      failed.push({ name: handout.title, error: err.message });
    }
  }

  return { journal, created, updated, unchanged, failed };
}

/**
 * Every RollTable in this world previously imported by this module, keyed by the GR
 * roll table id it was built from (Stage 12's `grRollTableId` flag) — same
 * find-by-flag pattern `syncedActorsByEntryId()` established for Actors.
 */
function syncedRollTablesByGrId() {
  const map = new Map();
  for (const table of game.tables) {
    const grId = table.getFlag(MODULE_ID, 'grRollTableId');
    if (grId != null) map.set(grId, table);
  }
  return map;
}

/**
 * Mirrors `App\Support\RollTables::withPadding()` on the GR side: if the table's
 * computed die has more faces than the highest authored `range_end`, appends one
 * synthetic "No result" row spanning the gap, so a native Foundry draw always finds
 * a match — the GR API returns authored rows only, the same as its own general-
 * purpose API, so this padding has to be reconstructed client-side to keep parity
 * with what the GR web run view already shows.
 */
function withPaddedRollTableRows(rows, die) {
  if (!rows.length) return rows;
  const faces = parseInt(String(die).replace(/[^\d]/g, ''), 10) || 0;
  const maxRange = rows.reduce((max, r) => Math.max(max, r.range_end), 0);
  if (faces <= maxRange) return rows;
  return [...rows, { range_start: maxRange + 1, range_end: faces, title: null, description: 'No result' }];
}

/** One GR roll table row -> a Foundry TableResult's display text (title + description, whichever are present). */
function rollTableRowText(row) {
  if (row.title && row.description) return `${row.title} — ${row.description}`;
  return row.title || row.description || '';
}

/**
 * Imports one GR roll table as a native Foundry RollTable document (Stage 12) —
 * created on first import, found and reused (by `grRollTableId` flag) and updated
 * in place on later ones. Every existing TableResult is cleared and rebuilt from
 * GR's current rows on update, the same convergent-rebuild approach Stage 9 uses for
 * an Actor's items — simpler and safer than trying to diff individual rows.
 */
async function importRollTable(table, existing, onProgress) {
  onProgress?.(`Importing "${table.title}"…`);

  const faces = parseInt(String(table.die).replace(/[^\d]/g, ''), 10) || 20;
  const formula = `1d${faces}`;
  const resultsData = withPaddedRollTableRows(table.rows || [], table.die).map((row) => ({
    type: CONST.TABLE_RESULT_TYPES.TEXT,
    text: rollTableRowText(row),
    range: [row.range_start, row.range_end],
    weight: 1,
  }));
  const flags = { [MODULE_ID]: { grRollTableId: table.id, grContentHash: table.content_hash, grSyncedAt: new Date().toISOString() } };

  let doc = existing;
  if (existing) {
    await existing.update({ name: table.title, formula, flags });
    const staleIds = existing.results.map((r) => r.id);
    if (staleIds.length) await existing.deleteEmbeddedDocuments('TableResult', staleIds);
  } else {
    doc = await RollTable.create({ name: table.title, formula, flags });
  }
  if (resultsData.length) await doc.createEmbeddedDocuments('TableResult', resultsData);
  return doc;
}

/** Section type -> JournalEntryPage heading level, matching the GR web run view's own convention. */
const SECTION_HEADING_LEVEL = { act: 1, chapter: 2, scene: 3, appendix: 2 };

/**
 * Flattens a GR section tree (Acts -> Chapters -> Scenes, Appendices as top-level
 * siblings) into a depth-first ordered list. Foundry's Journal page model has no
 * real page-within-page nesting, so "nested pages in tree order" (Stage 13) means
 * this: one page per section, in the same order a DM reading the run view
 * top-to-bottom would encounter them.
 */
function flattenSectionTree(nodes) {
  const out = [];
  const walk = (list) => {
    for (const node of list) {
      out.push(node);
      walk(node.children || []);
    }
  };
  walk(nodes || []);
  return out;
}

/**
 * Rewrites encounter-ref/handout-ref/roll-table-ref chips already embedded in a
 * section's body_html into links to whatever Stage 10–12 documents already exist
 * for them, using the same eid-/hid-/rtid- class-token trick the web run view's own
 * expand_*_refs() helpers key off (see app/Support/helpers.php in the main repo). A
 * ref with no matching document yet — that stage hasn't been run for this specific
 * item — falls back to a plain, undecorated label instead of a broken link.
 */
function rewriteAdventureRefs(html, ctx) {
  if (!html) return html;

  html = html.replace(/<div\b[^>]*\bclass="[^"]*\beid-(\d+)\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, (match, idStr) => {
    const enc = ctx.encountersById.get(Number(idStr));
    if (!enc) return match;
    const typeLabel = enc.encounter_type ? enc.encounter_type.charAt(0).toUpperCase() + enc.encounter_type.slice(1) : '';
    const roster = (enc.adversaries || [])
      .map((a) => {
        const actor = ctx.actorsByEntryId.get(a.entry_id);
        const label = actor ? `@UUID[${actor.uuid}]{${escapeHtml(a.name)}}` : escapeHtml(a.name);
        return `${a.quantity}× ${label}`;
      })
      .join(', ');
    const diffText = enc.difficulty ? ` — ${escapeHtml(enc.difficulty)}` : '';
    const rosterLine = roster ? `<br>Adversaries: ${roster}` : '';
    return `<p>⚔ <strong>${escapeHtml(enc.name)}</strong> (${escapeHtml(typeLabel)}${diffText})${rosterLine}</p>`;
  });

  html = html.replace(/<div\b[^>]*\bclass="[^"]*\bhid-(\d+)\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, (match, idStr) => {
    const id = Number(idStr);
    const page = ctx.handoutPagesByGrId.get(id);
    const title = ctx.handoutsById.get(id)?.title ?? 'Handout';
    const label = page ? `@UUID[${page.uuid}]{${escapeHtml(title)}}` : escapeHtml(title);
    return `<p>📄 ${label}</p>`;
  });

  html = html.replace(/<div\b[^>]*\bclass="[^"]*\brtid-(\d+)\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, (match, idStr) => {
    const id = Number(idStr);
    const table = ctx.rollTablesByGrId.get(id);
    const title = ctx.rollTableTitlesById.get(id) ?? 'Roll Table';
    const label = table ? `@UUID[${table.uuid}]{${escapeHtml(title)}}` : escapeHtml(title);
    return `<p>🎲 ${label}</p>`;
  });

  return html;
}

/**
 * A section's (or the module's) Related Articles as a footer list, linked to a
 * matching Actor (Stage 9) where one already exists — the "entry mentions linked
 * where a matching Actor exists" GR's own inline @-mention links aren't reliably
 * parseable for (see Tech_Docs/FOUNDRY_API.md "Adventure → Journal export" in the
 * main repo for why this uses the structured Related Articles data instead).
 */
function relatedEntriesFooter(relatedEntries, actorsByEntryId) {
  if (!relatedEntries || relatedEntries.length === 0) return '';
  const items = relatedEntries
    .map((r) => {
      const actor = actorsByEntryId.get(r.entry_id);
      const label = actor ? `@UUID[${actor.uuid}]{${escapeHtml(r.title)}}` : escapeHtml(r.title);
      const note = r.context_note ? ` — ${escapeHtml(r.context_note)}` : '';
      return `<li>${label}${note}</li>`;
    })
    .join('');
  return `<hr><p><strong>Related</strong></p><ul>${items}</ul>`;
}

/**
 * Creates or updates one JournalEntryPage, keyed by `flagKey`/`flagValue` (e.g.
 * `grSectionId`/{id}, or `grPageKind`/`'overview'` for the module overview page)
 * rather than by name, so renaming a section or the page itself doesn't break
 * re-import lookup. Always keeps `sort` current — even when content is otherwise
 * unchanged — so the page list stays in tree order even if sections were added,
 * removed, or reordered since the last import; only rebuilds
 * `name`/`title.level`/`text` when `contentHash` actually changed.
 * @returns {Promise<{changed: boolean, isNew: boolean}>}
 */
async function importAdventurePage(journal, flagKey, flagValue, { name, level, content, contentHash, sortOrder }) {
  const existingPage = journal.pages.find((p) => p.getFlag(MODULE_ID, flagKey) === flagValue);
  const isNew = !existingPage;
  const upToDate = !isNew && existingPage.getFlag(MODULE_ID, 'grContentHash') === contentHash;

  if (!isNew) {
    if (upToDate) {
      if (existingPage.sort !== sortOrder) await existingPage.update({ sort: sortOrder });
      return { changed: false, isNew: false };
    }
    await existingPage.update({
      name,
      title: { level },
      text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
      sort: sortOrder,
      flags: { [MODULE_ID]: { [flagKey]: flagValue, grContentHash: contentHash } },
    });
    return { changed: true, isNew: false };
  }

  await journal.createEmbeddedDocuments('JournalEntryPage', [{
    name,
    type: 'text',
    title: { level },
    text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
    sort: sortOrder,
    flags: { [MODULE_ID]: { [flagKey]: flagValue, grContentHash: contentHash } },
  }]);
  return { changed: true, isNew: true };
}

/**
 * Imports a whole module as one Journal Entry (Stage 13, the capstone composing
 * Stages 9–12): an overview page, then one page per section in depth-first tree
 * order, each with its encounter-ref/handout-ref/roll-table-ref chips rewritten
 * into links to whatever Stage 10–12 documents already exist, and its Related
 * Articles appended as a linked-where-possible footer. Reuses the same per-module
 * Journal Entry Stage 11 already creates (via findModuleJournal()) — a module's
 * handouts and its narrative end up in one place, not two competing journals.
 * Deliberately does not create any Actors/RollTables/handout pages itself — those
 * are Stages 9–12's job; this stage only links to what already exists.
 * @returns {Promise<{journal: JournalEntry, created: number, updated: number, unchanged: number}>}
 */
async function importAdventure(moduleId, onProgress) {
  onProgress?.('Fetching adventure…');
  const [prepared, encountersResult, handoutsResult, rollTablesResult] = await Promise.all([
    fetchModulePrepare(moduleId),
    fetchModuleEncounters(moduleId),
    fetchModuleHandouts(moduleId),
    fetchModuleRollTables(moduleId),
  ]);
  if (!prepared.ok) throw new Error(prepared.error);

  const encountersById = new Map((encountersResult.body?.encounters || []).map((e) => [e.id, e]));
  const handoutsById = new Map((handoutsResult.body?.handouts || []).map((h) => [h.id, h]));
  const rollTables = rollTablesResult.body?.roll_tables || [];
  const rollTableTitlesById = new Map(rollTables.map((t) => [t.id, t.title]));

  let journal = findModuleJournal(moduleId);
  if (!journal) {
    onProgress?.('Creating journal…');
    journal = await JournalEntry.create({
      name: prepared.body.module.title,
      flags: { [MODULE_ID]: { grModuleId: moduleId } },
    });
  } else if (journal.name !== prepared.body.module.title) {
    await journal.update({ name: prepared.body.module.title });
  }

  const handoutPagesByGrId = new Map();
  for (const page of journal.pages) {
    const hid = page.getFlag(MODULE_ID, 'grHandoutId');
    if (hid != null) handoutPagesByGrId.set(hid, page);
  }

  const ctx = {
    encountersById,
    handoutsById,
    handoutPagesByGrId,
    rollTablesByGrId: syncedRollTablesByGrId(),
    rollTableTitlesById,
    actorsByEntryId: syncedActorsByEntryId(),
  };

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const tally = (result) => {
    if (!result.changed) unchanged++;
    else if (result.isNew) created++;
    else updated++;
  };

  onProgress?.('Importing overview…');
  const overviewContent = rewriteAdventureRefs(prepared.body.module.overview || '', ctx)
    + relatedEntriesFooter(prepared.body.module_related_entries, ctx.actorsByEntryId);
  tally(await importAdventurePage(journal, 'grPageKind', 'overview', {
    name: prepared.body.module.title,
    level: 1,
    content: overviewContent,
    contentHash: prepared.body.module.content_hash,
    sortOrder: 0,
  }));

  const flatSections = flattenSectionTree(prepared.body.sections);
  for (let i = 0; i < flatSections.length; i++) {
    const section = flatSections[i];
    onProgress?.(`Importing "${section.title}"… (${i + 1}/${flatSections.length})`);
    const content = rewriteAdventureRefs(section.body_html, ctx)
      + relatedEntriesFooter(section.related_entries, ctx.actorsByEntryId);
    tally(await importAdventurePage(journal, 'grSectionId', section.id, {
      name: section.title,
      level: SECTION_HEADING_LEVEL[section.type] || 2,
      content,
      contentHash: section.content_hash,
      sortOrder: (i + 1) * 100000,
    }));
  }

  return { journal, created, updated, unchanged };
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

/** Standard D&D 5e ability modifier: floor((score - 10) / 2). */
function abilityModifier(score) {
  return Math.floor((Number(score) - 10) / 2);
}

/**
 * dnd5e's NPC sheet has no raw "override" field for spell save DC/attack — only
 * `system.attributes.spellcasting` (the ability, which derives DC/attack via the
 * standard `8 + proficiency + modifier` / `proficiency + modifier` core-rules formula)
 * plus bonus-formula fields added on top of that derivation. GR's stat block editor
 * stores the DM's *printed*, absolute values (e.g. "Spellcasting DC 15" — how every
 * published stat block states it), so to land exactly on that value this computes the
 * delta between the printed value and what the standard formula derives from this
 * actor's own abilities/proficiency bonus, and sets that delta as the bonus. With no
 * override given, no bonus is set and Foundry's own derivation is left alone.
 * @param {object} npc - the prepare payload (has `abilities`, `proficiency_bonus`, `spellcasting`)
 * @returns {{dc: ?string, attack: ?string}}
 */
function spellcastingBonuses(npc) {
  const sc = npc.spellcasting;
  if (!sc || !sc.ability) return { dc: null, attack: null };

  const mod = abilityModifier((npc.abilities || {})[sc.ability] ?? 10);
  const prof = Number(npc.proficiency_bonus) || 0;

  return {
    dc: sc.save_dc_override != null ? String(sc.save_dc_override - (8 + prof + mod)) : null,
    attack: sc.attack_override != null ? String(sc.attack_override - (prof + mod)) : null,
  };
}

/**
 * A monster's spellcasting isn't always plain spell slots — Pact Magic (Warlock-style)
 * and Innate Spellcasting (At Will / X per day, no slots at all) are both common on
 * published stat blocks and render in a completely different section of a Foundry
 * dnd5e sheet. Mutates a cloned spell item's `system.preparation` (and, for `per_day`,
 * `system.uses`) in place to match the stat block's own `usage_type` before it's
 * created on the actor — otherwise every cloned spell defaults to looking like
 * ordinary prepared/slot casting regardless of how the compendium source had it set.
 * `mode` values (`always`/`pact`/`atwill`/`innate`) are dnd5e's own
 * `CONFIG.DND5E.spellPreparationModes` keys — the same ones driving the "Pact Magic"/
 * "At Will"/"Innate" section headers on the actor sheet's spellbook tab.
 *
 * The `uses` shape for `per_day` is a best-effort guess at dnd5e's recovery schema
 * (a daily-recovering limited-use counter) — worth spot-checking against a real Actor
 * sheet; if it's off, the spell still clones and casts, just without an accurate
 * uses-per-day counter.
 */
function applySpellUsage(itemData, spell) {
  if (!itemData.system) itemData.system = {};

  switch (spell.usage_type) {
    case 'pact':
      itemData.system.preparation = { mode: 'pact', prepared: true };
      break;
    case 'at_will':
      itemData.system.preparation = { mode: 'atwill', prepared: true };
      break;
    case 'per_day':
      itemData.system.preparation = { mode: 'innate', prepared: true };
      if (spell.uses_per_day) {
        itemData.system.uses = {
          spent: 0,
          max: String(spell.uses_per_day),
          recovery: [{ period: 'day', type: 'recoverUp' }],
        };
      }
      break;
    default:
      itemData.system.preparation = { mode: 'always', prepared: true };
  }
}

/**
 * Resolves a compendium_ref (Stage 4/14 match) via fromUuid() into a clonable plain
 * item-data object (no _id), or null if it doesn't resolve — the source pack entry may
 * no longer exist (e.g. deleted since the last sync) or no match was ever found.
 */
async function resolveCompendiumItem(compendiumRef) {
  if (!compendiumRef || !compendiumRef.entry_uuid) return null;
  const source = await fromUuid(compendiumRef.entry_uuid);
  if (!source) return null;
  const itemData = source.toObject();
  delete itemData._id;
  return itemData;
}

/**
 * Creates or reuses one Item on the actor: clones from a synced compendium entry via
 * fromUuid() when a Stage 4 match was confirmed (compendium_ref present), otherwise
 * creates a fresh Item from GR's data via Foundry's own Item.create() — which fills in
 * every schema default itself, so there's no need to hand-construct a fully-shaped
 * Foundry document the way the static export (FoundryExport::toActorArray in GR) has to.
 */
async function addItemToActor(actor, compendiumRef, freshItemData) {
  const cloned = await resolveCompendiumItem(compendiumRef);
  await actor.createEmbeddedDocuments('Item', [cloned || freshItemData]);
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
 * Searches every Item-type compendium pack in this world for a document matching
 * `name` (case-insensitive) and, when given, `type` — returning a clonable plain
 * item-data object (no `_id`) or null. Unlike resolveCompendiumItem(), which resolves
 * a specific UUID GR already matched, this does the lookup itself: GR sends no
 * `compendium_ref` for the spellcasting summary (it isn't one of the stat block's
 * matched features), so the module finds the game system's own "Spellcasting" feat to
 * clone rather than only ever hand-building a bare one.
 */
async function findCompendiumItemByName(name, type = null) {
  const target = String(name).trim().toLowerCase();
  for (const pack of game.packs) {
    if (pack.documentName !== 'Item') continue;
    let index;
    try {
      index = await pack.getIndex({ fields: ['type'] });
    } catch (err) {
      continue;
    }
    const entry = index.find(
      (e) => (e.name || '').toLowerCase() === target && (type === null || e.type === type)
    );
    if (entry) {
      const doc = await pack.getDocument(entry._id);
      if (doc) {
        const data = doc.toObject();
        delete data._id;
        return data;
      }
    }
  }
  return null;
}

/**
 * Builds the "Spellcasting" feature Item from GR's structured spellcasting summary
 * (`npc.spellcasting.description`). Prefers to clone the game system's own
 * "Spellcasting" feat from a compendium — so it carries whatever the system defines
 * (icon, subtype, any activities) and looks like a native monster-feature rather than
 * a bare hand-built one — and overrides only its description with GR's summary text.
 * Falls back to a plain feat built from scratch when no such compendium entry exists
 * (e.g. the DM hasn't the system's features pack installed).
 *
 * GR's summary is plain textarea text (not the rich-text editor other feature
 * descriptions use), so it's escaped and newline-converted before being used as HTML.
 */
async function spellcastingSummaryItemData(description) {
  const html = escapeHtml(description).replace(/\n/g, '<br>');
  const cloned = await findCompendiumItemByName('Spellcasting', 'feat');
  if (cloned) {
    cloned.system = cloned.system || {};
    cloned.system.description = { ...(cloned.system.description || {}), value: html };
    return cloned;
  }
  return featureItemData({ name: 'Spellcasting', description: html }, null);
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
 * Populates a module <select> from the connected GR world — shared by every "pick a
 * module first" tab in the Import Hub (Stage 15: Encounters, Handouts, Tables,
 * Adventure). `resultPromise`, if given, is used instead of starting a fresh
 * `fetchModuleList()` — the hub opens all four of those tabs at once and passes the
 * same in-flight promise to each, so the module list is fetched once, not four times.
 * @returns {Promise<boolean>} true if at least one module was loaded
 */
async function populateModuleSelect(select, status, emptyMessage, readyMessage, resultPromise = null) {
  const result = await (resultPromise ?? fetchModuleList());
  if (!result.ok) {
    status.text(`✘ ${result.error}`).css('color', '#c62828');
    return false;
  }

  const modules = result.body.modules || [];
  select.empty();
  if (modules.length === 0) {
    select.append('<option value="">No modules in this world</option>');
    status.text(emptyMessage);
    return false;
  }

  select.append('<option value="">Choose a module…</option>');
  modules.forEach((m) => select.append(`<option value="${m.id}">${escapeHtml(m.title)}</option>`));
  select.prop('disabled', false);
  status.text(readyMessage);
  return true;
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
 * touch the Actor's folder, ownership, active effects, or prototype token config
 * beyond its texture (Stage 15: `prototypeToken.texture.src`, from `token_media_id` —
 * a merge-update, so disposition/scale/ring/etc. are untouched) — those are
 * Foundry-side state GR has no opinion on, left alone by simply never including them
 * in the update payload.
 *
 * Stage 14: if the payload carries a structured `spellcasting` profile, its ability is
 * set on the Actor, its `description` (if any) becomes a "Spellcasting" feature Item
 * — cloned from the game system's own "Spellcasting" feat if a compendium has one
 * (see `spellcastingSummaryItemData()`/`findCompendiumItemByName()`), so it looks
 * like a native monster feature rather than a bare hand-built one — and any
 * exactly-matched `spells` are cloned as real Items alongside the features/items
 * above; see `spellcastingBonuses()` for how a printed DC/attack override is applied,
 * and `applySpellUsage()` for how each spell's `usage_type` (plain slot / Pact Magic
 * / At Will / X-per-day Innate) maps onto Foundry's preparation modes so it lands in
 * the right sheet section. `spellcasting.caster_level` (1-20) sets
 * `system.details.spellLevel`, dnd5e's automatic spell-slot-table field. Separately,
 * `npc.saving_throw_proficiencies` (always present, not spellcasting-specific) sets
 * `abilities.*.proficient` on every ability — explicit per-ability checkboxes on the
 * GR side, independent of the free-text `saving_throws` line.
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

  // Stage 15: npc.token_media_id is already GR's resolved choice (the stat block's own
  // token image, or the entry's featured image as a fallback — see
  // FoundryExport::toPreparePayload()) — no fallback logic needed here. When it's the
  // same media id as the portrait (the common no-dedicated-token-image case),
  // uploadIconToFoundry()'s shared iconCache means this doesn't re-upload the file.
  let tokenPath = null;
  if (npc.token_media_id) {
    onProgress?.('Uploading token image…');
    tokenPath = await uploadIconToFoundry(npc.token_media_id, iconCache);
  }

  const abilities = {};
  for (const [key, value] of Object.entries(npc.abilities || {})) {
    abilities[key] = { value, proficient: npc.saving_throw_proficiencies?.[key] ? 1 : 0 };
  }

  const systemData = {
    abilities,
    attributes: {
      ac: { calc: 'flat', flat: npc.armor_class },
      hp: { value: npc.hit_points, max: npc.hit_points, formula: npc.hit_dice },
      movement: parseMovement(npc.speed),
      senses: parseSenses(npc.senses),
      ...(npc.spellcasting?.ability ? { spellcasting: npc.spellcasting.ability } : {}),
    },
    details: {
      alignment: npc.alignment,
      cr: crToDecimal(npc.challenge_rating),
      type: { value: (npc.type || '').toLowerCase(), subtype: npc.subtype || '' },
      // dnd5e's NPC sheet uses this to auto-compute a standard spell-slot table —
      // best-effort mapping (not verified against a live world); worth checking the
      // Actor's spell slots after import.
      ...(npc.spellcasting?.caster_level ? { spellLevel: npc.spellcasting.caster_level } : {}),
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

  // Stage 14: a printed DC/attack override becomes the *delta* from the standard
  // formula (see spellcastingBonuses() above), applied as dnd5e's bonus-formula fields
  // — there's no raw override field to just set. Left off entirely when the DM hasn't
  // set an override, so Foundry's own derivation from `attributes.spellcasting` stands.
  const spellBonus = spellcastingBonuses(npc);
  if (spellBonus.dc || spellBonus.attack) {
    systemData.bonuses = {
      ...(spellBonus.dc ? { spell: { dc: spellBonus.dc } } : {}),
      ...(spellBonus.attack ? { msak: { attack: spellBonus.attack }, rsak: { attack: spellBonus.attack } } : {}),
    };
  }

  const flags = syncInfo
    ? { [MODULE_ID]: { grEntryId: syncInfo.entryId, grContentHash: syncInfo.contentHash, grSyncedAt: new Date().toISOString() } }
    : undefined;

  let actor;
  if (existingActor) {
    onProgress?.('Updating actor…');
    await existingActor.update({
      name: npc.name,
      ...(portraitPath ? { img: portraitPath } : {}),
      ...(tokenPath ? { prototypeToken: { texture: { src: tokenPath } } } : {}),
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
      ...(tokenPath ? { prototypeToken: { texture: { src: tokenPath } } } : {}),
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

  // Stage 14 follow-up: the spellcasting summary (GR's plain-text description of
  // ability/DC/slots/etc.) becomes its own "Spellcasting" feature Item, same as the
  // free-text spellcasting trait above already does — Foundry's Actor sheet has
  // nowhere else to put this prose. If a stat block still has the old free-text
  // trait too, both Items appear; that's expected during the transition (see GR's
  // Docs/STATBLOCKS.md "Spell list"), not a bug to work around here.
  if (npc.spellcasting?.description) {
    onProgress?.('Adding spellcasting summary…');
    const summaryItemData = await spellcastingSummaryItemData(npc.spellcasting.description);
    await actor.createEmbeddedDocuments('Item', [summaryItemData]);
  }

  // Stage 14: only exact compendium matches are cloned as real spell Items — an
  // unmatched name has no fresh-creation fallback (unlike features/items, GR doesn't
  // send enough to hand-build a valid spell) and is simply left out; the DM's existing
  // free-text "Spellcasting" trait (imported above as a regular feature, unaffected)
  // is still there either way, so nothing is lost — just surfaced so the DM can add a
  // matching compendium spell later if they want it to roll natively.
  const spells = npc.spells || [];
  let unmatchedSpells = 0;
  for (let i = 0; i < spells.length; i++) {
    onProgress?.(`Adding spells… (${i + 1}/${spells.length})`);
    const cloned = await resolveCompendiumItem(spells[i].compendium_ref);
    if (cloned) {
      applySpellUsage(cloned, spells[i]);
      await actor.createEmbeddedDocuments('Item', [cloned]);
    } else {
      unmatchedSpells++;
    }
  }
  if (unmatchedSpells > 0) {
    ui.notifications.warn(
      `Geektastic Realms Foundry Connect: ${unmatchedSpells} spell${unmatchedSpells === 1 ? '' : 's'} on "${npc.name}" had no exact compendium match and were not added as items — the free-text Spellcasting trait still has them.`
    );
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
 * The Geektastic Realms import hub (Stage 15) — one consolidated window replacing the
 * five separate dialogs Stages 5/10/11/12/13 used to register as their own Module
 * Settings menu entries (Create Actor, Deploy Encounter, Import Handouts, Import Roll
 * Tables, Import Adventure). Reachable from a Geektastic Realms button in the Actors
 * and Journal directory headers (see the renderActorDirectory/renderJournalDirectory
 * hooks below) rather than Settings — these are things a DM clicks repeatedly through
 * a session, not one-time configuration, so Settings now only holds Server URL/API
 * Token/Test Connection/Sync Compendiums, which really are settings.
 *
 * Uses FormApplicationBase's native tab support (`options.tabs`, wired up for free by
 * the base class's own activateListeners()) instead of five separate windows. Every
 * tab's markup and behavior is the exact same code the five original dialogs had —
 * only the outer shell changed, so this should behave identically to before, just
 * reachable from one place with five tabs instead of five menu entries. Each tab's DOM
 * queries are scoped to that tab's own container (a `tab` jQuery element passed into
 * every method below), never the whole dialog — several tabs reuse the same class
 * names (e.g. `.grfc-module-select` appears in four different tabs), so scoping is
 * what keeps them from colliding now that they all live in one document at once
 * (classic Application tabs hide inactive panels with CSS, not by removing them from
 * the DOM, so all five tabs' elements exist simultaneously, even hidden).
 */
class ImportHubForm extends FormApplicationBase {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'grfc-import-hub',
      title: 'Geektastic Realms',
      width: 680,
      height: 640,
      closeOnSubmit: false,
      resizable: true,
      tabs: [{ navSelector: '.grfc-hub-tabs', contentSelector: '.grfc-hub-content', initial: 'actors' }],
    });
  }

  getData() {
    return {};
  }

  async _renderInner() {
    const html = `
      <form class="grfc-import-hub" style="display:flex;flex-direction:column;height:100%;box-sizing:border-box;">
        <style>
          /* Defensive fallback in case core Foundry CSS doesn't reach this dialog for
             some reason — without this, an inactive tab showing would stack all five
             panels' content at once instead of switching between them. */
          .grfc-import-hub .tab:not(.active) { display: none; }
        </style>
        <nav class="grfc-hub-tabs tabs" data-group="primary" style="flex:0 0 auto;">
          <a class="item" data-tab="actors"><i class="fas fa-user-plus"></i> Actors</a>
          <a class="item" data-tab="encounters"><i class="fas fa-people-group"></i> Encounters</a>
          <a class="item" data-tab="handouts"><i class="fas fa-book-open"></i> Handouts</a>
          <a class="item" data-tab="tables"><i class="fas fa-dice-d20"></i> Tables</a>
          <a class="item" data-tab="adventure"><i class="fas fa-scroll"></i> Adventure</a>
        </nav>
        <section class="grfc-hub-content" style="flex:1 1 auto;overflow:hidden;padding-top:.5rem;">
          <div class="tab" data-tab="actors" data-group="primary" style="height:100%;display:flex;flex-direction:column;box-sizing:border-box;padding:0 .25rem;">
            ${this._actorsTabHtml()}
          </div>
          <div class="tab" data-tab="encounters" data-group="primary" style="height:100%;display:flex;flex-direction:column;box-sizing:border-box;padding:0 .25rem;">
            ${this._encountersTabHtml()}
          </div>
          <div class="tab" data-tab="handouts" data-group="primary" style="height:100%;display:flex;flex-direction:column;box-sizing:border-box;padding:0 .25rem;">
            ${this._handoutsTabHtml()}
          </div>
          <div class="tab" data-tab="tables" data-group="primary" style="height:100%;display:flex;flex-direction:column;box-sizing:border-box;padding:0 .25rem;">
            ${this._tablesTabHtml()}
          </div>
          <div class="tab" data-tab="adventure" data-group="primary" style="height:100%;display:flex;flex-direction:column;box-sizing:border-box;padding:0 .25rem;">
            ${this._adventureTabHtml()}
          </div>
        </section>
      </form>
    `;
    return $(html);
  }

  activateListeners(html) {
    super.activateListeners(html); // wires up tab-switching via options.tabs above

    // One shared modules fetch — Encounters/Handouts/Tables/Adventure all start with
    // "pick a module," so this avoids four independent GET .../modules calls firing
    // the instant the hub opens; populateModuleSelect() awaits this same promise four
    // times instead of each starting its own fetch.
    const modulesPromise = fetchModuleList();

    this._actorsActivate(html.find('[data-tab="actors"]'));
    this._encountersActivate(html.find('[data-tab="encounters"]'), modulesPromise);
    this._handoutsActivate(html.find('[data-tab="handouts"]'), modulesPromise);
    this._tablesActivate(html.find('[data-tab="tables"]'), modulesPromise);
    this._adventureActivate(html.find('[data-tab="adventure"]'), modulesPromise);
  }

  // ── Actors (Stage 5/9: create/re-sync an Actor from any GR stat block) ──────

  _actorsTabHtml() {
    return `
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
      <ul class="grfc-npc-list" style="list-style:none;margin:0;padding:0;flex:1 1 auto;overflow-y:auto"></ul>
    `;
  }

  _actorsActivate(tab) {
    this._actorsLoadList(tab);
    this._actorsPopulateFolders(tab);
    tab.find('.grfc-npc-search').on('input', () => this._actorsApplyFilters(tab));
    tab.find('.grfc-category-filter').on('change', () => this._actorsApplyFilters(tab));
  }

  /** Populates the target-folder dropdown from this world's Actor folders — purely local, no GR round-trip needed. */
  _actorsPopulateFolders(tab) {
    const select = tab.find('.grfc-folder-select');
    const folders = game.folders
      .filter((f) => f.type === 'Actor')
      .map((f) => ({ id: f.id, name: f.name, depth: f.depth || 1 }))
      .sort((a, b) => a.name.localeCompare(b.name));

    folders.forEach((f) => {
      const prefix = f.depth > 1 ? '—'.repeat(f.depth - 1) + ' ' : '';
      select.append(`<option value="${escapeHtml(f.id)}">${prefix}${escapeHtml(f.name)}</option>`);
    });
  }

  _actorsApplyFilters(tab) {
    const query = tab.find('.grfc-npc-search').val().trim().toLowerCase();
    const category = tab.find('.grfc-category-filter').val();
    const rows = tab.find('.grfc-npc-list > li');
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
    tab.find('#grfc-npc-status').text(
      filters.length === 0 ? `${total} available — click Create to build one here.` : `${visible} of ${total} match (${filters.join(', ')}).`
    );
  }

  async _actorsLoadList(tab) {
    const status = tab.find('#grfc-npc-status');
    const list = tab.find('.grfc-npc-list');
    const search = tab.find('.grfc-npc-search');
    const categoryFilter = tab.find('.grfc-category-filter');

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
          const folderId = tab.find('.grfc-folder-select').val();
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

  // ── Encounters (Stage 10: deploy a whole encounter roster) ──────────────────

  _encountersTabHtml() {
    return `
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
    `;
  }

  _encountersActivate(tab, modulesPromise) {
    this._encountersLoadModules(tab, modulesPromise);
    tab.find('.grfc-module-select').on('change', () => this._encountersLoadList(tab));
  }

  async _encountersLoadModules(tab, modulesPromise) {
    await populateModuleSelect(
      tab.find('.grfc-module-select'),
      tab.find('#grfc-encounter-status'),
      'No adventure modules found in this Geektastic Realms world.',
      'Choose a module to see its encounters.',
      modulesPromise
    );
  }

  async _encountersLoadList(tab) {
    const moduleId = tab.find('.grfc-module-select').val();
    const list = tab.find('.grfc-encounter-list');
    const status = tab.find('#grfc-encounter-status');
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

        const placeTokens = tab.find('.grfc-place-tokens').is(':checked');
        const createCombat = tab.find('.grfc-create-combat').is(':checked');
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

  // ── Handouts (Stage 11: import a module's handouts as Journal pages) ────────

  _handoutsTabHtml() {
    return `
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;">
        <label style="white-space:nowrap;color:var(--color-text-dark-secondary,#666);font-size:.85em;">Module:</label>
        <select class="grfc-module-select" style="flex:1 1 auto;min-width:0;" disabled>
          <option value="">Loading modules…</option>
        </select>
      </div>
      <p id="grfc-handouts-status" style="color:var(--color-text-dark-secondary,#666);margin:.25rem 0 .5rem;">Loading modules…</p>
      <ul class="grfc-handouts-list" style="list-style:none;margin:0;padding:0;flex:1 1 auto;overflow-y:auto"></ul>
      <button type="button" class="grfc-import-handouts-btn" style="margin-top:.5rem;" disabled>Import Handouts</button>
    `;
  }

  _handoutsActivate(tab, modulesPromise) {
    this._handoutsLoadModules(tab, modulesPromise);
    tab.find('.grfc-module-select').on('change', () => this._handoutsLoadList(tab));
    tab.find('.grfc-import-handouts-btn').on('click', () => this._handoutsDoImport(tab));
  }

  async _handoutsLoadModules(tab, modulesPromise) {
    await populateModuleSelect(
      tab.find('.grfc-module-select'),
      tab.find('#grfc-handouts-status'),
      'No adventure modules found in this Geektastic Realms world.',
      'Choose a module to see its handouts.',
      modulesPromise
    );
  }

  async _handoutsLoadList(tab) {
    const select = tab.find('.grfc-module-select');
    const moduleId = select.val();
    const list = tab.find('.grfc-handouts-list');
    const status = tab.find('#grfc-handouts-status');
    const importBtn = tab.find('.grfc-import-handouts-btn');
    list.empty();
    importBtn.prop('disabled', true);

    if (!moduleId) {
      status.text('Choose a module to see its handouts.');
      return;
    }

    status.text('Loading handouts…');
    const result = await fetchModuleHandouts(moduleId);
    if (!result.ok) {
      status.text(`✘ ${result.error}`).css('color', '#c62828');
      return;
    }

    const handouts = result.body.handouts || [];
    if (handouts.length === 0) {
      status.text('No handouts in this module.');
      return;
    }
    status.text(`${handouts.length} handout${handouts.length === 1 ? '' : 's'} in this module.`);

    const journal = findModuleJournal(moduleId);
    handouts.forEach((handout) => {
      const existingPage = journal?.pages.find((p) => p.getFlag(MODULE_ID, 'grHandoutId') === handout.id) ?? null;
      const isChanged = !!existingPage && existingPage.getFlag(MODULE_ID, 'grContentHash') !== handout.content_hash;
      const statusLabel = !existingPage ? 'New' : isChanged ? '↻ Changed' : '✓ Up to date';
      const statusColor = !existingPage ? 'var(--color-text-dark-secondary,#666)' : isChanged ? '#b26a00' : '#2e7d32';

      const li = $(`
        <li style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid #7773;">
          <span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            <strong>${escapeHtml(handout.title)}</strong>
            <span style="color:var(--color-text-dark-secondary,#666);font-size:.85em;">${handout.section_title ? ' — ' + escapeHtml(handout.section_title) : ''}</span>
          </span>
          <span style="flex:0 0 auto;font-size:.8em;color:${statusColor};white-space:nowrap;">${statusLabel}</span>
        </li>
      `);
      list.append(li);
    });

    importBtn.prop('disabled', false);
  }

  async _handoutsDoImport(tab) {
    const select = tab.find('.grfc-module-select');
    const moduleId = select.val();
    const moduleTitle = select.find('option:selected').text();
    const status = tab.find('#grfc-handouts-status');
    const importBtn = tab.find('.grfc-import-handouts-btn');
    if (!moduleId) return;

    importBtn.prop('disabled', true);
    status.css('color', '');

    const result = await fetchModuleHandouts(moduleId);
    if (!result.ok) {
      status.text(`✘ ${result.error}`).css('color', '#c62828');
      importBtn.prop('disabled', false);
      return;
    }

    const handouts = result.body.handouts || [];
    const { journal, created, updated, unchanged, failed } = await importHandouts(
      moduleId,
      moduleTitle,
      handouts,
      (msg) => status.text(msg)
    );

    const parts = [];
    if (created) parts.push(`${created} created`);
    if (updated) parts.push(`${updated} updated`);
    if (unchanged) parts.push(`${unchanged} already up to date`);
    const summary = parts.length ? parts.join(', ') : 'nothing to import';

    if (failed.length === 0) {
      status.text(`✔ Done — ${summary}.`).css('color', '#2e7d32');
      ui.notifications.info(`Geektastic Realms Foundry Connect: imported handouts for "${moduleTitle}" (${summary}).`);
    } else {
      status.text(`⚠ ${summary}, ${failed.length} failed`).attr('title', failed.map((f) => `${f.name}: ${f.error}`).join('\n')).css('color', '#b26a00');
      ui.notifications.warn(`Geektastic Realms Foundry Connect: imported handouts for "${moduleTitle}" (${summary}) with ${failed.length} failure(s).`);
    }

    journal?.sheet?.render(true);
    importBtn.prop('disabled', false);
    await this._handoutsLoadList(tab);
  }

  // ── Tables (Stage 12: import a module's roll tables as native RollTables) ───

  _tablesTabHtml() {
    return `
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;">
        <label style="white-space:nowrap;color:var(--color-text-dark-secondary,#666);font-size:.85em;">Module:</label>
        <select class="grfc-module-select" style="flex:1 1 auto;min-width:0;" disabled>
          <option value="">Loading modules…</option>
        </select>
      </div>
      <p id="grfc-roll-tables-status" style="color:var(--color-text-dark-secondary,#666);margin:.25rem 0 .5rem;">Loading modules…</p>
      <ul class="grfc-roll-tables-list" style="list-style:none;margin:0;padding:0;flex:1 1 auto;overflow-y:auto"></ul>
      <button type="button" class="grfc-import-roll-tables-btn" style="margin-top:.5rem;" disabled>Import Roll Tables</button>
    `;
  }

  _tablesActivate(tab, modulesPromise) {
    this._tablesLoadModules(tab, modulesPromise);
    tab.find('.grfc-module-select').on('change', () => this._tablesLoadList(tab));
    tab.find('.grfc-import-roll-tables-btn').on('click', () => this._tablesDoImport(tab));
  }

  async _tablesLoadModules(tab, modulesPromise) {
    await populateModuleSelect(
      tab.find('.grfc-module-select'),
      tab.find('#grfc-roll-tables-status'),
      'No adventure modules found in this Geektastic Realms world.',
      'Choose a module to see its roll tables.',
      modulesPromise
    );
  }

  async _tablesLoadList(tab) {
    const moduleId = tab.find('.grfc-module-select').val();
    const list = tab.find('.grfc-roll-tables-list');
    const status = tab.find('#grfc-roll-tables-status');
    const importBtn = tab.find('.grfc-import-roll-tables-btn');
    list.empty();
    importBtn.prop('disabled', true);

    if (!moduleId) {
      status.text('Choose a module to see its roll tables.');
      return;
    }

    status.text('Loading roll tables…');
    const result = await fetchModuleRollTables(moduleId);
    if (!result.ok) {
      status.text(`✘ ${result.error}`).css('color', '#c62828');
      return;
    }

    const rollTables = result.body.roll_tables || [];
    if (rollTables.length === 0) {
      status.text('No roll tables in this module.');
      return;
    }
    status.text(`${rollTables.length} roll table${rollTables.length === 1 ? '' : 's'} in this module.`);

    const synced = syncedRollTablesByGrId();
    rollTables.forEach((table) => {
      const existing = synced.get(table.id) || null;
      const isChanged = !!existing && existing.getFlag(MODULE_ID, 'grContentHash') !== table.content_hash;
      const statusLabel = !existing ? 'New' : isChanged ? '↻ Changed' : '✓ Up to date';
      const statusColor = !existing ? 'var(--color-text-dark-secondary,#666)' : isChanged ? '#b26a00' : '#2e7d32';

      const li = $(`
        <li style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid #7773;">
          <span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            <strong>${escapeHtml(table.title)}</strong>
            <span style="color:var(--color-text-dark-secondary,#666);font-size:.85em;"> — ${escapeHtml(table.die)}, ${table.rows.length} row${table.rows.length === 1 ? '' : 's'}${table.section_title ? ' — ' + escapeHtml(table.section_title) : ''}</span>
          </span>
          <span style="flex:0 0 auto;font-size:.8em;color:${statusColor};white-space:nowrap;">${statusLabel}</span>
        </li>
      `);
      list.append(li);
    });

    importBtn.prop('disabled', false);
  }

  async _tablesDoImport(tab) {
    const moduleId = tab.find('.grfc-module-select').val();
    const status = tab.find('#grfc-roll-tables-status');
    const importBtn = tab.find('.grfc-import-roll-tables-btn');
    if (!moduleId) return;

    importBtn.prop('disabled', true);
    status.css('color', '');

    const result = await fetchModuleRollTables(moduleId);
    if (!result.ok) {
      status.text(`✘ ${result.error}`).css('color', '#c62828');
      importBtn.prop('disabled', false);
      return;
    }

    const rollTables = result.body.roll_tables || [];
    const synced = syncedRollTablesByGrId();

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const failed = [];

    for (let i = 0; i < rollTables.length; i++) {
      const table = rollTables[i];
      const existing = synced.get(table.id) || null;
      if (existing && existing.getFlag(MODULE_ID, 'grContentHash') === table.content_hash) {
        unchanged++;
        continue;
      }
      try {
        const doc = await importRollTable(table, existing, (msg) => status.text(`(${i + 1}/${rollTables.length}) ${msg}`));
        synced.set(table.id, doc);
        if (existing) updated++;
        else created++;
      } catch (err) {
        failed.push({ name: table.title, error: err.message });
      }
    }

    const parts = [];
    if (created) parts.push(`${created} created`);
    if (updated) parts.push(`${updated} updated`);
    if (unchanged) parts.push(`${unchanged} already up to date`);
    const summary = parts.length ? parts.join(', ') : 'nothing to import';

    if (failed.length === 0) {
      status.text(`✔ Done — ${summary}.`).css('color', '#2e7d32');
      ui.notifications.info(`Geektastic Realms Foundry Connect: imported roll tables (${summary}).`);
    } else {
      status.text(`⚠ ${summary}, ${failed.length} failed`).attr('title', failed.map((f) => `${f.name}: ${f.error}`).join('\n')).css('color', '#b26a00');
      ui.notifications.warn(`Geektastic Realms Foundry Connect: imported roll tables (${summary}) with ${failed.length} failure(s).`);
    }

    importBtn.prop('disabled', false);
    await this._tablesLoadList(tab);
  }

  // ── Adventure (Stage 13: import a whole module as one structured Journal) ───

  _adventureTabHtml() {
    return `
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;">
        <label style="white-space:nowrap;color:var(--color-text-dark-secondary,#666);font-size:.85em;">Module:</label>
        <select class="grfc-module-select" style="flex:1 1 auto;min-width:0;" disabled>
          <option value="">Loading modules…</option>
        </select>
      </div>
      <div class="grfc-adventure-preview" style="flex:1 1 auto;overflow-y:auto;color:var(--color-text-dark-secondary,#666);font-size:.9em;line-height:1.5;"></div>
      <p id="grfc-adventure-status" style="color:var(--color-text-dark-secondary,#666);margin:.5rem 0;">Loading modules…</p>
      <button type="button" class="grfc-import-adventure-btn" style="margin-top:.5rem;" disabled>Import Adventure</button>
    `;
  }

  _adventureActivate(tab, modulesPromise) {
    this._adventureLoadModules(tab, modulesPromise);
    tab.find('.grfc-module-select').on('change', () => this._adventureLoadPreview(tab));
    tab.find('.grfc-import-adventure-btn').on('click', () => this._adventureDoImport(tab));
  }

  async _adventureLoadModules(tab, modulesPromise) {
    await populateModuleSelect(
      tab.find('.grfc-module-select'),
      tab.find('#grfc-adventure-status'),
      'No adventure modules found in this Geektastic Realms world.',
      'Choose a module to import.',
      modulesPromise
    );
  }

  async _adventureLoadPreview(tab) {
    const moduleId = tab.find('.grfc-module-select').val();
    const preview = tab.find('.grfc-adventure-preview');
    const status = tab.find('#grfc-adventure-status');
    const importBtn = tab.find('.grfc-import-adventure-btn');
    preview.empty();
    importBtn.prop('disabled', true);

    if (!moduleId) {
      status.text('Choose a module to import.');
      return;
    }

    status.text('Loading adventure…');
    const result = await fetchModulePrepare(moduleId);
    if (!result.ok) {
      status.text(`✘ ${result.error}`).css('color', '#c62828');
      return;
    }

    const mod = result.body.module;
    const sectionCount = flattenSectionTree(result.body.sections).length;
    preview.html(`
      <p><strong>${escapeHtml(mod.title)}</strong></p>
      <p>${escapeHtml(mod.summary || 'No summary.')}</p>
      <p>${sectionCount} section${sectionCount === 1 ? '' : 's'} will become pages of one Journal Entry, alongside any handouts already imported for this module.</p>
    `);
    status.text('Ready to import.').css('color', '');
    importBtn.prop('disabled', false);
  }

  async _adventureDoImport(tab) {
    const moduleId = tab.find('.grfc-module-select').val();
    const status = tab.find('#grfc-adventure-status');
    const importBtn = tab.find('.grfc-import-adventure-btn');
    if (!moduleId) return;

    importBtn.prop('disabled', true);
    status.css('color', '');

    try {
      const { journal, created, updated, unchanged } = await importAdventure(moduleId, (msg) => status.text(msg));
      const parts = [];
      if (created) parts.push(`${created} created`);
      if (updated) parts.push(`${updated} updated`);
      if (unchanged) parts.push(`${unchanged} already up to date`);
      const summary = parts.length ? parts.join(', ') : 'nothing to import';

      status.text(`✔ Done — ${summary}.`).css('color', '#2e7d32');
      ui.notifications.info(`Geektastic Realms Foundry Connect: imported adventure "${journal.name}" (${summary}).`);
      journal.sheet.render(true);
    } catch (err) {
      status.text(`✘ ${err.message}`).css('color', '#c62828');
      ui.notifications.error(`Geektastic Realms Foundry Connect: failed to import adventure — ${err.message}`);
    } finally {
      importBtn.prop('disabled', false);
    }
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

  // Stage 15: Create Actor / Deploy Encounter / Import Handouts / Import Roll Tables /
  // Import Adventure used to each be their own Settings menu entry here. They're
  // things a DM clicks repeatedly through a session, not one-time configuration, so
  // they moved to the Geektastic Realms button in the Actors/Journal directory
  // headers (ImportHubForm, and the renderActorDirectory/renderJournalDirectory hooks
  // below) — Settings now only holds what's actually settings.
});

/**
 * Adds a "Geektastic Realms" button to a sidebar directory's header (Stage 15) —
 * opens the consolidated import hub (ImportHubForm above). Targets
 * `.directory-header .action-buttons`, the row Foundry's own "Create Folder"/
 * "Create Actor" buttons live in, with two fallback levels (appending to
 * `.directory-header` itself, then to the directory root) so the button still shows
 * up somewhere even if that specific container isn't found — not verified against a
 * live world, so worth confirming the button actually appears and lands somewhere
 * sensible. Wraps `html` in `$()` defensively in case a future Foundry version passes
 * a raw element to this hook instead of a jQuery object, the way classic-Application
 * render hooks have always done.
 */
function addImportHubButton(html) {
  const $html = html instanceof jQuery ? html : $(html);

  const button = $(
    '<button type="button" class="grfc-hub-button" title="Open the Geektastic Realms import hub"><i class="fas fa-dragon"></i> Geektastic Realms</button>'
  );
  button.on('click', (event) => {
    event.preventDefault();
    new ImportHubForm().render(true);
  });

  const actions = $html.find('.directory-header .action-buttons');
  const header = $html.find('.directory-header');
  if (actions.length) {
    actions.append(button);
  } else if (header.length) {
    header.append(button);
  } else {
    $html.prepend(button);
  }
}

Hooks.on('renderActorDirectory', (app, html) => addImportHubButton(html));
Hooks.on('renderJournalDirectory', (app, html) => addImportHubButton(html));

Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | ready`);
});
