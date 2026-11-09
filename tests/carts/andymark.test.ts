import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStore, marksFor } from '../../src/carts/runner';
import { blockedReason } from '../../src/carts/selection';
import { LineProblem } from '../../src/carts/store-method';
import { andymark, andymarkReadProduct, andymarkRounds, chooseAndyMarkVariant } from '../../src/carts/stores/andymark';
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
    expect(mock.mock.calls.map(call => call[0])).toEqual(['/products/test-part.js', '/products/test-part']);
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
    stub(json({ handle: 'test-part', variants: [{ id: 11, sku: 'AM-1', available: true }] }), new Response('<html></html>'), new Response('', { status: 403 }));
    const result = await buildStore(andymark, andymark.steps!, [am()], hereTab, options);
    expect(result.items[0].outcome).toBe('checklist');
    expect(result.stopped?.reason).toBe('bot-check');
  });
});

describe('AndyMark: the quantity an item is sold in', () => {
  const pageWith = (data: string) => `<html><body><h1>A part</h1><script id="variant_metafield_data" type="application/json">${data}</script></body></html>`;
  const sold = (values: Record<string, string>) => pageWith(`{\n${Object.entries(values).map(([id, n]) => `"${id}" : { "availabilityText": "", "orderedInQuantity": "${n}", "maxPerOrder": "0" }`).join(' , ')}\n}`);
  /** A shop whose product page says `page`, with a cart page that isn't simulated. */
  function shop(page: string | Response, start: Record<string, number> = {}) {
    const cart = new Map(Object.entries(start)); const posts: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/products/test-part.js') return json({ handle: 'test-part', variants: [{ id: 11, sku: 'AM-1', available: true }, { id: 22, sku: 'AM-2', available: true }, { id: 33, sku: 'AM-3', available: false }] });
      if (url === '/products/test-part') return typeof page === 'string' ? new Response(page) : page;
      if (url === '/cart.js') return json({ items: [...cart].map(([id, quantity]) => ({ variant_id: Number(id), quantity, price: 1000 })) });
      if (url === '/cart/add.js') { const { items } = JSON.parse(String(init!.body)); posts.push(items); for (const i of items) cart.set(String(i.id), (cart.get(String(i.id)) ?? 0) + i.quantity); return json({ items }); }
      throw new Error(`unexpected ${url}`);
    }));
    return { cart, posts };
  }
  const build = (...orders: ReturnType<typeof am>[]) => buildStore(andymark, andymark.steps!, orders, hereTab, options);

  it('refuses a quantity below it, in the agreed words, with nothing added or marked', async () => {
    const { posts } = shop(sold({ 11: '25' }));
    const result = await build(am({ quantity: 1 }));
    expect(result.items[0]).toMatchObject({ outcome: 'failed', confirmed: false, message: 'AndyMark sells this in multiples of 25, so it would change 1 to 25. Fix the quantity in Notion, or add it by hand.' });
    expect(posts).toEqual([]);
    expect(marksFor(result)).toEqual([]);
    expect(result.finalCheckNote).toBeUndefined();
  });
  it('refuses a quantity above it that is not a multiple, naming what it would round to', async () => {
    const { posts } = shop(sold({ 11: '25' }));
    const result = await build(am({ quantity: 30 }));
    expect(result.items[0].message).toBe('AndyMark sells this in multiples of 25, so it would change 30 to 25. Fix the quantity in Notion, or add it by hand.');
    expect(posts).toEqual([]);
  });
  it('adds a whole multiple normally, and marks it', async () => {
    const { posts } = shop(sold({ 11: '25' }));
    const result = await build(am({ quantity: 50 }));
    expect(posts).toEqual([[{ id: 11, quantity: 50 }]]);
    expect(result.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
  });
  it('adds anything when the value is 1', async () => {
    const { posts } = shop(sold({ 11: '1' }));
    await build(am({ quantity: 7 }));
    expect(posts).toEqual([[{ id: 11, quantity: 7 }]]);
  });
  it('reads the chosen option\'s value, not another option\'s', async () => {
    const { posts } = shop(sold({ 11: '25', 22: '1' }));
    const result = await build(am({ sku: 'AM-2', quantity: 3 }));
    expect(posts).toEqual([[{ id: 22, quantity: 3 }]]);
    expect(result.items[0].outcome).toBe('added');
  });
  it.each([
    ['no data on the page', '<html><body>A part</body></html>'],
    ['no entry for this option', sold({ 22: '25' })],
    ['a value that isn\'t a number', sold({ 11: 'lots' })],
    ['an empty value', sold({ 11: '' })],
    ['zero', sold({ 11: '0' })],
    ['a value in another shape', pageWith('{ "11": { "orderedInQuantity": { "n": 25 } } }')],
    ['a page that broke', new Response('', { status: 500 })],
  ])('proceeds as usual with %s', async (_name, page) => {
    const { posts } = shop(page);
    const result = await build(am({ quantity: 1 }));
    expect(posts).toEqual([[{ id: 11, quantity: 1 }]]);
    expect(result.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
  });
  it('reads the value past a raw line break in another field, which JSON.parse would refuse', async () => {
    const { posts } = shop(pageWith('{ "11" : { "availabilityText": "two\nlines", "orderedInQuantity": "25" } }'));
    await build(am({ quantity: 1 }));
    expect(posts).toEqual([]);
  });
  it('the settled recheck still covers a value that couldn\'t be read', async () => {
    const { cart, posts } = shop('<html></html>');
    const result = await buildStore(andymark, andymark.steps!, [am({ quantity: 1 })], hereTab, { ...options, settle: async () => { cart.set('11', 25); } });
    expect(posts).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, storeChanged: { asked: 1, holds: 25 } });
  });
  it('a wall while reading it stops the store, certain that nothing was sent', async () => {
    const { posts } = shop(new Response('', { status: 429 }));
    const result = await build(am({ quantity: 1 }), am({ id: 'b', sku: 'AM-2', quantity: 1 }));
    expect(result.stopped?.reason).toBe('bot-check');
    expect(result.items.map(item => item.outcome)).toEqual(['checklist', 'checklist']);
    expect(result.items[0].message).toBe('');
    expect(posts).toEqual([]);
  });
  it('doesn\'t read it for an option that is out of stock, which fails on its own', async () => {
    const { posts } = shop(sold({ 33: '25' }));
    const result = await build(am({ sku: 'AM-3', quantity: 1 }));
    expect(result.items[0].message).toMatch(/out of stock/);
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(['/products/test-part.js']);
    expect(posts).toEqual([]);
  });
  it('a refusal stays with its own line: the row can still be ticked, and the next line still goes', async () => {
    const { posts } = shop(sold({ 11: '25', 22: '1' }));
    const refused = am({ id: 'a', quantity: 1 });
    expect(blockedReason(refused, andymark)).toBeNull();
    const result = await build(refused, am({ id: 'b', sku: 'AM-2', quantity: 2 }));
    expect(result.items.map(item => item.outcome)).toEqual(['failed', 'added']);
    expect(result.stopped).toBeUndefined();
    expect(posts).toEqual([[{ id: 22, quantity: 2 }]]);
    expect(marksFor(result).map(mark => mark.orderId)).toEqual(['b']);
  });
  it('its rounding follows the theme', () => {
    expect([[1, 25], [24, 25], [25, 25], [30, 25], [50, 50], [99, 25], [7, 1]].map(([q, n]) => andymarkRounds(q, n))).toEqual([25, 25, 25, 25, 50, 75, 7]);
  });
});
