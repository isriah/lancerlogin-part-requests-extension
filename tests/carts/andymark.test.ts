import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStore } from '../../src/carts/runner';
import { LineProblem } from '../../src/carts/store-method';
import { andymark, andymarkReadProduct, chooseAndyMarkVariant } from '../../src/carts/stores/andymark';
import { hereTab, options, order } from './helpers';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const stub = (...replies: Response[]) => { let n = 0; const mock = vi.fn(async (_url: string) => replies[Math.min(n++, replies.length - 1)]); vi.stubGlobal('fetch', mock); return mock; };
afterEach(() => vi.unstubAllGlobals());
const am = (extra = {}) => order({ vendor: 'AndyMark', urlVendor: 'AndyMark', sku: 'AM-1', productUrl: 'https://andymark.com/products/test-part', ...extra });
const variants = [{ id: '11', sku: 'AM-1', available: true }, { id: '22', sku: 'AM-2', available: true }];

/** A synthetic store: one product, a cart that accumulates, and an optional cap on how many of a variant it will hold. */
function fakeShop(cap = Infinity, start: Record<string, number> = {}) {
  const cart = new Map(Object.entries(start)); const posts: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/products/test-part.js') return json({ handle: 'test-part', variants: [{ id: 11, sku: 'AM-1', available: true }, { id: 22, sku: 'AM-2', available: true }] });
    if (url === '/cart.js') return json({ items: [...cart].map(([id, quantity]) => ({ variant_id: Number(id), quantity, price: 1000 })).concat([{ variant_id: 99, quantity: 7, price: 5 }]) });
    if (url === '/cart/add.js') { const { items } = JSON.parse(String(init!.body)); posts.push(items); for (const i of items) cart.set(String(i.id), Math.min(cap, (cart.get(String(i.id)) ?? 0) + i.quantity)); return json({ items }); }
    throw new Error(`unexpected ${url}`);
  }));
  return { cart, posts };
}

describe('AndyMark', () => {
  it('is a direct Shopify store on andymark.com that needs a SKU and a link', () => {
    expect(andymark).toMatchObject({ id: 'andymark', label: 'AndyMark', badge: 'direct', hosts: ['andymark.com', 'www.andymark.com'], origins: ['https://andymark.com/*'] });
    expect(andymark.requiredFields).toEqual(['sku', 'productUrl', 'quantity']);
    expect(andymark.missing!(am({ sku: null }))).toEqual(['a SKU']);
    expect(andymark.missing!(am({ productUrl: 'https://example.test/products/x' }))).toEqual(['a product link on AndyMark\'s site']);
    expect(andymark.missing!(am())).toEqual([]);
  });
  it('resolves the exact variant in the product named by the link, by handle', async () => {
    const mock = stub(json({ handle: 'test-part', variants: [{ id: 11, sku: 'AM-1', available: true }, { id: 22, sku: 'AM-2', available: false }] }));
    expect(await andymark.steps!.resolveLine(am({ sku: 'am-2' }), hereTab)).toEqual({ key: '22', addAs: '22', available: false });
    expect(String(mock.mock.calls[0][0])).toBe('/products/test-part.js');
  });
  it('refuses a SKU that two options of the product share, unless the saved option settles it', () => {
    const dup = [...variants, { id: '33', sku: 'AM-1', available: true }];
    expect(() => chooseAndyMarkVariant(dup, null, 'AM-1')).toThrow(/More than one option/);
    expect(chooseAndyMarkVariant(dup, '33', 'AM-1').id).toBe('33');
    expect(() => chooseAndyMarkVariant(dup, '22', 'AM-1')).toThrow(/saved link's option is SKU AM-2/);
  });
  it('never takes a SKU-less, unconfirmed or unknown option', () => {
    expect(() => chooseAndyMarkVariant(variants, null, null)).toThrow(LineProblem);
    expect(() => chooseAndyMarkVariant([{ id: '5', sku: '', available: true }], null, 'AM-1')).toThrow(/No option/);
    expect(() => chooseAndyMarkVariant([{ id: '5', sku: '', available: true }], '5', 'AM-1')).toThrow(/no SKU/);
    expect(() => chooseAndyMarkVariant(variants, null, 'AM-')).toThrow(/No option/);
    expect(() => chooseAndyMarkVariant(variants, '99', 'AM-1')).toThrow(/no longer has/);
  });
  it('refuses when the store answers for another product', async () => {
    stub(json({ handle: 'other-part', variants: [{ id: 11, sku: 'AM-1', available: true }] }));
    await expect(andymark.steps!.resolveLine(am(), hereTab)).rejects.toThrow(/different product/);
  });
  it('refuses a missing page, a link that is not a product, and no SKU', async () => {
    stub(new Response('', { status: 404 }));
    await expect(andymark.steps!.resolveLine(am(), hereTab)).rejects.toThrow(/no longer has this product/);
    await expect(andymark.steps!.resolveLine(am({ productUrl: 'https://andymark.com/pages/x' }), hereTab)).rejects.toThrow(/product link/);
    stub(json({ handle: 'test-part', variants: [{ id: 11, sku: 'AM-1', available: true }] }));
    await expect(andymark.steps!.resolveLine(am({ sku: null }), hereTab)).rejects.toThrow(/needs a SKU/);
  });
  it('stops the store at a wall or an answer that is not a product', async () => {
    stub(new Response('', { status: 403 })); expect(await andymarkReadProduct('x')).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    stub(new Response('', { status: 429 })); await expect(andymark.steps!.resolveLine(am(), hereTab)).rejects.toMatchObject({ reason: 'bot-check' });
    stub(new Response('<html>')); expect(await andymarkReadProduct('x')).toMatchObject({ kind: 'stop', reason: 'unexpected' });
    stub(json({ variants: [] })); expect(await andymarkReadProduct('x')).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('only ever reads the link\'s own product, never a SKU search', async () => {
    const mock = stub(json({ handle: 'test-part', variants: [{ id: 11, sku: 'AM-1', available: true }] }));
    expect((await andymark.steps!.resolveLine(am(), hereTab)).key).toBe('11');
    expect(mock).toHaveBeenCalledTimes(1);
    expect(readFileSync(resolve('src/carts/stores/andymark.ts'), 'utf8')).not.toMatch(/search|suggest/);
  });
  it('adds once to the right variant, reads back, and a retry adds nothing', async () => {
    const { cart, posts } = fakeShop();
    const first = await buildStore(andymark, andymark.steps!, [am({ quantity: 2 })], hereTab, options);
    expect(posts).toEqual([[{ id: 11, quantity: 2 }]]);
    expect(first.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    const second = await buildStore(andymark, andymark.steps!, [am({ quantity: 2 })], hereTab, options);
    expect(posts).toHaveLength(1);
    expect(cart.get('11')).toBe(2);
    expect(second.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true });
  });
  it('reports short stock and marks nothing', async () => {
    fakeShop(1);
    const result = await buildStore(andymark, andymark.steps!, [am({ quantity: 3 })], hereTab, options);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false });
    expect(result.items[0].message).toMatch(/short|1/i);
  });
  it('flags a read-back that does not match', async () => {
    const cart = new Map<string, number>();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/products/test-part.js') return json({ handle: 'test-part', variants: [{ id: 11, sku: 'AM-1', available: true }] });
      if (url === '/cart.js') return json({ items: [...cart].map(([id, quantity]) => ({ variant_id: Number(id), quantity })) });
      cart.set('11', 9); return json({});
    }));
    const result = await buildStore(andymark, andymark.steps!, [am({ quantity: 2 })], hereTab, options);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false });
  });
  it('a duplicate-SKU line adds nothing and the rest carry on', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/products/dup.js') return json({ handle: 'dup', variants: [{ id: 1, sku: 'AM-D', available: true }, { id: 2, sku: 'am-d', available: true }] });
      if (url === '/cart.js') return json({ items: [] });
      posts.push(init?.body); return json({});
    }));
    const result = await buildStore(andymark, andymark.steps!, [am({ id: 'a', sku: 'AM-D', productUrl: 'https://andymark.com/products/dup' })], hereTab, options);
    expect(result.items[0].outcome).toBe('failed');
    expect(result.items[0].message).toMatch(/More than one option/);
    expect(posts).toEqual([]);
  });
  it('stops the store when the cart read hits a wall', async () => {
    stub(json({ handle: 'test-part', variants: [{ id: 11, sku: 'AM-1', available: true }] }), new Response('', { status: 403 }));
    const result = await buildStore(andymark, andymark.steps!, [am()], hereTab, options);
    expect(result.items[0].outcome).toBe('checklist');
  });
});
