import { AppError } from './errors';
import { apiBase } from './pairing';
import type { DeviceOptions, Repeat, RequestDraft } from './types';

type Json = Record<string, any>;
interface Reply { status: number; body: Json; retryAfter: number | null; parsed: boolean }
export const REQUEST_TIMEOUT_MS = 40_000;
const NO_ANSWER = 'The site did not confirm this request. It may already exist.';
const CONFLICT = 'A request with this ID already exists with different details. Check the ordering database in Notion.';

/** The result of one POST /requests. Everything the plugin's README lists lands in exactly one of these. */
export type CreateOutcome =
  | { kind: 'created'; pageUrl: string; repeats: Repeat[] }
  | { kind: 'pending' }
  | { kind: 'uncertain'; message: string }
  | { kind: 'failed'; message: string; code: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'refused'; message: string; code: string; retryAfterSeconds?: number }
  | { kind: 'maintenance'; retryAfterSeconds: number }
  | { kind: 'no-answer'; message: string };

const text = (value: unknown, fallback: string): string => typeof value === 'string' && value.trim() ? value.slice(0, 500) : fallback;
function repeatsFrom(value: unknown): Repeat[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: Json): Repeat[] => item && typeof item.memberName === 'string' && Number.isFinite(item.createdMs)
    ? [{ memberName: item.memberName.slice(0, 120), createdMs: item.createdMs, pageUrl: safePageUrl(item.pageUrl), state: String(item.state ?? '') }] : []);
}
/** Only ever show a link to Notion, whatever a response says. */
export function safePageUrl(value: unknown): string | null {
  try {
    const u = new URL(String(value));
    if (u.protocol === 'https:' && ['notion.so', 'notion.com'].some(h => u.hostname === h || u.hostname.endsWith(`.${h}`))) return u.href;
  } catch { /* Never display an arbitrary link from an unexpected response. */ }
  return null;
}
/** Maps a status and body to what the extension should do. See "Results of POST /requests" in the plugin's README. */
export function interpretCreate({ status, body, retryAfter, parsed }: Reply): CreateOutcome {
  if (status === 503 && (body.code === 'update_maintenance' || !parsed && retryAfter !== null)) return { kind: 'maintenance', retryAfterSeconds: retryAfter ?? 30 };
  if (body.state === 'created') {
    const pageUrl = safePageUrl(body.pageUrl);
    return pageUrl ? { kind: 'created', pageUrl, repeats: repeatsFrom(body.repeats) } : { kind: 'uncertain', message: 'The request was accepted, but the site did not return a valid page link. Check the ordering database in Notion.' };
  }
  if (body.state === 'pending') return { kind: 'pending' };
  if (body.state === 'uncertain') return { kind: 'uncertain', message: text(body.error, NO_ANSWER) };
  if (body.state === 'failed') return { kind: 'failed', message: text(body.error, 'Notion refused this request, so nothing was created.'), code: text(body.code, 'failed') };
  if (body.code === 'submission_conflict') return { kind: 'conflict', message: CONFLICT };
  if (status >= 500 && !body.code || status >= 500 && status !== 503 || !parsed) return { kind: 'no-answer', message: NO_ANSWER };
  if (status >= 400) {
    const errors = Array.isArray(body.errors) ? body.errors.filter((e: unknown) => typeof e === 'string').join(' ') : '';
    return { kind: 'refused', message: errors || text(body.error, 'The site refused this request. Nothing was created.'), code: text(body.code, 'refused'), ...(retryAfter === null ? {} : { retryAfterSeconds: retryAfter }) };
  }
  return { kind: 'no-answer', message: NO_ANSWER };
}
/** Exactly the fields the plugin accepts: it refuses a draft with anything else. */
export const wireDraft = (d: RequestDraft): RequestDraft => ({
  description: d.description, status: d.status, url: d.url, sku: d.sku, team: d.team, recipient: d.recipient,
  quantity: d.quantity, price: d.price, currencyConfirmed: d.currencyConfirmed,
});
export class PluginClient {
  // The wrapper matters: Chrome throws "Illegal invocation" if native fetch is called as a method of this class.
  constructor(private origin: string, private key?: string, private transport: typeof fetch = (input, init) => fetch(input, init)) {}
  /** Network failures reject with a `network` AppError. Any HTTP answer resolves. A 401 on a keyed call becomes `pair_again`. */
  private async call(path: string, method: 'GET' | 'POST', body?: unknown): Promise<Reply> {
    let response: Response;
    try {
      response = await this.transport(`${apiBase(this.origin)}${path}`, {
        method,
        headers: { ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // A redirect could carry the key elsewhere, and cookies have no part in this.
        credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      console.warn('Site request failed before a response:', error instanceof Error ? error.name : 'unknown error');
      throw new AppError(`Could not reach ${this.origin}. Check your connection.`, 'network', true);
    }
    let parsed: Json = {}; let ok = false;
    try { const value = await response.json(); if (value && typeof value === 'object' && !Array.isArray(value)) { parsed = value; ok = true; } } catch { /* Handled by each caller. */ }
    const seconds = Number(response.headers.get('Retry-After'));
    const reply = { status: response.status, body: parsed, parsed: ok, retryAfter: response.headers.has('Retry-After') && Number.isFinite(seconds) ? seconds : null };
    if (this.key && reply.status === 401) throw new AppError(text(parsed.error, 'This device is no longer paired. Run /ordering-pin in Discord and pair it again.'), 'pair_again', false, true);
    return reply;
  }
  private refused(reply: Reply, fallback: string): AppError {
    if (reply.status === 503 && reply.body.code === 'update_maintenance') return new AppError('The site is updating. Try again in a minute.', 'update_maintenance', false, true);
    return new AppError(reply.parsed ? text(reply.body.error, fallback) : fallback, text(reply.body.code, reply.parsed ? 'refused' : 'not_a_site'), false, true);
  }
  async pair(pin: string, deviceLabel: string): Promise<{ deviceKey: string; memberName: string }> {
    const reply = await this.call('/pair', 'POST', { pin, ...(deviceLabel ? { deviceLabel } : {}) });
    if (reply.status === 201 && typeof reply.body.deviceKey === 'string' && /^[A-Za-z0-9_-]{43}$/.test(reply.body.deviceKey)) {
      return { deviceKey: reply.body.deviceKey, memberName: text(reply.body.memberName, '') };
    }
    throw this.refused(reply, `${this.origin} did not answer like a site with Part Requests. Check the address from Discord.`);
  }
  async options(): Promise<DeviceOptions> {
    const reply = await this.call('/options', 'GET');
    if (reply.status !== 200 || !reply.parsed || !Array.isArray(reply.body.teams) || !Array.isArray(reply.body.recipients)) throw this.refused(reply, 'The site did not return the team list. Try again shortly.');
    const choices = (list: Json[]) => list.filter(c => c && typeof c.id === 'string').map(c => ({ id: c.id, name: String(c.name ?? c.id) }));
    return {
      memberName: text(reply.body.memberName, ''), teams: choices(reply.body.teams), recipients: choices(reply.body.recipients),
      defaultRecipientId: typeof reply.body.defaultRecipientId === 'string' ? reply.body.defaultRecipientId : null,
      recipientsUpdatedMs: typeof reply.body.recipientsUpdatedMs === 'number' ? reply.body.recipientsUpdatedMs : null,
    };
  }
  async saveRecipient(notionUserId: string | null): Promise<void> {
    const reply = await this.call('/recipient', 'POST', { notionUserId });
    if (reply.status !== 200) throw this.refused(reply, 'The site did not save your name. Try again shortly.');
  }
  async check(url: string, sku: string): Promise<Repeat[]> {
    const reply = await this.call('/check', 'POST', { url, sku });
    if (reply.status !== 200) throw this.refused(reply, 'The repeat check did not run.');
    return repeatsFrom(reply.body.repeats);
  }
  async create(submissionId: string, draft: RequestDraft): Promise<CreateOutcome> {
    let reply: Reply;
    try { reply = await this.call('/requests', 'POST', { submissionId, draft: wireDraft(draft) }); }
    catch (error) {
      if (error instanceof AppError && error.code === 'network') return { kind: 'no-answer', message: NO_ANSWER };
      throw error;
    }
    return interpretCreate(reply);
  }
  /** Reads the recorded result without resending anything. `undefined` means the site has no record of this ID. */
  async recorded(submissionId: string): Promise<CreateOutcome | undefined> {
    const reply = await this.call(`/requests/${submissionId}`, 'GET');
    return reply.status === 404 && reply.body.code === 'not_found' ? undefined : interpretCreate(reply);
  }
}
