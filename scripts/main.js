/**
 * Geektastic Realms Foundry Connect — Stage 2 (module skeleton + handshake).
 *
 * Registers the server URL / API token this world uses to reach a Geektastic
 * Realms instance, and a "Test Connection" action that calls
 * GET {url}/api/foundry/v1/ping (see Docs/FOUNDRY_API.md in the geektastic-realms
 * repo for the full API contract as it grows stage by stage).
 *
 * Deliberately built against the classic FormApplication/Application v1 API rather
 * than v13's newer ApplicationV2 — v1 remains supported via Foundry's compatibility
 * layer and is the better-documented, less version-fragile choice for a module this
 * small. Revisit if/when ApplicationV2 becomes the only supported path.
 */

const MODULE_ID = 'geektastic-realms-foundry-connect';

/** Minimal HTML escaping for the values we interpolate into the dialog markup. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/**
 * Calls the Geektastic Realms ping endpoint with the configured server URL/token.
 * @returns {Promise<{ok: true, settingName: string, version: string} | {ok: false, error: string}>}
 */
async function testConnection() {
  const serverUrl = (game.settings.get(MODULE_ID, 'serverUrl') || '').trim().replace(/\/+$/, '');
  const token = (game.settings.get(MODULE_ID, 'apiToken') || '').trim();

  if (!serverUrl || !token) {
    return { ok: false, error: 'Set both the Server URL and API Token first.' };
  }

  let response;
  try {
    response = await fetch(`${serverUrl}/api/foundry/v1/ping`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    return { ok: false, error: `Network error reaching ${serverUrl}: ${err.message}` };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    return { ok: false, error: body?.error || `HTTP ${response.status} from server` };
  }

  return {
    ok: true,
    settingName: body.setting?.name ?? 'unknown world',
    version: body.gr_version ?? '?',
  };
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
});

Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | ready`);
});
