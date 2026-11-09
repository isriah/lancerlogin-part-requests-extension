import './styles.css';
import { VENDORS, vendorForUrl } from './vendors';
import { validateDraft } from './validate';
import type { CaptureResult, Choice, DraftRecord, Repeat, RequestDraft, SettingsView, Submission } from './types';
import { choices, el, errorText, notice, send, UiError } from './ui';

let settings: SettingsView = { pairing: 'unpaired', defaultTeam: '' };
let record: DraftRecord | undefined;
let submission: Submission | undefined;
let sourceKey = '';
let tabId: number;
let saving: Promise<unknown> = Promise.resolve();
let savingError = '';
let busy = false;
const form = el<HTMLFormElement>('request-form');
const submitButton = el<HTMLButtonElement>('submit');
const fields = ['description', 'status', 'sku', 'team', 'recipient', 'url', 'quantity', 'price'] as const;
const input = (id: string) => el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
const format = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const isPaired = () => settings.pairing === 'paired';
function resetPanels(): void { for (const id of ['loading', 'unsupported', 'not-product', 'result', 'request-form']) el(id).hidden = true; }
// A saved choice stays selectable when the list is missing or has changed. Sending checks it against the current list.
const withSaved = (list: Choice[], saved: string): Choice[] => saved && !list.some(c => c.id === saved) ? [...list, { id: saved, name: 'Saved choice' }] : list;
function fillChoices(team: string, recipient: string): void {
  choices(el('team'), withSaved(settings.options?.teams || [], team), team, 'Choose team');
  choices(el('recipient'), withSaved(settings.options?.recipients || [], recipient), recipient, 'Choose recipient');
}
function showPairing(): void {
  el('setup').hidden = isPaired();
  el('setup-title').textContent = settings.pairing === 'expired' ? 'Pair this device again' : 'Pair this device to send requests';
  el('setup-message').textContent = settings.pairing === 'expired'
    ? 'It is no longer paired. Run /ordering-pin in Discord for a new PIN. Your drafts are kept.'
    : 'Run /ordering-pin in Discord for a PIN, then enter it in settings. Your drafts are kept.';
  setEnabled();
}
function fill(): void {
  if (!record) return;
  fillChoices(record.draft.team, record.draft.recipient);
  for (const field of fields) input(field).value = record.draft[field] === null ? '' : String(record.draft[field]);
  el<HTMLInputElement>('currency-confirmed').checked = record.draft.currencyConfirmed;
  el('currency-row').hidden = record.capture.currency === 'USD' || !record.capture.currency && record.capture.price === null;
  const issues = el('capture-issues'); issues.replaceChildren();
  for (const issue of record.capture.issues) { const li = document.createElement('li'); li.textContent = issue; issues.append(li); }
  issues.hidden = !issues.childElementCount;
  form.hidden = false; updateTotal(); setEnabled();
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
  el('total').textContent = total !== null && Number.isFinite(total) ? format(total) : 'Not set';
  submitButton.textContent = draft.status === 'Incomplete Request' ? 'Save incomplete request ↗' : 'Create request ↗';
  setEnabled();
}
function setEnabled(): void {
  for (const node of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input,select,textarea,button')) node.disabled = busy || !!submission;
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
form.addEventListener('input', () => { updateTotal(); void save(); });
form.addEventListener('change', () => { updateTotal(); void save(); });
for (const id of ['url', 'sku']) el(id).addEventListener('change', () => { void checkRepeats(); });
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const repeatText = (repeats: Repeat[]) => repeats.map(r => `${r.memberName} on ${when(r.createdMs)}`).join('; ');
async function reloadSettings(): Promise<void> { settings = await send<SettingsView>({ type: 'settings' }); showPairing(); }
/** A warning only: it never blocks sending. If the check fails, the student simply sees no warning. */
async function checkRepeats(): Promise<void> {
  const node = el('repeat-warning');
  const asked = input('url').value.trim();
  if (!isPaired() || submission || !vendorForUrl(asked)) { node.hidden = true; return; }
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
function showSubmission(value: Submission): void {
  submission = value;
  el('result').hidden = false;
  el('repeat-warning').hidden = true;
  const link = el<HTMLAnchorElement>('notion-link');
  const uncertain = value.state === 'uncertain' || value.state === 'pending' && Date.now() - value.updatedAt >= 30_000;
  link.hidden = value.state !== 'success';
  if (value.state === 'success') {
    form.hidden = true;
    el('result-title').textContent = 'Request created';
    el('result-message').textContent = `Your part is in Notion. The coach can take it from here.${value.repeats?.length ? ` Also requested recently by ${repeatText(value.repeats)}.` : ''}`;
    link.href = value.pageUrl!; link.textContent = 'Open in Notion ↗';
  } else {
    el('result-title').textContent = uncertain ? 'Check Notion before retrying' : value.state === 'pending' ? 'Sending your request' : 'Request was not created';
    el('result-message').textContent = uncertain ? 'The result could not be confirmed. Your request may already exist. Check your team\'s ordering database in Notion before sending it again.' : value.message || 'You can close this popup. Reopen it to check the saved result.';
  }
  el('uncertain-check').hidden = !uncertain;
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
  const list = el('validation'); list.replaceChildren();
  for (const error of errors) { const li = document.createElement('li'); li.textContent = error; list.append(li); }
  list.hidden = !errors.length;
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
async function capture(): Promise<void> {
  resetPanels(); el('loading').hidden = false;
  const result = await send<{ unsupported?: boolean; key?: string; record?: DraftRecord; capture?: CaptureResult; submission?: Submission }>({ type: 'capture', tabId });
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
  try { await saving; await send({ type: 'discard', key: sourceKey }); record = undefined; submission = undefined; notice(''); await capture(); }
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
for (const vendor of VENDORS) { const li = document.createElement('li'); li.textContent = vendor.label; el('vendor-list').append(li); }
/** Opens from the cached lists, then brings them up to date. Choices made meanwhile are kept. */
async function refreshOptions(): Promise<void> {
  try {
    settings = await send<SettingsView>({ type: 'refresh-options' }); showPairing();
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
  tabId = tab.id; await capture();
  if (isPaired()) await refreshOptions();
}
void init().catch(error => { resetPanels(); notice(errorText(error), 'error'); });
// Short polling only while this popup is open; the worker owns the actual request.
setInterval(() => {
  if (submission?.state === 'pending') void send<Submission | null>({ type: 'submission', id: submission.id }).then(result => { if (result) showSubmission(result); }).catch(() => undefined);
  // While this popup is waiting on its own send, it can still say that the site is updating.
  else if (busy && record) void send<Submission | null>({ type: 'submission', id: record.submissionId }).then(result => { if (busy && result?.state === 'pending' && result.message) notice(result.message); }).catch(() => undefined);
}, 1500);
