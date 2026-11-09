// Thrifty Bot is a Shopify store. These run its method against synthetic answers shaped like the store's own, including its pack items and pre-orders.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineProblem } from '../../src/carts/store-method';
import { allowedInTab, isOnStore } from '../../src/carts/safety';
import { shopifyAddLine, shopifyReadCart } from '../../src/carts/stores/shopify';
import { thrifty } from '../../src/carts/stores/thrifty';
import { hereTab, order } from './helpers';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const stub = (...replies: Response[]) => { let n = 0; const mock = vi.fn(async () => replies[Math.min(n++, replies.length - 1)]); vi.stubGlobal('fetch', mock); return mock; };
afterEach(() => vi.unstubAllGlobals());
const row = (extra = {}) => order({ vendor: 'Thrifty Bot', urlVendor: 'Thrifty Bot', ...extra });
const pack = { title: 'QTY 10 - Test Bushing', variants: [{ id: 111, sku: 'TTB-0004', available: true }] };
const foam = { title: 'QTY 4 - Test Foam', variants: [
  { id: 201, sku: 'TTB-0326', available: true }, { id: 202, sku: 'TTB-0314', available: false },
  { id: 203, sku: null, available: false }, { id: 204, sku: null, available: true },
] };
const url = (handle: string, variant = '') => `https://www.thethriftybot.com/products/${handle}${variant ? `?variant=${variant}` : ''}`;

describe('Thrifty Bot', () => {
  it('is a direct Shopify store on its own site', () => {
    expect(thrifty).toMatchObject({ id: 'thrifty', label: 'Thrifty Bot', badge: 'direct', cartUrl: 'https://www.thethriftybot.com/cart', startUrl: 'https://www.thethriftybot.com/cart' });
    expect(thrifty.origins).toEqual(['https://www.thethriftybot.com/*']);
    for (const good of ['https://www.thethriftybot.com/products/x', 'https://thethriftybot.com/products/x']) expect(isOnStore(thrifty, good)).toBe(true);
    for (const bad of ['https://evil.example.test/products/x', 'https://www.thethriftybot.com.evil.test/products/x', 'http://www.thethriftybot.com/products/x']) expect(isOnStore(thrifty, bad)).toBe(false);
    expect(allowedInTab(thrifty, 'https://www.thethriftybot.com/checkout')).toBe(false);
    expect(allowedInTab(thrifty, 'https://www.thethriftybot.com/cart/111:10')).toBe(false);
    expect(allowedInTab(thrifty, 'https://www.thethriftybot.com/cart')).toBe(true);
  });
  it('asks for a product link on its own site', () => {
    expect(thrifty.missing!(row({ productUrl: 'https://www.thethriftybot.com/products/qty-10-test' }))).toEqual([]);
    expect(thrifty.missing!(row({ productUrl: 'https://www.revrobotics.com/test/' }))).toEqual(["a product link on Thrifty Bot's site"]);
    expect(thrifty.missing!(row({ productUrl: 'https://www.thethriftybot.com/collections/all' }))).toEqual(["a product link on Thrifty Bot's site"]);
  });
  it('resolves a "QTY 10" pack to its one variant, and keeps the quantity as packs', async () => {
    const mock = stub(json(pack));
    const target = await thrifty.steps!.resolveLine(row({ sku: 'ttb-0004', quantity: 3, productUrl: url('qty-10-the-thrifty-bushing') }), hereTab);
    expect(target).toEqual({ key: '111', addAs: '111', available: true });
    expect(mock.mock.calls[0][0 as never]).toBe('/products/qty-10-the-thrifty-bushing.js');
    // Three packs are sent as 3, never as 30.
    const add = stub(json({ items: [] }));
    await thrifty.steps!.addLine(hereTab, target, 3);
    expect(JSON.parse(String((add.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ items: [{ id: 111, quantity: 3 }] });
  });
  it('refuses a pack whose SKU is a different pack\'s', async () => {
    stub(json(pack));
    await expect(thrifty.steps!.resolveLine(row({ sku: 'TTB-0005', productUrl: url('qty-10-the-thrifty-bushing') }), hereTab)).rejects.toThrow(/No option on this product has SKU TTB-0005/);
  });
  it('treats a "QTY 25" pack the same way', async () => {
    stub(json({ variants: [{ id: 301, sku: 'TTB-0074', available: true }] }));
    expect(await thrifty.steps!.resolveLine(row({ sku: 'TTB-0074', quantity: 2, productUrl: url('qty-25-test-inserts') }), hereTab)).toMatchObject({ key: '301', addAs: '301' });
  });
  it('picks the exact option of a multi-option pack by saved variant, confirmed by SKU', async () => {
    stub(json(foam));
    expect(await thrifty.steps!.resolveLine(row({ sku: 'TTB-0326', productUrl: url('foam-qty-4', '201') }), hereTab)).toMatchObject({ key: '201', available: true });
    stub(json(foam));
    await expect(thrifty.steps!.resolveLine(row({ sku: 'TTB-0314', productUrl: url('foam-qty-4', '201') }), hereTab)).rejects.toThrow(/saved link's option is SKU TTB-0326/);
  });
  it('refuses a multi-option pack with no variant and no SKU, or an unmatched SKU', async () => {
    stub(json(foam)); await expect(thrifty.steps!.resolveLine(row({ sku: null, productUrl: url('foam-qty-4') }), hereTab)).rejects.toThrow(/several options/);
    stub(json(foam)); await expect(thrifty.steps!.resolveLine(row({ sku: 'TTB-9999', productUrl: url('foam-qty-4') }), hereTab)).rejects.toThrow(LineProblem);
  });
  it('options with no SKU need the saved variant, and say the SKU was unconfirmed', async () => {
    stub(json(foam));
    expect(await thrifty.steps!.resolveLine(row({ sku: 'TTB-0999', productUrl: url('foam-qty-4', '204') }), hereTab)).toMatchObject({ key: '204', note: expect.stringMatching(/could not be confirmed/) });
  });
  it('marks a sold-out option unavailable instead of adding it', async () => {
    stub(json(foam));
    expect(await thrifty.steps!.resolveLine(row({ sku: 'TTB-0314', productUrl: url('foam-qty-4', '202') }), hereTab)).toMatchObject({ key: '202', available: false });
  });
  it('treats a "Pre-Order:" item as an ordinary product, with the same exact-SKU rule', async () => {
    const pre = { title: 'Pre-Order: Test Motor', variants: [{ id: 401, sku: 'TTB-0350', available: true }] };
    stub(json(pre));
    expect(await thrifty.steps!.resolveLine(row({ sku: 'TTB-0350', productUrl: url('pulsar-775') }), hereTab)).toEqual({ key: '401', addAs: '401', available: true });
    stub(json(pre));
    await expect(thrifty.steps!.resolveLine(row({ sku: 'TTB-0351', productUrl: url('pulsar-775') }), hereTab)).rejects.toThrow(/No option/);
  });
  it('reads back only the line asked for', async () => {
    const cart = { items: [{ variant_id: 111, quantity: 3, price: 799, title: 'Wanted' }, { variant_id: 999, quantity: 4, price: 1, title: 'Someone else\'s' }] };
    stub(json(cart));
    const lines = await thrifty.steps!.readCart(hereTab, ['111']);
    expect(lines).toEqual([{ key: '111', quantity: 3, unitPrice: 7.99 }]);
    expect(JSON.stringify(lines)).not.toMatch(/Someone|999/);
  });
  it('a store refusal reaches the person, and a short cart is reported as it is for the runner to judge', async () => {
    stub(json({ status: 422, description: 'You can only add 2 of this item.' }, 422));
    await expect(thrifty.steps!.addLine(hereTab, { key: '111', addAs: '111' }, 5)).rejects.toThrow('You can only add 2 of this item.');
    stub(json({ items: [{ variant_id: 111, quantity: 2 }] }));
    expect(await shopifyReadCart(['111'])).toEqual([{ key: '111', quantity: 2, unitPrice: null }]);
  });
  it('stops the store at a wall', async () => {
    stub(new Response('', { status: 429 }));
    await expect(thrifty.steps!.resolveLine(row({ sku: 'TTB-0004', productUrl: url('qty-10-the-thrifty-bushing') }), hereTab)).rejects.toMatchObject({ reason: 'bot-check' });
    stub(new Response('', { status: 403 })); expect(await shopifyAddLine('111', 1)).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    stub(new Response('', { status: 403 })); await expect(thrifty.steps!.readCart(hereTab, ['111'])).rejects.toMatchObject({ reason: 'bot-check' });
  });
});
