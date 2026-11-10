import './styles.css';
import { applyAppearance } from './appearance';
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY, brandTokens } from './brand';
import { allStoreOrigins, originsToGiveBack } from './carts/registry';
import { manifestAllowsLocalHttp, normalizePin, normalizeSiteAddress, originPattern } from './pairing';
import { VENDORS } from './vendors';
import type { SettingsView, UnpairView } from './types';
import { asUpdateView, choices, el, errorText, linkExtensionsPage, newerRelease, notice, send, showUpdateNotice, UiError } from './ui';
import type { UpdateView } from './updates';

let settings: SettingsView = { pairing: 'unpaired', defaultTeam: '' };
const address = el<HTMLInputElement>('site-address');
const pin = el<HTMLInputElement>('pin');
const label = el<HTMLInputElement>('device-label');
const express = el<HTMLInputElement>('express-enabled');
const carts = el<HTMLInputElement>('carts-enabled');
for (const vendor of VENDORS) { const li = document.createElement('li'); li.textContent = vendor.label; el('vendor-list').append(li); }
const version = globalThis.chrome?.runtime?.getManifest?.().version ?? '';
el('version').textContent = version;
let update: UpdateView | undefined;
renderRelease();

function showSwatch(id: string, name: string, color: string, text: string): void {
  const swatch = el(id);
  swatch.textContent = `${name} ${color.toUpperCase()}`;
  swatch.style.setProperty('--swatch-background', color);
  swatch.style.setProperty('--swatch-text', text);
}
function checkedText(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return date.toDateString() === new Date().toDateString() ? `today at ${time}` : `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${time}`;
}
/** The installed version and the newest release as last checked, in the header, and how to update when there's one. */
function renderRelease(): void {
  const release = newerRelease(update);
  const state = el('release-state');
  state.textContent = release ? `v${version} · Update available` : update?.checkedAt ? `v${version} · Up to date` : `v${version}`;
  state.classList.toggle('pill-neutral', !update?.checkedAt);
  if (release) state.dataset.tone = 'warning'; else if (update?.checkedAt) state.dataset.tone = 'success'; else delete state.dataset.tone;
  state.title = `${update?.checkedAt ? `Last checked ${checkedText(update.checkedAt)}. ` : ''}Once a day this asks GitHub whether a newer release exists. It sends nothing about you or your team.`;
  el('release-notice').hidden = !release;
  if (!release) return;
  el('release-title').textContent = `Update available: v${release.version} (you have v${version})`;
  el<HTMLAnchorElement>('release-download').href = release.url;
}
el('release-check').addEventListener('click', async () => {
  const button = el<HTMLButtonElement>('release-check');
  const before = update?.checkedAt;
  button.disabled = true; button.textContent = 'Checking...';
  try {
    update = asUpdateView(await send({ type: 'update-check' })) ?? update;
    renderRelease();
    // An update already has its own notice, with the link and the steps.
    if (!update?.checkedAt || update.checkedAt === before) notice('GitHub could not be reached just now. Try again later.', 'warning');
    else notice(newerRelease(update) ? '' : `v${version} is the latest release.`, 'success');
  } catch { notice('GitHub could not be reached just now. Try again later.', 'warning'); }
  finally { button.disabled = false; button.textContent = 'Check for updates'; }
});
linkExtensionsPage(el('release-extensions'));
send({ type: 'update-status' }).then(value => { update = asUpdateView(value); renderRelease(); }).catch(() => renderRelease());
function renderBrand(): void {
  const brand = settings.brand;
  const primary = brand?.primary || DEFAULT_PRIMARY, secondary = brand?.secondary || DEFAULT_SECONDARY;
  const tokens = brandTokens(primary, secondary, settings.theme === 'light' ? 'light' : 'dark');
  showSwatch('swatch-primary', 'Primary', primary, tokens['--on-primary']);
  showSwatch('swatch-secondary', 'Secondary', secondary, tokens['--on-secondary']);
  el('brand-checked').textContent = brand
    ? `Colors come from your team's LancerLogin site. Checked ${checkedText(brand.checkedAt)}.`
    : 'Using LancerLogin\'s default colors until your team\'s site answers.';
  el('paired-team-row').hidden = !brand;
  el('paired-team').textContent = brand?.organizationName || '';
}
function render(): void {
  applyAppearance(settings);
  const isPaired = settings.pairing === 'paired';
  const light = settings.theme === 'light';
  el('theme-toggle').setAttribute('aria-checked', String(light));
  showUpdateNotice(settings.options);
  el('default-colors-notice').hidden = !!settings.brand;
  el('pair-form').hidden = isPaired;
  el('paired-card').hidden = !isPaired;
  const hasLists = isPaired && !!settings.options;
  el('defaults-card').hidden = !hasLists;
  el('defaults-placeholder').hidden = hasLists;
  el('defaults-placeholder').firstElementChild!.textContent = isPaired ? 'Your team\'s lists haven\'t loaded yet. Reopen this page in a moment.' : 'Pair this device first. Your team and your Notion name come from your team\'s site.';
  el('pairing-title').textContent = isPaired ? 'Paired' : settings.pairing === 'expired' ? 'Pair this device again' : 'Pair this device';
  const state = el('pairing-state');
  state.textContent = isPaired ? '✓ Paired' : settings.pairing === 'expired' ? 'Pair again' : 'Not paired';
  state.classList.toggle('pill-neutral', settings.pairing === 'unpaired');
  if (isPaired) state.dataset.tone = 'success'; else if (settings.pairing === 'expired') state.dataset.tone = 'warning'; else delete state.dataset.tone;
  express.disabled = !isPaired;
  express.checked = isPaired && settings.expressEnabled === true;
  // The Admin's switch hides Carts altogether. This device's own choice comes back if the Admin turns it on again.
  const allowed = settings.options?.cartsEnabled !== false;
  el('carts-setting').hidden = !allowed;
  carts.disabled = !isPaired;
  carts.checked = isPaired && settings.cartsEnabled === true;
  el('carts-open-row').hidden = !(isPaired && allowed && settings.cartsEnabled === true);
  el('settings-unpaired').hidden = isPaired;
  if (settings.origin && !address.value) address.value = settings.origin;
  if (settings.deviceLabel && !label.value) label.value = settings.deviceLabel;
  if (!isPaired) return;
  renderBrand();
  el('paired-member').textContent = settings.memberName || settings.options?.memberName || 'Team member';
  el('paired-origin').textContent = settings.origin ? new URL(settings.origin).host : '';
  el('paired-label').textContent = settings.deviceLabel || 'Browser extension';
  if (!settings.options) return;
  choices(el('default-team'), settings.options.teams, el<HTMLSelectElement>('default-team').value || settings.defaultTeam, 'Choose your team');
  choices(el('default-recipient'), settings.options.recipients, el<HTMLSelectElement>('default-recipient').value || settings.options.defaultRecipientId || '', 'Choose your name');
  el('recipients-state').textContent = settings.options.recipients.length ? 'Missing your name? Ask an Admin to refresh the recipient list.' : 'The recipient list is still empty. It refreshes on its own every few hours, or an Admin can refresh it now.';
}
el('theme-toggle').addEventListener('click', async () => {
  const theme = settings.theme === 'light' ? 'dark' : 'light';
  // Answers the click at once, and the worker keeps the choice for every page.
  settings = { ...settings, theme }; render();
  try { settings = await send<SettingsView>({ type: 'set-theme', theme }); render(); }
  catch (error) { notice(errorText(error), 'error'); }
});
express.addEventListener('change', async () => {
  try {
    settings = await send<SettingsView>({ type: 'set-express', enabled: express.checked }); render();
    notice(settings.expressEnabled ? 'Express addition is on. A toolbar click sends the request when everything was filled in from the page.' : 'Express addition is off. Every request waits for you on the form.', 'success');
  } catch (error) { express.checked = settings.expressEnabled === true; notice(errorText(error), 'error'); }
});
carts.addEventListener('change', () => {
  if (carts.checked) {
    // Chrome only shows the prompt during this click, so nothing may be awaited before this request.
    const asked = chrome.permissions.request({ origins: allStoreOrigins() });
    void asked.then(async granted => {
      settings = await send<SettingsView>({ type: 'set-carts', enabled: true }); render();
      notice(granted ? 'Carts is on. Open Carts to see your team\'s open orders.' : 'Carts is on, without store access. You can still see open orders and add items yourself from a checklist. Open Carts to allow access later.', granted ? 'success' : 'warning');
    }).catch(error => { carts.checked = false; notice(errorText(error), 'error'); });
    return;
  }
  void (async () => {
    try {
      settings = await send<SettingsView>({ type: 'set-carts', enabled: false }); render();
      await chrome.permissions.remove({ origins: originsToGiveBack() }).catch(() => undefined);
      notice('Carts is off, and this extension gave back its access to the stores.', 'success');
    } catch (error) { carts.checked = settings.cartsEnabled === true; notice(errorText(error), 'error'); }
  })();
});
el('carts-open').addEventListener('click', () => { void chrome.tabs.create({ url: chrome.runtime.getURL('carts.html') }); });
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
  if (!confirm('Unpair this device? This removes it from your team\'s site, which frees one of your 5 device slots, and forgets the key on this computer. To pair again you need a new PIN from /ordering-pin. Drafts are kept.')) return;
  const button = el<HTMLButtonElement>('unpair');
  button.disabled = true;
  notice('Unpairing...');
  try {
    const result = await send<UnpairView>({ type: 'unpair' });
    await chrome.permissions.remove({ origins: originsToGiveBack() }).catch(() => undefined);
    settings = result;
    address.value = ''; label.value = ''; render();
    if (result.revokedOnSite) notice('Unpaired. This device was removed from your team\'s site, which frees one of your 5 device slots, and this computer no longer has the key.', 'success');
    else notice('Unpaired on this computer, which no longer has the key. The site could not confirm removing this device, so it may still count toward your limit of 5, and an Admin may need to remove it.', 'error');
  } catch (error) { notice(errorText(error), 'error'); }
  finally { button.disabled = false; }
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
