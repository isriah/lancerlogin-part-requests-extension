import './styles.css';
import { VENDORS, vendorForUrl } from './vendors';
import { validateDraft } from './validate';
import type { CaptureResult, Choice, DraftRecord, ExpressReason, Repeat, RequestDraft, SettingsView, Submission } from './types';
import { applyAppearance } from './appearance';
import { safePageUrl } from './client';
import { choices, el, errorText, notice, send, showUpdateNotice, UiError } from './ui';

let settings: SettingsView = { pairing: 'unpaired', defaultTeam: '' };
let record: DraftRecord | undefined;
let submission: Submission | undefined;
let sourceKey = '';
let tabId: number;
let saving: Promise<unknown> = Promise.resolve();
let savingError = '';
let busy = false;
let reloading = false;
const form = el<HTMLFormElement>('request-form');
const submitButton = el<HTMLButtonElement>('submit');
const fields = ['description', 'status', 'sku', 'team', 'recipient', 'url', 'quantity', 'price'] as const;
const input = (id: string) => el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
const format = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const isPaired = () => settings.pairing === 'paired';
/** Messages sit inside the form's card when the form is showing, and above whatever else is showing otherwise. */
function placeAlerts(): void {
  const alerts = el('alerts');
  if (!form.hidden) el('form-head').after(alerts);
  else if (alerts.parentElement !== el('main')) el('main').prepend(alerts);
}
function resetPanels(): void { for (const id of ['loading', 'unsupported', 'not-product', 'result', 'request-form']) el(id).hidden = true; placeAlerts(); }
// A saved choice stays selectable when the list is missing or has changed. Sending checks it against the current list.
const withSaved = (list: Choice[], saved: string): Choice[] => saved && !list.some(c => c.id === saved) ? [...list, { id: saved, name: 'Saved choice' }] : list;
function fillChoices(team: string, recipient: string): void {
  choices(el('team'), withSaved(settings.options?.teams || [], team), team, 'Choose a team');
  choices(el('recipient'), withSaved(settings.options?.recipients || [], recipient), recipient, 'Choose a person');
}
function showPairing(): void {
  applyAppearance(settings);
  showUpdateNotice(settings.options);
  el('setup').hidden = isPaired();
  el('setup').dataset.tone = settings.pairing === 'expired' ? 'error' : 'neutral';
  el('setup-title').textContent = settings.pairing === 'expired' ? 'Pair this device again' : 'Pair this device to send requests';
  el('setup-message').textContent = settings.pairing === 'expired'
    ? 'It is no longer paired. Run /ordering-pin in Discord for a new PIN. Your drafts are kept.'
    : 'Run /ordering-pin in Discord for a PIN, then enter it in settings. Your drafts are kept.';
  setEnabled();
}
/** A list with its heading: the heading's box hides along with an empty list. */
function setList(id: string, items: string[]): void {
  const list = el(id); list.replaceChildren();
  for (const item of items) { const li = document.createElement('li'); li.textContent = item; list.append(li); }
  list.parentElement!.hidden = !items.length;
}
const expressReasons = (): ExpressReason[] => settings.expressEnabled && record?.express?.reasons || [];
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const repeatText = (repeats: Repeat[]) => repeats.map(r => `${r.memberName} on ${when(r.createdMs)}`).join('; ');
const newTabLink = (href: string, text: string) => Object.assign(document.createElement('a'), { href, textContent: text, target: '_blank', rel: 'noopener noreferrer' });
/** Why Express addition stopped. Built as nodes: these carry text from the store page and the site. */
function showExpressReasons(): void {
  const reasons = expressReasons();
  const list = el('express-reasons'); list.replaceChildren();
  for (const reason of reasons) {
    const li = document.createElement('li');
    if (reason.code === 'repeat' && reason.repeats?.length) {
      const page = reason.repeats.map(r => safePageUrl(r.pageUrl)).find(Boolean);
      li.append(`${reason.repeats.map(r => `${r.memberName} requested this on ${when(r.createdMs)}`).join('; ')}. `);
      if (page) li.append(newTabLink(page, 'Open it ↗'), ' ');
      li.append('You can still send yours.');
    } else if (reason.code === 'defaults') {
      const settingsLink = Object.assign(document.createElement('a'), { href: '#', textContent: 'Settings' });
      settingsLink.addEventListener('click', event => { event.preventDefault(); void chrome.runtime.openOptionsPage(); });
      li.append(reason.text.replace(/ in Settings\.$/, ' in '), settingsLink, '.');
    } else li.textContent = reason.text;
    list.append(li);
  }
  el('express-reasons-box').hidden = !reasons.length;
  const invalid = new Set<string>();
  for (const { code } of reasons) {
    if (code === 'price' || code === 'currency') invalid.add('price');
    if (code === 'variant') { invalid.add('description'); invalid.add('price'); }
    if (code === 'description') invalid.add('description');
    if (code === 'defaults' && record) {
      if (!settings.options?.teams.some(t => t.id === record!.draft.team)) invalid.add('team');
      if (!settings.options?.recipients.some(p => p.id === record!.draft.recipient)) invalid.add('recipient');
    }
  }
  for (const id of ['description', 'team', 'recipient', 'price']) {
    if (invalid.has(id)) input(id).setAttribute('aria-invalid', 'true'); else input(id).removeAttribute('aria-invalid');
  }
}
function fill(): void {
  if (!record) return;
  fillChoices(record.draft.team, record.draft.recipient);
  for (const field of fields) input(field).value = record.draft[field] === null ? '' : String(record.draft[field]);
  el<HTMLInputElement>('currency-confirmed').checked = record.draft.currencyConfirmed;
  el('currency-row').hidden = record.capture.currency === 'USD' || !record.capture.currency && record.capture.price === null;
  const reasons = expressReasons();
  // Anything the reader flagged is already among Express addition's reasons, so it isn't said twice.
  setList('capture-issues', reasons.length ? [] : record.capture.issues);
  showExpressReasons();
  form.hidden = false; placeAlerts(); updateTotal(); setEnabled();
  if (!submission) void checkRepeats();
}
function readForm(): RequestDraft {
  const number = (id: string) => input(id).value.trim() === '' ? null : Number(input(id).value);
  return {
    description: input('description').value, status: input('status').value as RequestDraft['status'],
    sku: input('sku').value, team: input('team').value, recipient: input('recipient').value,
    url: input('url').value.trim(), quantity: number('quantity'), price: number('price'),
    currencyConfirmed: el<HTMLInputElement>('currency-confirmed').checked,
  };
}
function updateTotal(): void {
  const draft = readForm();
  const vendor = vendorForUrl(draft.url);
  el('vendor').textContent = vendor?.label || 'UNSUPPORTED URL';
  const total = draft.quantity !== null && draft.price !== null ? draft.quantity * draft.price : null;
  el('total').textContent = total !== null && Number.isFinite(total) ? format(total) : '—';
  submitButton.textContent = draft.status === 'Incomplete Request' ? 'Save incomplete' : 'Create request';
  setEnabled();
}
function setEnabled(): void {
  for (const node of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input,select,textarea,button')) {
    if (!node.closest('#alerts')) node.disabled = busy || !!submission;
  }
  submitButton.disabled ||= !isPaired() || !vendorForUrl(input('url').value.trim());
}
function save(): Promise<unknown> {
  if (!record || submission) return saving;
  record.draft = readForm(); record.updatedAt = Math.max(Date.now(), record.updatedAt + 1);
  const snapshot = structuredClone(record);
  const write = send({ type: 'save-draft', record: snapshot });
  saving = Promise.all([saving, write]).then(() => { savingError = ''; }).catch(error => { savingError = errorText(error); notice(`Could not save edits: ${savingError}`, 'error'); });
  return saving;
}
form.addEventListener('input', event => { (event.target as HTMLElement).removeAttribute?.('aria-invalid'); updateTotal(); void save(); });
form.addEventListener('change', () => { updateTotal(); void save(); });
for (const id of ['url', 'sku']) el(id).addEventListener('change', () => { void checkRepeats(); });
async function reloadSettings(): Promise<void> { settings = await send<SettingsView>({ type: 'settings' }); showPairing(); }
/** A warning only: it never blocks sending. If the check fails, the student simply sees no warning. */
async function checkRepeats(): Promise<void> {
  const node = el('repeat-warning');
  const asked = input('url').value.trim();
  // Express addition's reasons already name a repeat, with the same link.
  if (!isPaired() || submission || !vendorForUrl(asked) || expressReasons().some(r => r.code === 'repeat')) { node.hidden = true; return; }
  try {
    const { repeats } = await send<{ repeats: Repeat[] }>({ type: 'check-repeats', url: asked, sku: input('sku').value });
    if (input('url').value.trim() !== asked || submission) return;
    el('repeat-names').textContent = repeatText(repeats);
    const link = el<HTMLAnchorElement>('repeat-link');
    const page = repeats.find(r => r.pageUrl)?.pageUrl;
    link.hidden = !page;
    if (page) link.href = page;
    node.hidden = !repeats.length;
  } catch (error) {
    node.hidden = true;
    if (error instanceof UiError && error.code === 'pair_again') await reloadSettings();
  }
}
const PILLS: Record<string, [string, string]> = { success: ['✓ Created', 'success'], uncertain: ['! Uncertain', 'warning'], failed: ['✕ Not created', 'error'] };
function showFacts(value: Submission, details: boolean): void {
  const facts = value.facts;
  const item = el('result-item'), list = el('result-facts');
  item.textContent = facts?.description || ''; item.hidden = !facts?.description;
  list.replaceChildren();
  if (facts && details) {
    const packs = /mcmaster/i.test(facts.store) ? ` pack${facts.quantity === 1 ? '' : 's'}` : '';
    const rows: [string, string][] = [
      ['Store', facts.store], ['Quantity', facts.quantity === null ? '' : `${facts.quantity}${packs}`],
      ['Unit price', facts.price === null ? '' : `${format(facts.price)} USD`], ['Team', facts.team], ['Orderer / recipient', facts.recipient],
    ];
    for (const [label, text] of rows) {
      if (!text) continue;
      const row = document.createElement('div');
      row.append(Object.assign(document.createElement('dt'), { textContent: label }), Object.assign(document.createElement('dd'), { textContent: text }));
      list.append(row);
    }
  }
  list.hidden = !list.childElementCount;
}
function showSubmission(value: Submission): void {
  submission = value;
  form.hidden = true; el('result').hidden = false; placeAlerts();
  el('repeat-warning').hidden = true;
  const link = el<HTMLAnchorElement>('notion-link');
  const uncertain = value.state === 'uncertain' || value.state === 'pending' && Date.now() - value.updatedAt >= 30_000;
  const state = uncertain ? 'uncertain' : value.state;
  const express = value.express === true;
  link.hidden = value.state !== 'success';
  const message = el('result-message');
  if (state === 'success') {
    el('result-title').textContent = express ? 'Request sent' : 'Request created';
    message.textContent = express ? '' : `Your part is in Notion. The coach can take it from here.${value.repeats?.length ? ` Also requested recently by ${repeatText(value.repeats)}.` : ''}`;
    link.href = value.pageUrl!; link.textContent = express ? 'Open in Notion to review ↗' : 'Open in Notion ↗';
  } else if (state === 'uncertain') {
    el('result-title').textContent = express ? 'Not sure it was created' : 'Check Notion before retrying';
    message.textContent = 'The result could not be confirmed, and your request may already exist. Check your team\'s ordering database in Notion before sending it again. It won\'t be resent by itself.';
  } else if (state === 'pending') {
    el('result-title').textContent = 'Sending your request';
    message.textContent = value.message || (express ? 'Everything was filled in from this page, so Express addition is sending it now. You can close this popup. The request keeps going.' : 'You can close this popup. Reopen it to check the saved result.');
  } else {
    el('result-title').textContent = 'Request was not created';
    message.textContent = value.message || 'You can close this popup. Reopen it to check the saved result.';
  }
  message.hidden = !message.textContent;
  el('result-spin').hidden = state !== 'pending';
  const pill = el('result-pill'), tone = PILLS[state];
  pill.hidden = !tone;
  if (tone) { pill.textContent = tone[0]; pill.dataset.tone = tone[1]; }
  showFacts(value, state !== 'uncertain');
  el('express-help').hidden = !(express && state === 'success');
  el('express-off-row').hidden = !(express && state === 'success');
  el('uncertain-check').hidden = !uncertain;
  // Checked again here, because the link comes from saved lists: it only ever opens Notion.
  const database = el<HTMLAnchorElement>('database-link');
  const databaseLink = uncertain ? safePageUrl(settings.options?.databaseLink) : null;
  database.hidden = !databaseLink;
  if (databaseLink) database.href = databaseLink; else database.removeAttribute('href');
  el('retry').hidden = value.state !== 'failed' && !uncertain;
  el('new-request').hidden = value.state !== 'success';
  el<HTMLButtonElement>('retry').disabled = uncertain && !el<HTMLInputElement>('checked-notion').checked;
  setEnabled();
}
el('checked-notion').addEventListener('change', () => { if (submission) showSubmission(submission); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || submission || !record || !isPaired()) return;
  const errors = validateDraft(readForm(), settings.options);
  setList('validation', errors);
  if (errors.length) return;
  busy = true; setEnabled(); notice('Sending this request...');
  try {
    await save(); if (savingError) throw new Error(savingError);
    const result = await send<Submission>({ type: 'submit', key: record.key, submissionId: record.submissionId });
    notice(''); showSubmission(result);
  } catch (error) {
    notice(errorText(error), 'error');
    if (error instanceof UiError && error.code === 'pair_again') await reloadSettings().catch(() => undefined);
    // A lost popup message must not turn an unknown POST into an automatic retry.
    try { const result = await send<Submission | null>({ type: 'submission', id: record.submissionId }); if (result) showSubmission(result); } catch { notice('Connection lost. Reopen the extension to check the saved result before retrying.', 'error'); }
  } finally { busy = false; setEnabled(); }
});
/** `auto` is only for the toolbar opening this popup. Anything a student does in here reads the page without sending. */
async function capture(auto: boolean): Promise<void> {
  resetPanels(); el('loading').hidden = false;
  const result = await send<{ unsupported?: boolean; key?: string; record?: DraftRecord; capture?: CaptureResult; submission?: Submission }>({ type: 'capture', tabId, auto });
  resetPanels();
  if (result.unsupported) { el('unsupported').hidden = false; return; }
  if (result.capture) { el('not-product').hidden = false; el('capture-explanation').textContent = result.capture.issues.join(' '); return; }
  sourceKey = result.key || result.record?.key || '';
  record = result.record; submission = result.submission;
  if (record) {
    if (!record.draft.team) record.draft.team = settings.defaultTeam;
    if (!record.draft.recipient) record.draft.recipient = settings.options?.defaultRecipientId || '';
    fill();
  }
  if (submission) showSubmission(submission);
}
async function startOver(): Promise<void> {
  try { await saving; await send({ type: 'discard', key: sourceKey }); record = undefined; submission = undefined; notice(''); await capture(false); }
  catch (error) { notice(errorText(error), 'error'); }
}
el('discard').addEventListener('click', () => { void startOver(); });
el('new-request').addEventListener('click', () => { void startOver(); });
el('retry').addEventListener('click', async () => {
  try {
    record = await send<DraftRecord>({ type: 'restart', key: sourceKey, acknowledgeUncertain: el<HTMLInputElement>('checked-notion').checked });
    submission = undefined; el('result').hidden = true; el<HTMLInputElement>('checked-notion').checked = false; notice('Review the request, then submit when ready.'); fill();
  } catch (error) { notice(errorText(error), 'error'); }
});
for (const id of ['settings', 'connect']) el(id).addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
el('express-off').addEventListener('click', event => { event.preventDefault(); void chrome.runtime.openOptionsPage(); });
for (const vendor of VENDORS) { const li = document.createElement('li'); li.textContent = vendor.label; el('vendor-list').append(li); }
/** Opens from the cached lists, then brings them up to date. Choices made meanwhile are kept. */
async function refreshOptions(): Promise<void> {
  try {
    settings = await send<SettingsView>({ type: 'refresh-options' }); showPairing();
    if (submission) showSubmission(submission); // A result already showing can gain the database link.
    if (!record || submission) return;
    const team = input('team').value || settings.defaultTeam;
    const recipient = input('recipient').value || settings.options?.defaultRecipientId || '';
    const changed = team !== input('team').value || recipient !== input('recipient').value;
    fillChoices(team, recipient); updateTotal();
    if (changed) void save();
  } catch (error) {
    await reloadSettings().catch(() => undefined);
    if (!isPaired() || !settings.options) notice(errorText(error), 'error');
  }
}
async function init(): Promise<void> {
  await reloadSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Open a product in a regular Chrome tab.');
  tabId = tab.id; await capture(true);
  if (isPaired()) await refreshOptions();
}
void init().catch(error => { resetPanels(); notice(errorText(error), 'error'); });
/** An Express send that came back to the form: the worker has saved why, or it's still waiting its turn. Never sends anything. */
async function reloadAfterExpress(): Promise<void> {
  if (reloading) return;
  reloading = true;
  try { await new Promise(done => setTimeout(done, 150)); await capture(false); } catch (error) { notice(errorText(error), 'error'); } finally { reloading = false; }
}
// Short polling only while this popup is open; the worker owns the actual request.
setInterval(() => {
  if (submission?.state === 'pending') {
    const express = submission.express === true;
    void send<Submission | null>({ type: 'submission', id: submission.id }).then(result => {
      if (express && (!result || result.state === 'failed')) return reloadAfterExpress();
      if (result) showSubmission(result);
    }).catch(() => undefined);
  }
  // While this popup is waiting on its own send, it can still say that the site is updating.
  else if (busy && record) void send<Submission | null>({ type: 'submission', id: record.submissionId }).then(result => { if (busy && result?.state === 'pending' && result.message) notice(result.message); }).catch(() => undefined);
}, 1500);
