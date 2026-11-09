import { AppError } from './errors';
import { parseBranding } from './brand';
import { apiBase } from './pairing';
import { isVersion } from './version';
import type { CartMark, CartOrder, MarkInput, MarksOutcome, OrdersOutcome, StatusGroup } from './carts/types';
import type { DeviceOptions, Repeat, RequestDraft } from './types';

type Json = Record<string, any>;
interface Reply { status: number; body: Json; retryAfter: number | null; parsed: boolean }
export const REQUEST_TIMEOUT_MS = 40_000;
/** A student is waiting on Unpair, which goes ahead on this computer either way. */
export const REVOKE_TIMEOUT_MS = 10_000;
/** Team colors are decoration, and the checks before an Express send have a student waiting. Neither should hold anything up. */
export const QUICK_TIMEOUT_MS = 10_000;
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
/** The update link is the plugin's choice of page, so it only has to be https. */
export function safeUpdateUrl(value: unknown): string | null {
  try {
    const u = new URL(String(value));
    if (u.protocol === 'https:' && !u.username && !u.password) return u.href;
  } catch { /* No link, and the notice still shows. */ }
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
const string = (value: unknown, limit = 2000): string | null => typeof value === 'string' && value.trim() ? value.slice(0, limit) : null;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(item => string(item, 200) ?? []) : [];
/** The plugin promises http or https. Nothing else is ever shown as a link or used to find a product. */
function safeProductUrl(value: unknown): string | null {
  try {
    const u = new URL(String(value));
    if (value && ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password) return u.href;
  } catch { /* Blank, like a row with no link. */ }
  return null;
}
const GROUPS: readonly StatusGroup[] = ['NORMAL', 'RUSH', 'SLOW', 'INCOMPLETE'];
function markFrom(value: Json): CartMark[] {
  if (!value || typeof value !== 'object' || !Number.isFinite(value.quantity)) return [];
  return [{ memberName: string(value.memberName, 120) ?? 'Someone', deviceLabel: string(value.deviceLabel, 120) ?? '', quantity: value.quantity, markedMs: Number.isFinite(value.markedMs) ? value.markedMs : 0, expiresMs: Number.isFinite(value.expiresMs) ? value.expiresMs : 0, ownDevice: value.ownDevice === true }];
}
/** Rows are also written by hand in Notion, so anything can be blank. A row without an ID or a known group can't be acted on, and is left out. */
export function orderFrom(value: Json): CartOrder[] {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !GROUPS.includes(value.statusGroup)) return [];
  return [{
    id: value.id.slice(0, 200), url: safePageUrl(value.url), description: string(value.description), vendor: string(value.vendor, 200), urlVendor: string(value.urlVendor, 200),
    sku: string(value.sku), productUrl: safeProductUrl(value.productUrl), quantity: Number.isFinite(value.quantity) && value.quantity > 0 ? value.quantity : null, unitPrice: Number.isFinite(value.unitPrice) && value.unitPrice >= 0 ? value.unitPrice : null,
    status: string(value.status, 200) ?? value.statusGroup, statusGroup: value.statusGroup, teams: strings(value.teams), requesters: strings(value.requesters),
    cartMarks: Array.isArray(value.cartMarks) ? value.cartMarks.flatMap(markFrom) : [],
  }];
}
const ADMIN_CODES = new Set(['notion_access_lost', 'notion_not_connected', 'notion_schema_changed', 'credentials_unavailable', 'credentials_unreadable']);
const WAIT_CODES = new Set(['rate_limited', 'notion_unavailable', 'notion_rate_limited', 'update_maintenance']);
const waitFor = (reply: Reply, fallback: number): number => {
  const said = reply.retryAfter ?? (Number.isFinite(reply.body.retryAfterSeconds) ? reply.body.retryAfterSeconds : fallback);
  return Math.min(Math.max(said, 1), 120);
};
const CARTS_OFF = 'An Admin turned Carts off for your team.';
/** Maps every answer of GET /orders to what the page does. See "How GET /orders reads Notion" in the plugin's README. */
export function interpretOrders(reply: Reply): OrdersOutcome {
  const { status, body, parsed } = reply;
  const code = text(body.code, parsed ? 'refused' : 'not_a_site');
  if (status === 200 && parsed && Array.isArray(body.orders)) {
    return {
      kind: 'orders', orders: body.orders.flatMap(orderFrom), fetchedMs: Number.isFinite(body.fetchedMs) ? body.fetchedMs : null, stale: body.stale === true, refreshing: body.refreshing === true,
      refreshError: string(body.refreshError, 200), truncated: body.truncated === true, skippedRows: (Number.isFinite(body.skippedRows) && body.skippedRows > 0 ? body.skippedRows : 0) + body.orders.filter((row: Json) => !orderFrom(row).length).length,
    };
  }
  if (status === 202) return { kind: 'refreshing', retryAfterSeconds: waitFor(reply, 2) };
  if (status === 403 && code === 'carts_disabled') return { kind: 'disabled', message: text(body.error, CARTS_OFF) };
  if (ADMIN_CODES.has(code)) return { kind: 'admin', code, message: text(body.error, 'The site can\'t read the ordering database right now. An Admin has to fix this.') };
  if (WAIT_CODES.has(code)) return { kind: 'wait', code, message: text(body.error, 'The site is busy reading the ordering database.'), retryAfterSeconds: waitFor(reply, 30) };
  return { kind: 'error', code, message: parsed ? text(body.error, 'The site did not return the open orders. Try again shortly.') : 'The site did not return the open orders. Try again shortly.' };
}
export function interpretMarks(reply: Reply): MarksOutcome {
  const { status, body, parsed } = reply;
  const code = text(body.code, parsed ? 'refused' : 'not_a_site');
  if (status === 201 && parsed) return { kind: 'marked', marked: Number.isFinite(body.marked) ? body.marked : 0 };
  if (status === 403 && code === 'carts_disabled') return { kind: 'disabled', message: text(body.error, CARTS_OFF) };
  if (status === 429 || status === 503 && (code === 'update_maintenance' || !parsed && reply.retryAfter !== null)) return { kind: 'wait', code, message: status === 429 ? 'The site asked to wait a moment.' : 'The site is updating.', retryAfterSeconds: waitFor(reply, 30) };
  return { kind: 'error', code, message: parsed ? text(body.error, 'The site did not record this.') : 'The site did not record this.' };
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
  private async call(path: string, method: 'GET' | 'POST', body?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Reply> {
    let response: Response;
    try {
      response = await this.transport(`${apiBase(this.origin)}${path}`, {
        method,
        headers: { ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // A redirect could carry the key elsewhere, and cookies have no part in this.
        credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
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
  /**
   * The team's colors and name from Core's public status. It never sends the key, which this route has no use for. `null` means
   * the site didn't answer, or answered with anything that fails validation.
   */
  async branding() {
    try {
      const response = await this.transport(`${this.origin}/api/setup/status`, { method: 'GET', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(QUICK_TIMEOUT_MS) });
      return response.ok ? parseBranding(await response.json()) : null;
    } catch { return null; }
  }
  async pair(pin: string, deviceLabel: string): Promise<{ deviceKey: string; memberName: string }> {
    const reply = await this.call('/pair', 'POST', { pin, ...(deviceLabel ? { deviceLabel } : {}) });
    if (reply.status === 201 && typeof reply.body.deviceKey === 'string' && /^[A-Za-z0-9_-]{43}$/.test(reply.body.deviceKey)) {
      return { deviceKey: reply.body.deviceKey, memberName: text(reply.body.memberName, '') };
    }
    throw this.refused(reply, `${this.origin} did not answer like a site with Part Requests. Check the address from Discord.`);
  }
  async options(timeoutMs = REQUEST_TIMEOUT_MS): Promise<DeviceOptions> {
    const reply = await this.call('/options', 'GET', undefined, timeoutMs);
    if (reply.status !== 200 || !reply.parsed || !Array.isArray(reply.body.teams) || !Array.isArray(reply.body.recipients)) throw this.refused(reply, 'The site did not return the team list. Try again shortly.');
    const choices = (list: Json[]) => list.filter(c => c && typeof c.id === 'string').map(c => ({ id: c.id, name: String(c.name ?? c.id) }));
    return {
      memberName: text(reply.body.memberName, ''), teams: choices(reply.body.teams), recipients: choices(reply.body.recipients),
      defaultRecipientId: typeof reply.body.defaultRecipientId === 'string' ? reply.body.defaultRecipientId : null,
      recipientsUpdatedMs: typeof reply.body.recipientsUpdatedMs === 'number' ? reply.body.recipientsUpdatedMs : null,
      minimumExtensionVersion: isVersion(reply.body.minimumExtensionVersion) ? reply.body.minimumExtensionVersion : null,
      updateUrl: safeUpdateUrl(reply.body.updateUrl),
      databaseLink: safePageUrl(reply.body.databaseLink),
      ...(typeof reply.body.cartsEnabled === 'boolean' ? { cartsEnabled: reply.body.cartsEnabled } : {}),
    };
  }
  async orders(refresh = false): Promise<OrdersOutcome> { return interpretOrders(await this.call(`/orders${refresh ? '?refresh=1' : ''}`, 'GET')); }
  /** Up to 100 at a time, as the plugin allows. Only an order's ID and its quantity go to the site. */
  async mark(marks: MarkInput[]): Promise<MarksOutcome> {
    return interpretMarks(await this.call('/orders/marks', 'POST', { marks: marks.map(({ orderId, quantity }) => ({ orderId, quantity })) }));
  }
  /** True only when the site confirmed this key is revoked. Offline and an unknown key reject, as on any other call. */
  async revokeSelf(): Promise<boolean> {
    const reply = await this.call('/devices/self/revoke', 'POST', undefined, REVOKE_TIMEOUT_MS);
    return reply.status === 200 && reply.body.revoked === true;
  }
  async saveRecipient(notionUserId: string | null): Promise<void> {
    const reply = await this.call('/recipient', 'POST', { notionUserId });
    if (reply.status !== 200) throw this.refused(reply, 'The site did not save your name. Try again shortly.');
  }
  async check(url: string, sku: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Repeat[]> {
    const reply = await this.call('/check', 'POST', { url, sku }, timeoutMs);
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
