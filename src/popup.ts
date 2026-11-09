import './styles.css';
import { VENDORS, vendorForUrl } from './vendors';
import { validateDraft } from './notion';
import type { CaptureResult, Configuration, DraftRecord, RequestDraft, Submission } from './types';
import { choices, el, errorText, notice, send } from './ui';

let config: Configuration | undefined;
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
function resetPanels(): void { for (const id of ['loading', 'unsupported', 'not-product', 'result', 'request-form']) el(id).hidden = true; }
function fill(): void {
  if (!record) return;
  choices(el('team'), config?.schema.properties.team.options || [], record.draft.team, 'Choose team');
  choices(el('recipient'), config?.people || [], record.draft.recipient, 'Choose recipient');
  for (const field of fields) input(field).value = record.draft[field] === null ? '' : String(record.draft[field]);
  el<HTMLInputElement>('currency-confirmed').checked = record.draft.currencyConfirmed;
  el('currency-row').hidden = record.capture.currency === 'USD' || !record.capture.currency && record.capture.price === null;
  const issues = el('capture-issues'); issues.replaceChildren();
  for (const issue of record.capture.issues) { const li = document.createElement('li'); li.textContent = issue; issues.append(li); }
  issues.hidden = !issues.childElementCount;
  form.hidden = false; updateTotal(); setEnabled();
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
  submitButton.disabled ||= !config || !vendorForUrl(input('url').value.trim());
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
function showSubmission(value: Submission): void {
  submission = value;
  el('result').hidden = false;
  const link = el<HTMLAnchorElement>('notion-link');
  const uncertain = value.state === 'uncertain' || value.state === 'pending' && Date.now() - value.updatedAt >= 30_000;
  link.hidden = false;
  if (value.state === 'success') {
    form.hidden = true;
    el('result-title').textContent = 'Request created';
    el('result-message').textContent = 'Your part is in Notion. The coach can take it from here.';
    link.href = value.pageUrl!; link.textContent = 'Open in Notion ↗';
  } else {
    link.href = config?.databaseUrl || '#'; link.textContent = 'Check ordering database ↗';
    link.hidden = !config;
    el('result-title').textContent = uncertain ? 'Check Notion before retrying' : value.state === 'pending' ? 'Sending your request' : 'Request was not created';
    el('result-message').textContent = uncertain ? 'The result could not be confirmed. Your request may already exist. Check the database before sending it again.' : value.message || 'You can close this popup. Reopen it to check the saved result.';
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
  if (busy || submission || !record || !config) return;
  const errors = validateDraft(readForm(), config);
  const list = el('validation'); list.replaceChildren();
  for (const error of errors) { const li = document.createElement('li'); li.textContent = error; list.append(li); }
  list.hidden = !errors.length;
  if (errors.length) return;
  busy = true; setEnabled(); notice('Sending this request to Notion...');
  try {
    await save(); if (savingError) throw new Error(savingError);
    const result = await send<Submission>({ type: 'submit', key: record.key, submissionId: record.submissionId });
    notice(''); showSubmission(result);
  } catch (error) {
    notice(errorText(error), 'error');
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
    if (!record.draft.team) record.draft.team = config?.defaultTeam || '';
    if (!record.draft.recipient) record.draft.recipient = config?.defaultRecipient || '';
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
async function init(): Promise<void> {
  const settings = await send<{ config?: Configuration }>({ type: 'settings' }); config = settings.config;
  el('setup').hidden = !!config;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Open a product in a regular Chrome tab.');
  tabId = tab.id; await capture();
}
void init().catch(error => { resetPanels(); notice(errorText(error), 'error'); });
// Short polling only while this popup is open; the worker owns the actual request.
setInterval(() => {
  if (submission?.state === 'pending') void send<Submission | null>({ type: 'submission', id: submission.id }).then(result => { if (result) showSubmission(result); }).catch(() => undefined);
}, 1500);
