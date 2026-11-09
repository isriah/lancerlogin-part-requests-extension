// CTRE is a Shopify store. These run its real steps against a stateful fake of /products, /cart.js and /cart/add.js.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStore, marksFor } from '../../src/carts/runner';
import { LineProblem, StoreStop } from '../../src/carts/store-method';
import { ctre } from '../../src/carts/stores/ctre';
import { hereTab, options, order } from './helpers';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const product = (variants: { id: number; sku: string; available?: boolean }[]) => ({ variants: variants.map(v => ({ available: true, ...v })) });
const URL_PACK = 'https://store.ctr-electronics.com/products/falcon-pack?variant=102';
/** A store: products by handle, a cart by variant ID. `cap` limits what one variant can hold, like short stock. */
function fakeShop(products: Record<string, unknown>, cart = new Map<number, number>(), cap = Infinity, wall?: number) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (wall && url.startsWith('/cart')) return new Response('', { status: wall });
    if (url.startsWith('/products/')) { const p = products[decodeURIComponent(url.slice(10).replace(/\.js$/, ''))]; return p ? json(p) : json({}, 404); }
    if (url === '/cart.js') return json({ items: [...cart].map(([variant_id, quantity]) => ({ variant_id, quantity, price: 1999 })).concat([{ variant_id: 999, quantity: 7, price: 1 }]) });
    if (url === '/cart/add.js') { for (const item of JSON.parse(String(init!.body)).items) cart.set(item.id, Math.min(cap, (cart.get(item.id) ?? 0) + item.quantity)); return json({}); }
    return json({}, 404);
  }));
  return { cart, calls };
}
afterEach(() => vi.unstubAllGlobals());

const catalog = { 'falcon-pack': product([{ id: 101, sku: 'CTR-8-1' }, { id: 102, sku: 'WCP-0001' }]), 'one-thing': product([{ id: 5, sku: 'CTR-ONE' }]) };
const wanted = (extra = {}) => order({ vendor: 'CTRE', urlVendor: 'CTRE', sku: 'WCP-0001', productUrl: URL_PACK, quantity: 2, unitPrice: 19.99, ...extra });

describe('CTRE', () => {
  it('is a direct Shopify store on its own hosts only', () => {
    expect(ctre).toMatchObject({ id: 'ctre', label: 'CTRE', badge: 'direct', origins: ['https://store.ctr-electronics.com/*'], cartUrl: 'https://store.ctr-electronics.com/cart' });
    expect(ctre.hosts).toEqual(['store.ctr-electronics.com', 'www.store.ctr-electronics.com']);
  });
  it('refuses a product link on another store', () => {
    expect(ctre.missing!(order({ productUrl: 'https://wcproducts.com/products/x' }))).toEqual(["a product link on CTRE's site"]);
    expect(ctre.missing!(wanted())).toEqual([]);
  });
  it('matches a WCP- SKU on the CTRE page, because the request names the vendor', async () => {
    fakeShop(catalog);
    expect(await ctre.steps!.resolveLine(wanted({ productUrl: 'https://store.ctr-electronics.com/products/falcon-pack' }), hereTab)).toEqual({ key: '102', addAs: '102', available: true });
  });
  it('refuses a SKU that conflicts with the saved variant, as for a different pack size', async () => {
    fakeShop(catalog);
    await expect(ctre.steps!.resolveLine(wanted({ sku: 'CTR-8-1' }), hereTab)).rejects.toThrow(/SKU CTR-8-1, but .* SKU WCP-0001/);
  });
  it('refuses a product with several options when nothing says which', async () => {
    fakeShop(catalog);
    await expect(ctre.steps!.resolveLine(wanted({ sku: null, productUrl: 'https://store.ctr-electronics.com/products/falcon-pack' }), hereTab)).rejects.toBeInstanceOf(LineProblem);
  });
  it('adds a pack count as given, reads back, and a retry adds nothing', async () => {
    const { cart, calls } = fakeShop(catalog);
    const first = await buildStore(ctre, ctre.steps!, [wanted({ description: 'Falcon (8-Pack)', quantity: 2 })], hereTab, options);
    expect(first.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(cart.get(102)).toBe(2);
    expect(marksFor(first)).toEqual([{ orderId: 'order-1', quantity: 2 }]);
    const second = await buildStore(ctre, ctre.steps!, [wanted({ quantity: 2 })], hereTab, options);
    expect(cart.get(102)).toBe(2);
    expect(second.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true });
    expect(calls.filter(c => c === 'POST /cart/add.js')).toHaveLength(1);
    expect(calls.join(' ')).not.toMatch(/checkout|action=buy|\/cart\/\d+:\d+/);
  });
  it('reports short stock and marks nothing', async () => {
    const { cart } = fakeShop(catalog, new Map(), 1);
    const result = await buildStore(ctre, ctre.steps!, [wanted({ quantity: 3 })], hereTab, options);
    expect(cart.get(102)).toBe(1);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false });
    expect(marksFor(result)).toEqual([]);
  });
  it('does not mark a line when the read-back shows nothing arrived', async () => {
    fakeShop(catalog);
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url === '/cart/add.js' ? json({}) : real(url, init)));
    const result = await buildStore(ctre, ctre.steps!, [wanted()], hereTab, options);
    expect(result.items[0].outcome).toBe('failed');
    expect(marksFor(result)).toEqual([]);
  });
  it('leaves other lines in the cart out of the read', async () => {
    fakeShop(catalog, new Map([[555, 4]]));
    expect(await ctre.steps!.readCart(hereTab, ['102'])).toEqual([]);
  });
  it('stops the whole store on a wall', async () => {
    fakeShop(catalog, new Map(), Infinity, 403);
    await expect(ctre.steps!.readCart(hereTab, ['102'])).rejects.toBeInstanceOf(StoreStop);
  });
  it('refuses a sold-out option without trying to add', async () => {
    const { calls } = fakeShop({ 'one-thing': product([{ id: 5, sku: 'CTR-ONE', available: false }]) });
    const result = await buildStore(ctre, ctre.steps!, [wanted({ sku: 'CTR-ONE', productUrl: 'https://store.ctr-electronics.com/products/one-thing' })], hereTab, options);
    expect(result.items[0].outcome).toBe('failed');
    expect(calls).not.toContain('POST /cart/add.js');
  });
  it('never uses the SKU prefix to pick a store or convert a quantity', () => {
    const source = readFileSync(resolve('src/carts/stores/ctre.ts'), 'utf8').replace(/^\/\/.*$/gm, '');
    expect(source).not.toMatch(/WCP-|startsWith|quantity\s*\*|\* *8/);
  });
});
