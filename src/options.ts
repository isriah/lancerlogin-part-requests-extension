import './styles.css';
import { VENDORS } from './vendors';
import type { Configuration } from './types';
import { choices, el, errorText, notice, send, UiError } from './ui';

interface RecipientResult { config: Configuration; recipientSummary: string; recipientLookupFailed: boolean }
let config: Configuration | undefined;
const token = el<HTMLInputElement>('token');
const database = el<HTMLInputElement>('database-url');
const source = el<HTMLSelectElement>('data-source');
for (const vendor of VENDORS) { const li = document.createElement('li'); li.textContent = vendor.label; el('vendor-list').append(li); }
function render(): void {
  el('defaults-card').hidden = !config;
  el('disconnect').hidden = !config;
  el('connection-state').textContent = config ? 'CONNECTED' : 'NOT CONNECTED';
  if (!config) return;
  database.value = config.databaseUrl;
  token.placeholder = 'Token saved. Leave blank to keep it.';
  choices(el('default-team'), config.schema.properties.team.options || [], config.defaultTeam, 'Choose your team');
  choices(el('default-recipient'), config.people, config.defaultRecipient, 'Choose yourself');
}
el<HTMLFormElement>('connection-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = el<HTMLButtonElement>('test-connection'); button.disabled = true; notice('Checking the database and its fields...');
  try {
    const result = await send<RecipientResult>({ type: 'connect', token: token.value, databaseUrl: database.value, dataSourceId: source.value || undefined });
    config = result.config;
    token.value = ''; el('source-row').hidden = true; render(); notice(`Connected. ${result.recipientSummary} Choose your default team and recipient below.`, result.recipientLookupFailed ? 'error' : 'success');
  } catch (error) {
    notice(errorText(error), 'error');
    if (error instanceof UiError && error.code === 'data_source' && Array.isArray(error.details)) {
      choices(source, error.details, '', 'Choose the ordering data source'); el('source-row').hidden = false;
    }
  } finally { button.disabled = false; }
});
database.addEventListener('input', () => { source.replaceChildren(); el('source-row').hidden = true; });
el<HTMLFormElement>('defaults-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { config = await send<Configuration>({ type: 'save-settings', defaultTeam: el<HTMLSelectElement>('default-team').value, defaultRecipient: el<HTMLSelectElement>('default-recipient').value }); render(); notice('Defaults saved. Open a product page and click the extension.', 'success'); }
  catch (error) { notice(errorText(error), 'error'); }
});
el<HTMLFormElement>('import-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = el<HTMLButtonElement>('import'); button.disabled = true;
  try {
    const result = await send<{ config: Configuration; imported: { name: string }[] }>({ type: 'import-people', pageUrl: el<HTMLInputElement>('request-url').value });
    config = result.config; render(); notice(`Found ${result.imported.map(p => p.name).join(', ')}. Choose the right person and save your defaults.`, 'success');
  } catch (error) { notice(errorText(error), 'error'); } finally { button.disabled = false; }
});
el('disconnect').addEventListener('click', async () => { try { await send({ type: 'disconnect' }); config = undefined; token.value = ''; token.placeholder = 'Enter the coach-created token'; render(); notice('Disconnected. The token was removed from this extension. Revoke it in Notion if it is no longer needed.'); } catch (error) { notice(errorText(error), 'error'); } });
// Keep the recipient list current without a button. Choices made while this runs are preserved.
async function refreshRecipients(): Promise<void> {
  const result = await send<RecipientResult>({ type: 'refresh-people' });
  if (!result.config) return;
  const team = el<HTMLSelectElement>('default-team').value;
  const recipient = el<HTMLSelectElement>('default-recipient').value;
  config = result.config; render();
  if (team) el<HTMLSelectElement>('default-team').value = team;
  if (recipient) el<HTMLSelectElement>('default-recipient').value = recipient;
  if (result.recipientSummary && (result.recipientLookupFailed || !el('notice').textContent)) notice(result.recipientSummary, result.recipientLookupFailed ? 'error' : '');
}
send<{ config?: Configuration }>({ type: 'settings' }).then(async result => {
  config = result.config; render();
  if (config) await refreshRecipients();
}).catch(error => notice(errorText(error)));
