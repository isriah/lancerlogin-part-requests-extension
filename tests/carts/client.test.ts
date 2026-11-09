import { describe, expect, it, vi } from 'vitest';
import { interpretMarks, interpretOrders, orderFrom, PluginClient } from '../../src/client';
import { API, DEVICE_KEY, SITE, response } from '../helpers';

const reply = (status: number, body: Record<string, unknown> = {}, retryAfter: number | null = null, parsed = true) => ({ status, body: body as Record<string, any>, retryAfter, parsed }); // eslint-disable-line @typescript-eslint/no-explicit-any
const row = { id: 'p1', url: 'https://app.notion.com/p/1', description: 'Test bracket', vendor: 'REV', urlVendor: 'REV', sku: 'REV-1', productUrl: 'https://www.revrobotics.com/rev-1/', quantity: 2, unitPrice: 12.5, status: 'NORMAL Request', statusGroup: 'NORMAL', teams: ['Test Team One'], requesters: ['Test Student A'], cartMarks: [{ memberName: 'Test Student B', deviceLabel: 'Workshop laptop', quantity: 2, markedMs: 5, expiresMs: 9, ownDevice: false }] };

describe('GET /orders', () => {
  it('200 shows the orders', () => {
    expect(interpretOrders(reply(200, { orders: [row], fetchedMs: 7, stale: false, refreshing: false, refreshError: null, truncated: false, skippedRows: 0 }))).toMatchObject({ kind: 'orders', fetchedMs: 7, stale: false, refreshing: false, truncated: false, skippedRows: 0, orders: [{ id: 'p1', quantity: 2 }] });
  });
  it('200 passes on stale, refreshing, truncated, skippedRows and refreshError', () => {
    expect(interpretOrders(reply(200, { orders: [], stale: true, refreshing: true, refreshError: 'rate_limited', truncated: true, skippedRows: 3 }))).toMatchObject({ stale: true, refreshing: true, refreshError: 'rate_limited', truncated: true, skippedRows: 3 });
  });
  it('202 means nothing to show yet, not no orders', () => {
    expect(interpretOrders(reply(202, { state: 'refreshing', orders: [], retryAfterSeconds: 3 }))).toEqual({ kind: 'refreshing', retryAfterSeconds: 3 });
    expect(interpretOrders(reply(202, { state: 'refreshing', orders: [] }, 5))).toEqual({ kind: 'refreshing', retryAfterSeconds: 5 });
  });
  it('403 carts_disabled shows the site\'s words', () => {
    expect(interpretOrders(reply(403, { code: 'carts_disabled', error: 'Turned off here.' }))).toEqual({ kind: 'disabled', message: 'Turned off here.' });
  });
  it.each([[429, 'rate_limited'], [502, 'notion_unavailable'], [503, 'notion_rate_limited']])('%i %s waits', (status, code) => {
    expect(interpretOrders(reply(status, { code, retryAfterSeconds: 9 }))).toMatchObject({ kind: 'wait', code, retryAfterSeconds: 9 });
  });
  it.each(['notion_access_lost', 'notion_not_connected', 'notion_schema_changed', 'credentials_unavailable', 'credentials_unreadable'])('503 %s needs an Admin', code => {
    expect(interpretOrders(reply(503, { code }))).toMatchObject({ kind: 'admin', code });
  });
  it('anything else is an error, and a body that isn\'t data never shows', () => {
    expect(interpretOrders(reply(500, {}, null, false))).toMatchObject({ kind: 'error', code: 'not_a_site' });
  });
  it('caps a very long wait', () => { expect(interpretOrders(reply(429, { code: 'rate_limited' }, 9999))).toMatchObject({ retryAfterSeconds: 120 }); });
  it('keeps blank fields blank, and drops a row it can\'t act on', () => {
    const [blank] = orderFrom({ id: 'p2', statusGroup: 'SLOW', status: 'SLOW', description: null, vendor: null, urlVendor: null, sku: null, productUrl: null, quantity: null, unitPrice: null, teams: [], requesters: [], cartMarks: [] });
    expect(blank).toMatchObject({ description: null, vendor: null, sku: null, productUrl: null, quantity: null, unitPrice: null, statusGroup: 'SLOW' });
    expect(orderFrom({ id: 'p3', statusGroup: 'ORDERED' })).toEqual([]);
    expect(orderFrom({ statusGroup: 'NORMAL' })).toEqual([]);
  });
  it('never trusts a product link that isn\'t http or https, or a page link off Notion', () => {
    expect(orderFrom({ ...row, productUrl: 'javascript:alert(1)' })[0].productUrl).toBeNull();
    expect(orderFrom({ ...row, url: 'https://evil.example.test/' })[0].url).toBeNull();
  });
  it('asks with ?refresh=1 only for the Refresh button', async () => {
    const transport = vi.fn(async () => response({ orders: [] }));
    const client = new PluginClient(SITE, DEVICE_KEY, transport as unknown as typeof fetch);
    await client.orders(); await client.orders(true);
    expect((transport.mock.calls as unknown as [string][]).map(call => call[0])).toEqual([`${API}/orders`, `${API}/orders?refresh=1`]);
  });
  it('401 becomes pair again', async () => {
    const client = new PluginClient(SITE, DEVICE_KEY, (async () => response({ code: 'pair_again' }, 401)) as unknown as typeof fetch);
    await expect(client.orders()).rejects.toMatchObject({ code: 'pair_again' });
  });
});
describe('POST /orders/marks', () => {
  it('201 is marked', () => { expect(interpretMarks(reply(201, { marked: 2, markedMs: 1, expiresMs: 2 }))).toEqual({ kind: 'marked', marked: 2 }); });
  it('403 is disabled', () => { expect(interpretMarks(reply(403, { code: 'carts_disabled', error: 'Off.' }))).toEqual({ kind: 'disabled', message: 'Off.' }); });
  it('429 and maintenance wait', () => {
    expect(interpretMarks(reply(429, { code: 'rate_limited', retryAfterSeconds: 4 }))).toMatchObject({ kind: 'wait', retryAfterSeconds: 4 });
    expect(interpretMarks(reply(503, { code: 'update_maintenance' }, 30))).toMatchObject({ kind: 'wait', retryAfterSeconds: 30 });
  });
  it('409 and 400 are errors, with nothing retried by itself', () => {
    expect(interpretMarks(reply(409, { code: 'too_many_marks', error: 'Too many.' }))).toMatchObject({ kind: 'error', code: 'too_many_marks' });
    expect(interpretMarks(reply(400, { code: 'validation' }))).toMatchObject({ kind: 'error' });
  });
  it('sends only the order and the quantity', async () => {
    const transport = vi.fn(async () => response({ marked: 1 }, 201));
    await new PluginClient(SITE, DEVICE_KEY, transport as unknown as typeof fetch).mark([{ orderId: 'p1', quantity: 2, extra: 'no' } as never]);
    expect(JSON.parse(String((transport.mock.calls as unknown as [string, RequestInit][])[0][1].body))).toEqual({ marks: [{ orderId: 'p1', quantity: 2 }] });
  });
});
