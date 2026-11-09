import { capturePage } from './reader';
import { vendorForUrl } from './vendors';
import { AppError, NotionClient, validateDraft } from './notion';
import { SubmissionManager } from './submissions';
import type { Configuration, DraftRecord, Message, Person, Schema, Submission } from './types';

const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const get = async <T>(key: string): Promise<T | undefined> => (await chrome.storage.local.get(key))[key] as T | undefined;
const put = async (key: string, value: unknown): Promise<void> => chrome.storage.local.set({ [key]: value });
let draftWrites: Promise<unknown> = Promise.resolve();
const manager = new SubmissionManager({
  get: id => get<Submission>(`submission:${id}`),
  set: s => put(`submission:${s.id}`, s),
});
async function connected(): Promise<{ config: Configuration; client: NotionClient }> {
  const config = await get<Configuration>('config');
  const token = await get<string>('token');
  if (!config || !token) throw new AppError('Connect the ordering database in settings first.', 'setup');
  return { config, client: new NotionClient(token) };
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
const uniquePeople = (people: Person[]): Person[] => [...new Map(people.map(p => [p.id, p])).values()].sort((a, b) => a.name.localeCompare(b.name));
// Finding guests is a convenience. If it fails, members and the manual import still work, so report it without failing.
async function lookupRecipients(client: NotionClient, schema: Schema): Promise<{ people: Person[]; summary: string; failed: boolean }> {
  try {
    const { people, requests } = await client.recipientsFromRequests(schema);
    return { people, failed: false, summary: `Found ${people.length} ${people.length === 1 ? 'person' : 'people'} on ${requests} existing ${requests === 1 ? 'request' : 'requests'}.` };
  } catch (error) {
    return { people: [], failed: true, summary: `Could not read existing requests to find guests: ${error instanceof AppError ? error.message : 'unexpected error'}` };
  }
}
async function handle(message: Message): Promise<unknown> {
  await ready;
  switch (message.type) {
    case 'settings': return { config: await get<Configuration>('config'), hasToken: !!await get<string>('token') };
    case 'connect': {
      const existing = await get<Configuration>('config');
      const token = typeof message.token === 'string' && message.token.trim() || await get<string>('token');
      if (!token || /\s/.test(token) || token.length > 1000) throw new AppError('Enter a valid connection token.');
      const client = new NotionClient(token);
      const schema = await client.connect(message.databaseUrl, message.dataSourceId, existing?.schema);
      const same = existing?.schema.dataSourceId === schema.dataSourceId;
      const members = await client.members();
      const lookup = await lookupRecipients(client, schema);
      const people = uniquePeople([...(same ? existing.people : []), ...lookup.people, ...members]);
      const config: Configuration = {
        databaseUrl: `https://www.notion.so/${schema.databaseId.replaceAll('-', '')}`,
        schema, people,
        defaultTeam: same && schema.properties.team.options?.some(t => t.id === existing.defaultTeam) ? existing.defaultTeam : '',
        defaultRecipient: same && people.some(p => p.id === existing.defaultRecipient) ? existing.defaultRecipient : '',
      };
      await chrome.storage.local.set({ token, config });
      return { config, recipientSummary: lookup.summary, recipientLookupFailed: lookup.failed };
    }
    case 'refresh-people': {
      const { config, client } = await connected();
      const [lookup, members] = await Promise.all([lookupRecipients(client, config.schema), client.members().catch(() => [] as Person[])]);
      // Read again after the slow lookup so defaults saved in the meantime are kept.
      const latest = await get<Configuration>('config');
      if (!latest || latest.schema.dataSourceId !== config.schema.dataSourceId) return { config: latest, recipientSummary: '', recipientLookupFailed: false };
      const next = { ...latest, people: uniquePeople([...latest.people, ...lookup.people, ...members]) };
      await put('config', next);
      return { config: next, recipientSummary: lookup.summary, recipientLookupFailed: lookup.failed };
    }
    case 'save-settings': {
      const { config } = await connected();
      if (!config.schema.properties.team.options?.some(t => t.id === message.defaultTeam)) throw new AppError('Choose a team.');
      if (!config.people.some(p => p.id === message.defaultRecipient)) throw new AppError('Choose a recipient. Import an existing request if you are a guest.');
      const next = { ...config, defaultTeam: message.defaultTeam, defaultRecipient: message.defaultRecipient };
      await put('config', next); return next;
    }
    case 'import-people': {
      const { config, client } = await connected();
      const people = await client.peopleFromPage(message.pageUrl, config.schema);
      const next = { ...config, people: uniquePeople([...config.people, ...people]) };
      await put('config', next); return { config: next, imported: people };
    }
    case 'disconnect': {
      await chrome.storage.local.remove(['config', 'token']); return true;
    }
    case 'capture': {
      if (!Number.isInteger(message.tabId)) throw new AppError('Open a product in a regular Chrome tab.');
      const tab = await chrome.tabs.get(message.tabId);
      const vendor = vendorForUrl(tab.url || '');
      if (!vendor) return { unsupported: true };
      const key = `${tab.id}:${tab.url}`;
      validKey(key);
      const receipt = await get<{ submissionId: string }>(`receipt:${key}`);
      if (receipt) return { key, submission: await get<Submission>(`submission:${receipt.submissionId}`) };
      const previous = await get<DraftRecord>(`draft:${key}`);
      if (previous) return { record: previous, submission: await get<Submission>(`submission:${previous.submissionId}`) };
      let capture;
      try {
        const results = await chrome.scripting.executeScript({ target: { tabId: message.tabId }, world: 'ISOLATED', func: capturePage, args: [vendor] });
        capture = results[0]?.result;
      } catch { throw new AppError('Chrome could not read this tab. Wait for the product page to load, then reopen the extension.', 'capture'); }
      if (!capture || capture.url !== tab.url) throw new AppError('The page changed during capture. Reopen the extension.');
      if (capture.kind !== 'product') return { capture };
      const config = await get<Configuration>('config');
      const record: DraftRecord = {
        key, submissionId: crypto.randomUUID(), capture, updatedAt: Date.now(),
        draft: { description: capture.description, url: capture.url, sku: capture.sku, price: capture.price, quantity: 1, status: 'NORMAL Request', team: config?.defaultTeam || '', recipient: config?.defaultRecipient || '', currencyConfirmed: capture.currency === 'USD' || !capture.currency && capture.price === null },
      };
      await put(`draft:${key}`, record);
      return { record };
    }
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
        await put(`draft:${input.key}`, { ...previous, draft: input.draft, updatedAt: input.updatedAt }); return true;
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
    case 'submission': validId(message.id); return await get<Submission>(`submission:${message.id}`) || null;
    case 'submit': {
      validId(message.submissionId); validKey(message.key);
      const existing = await get<Submission>(`submission:${message.submissionId}`);
      if (existing?.draftKey === message.key) return existing;
      const record = await recordFor(message.key);
      if (record.submissionId !== message.submissionId) throw new AppError('This submission is out of date. Reopen the extension.');
      // Completed IDs always return their original result even if settings later change.
      const { config, client } = await connected();
      const errors = validateDraft(record.draft, config);
      if (errors.length) throw new AppError(errors.join(' '));
      const result = await manager.submit(record.submissionId, record.key, () => client.create(record.draft, config));
      if (result.state === 'success') {
        await put(`receipt:${record.key}`, { submissionId: record.submissionId });
        await chrome.storage.local.remove(`draft:${record.key}`);
      }
      return result;
    }
    case 'restart': {
      const record = await recordFor(message.key);
      const status = await get<Submission>(`submission:${record.submissionId}`);
      if (status?.state === 'pending' && Date.now() - status.updatedAt < 30_000) throw new AppError('The request is still being sent. Wait for the result.');
      if (status && ['pending', 'uncertain'].includes(status.state) && message.acknowledgeUncertain !== true) throw new AppError('Check Notion and confirm the request was not created before retrying.');
      const next = { ...record, submissionId: crypto.randomUUID(), updatedAt: Date.now() };
      await put(`draft:${record.key}`, next); return next;
    }
    default: throw new AppError('Unknown extension operation.');
  }
}

chrome.runtime.onMessage.addListener((message: Message, sender, respond) => {
  const allowed = [chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('options.html')];
  if (sender.id !== chrome.runtime.id || !sender.url || !allowed.includes(sender.url.split('?')[0].split('#')[0])) {
    respond({ ok: false, error: 'Untrusted message source.' }); return false;
  }
  handle(message).then(data => respond({ ok: true, data }), error => respond({
    ok: false, error: error instanceof AppError ? error.message : 'An extension operation failed. Your request was not automatically retried.',
    code: error instanceof AppError ? error.code : 'internal', details: error instanceof AppError ? error.details : undefined,
  }));
  return true;
});
