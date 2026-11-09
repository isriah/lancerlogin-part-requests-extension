import type { Brand, Theme } from './brand';
import { PluginClient, QUICK_TIMEOUT_MS, wireDraft, type CreateOutcome } from './client';
import { AppError } from './errors';
import { ALREADY_SENT, CHECK_FAILED, pageReasons, repeatReason } from './express';
import { cleanDeviceLabel, manifestAllowsLocalHttp, normalizePin, normalizeSiteAddress, originPattern } from './pairing';
import { capturePage } from './reader';
import { SubmissionManager, type Created } from './submissions';
import { validateDraft } from './validate';
import { vendorForUrl } from './vendors';
import type { CaptureResult, DeviceOptions, DraftRecord, ExpressReason, Message, RequestDraft, SettingsView, Submission, SubmissionFacts } from './types';

/** Retries of one create while the site reports maintenance. At Core's 30 seconds, that is two minutes. */
const MAINTENANCE_RETRIES = 4;
const MAX_RETRY_WAIT_SECONDS = 120;
/** Asks about another request still running with this ID, every 2 seconds for up to a minute. */
const PENDING_POLLS = 30;
/** A pending record not touched for this long has no worker behind it. */
const STALE_MS = 30_000;
/** Team colors are asked for at pairing, then at most this often, whether or not the last try worked. */
const BRAND_REFRESH_MS = 24 * 60 * 60 * 1000;

interface Site { origin: string; memberName: string; deviceLabel: string; pairedAt: number; expired?: boolean }

// Trusted contexts only: product pages' content scripts can never read this storage. The key stays in the worker.
const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const get = async <T>(key: string): Promise<T | undefined> => (await chrome.storage.local.get(key))[key] as T | undefined;
const put = async (key: string, value: unknown): Promise<void> => chrome.storage.local.set({ [key]: value });
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
let draftWrites: Promise<unknown> = Promise.resolve();
const manager = new SubmissionManager({
  get: id => get<Submission>(`submission:${id}`),
  set: s => put(`submission:${s.id}`, s),
  remove: id => chrome.storage.local.remove(`submission:${id}`),
});
/** Creates running in this worker. A pending record not in here was left behind by a worker that stopped. */
const active = new Set<string>();
/** One capture per tab at a time, so rapid reopening shares a draft and a submission ID instead of racing to make two. */
const captures = new Map<number, Promise<unknown>>();
function oneAtATime<T>(tabId: number, work: () => Promise<T>): Promise<T> {
  const next = (captures.get(tabId) ?? Promise.resolve()).then(work, work);
  captures.set(tabId, next.catch(() => undefined));
  return next;
}
let brandRefresh: Promise<void> | undefined;

async function view(): Promise<SettingsView> {
  const [site, key, options, defaultTeam, brand, theme, expressEnabled, cartsEnabled] = await Promise.all([get<Site>('site'), get<string>('deviceKey'), get<DeviceOptions>('options'), get<string>('defaultTeam'), get<Brand>('brand'), get<Theme>('theme'), get<boolean>('expressEnabled'), get<boolean>('cartsEnabled')]);
  return {
    pairing: !site ? 'unpaired' : key && !site.expired ? 'paired' : 'expired',
    origin: site?.origin, memberName: site?.memberName, deviceLabel: site?.deviceLabel, options, defaultTeam: defaultTeam || '',
    brand: site ? brand : undefined, theme: theme === 'light' ? 'light' : 'dark', expressEnabled: expressEnabled === true, cartsEnabled: cartsEnabled === true,
  };
}
/** Asks the site for its colors if it's due. Any failure keeps the last good colors. It never rejects. */
function refreshBrand(): Promise<void> {
  brandRefresh ??= (async () => {
    const [site, last] = await Promise.all([get<Site>('site'), get<number>('brandAttemptAt')]);
    if (!site || !await chrome.permissions.contains({ origins: [originPattern(site.origin)] })) return;
    if (typeof last === 'number' && Date.now() - last < BRAND_REFRESH_MS) return;
    await put('brandAttemptAt', Date.now());
    const brand = await new PluginClient(site.origin).branding();
    // Unpair or a new site may have happened meanwhile, and those colors must not come back.
    if (brand && (await get<Site>('site'))?.origin === site.origin) await put('brand', { ...brand, checkedAt: Date.now() } satisfies Brand);
  })().catch(() => undefined).finally(() => { brandRefresh = undefined; });
  return brandRefresh;
}
/** The key is forgotten, the site is kept so pairing again is one step, and drafts are untouched. */
async function pairAgain(): Promise<void> {
  const site = await get<Site>('site');
  await chrome.storage.local.remove('deviceKey');
  if (site) await put('site', { ...site, expired: true });
}
async function paired(): Promise<{ site: Site; client: PluginClient }> {
  const [site, key] = await Promise.all([get<Site>('site'), get<string>('deviceKey')]);
  if (!site || !key || site.expired) throw new AppError(site ? 'This device is no longer paired. Run /ordering-pin in Discord and pair it again. Your drafts are kept.' : 'Pair this device first. Open settings and enter the site address and PIN from /ordering-pin in Discord.', 'pair_again', false, true);
  if (!await chrome.permissions.contains({ origins: [originPattern(site.origin)] })) throw new AppError(`Chrome no longer has permission to reach ${site.origin}. Open settings, unpair this device, then pair it again.`, 'permission_missing', false, true);
  return { site, client: new PluginClient(site.origin, key) };
}
/** Runs a device call, and turns a revoked or expired key into the pair-again state before reporting it. */
async function device<T>(work: (client: PluginClient, site: Site) => Promise<T>): Promise<T> {
  const { client, site } = await paired();
  try { return await work(client, site); }
  catch (error) {
    if (error instanceof AppError && error.code === 'pair_again') await pairAgain();
    throw error;
  }
}
async function refreshOptions(timeoutMs?: number): Promise<SettingsView> {
  const colors = refreshBrand();
  try {
    const options = await device(client => client.options(timeoutMs));
    await put('options', options);
    const site = await get<Site>('site');
    if (site && options.memberName && site.memberName !== options.memberName) await put('site', { ...site, memberName: options.memberName });
  } finally { await colors; }
  return view();
}
function validKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !/^\d+:https?:\/\//.test(key) || key.length > 2200) throw new AppError('Invalid source tab. Reopen the extension on the product page.');
}
function validId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id)) throw new AppError('Invalid submission. Reopen the extension.');
}
async function recordFor(key: string): Promise<DraftRecord> {
  validKey(key);
  const record = await get<DraftRecord>(`draft:${key}`);
  if (!record) throw new AppError('This draft is no longer available. Reopen the extension.');
  return record;
}
const blankDraft = (capture: CaptureResult, defaultTeam: string | undefined, options: DeviceOptions | undefined): RequestDraft => ({
  description: capture.description, url: capture.url, sku: capture.sku, price: capture.price, quantity: 1, status: 'NORMAL Request', team: defaultTeam || '', recipient: options?.defaultRecipientId || '', currencyConfirmed: capture.currency === 'USD' || !capture.currency && capture.price === null,
});
function factsFor(draft: RequestDraft, vendor: string, options: DeviceOptions | undefined): SubmissionFacts {
  const name = (list: { id: string; name: string }[] | undefined, id: string) => list?.find(c => c.id === id)?.name || '';
  return { description: draft.description.slice(0, 300), store: vendorForUrl(draft.url)?.label || vendor, quantity: draft.quantity, price: draft.price, team: name(options?.teams, draft.team), recipient: name(options?.recipients, draft.recipient) };
}
/** This URL has a receipt or an unsettled submission from any tab. Failed ones don't count, since nothing was created. */
async function sentFromThisBrowser(url: string): Promise<boolean> {
  const all = await chrome.storage.local.get(null);
  const sameUrl = (key: unknown) => typeof key === 'string' && key.slice(key.indexOf(':') + 1) === url;
  return Object.entries(all).some(([name, value]) => name.startsWith('receipt:') ? sameUrl(name.slice('receipt:'.length))
    : name.startsWith('submission:') && !!value && (value as Submission).state !== 'failed' && sameUrl((value as Submission).draftKey));
}
/** Everything that has to hold for a send with no click, using the freshest lists. Any failure here means the form. */
async function expressReasons(capture: CaptureResult): Promise<{ draft: RequestDraft; options: DeviceOptions | undefined; reasons: ExpressReason[] }> {
  const reasons: ExpressReason[] = [];
  let reachable = true;
  try { await refreshOptions(QUICK_TIMEOUT_MS); }
  catch (error) {
    reachable = false;
    reasons.push({ code: 'issue', text: error instanceof AppError ? error.message : 'The site could not be reached to check your defaults.' });
  }
  const [options, team] = await Promise.all([get<DeviceOptions>('options'), get<string>('defaultTeam')]);
  const draft = blankDraft(capture, team, options);
  reasons.push(...pageReasons(capture, draft, options));
  if (await sentFromThisBrowser(capture.url)) reasons.push(ALREADY_SENT);
  if (reachable) {
    try {
      const repeats = await device(client => client.check(draft.url, draft.sku.slice(0, 2000), QUICK_TIMEOUT_MS));
      if (repeats.length) reasons.push(repeatReason(repeats));
    } catch { reasons.push(CHECK_FAILED); }
  }
  return { draft, options, reasons };
}
/**
 * The send with no click. It uses the same submission ID, queue and retries as Create request, and the worker owns it, so closing the
 * popup doesn't cancel it. Only a recorded refusal or a send that never reached Notion returns to the form; nothing is resent here.
 */
async function startExpressSend(record: DraftRecord, options: DeviceOptions | undefined): Promise<Submission> {
  const id = record.submissionId;
  const facts = factsFor(record.draft, record.capture.vendor, options);
  const backToForm = (submissionId: string, text: string) => put(`draft:${record.key}`, { ...record, submissionId, updatedAt: Date.now(), express: { state: 'attempted', reasons: [{ code: 'send-failed', text }] } } satisfies DraftRecord);
  active.add(id);
  let stored!: () => void;
  const pendingStored = new Promise<void>(done => { stored = done; });
  const finished = manager.submit(id, record.key, () => { stored(); return device(client => sendOnce(client, record)); }, { express: true, facts })
    .then(async result => {
      if (result.state === 'success') await finishSuccess(record.key, id);
      else if (result.state === 'failed' && result.recorded) await backToForm(crypto.randomUUID(), result.message || 'Notion refused this request, so nothing was created.');
    })
    .catch(async error => { await backToForm(id, error instanceof AppError ? error.message : 'The request could not be sent. Nothing was created.'); })
    .finally(() => { active.delete(id); stored(); });
  // Another tab's send can hold the queue for minutes, and the popup shouldn't wait on it to say what's happening.
  await Promise.race([pendingStored, finished, sleep(1500)]);
  const now = await get<Submission>(`submission:${id}`);
  // Refused already: let the draft's reason finish saving, so the popup goes straight to the form.
  if (now?.state === 'failed') await finished;
  return now ?? { id, draftKey: record.key, state: 'pending', updatedAt: Date.now(), express: true, facts };
}
async function captureTab(tabId: number, auto: boolean): Promise<unknown> {
  if (!Number.isInteger(tabId)) throw new AppError('Open a product in a regular Chrome tab.');
  const tab = await chrome.tabs.get(tabId);
  const vendor = vendorForUrl(tab.url || '');
  if (!vendor) return { unsupported: true };
  const key = `${tab.id}:${tab.url}`;
  validKey(key);
  const receipt = await get<{ submissionId: string }>(`receipt:${key}`);
  if (receipt) return { key, submission: await get<Submission>(`submission:${receipt.submissionId}`) };
  const previous = await get<DraftRecord>(`draft:${key}`);
  if (previous) {
    const stored = await get<Submission>(`submission:${previous.submissionId}`);
    const submission = stored && await reconciled(stored);
    // The server may have just confirmed it, which clears the draft.
    if (submission) return submission.state === 'success' ? { key, submission } : { record: previous, submission };
    // Still waiting its turn in the queue behind another tab's send.
    if (active.has(previous.submissionId)) return { record: previous, submission: { id: previous.submissionId, draftKey: key, state: 'pending', updatedAt: Date.now(), express: true } satisfies Submission };
  }
  const settings = await view();
  const wantsExpress = auto && settings.expressEnabled === true && settings.pairing === 'paired' && !previous?.edited && (!previous?.express || previous.express.state === 'fallback');
  if (previous && !wantsExpress) return { record: previous };
  let capture;
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: capturePage, args: [vendor] });
    capture = results[0]?.result;
  } catch {
    // A draft already here is still good, and there's nothing to read a new answer from.
    if (previous) return { record: previous };
    throw new AppError('Chrome could not read this tab. Wait for the product page to load, then reopen the extension.', 'capture');
  }
  if (!capture || capture.url !== tab.url) { if (previous) return { record: previous }; throw new AppError('The page changed during capture. Reopen the extension.'); }
  if (capture.kind !== 'product') return previous ? { record: previous } : { capture };
  if (!wantsExpress) {
    const [options, defaultTeam] = await Promise.all([get<DeviceOptions>('options'), get<string>('defaultTeam')]);
    // Pressing New request or Discard is a deliberate choice of the form, and stays that way until the draft is gone.
    const record: DraftRecord = { key, submissionId: crypto.randomUUID(), capture, updatedAt: Date.now(), draft: blankDraft(capture, defaultTeam, options), ...(auto ? {} : { express: { state: 'manual', reasons: [] } }) };
    await put(`draft:${key}`, record);
    return { record };
  }
  const { draft, options, reasons } = await expressReasons(capture);
  // Keeps the ID, which no submission has used yet, when looking at an unedited draft again.
  const record: DraftRecord = { key, submissionId: previous?.submissionId ?? crypto.randomUUID(), capture, updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1), draft };
  if (reasons.length) {
    // A foreign amount must not sit in a field labeled USD while a student reads why it wasn't sent.
    if (reasons.some(r => r.code === 'currency')) record.draft = { ...draft, price: null, currencyConfirmed: false };
    record.express = { state: 'fallback', reasons };
    await put(`draft:${key}`, record);
    return { record };
  }
  // Written before anything is sent. If the worker stops right here, the student sees the form, never a second send.
  record.express = { state: 'attempted', reasons: [] };
  await put(`draft:${key}`, record);
  const submission = await startExpressSend(record, options);
  return submission.state === 'failed' ? { record: await get<DraftRecord>(`draft:${key}`) ?? record } : { record, submission };
}
async function finishSuccess(key: string, submissionId: string): Promise<void> {
  await put(`receipt:${key}`, { submissionId });
  await chrome.storage.local.remove(`draft:${key}`);
}
/** Turns every outcome except created into what the submission manager records. Refusals mean nothing was recorded. */
function raise(outcome: Exclude<CreateOutcome, { kind: 'created' | 'pending' | 'maintenance' }>): never {
  if (outcome.kind === 'uncertain') throw new AppError(outcome.message, 'uncertain', true);
  if (outcome.kind === 'conflict') throw new AppError(outcome.message, 'submission_conflict', true);
  if (outcome.kind === 'no-answer') throw new AppError(outcome.message, 'network', true);
  if (outcome.kind === 'failed') throw new AppError(outcome.message, outcome.code);
  throw new AppError(outcome.message, outcome.code, false, true);
}
/**
 * One create with one submission ID. Maintenance never reached the plugin, so the same ID is resent after Retry-After, a
 * limited number of times. An uncertain result or no answer is never resent here; only the student can choose to.
 */
async function sendOnce(client: PluginClient, record: DraftRecord): Promise<Created> {
  const id = record.submissionId;
  const touch = async (message?: string) => {
    const current = await get<Submission>(`submission:${id}`);
    if (current?.state === 'pending') await put(`submission:${id}`, { ...current, updatedAt: Date.now(), ...(message === undefined ? {} : { message }) });
  };
  // A storage call every few seconds also keeps Chrome from stopping the worker during a long wait.
  const beat = setInterval(() => { void touch(); }, 5000);
  try {
    let outcome: CreateOutcome | undefined;
    for (let attempt = 0; ; attempt++) {
      outcome = await client.create(id, record.draft);
      if (outcome.kind !== 'maintenance') break;
      if (attempt >= MAINTENANCE_RETRIES) throw new AppError('The site is still updating, so nothing was sent. Try again in a few minutes. Your draft is kept.', 'update_maintenance', false, true);
      const wait = Math.min(Math.max(outcome.retryAfterSeconds, 1), MAX_RETRY_WAIT_SECONDS);
      await touch(`The site is updating. Trying again in ${wait} seconds. You can leave this open or close it.`);
      await sleep(wait * 1000);
      await touch('');
    }
    // Another request with this ID is running, so only ask about it from here on.
    for (let poll = 0; outcome?.kind === 'pending'; poll++) {
      if (poll >= PENDING_POLLS) throw new AppError('The site has not finished this request. It may already exist.', 'network', true);
      await sleep(2000);
      outcome = await client.recorded(id);
      if (!outcome) throw new AppError('The site did not confirm this request. It may already exist.', 'network', true);
    }
    if (outcome.kind === 'created') return { pageUrl: outcome.pageUrl, repeats: outcome.repeats };
    if (outcome.kind === 'maintenance') throw new AppError('The site did not confirm this request. It may already exist.', 'network', true);
    return raise(outcome as Exclude<CreateOutcome, { kind: 'created' | 'pending' | 'maintenance' }>);
  } finally { clearInterval(beat); }
}
/** Asks the server what became of a submission this worker is not sending. It only reads: nothing is ever resent here. */
async function reconciled(submission: Submission): Promise<Submission> {
  if (active.has(submission.id)) return submission;
  const left = submission.state === 'pending' && Date.now() - submission.updatedAt >= STALE_MS;
  const unanswered = submission.state === 'uncertain' && !submission.recorded;
  if (!left && !unanswered) return submission;
  let outcome: CreateOutcome | undefined;
  try { outcome = await device(client => client.recorded(submission.id)); }
  catch { return submission; }
  let next: Submission;
  if (outcome === undefined) next = { ...submission, state: 'failed', recorded: false, message: 'The site has no record of this request, so nothing was created. Review it and send it again.' };
  else if (outcome.kind === 'created') next = { ...submission, state: 'success', recorded: true, pageUrl: outcome.pageUrl, message: undefined };
  else if (outcome.kind === 'failed') next = { ...submission, state: 'failed', recorded: true, message: outcome.message };
  else if (outcome.kind === 'uncertain') next = { ...submission, state: 'uncertain', recorded: true, message: outcome.message };
  else if (outcome.kind === 'pending') next = { ...submission, state: 'pending', message: undefined };
  else return submission;
  next.updatedAt = Date.now();
  await put(`submission:${next.id}`, next);
  if (next.state === 'success') await finishSuccess(next.draftKey, next.id);
  return next;
}
async function handle(message: Message): Promise<unknown> {
  await ready;
  switch (message.type) {
    case 'settings': return view();
    case 'pair': {
      const origin = normalizeSiteAddress(message.origin, manifestAllowsLocalHttp(chrome.runtime.getManifest()));
      const pin = normalizePin(message.pin);
      const label = cleanDeviceLabel(message.deviceLabel);
      const pattern = originPattern(origin);
      if (!await chrome.permissions.contains({ origins: [pattern] })) throw new AppError(`Chrome has not given permission to reach ${origin}. Click Pair this device and choose Allow.`, 'permission_denied');
      const previous = await get<Site>('site');
      let result;
      try { result = await new PluginClient(origin).pair(pin, label); }
      catch (error) {
        // A PIN refusal proves this is the right site. Anything else may be a mistyped address, so do not keep access to it.
        const known = error instanceof AppError && ['pin_refused', 'pin_malformed', 'device_limit', 'pairing_paused'].includes(error.code);
        if (!known && previous?.origin !== origin) await chrome.permissions.remove({ origins: [pattern] }).catch(() => undefined);
        throw error;
      }
      if (previous && previous.origin !== origin) {
        await chrome.storage.local.remove(['options', 'defaultTeam', 'brand', 'expressEnabled', 'cartsEnabled']);
        await chrome.permissions.remove({ origins: [originPattern(previous.origin)] }).catch(() => undefined);
      }
      const site: Site = { origin, memberName: result.memberName, deviceLabel: label, pairedAt: Date.now() };
      await chrome.storage.local.set({ deviceKey: result.deviceKey, site });
      // Pairing always asks for the colors, however recently they were read.
      await chrome.storage.local.remove('brandAttemptAt');
      // Pairing has succeeded either way. The page shows the team list when it loads.
      await refreshOptions().catch(() => undefined);
      return view();
    }
    case 'unpair': {
      const site = await get<Site>('site');
      // Tell the site first, while the key and the permission are still here. Any failure still unpairs this computer.
      let revokedOnSite = false;
      try { revokedOnSite = await (await paired()).client.revokeSelf(); }
      catch { /* Offline, expired or no permission: Options says an Admin may need to remove the device. */ }
      await chrome.storage.local.remove(['deviceKey', 'site', 'options', 'defaultTeam', 'brand', 'brandAttemptAt', 'expressEnabled', 'cartsEnabled']);
      if (site) await chrome.permissions.remove({ origins: [originPattern(site.origin)] }).catch(() => undefined);
      return { ...await view(), revokedOnSite };
    }
    case 'refresh-options': return refreshOptions();
    case 'set-theme':
      if (message.theme !== 'dark' && message.theme !== 'light') throw new AppError('Unknown theme.');
      await put('theme', message.theme);
      return view();
    case 'set-express':
      if (typeof message.enabled !== 'boolean') throw new AppError('Unknown setting.');
      if (message.enabled && (await view()).pairing !== 'paired') throw new AppError('Pair this device first.');
      await put('expressEnabled', message.enabled);
      return view();
    case 'set-carts':
      if (typeof message.enabled !== 'boolean') throw new AppError('Unknown setting.');
      if (message.enabled && (await view()).pairing !== 'paired') throw new AppError('Pair this device first.');
      await put('cartsEnabled', message.enabled);
      return view();
    case 'carts-orders': {
      const outcome = await device(client => client.orders(message.refresh === true));
      // The Admin's switch can change between option reads. Keep the saved copy honest, so the popup hides or shows Carts correctly.
      if (outcome.kind === 'disabled' || outcome.kind === 'orders') {
        const options = await get<DeviceOptions>('options');
        const enabled = outcome.kind === 'orders';
        if (options && options.cartsEnabled !== enabled) await put('options', { ...options, cartsEnabled: enabled });
      }
      return outcome;
    }
    case 'carts-marks': {
      if (!Array.isArray(message.marks) || message.marks.length > 100) throw new AppError('Too many cart marks at once.');
      return device(client => client.mark(message.marks));
    }
    case 'save-defaults': {
      const options = await get<DeviceOptions>('options');
      if (!options?.teams.some(t => t.id === message.defaultTeam)) throw new AppError('Choose a team.');
      if (!options.recipients.some(p => p.id === message.defaultRecipient)) throw new AppError('Choose your name.');
      await device(client => client.saveRecipient(message.defaultRecipient));
      await chrome.storage.local.set({ defaultTeam: message.defaultTeam, options: { ...options, defaultRecipientId: message.defaultRecipient } });
      return view();
    }
    case 'check-repeats': {
      if (typeof message.url !== 'string' || typeof message.sku !== 'string' || !vendorForUrl(message.url)) return { repeats: [] };
      return { repeats: await device(client => client.check(message.url, message.sku.slice(0, 2000))) };
    }
    case 'capture': return oneAtATime(message.tabId, () => captureTab(message.tabId, message.auto === true));
    case 'save-draft': {
      const input = message.record;
      validKey(input?.key); validId(input?.submissionId);
      // All popup edits are sent immediately; serialize writes here so closing the
      // popup cannot strand queued edits in that destroyed document.
      const write = draftWrites.then(async () => {
        const previous = await recordFor(input.key);
        if (previous.submissionId !== input.submissionId) throw new AppError('This form is out of date. Reopen the extension.');
        if (await get<Submission>(`submission:${previous.submissionId}`)) throw new AppError('This submission is already recorded. Use New request or the retry action.');
        if (!Number.isFinite(input.updatedAt) || JSON.stringify(input.draft).length > 12000) throw new AppError('The request is invalid or too long.');
        if (input.updatedAt <= previous.updatedAt) return true;
        const edited = previous.edited || JSON.stringify(wireDraft(previous.draft)) !== JSON.stringify(wireDraft(input.draft));
        await put(`draft:${input.key}`, { ...previous, draft: input.draft, updatedAt: input.updatedAt, ...(edited ? { edited } : {}) }); return true;
      });
      draftWrites = write.catch(() => undefined);
      return write;
    }
    case 'discard': {
      validKey(message.key);
      if (await get(`receipt:${message.key}`)) { await chrome.storage.local.remove(`receipt:${message.key}`); return true; }
      const record = await recordFor(message.key);
      const submission = await get<Submission>(`submission:${record.submissionId}`);
      if (submission?.state === 'pending' || submission?.state === 'uncertain') throw new AppError('Check the pending result in Notion before starting over.');
      await chrome.storage.local.remove(`draft:${message.key}`); return true;
    }
    case 'submission': {
      validId(message.id);
      const stored = await get<Submission>(`submission:${message.id}`);
      return stored ? await reconciled(stored) : null;
    }
    case 'submit': {
      validId(message.submissionId); validKey(message.key);
      const existing = await get<Submission>(`submission:${message.submissionId}`);
      if (existing?.draftKey === message.key) return existing;
      const record = await recordFor(message.key);
      if (record.submissionId !== message.submissionId) throw new AppError('This submission is out of date. Reopen the extension.');
      await paired();
      const options = await get<DeviceOptions>('options');
      const errors = validateDraft(record.draft, options);
      if (errors.length) throw new AppError(errors.join(' '));
      // A student has chosen to send this one, so Express addition leaves it alone from now on, whatever comes back.
      if (record.express?.state !== 'manual') await put(`draft:${record.key}`, { ...record, express: { state: 'manual', reasons: record.express?.reasons ?? [] } } satisfies DraftRecord);
      active.add(record.submissionId);
      try {
        const result = await manager.submit(record.submissionId, record.key, () => device(client => sendOnce(client, record)), { facts: factsFor(record.draft, record.capture.vendor, options) });
        if (result.state === 'success') {
          await finishSuccess(record.key, record.submissionId);
          // A member's first chosen person becomes their default, if they skipped choosing one in settings.
          if (record.draft.recipient && options && !options.defaultRecipientId) {
            await device(client => client.saveRecipient(record.draft.recipient))
              .then(() => put('options', { ...options, defaultRecipientId: record.draft.recipient }))
              .catch(() => undefined);
          }
        }
        return result;
      } finally { active.delete(record.submissionId); }
    }
    case 'restart': {
      const record = await recordFor(message.key);
      const status = await get<Submission>(`submission:${record.submissionId}`);
      if (status?.state === 'pending' && (active.has(status.id) || Date.now() - status.updatedAt < STALE_MS)) throw new AppError('The request is still being sent. Wait for the result.');
      if (status && ['pending', 'uncertain'].includes(status.state) && message.acknowledgeUncertain !== true) throw new AppError('Check Notion and confirm the request was not created before retrying.');
      // Retrying is the student's choice, made on the form. Express addition never picks this draft up again by itself.
      const chosen: DraftRecord = { ...record, express: { state: 'manual', reasons: [] } };
      // The server allows one create per ID, so an ID with no recorded result is the safest one to send again. A recorded ID is used up.
      if (status && !status.recorded) {
        await chrome.storage.local.remove(`submission:${status.id}`);
        await put(`draft:${record.key}`, chosen);
        return chosen;
      }
      const next = { ...chosen, submissionId: crypto.randomUUID(), updatedAt: Date.now() };
      await put(`draft:${record.key}`, next); return next;
    }
    default: throw new AppError('Unknown extension operation.');
  }
}

chrome.runtime.onMessage.addListener((message: Message, sender, respond) => {
  const allowed = [chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('options.html'), chrome.runtime.getURL('carts.html')];
  if (sender.id !== chrome.runtime.id || !sender.url || !allowed.includes(sender.url.split('?')[0].split('#')[0])) {
    respond({ ok: false, error: 'Untrusted message source.' }); return false;
  }
  handle(message).then(data => respond({ ok: true, data }), error => respond({
    ok: false, error: error instanceof AppError ? error.message : 'An extension operation failed. Your request was not automatically retried.',
    code: error instanceof AppError ? error.code : 'internal', details: error instanceof AppError ? error.details : undefined,
  }));
  return true;
});
