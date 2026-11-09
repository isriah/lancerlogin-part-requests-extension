import './styles.css';
import { manifestAllowsLocalHttp, normalizePin, normalizeSiteAddress, originPattern } from './pairing';
import { VENDORS } from './vendors';
import type { SettingsView } from './types';
import { choices, el, errorText, notice, send, UiError } from './ui';

let settings: SettingsView = { pairing: 'unpaired', defaultTeam: '' };
const address = el<HTMLInputElement>('site-address');
const pin = el<HTMLInputElement>('pin');
const label = el<HTMLInputElement>('device-label');
for (const vendor of VENDORS) { const li = document.createElement('li'); li.textContent = vendor.label; el('vendor-list').append(li); }
el('version').textContent = globalThis.chrome?.runtime?.getManifest?.().version ?? '';

function render(): void {
  const isPaired = settings.pairing === 'paired';
  el('pair-form').hidden = isPaired;
  el('paired-card').hidden = !isPaired;
  el('defaults-card').hidden = !isPaired || !settings.options;
  el('capture-step').textContent = el('defaults-card').hidden ? '02' : '03';
  el('pairing-state').textContent = isPaired ? 'PAIRED' : settings.pairing === 'expired' ? 'PAIR AGAIN' : 'NOT PAIRED';
  if (settings.origin && !address.value) address.value = settings.origin;
  if (settings.deviceLabel && !label.value) label.value = settings.deviceLabel;
  if (!isPaired) return;
  el('paired-member').textContent = settings.memberName || settings.options?.memberName || 'Team member';
  el('paired-origin').textContent = settings.origin || '';
  el('paired-label').textContent = settings.deviceLabel || 'Browser extension';
  if (!settings.options) return;
  choices(el('default-team'), settings.options.teams, el<HTMLSelectElement>('default-team').value || settings.defaultTeam, 'Choose your team');
  choices(el('default-recipient'), settings.options.recipients, el<HTMLSelectElement>('default-recipient').value || settings.options.defaultRecipientId || '', 'Choose your name');
  el('recipients-state').textContent = settings.options.recipients.length ? 'Missing your name? Ask an Admin to refresh the recipient list.' : 'The recipient list is still empty. It refreshes on its own every few hours, or an Admin can refresh it now.';
}
el<HTMLFormElement>('pair-form').addEventListener('submit', event => {
  event.preventDefault();
  let origin: string; let code: string;
  try { origin = normalizeSiteAddress(address.value, manifestAllowsLocalHttp(chrome.runtime.getManifest())); code = normalizePin(pin.value); }
  catch (error) { notice(errorText(error), 'error'); return; }
  const button = el<HTMLButtonElement>('pair');
  // Chrome only shows the prompt during this click, so nothing may be awaited before this request.
  const asked = chrome.permissions.request({ origins: [originPattern(origin)] });
  button.disabled = true;
  notice(`Asking Chrome for permission to reach ${origin}...`);
  void asked.then(async granted => {
    if (!granted) { notice(`You chose Deny, so Chrome did not give this extension access to ${origin}. Nothing was paired and your PIN was not used. Click Pair this device again and choose Allow.`, 'error'); return; }
    notice('Pairing...');
    settings = await send<SettingsView>({ type: 'pair', origin, pin: code, deviceLabel: label.value });
    pin.value = ''; render();
    notice(`Paired as ${settings.memberName || 'a team member'}. Choose your defaults, then open a product page and click the extension.`, 'success');
    if (!settings.options) await refresh();
  }).catch(error => notice(errorText(error), 'error')).finally(() => { button.disabled = false; });
});
el<HTMLFormElement>('defaults-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    settings = await send<SettingsView>({ type: 'save-defaults', defaultTeam: el<HTMLSelectElement>('default-team').value, defaultRecipient: el<HTMLSelectElement>('default-recipient').value });
    render(); notice('Defaults saved. Open a product page and click the extension.', 'success');
  } catch (error) { await expiredCheck(error); }
});
el('unpair').addEventListener('click', async () => {
  if (!confirm('Unpair this device? This only forgets the key on this computer. To pair again you need a new PIN from /ordering-pin. Drafts are kept.')) return;
  try {
    settings = await send<SettingsView>({ type: 'unpair' });
    address.value = ''; label.value = ''; render();
    notice('Unpaired. This computer no longer has the key. It stays on your team\'s device list until an Admin removes it.');
  } catch (error) { notice(errorText(error), 'error'); }
});
async function expiredCheck(error: unknown): Promise<void> {
  notice(errorText(error), 'error');
  if (error instanceof UiError && error.code === 'pair_again') {
    settings = await send<SettingsView>({ type: 'settings' }); render();
    notice('This device is no longer paired. It may have been removed by an Admin, or you may have left the roster. Run /ordering-pin in Discord and pair it again. Your drafts are kept.', 'error');
  }
}
/** Keep the lists current without a button. Choices made while this runs are preserved. */
async function refresh(): Promise<void> {
  try { settings = await send<SettingsView>({ type: 'refresh-options' }); render(); }
  catch (error) { await expiredCheck(error); }
}
send<SettingsView>({ type: 'settings' }).then(async value => {
  settings = value; render();
  if (settings.pairing === 'paired') await refresh();
  else if (settings.pairing === 'expired') notice('This device is no longer paired. Run /ordering-pin in Discord and pair it again. Your drafts are kept.', 'error');
}).catch(error => notice(errorText(error)));
