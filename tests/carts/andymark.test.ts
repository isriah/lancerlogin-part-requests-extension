import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStore, marksFor, roundUpTo } from '../../src/carts/runner';
import { blockedReason } from '../../src/carts/selection';
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
  function shop(page: string | Response, start: Record<string, number> = {}, cap = Infinity) {
    const cart = new Map(Object.entries(start)); const posts: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/products/test-part.js') return json({ handle: 'test-part', variants: [{ id: 11, sku: 'AM-1', available: true }, { id: 22, sku: 'AM-2', available: true }, { id: 33, sku: 'AM-3', available: false }] });
      if (url === '/products/test-part') return typeof page === 'string' ? new Response(page) : page;
      if (url === '/cart.js') return json({ items: [...cart].map(([id, quantity]) => ({ variant_id: Number(id), quantity, price: 1000 })) });
      if (url === '/cart/add.js') { const { items } = JSON.parse(String(init!.body)); posts.push(items); for (const i of items) cart.set(String(i.id), Math.min(cap, (cart.get(String(i.id)) ?? 0) + i.quantity)); return json({ items }); }
      throw new Error(`unexpected ${url}`);
    }));
    return { cart, posts };
  }
  const build = (...orders: ReturnType<typeof am>[]) => buildStore(andymark, andymark.steps!, orders, hereTab, options);

  it('rounds a quantity below it up, flags it in plain words, and marks the order at the quantity requested', async () => {
    const { cart, posts } = shop(sold({ 11: '25' }));
    const result = await build(am({ quantity: 1 }));
    expect(posts).toEqual([[{ id: 11, quantity: 25 }]]);
    expect(cart.get('11')).toBe(25);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: '', rounded: { soldIn: 25, asked: 1, orders: 1, holds: 25, note: 'AndyMark sells this in multiples of 25, so the cart holds 25, not the 1 requested.' } });
    expect(marksFor(result)).toEqual([{ orderId: 'order-1', quantity: 1 }]);
    expect(result.finalCheckNote).toBeUndefined();
  });
  it('rounds a quantity above it up, where the store\'s own page would have left the team short', async () => {
    const { cart, posts } = shop(sold({ 11: '25' }));
    const result = await build(am({ quantity: 30 }));
    expect(posts).toEqual([[{ id: 11, quantity: 50 }]]);
    expect(cart.get('11')).toBe(50);
    expect(result.items[0].rounded?.note).toBe('AndyMark sells this in multiples of 25, so the cart holds 50, not the 30 requested.');
    expect(marksFor(result)).toEqual([{ orderId: 'order-1', quantity: 30 }]);
  });
  it('holds at the store\'s own cart page, whose rule leaves a multiple alone', async () => {
    const { cart } = shop(sold({ 11: '25' }));
    const theme = () => { for (const [id, quantity] of cart) cart.set(id, Math.max(Math.floor(quantity / 25) * 25, 25)); };
    const result = await buildStore(andymark, andymark.steps!, [am({ quantity: 30 })], hereTab, { ...options, settle: async () => theme() });
    expect(cart.get('11')).toBe(50);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, rounded: { holds: 50 } });
    expect(result.items[0].storeChanged).toBeUndefined();
  });
  it('a retry adds nothing, stays flagged as rounded, and isn\'t a mismatch', async () => {
    const { cart, posts } = shop(sold({ 11: '25' }));
    await build(am({ quantity: 1 }));
    const retry = await build(am({ quantity: 1 }));
    expect(posts).toHaveLength(1);
    expect(cart.get('11')).toBe(25);
    expect(retry.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: 'Already in the cart: it holds 25, so nothing was added.', rounded: { holds: 25 } });
    expect(retry.items[0].message).not.toMatch(/more than|mismatch/i);
    expect(marksFor(retry)).toEqual([{ orderId: 'order-1', quantity: 1 }]);
  });
  it('adds only the difference to reach the multiple', async () => {
    const { cart, posts } = shop(sold({ 11: '25' }), { 11: 10 });
    const result = await build(am({ quantity: 1 }));
    expect(posts).toEqual([[{ id: 11, quantity: 15 }]]);
    expect(cart.get('11')).toBe(25);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: 'Already in the cart: it held 10, so 15 more were added to reach 25.', rounded: { holds: 25 } });
  });
  it('a cart above the rounded amount adds nothing, says so, and isn\'t marked', async () => {
    const { posts } = shop(sold({ 11: '25' }), { 11: 50 });
    const result = await build(am({ quantity: 1 }));
    expect(posts).toEqual([]);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false });
    expect(result.items[0].message).toBe('The cart already holds 50, more than this needs: 1 requested, rounded up to 25 because AndyMark sells this in multiples of 25. Nothing was added, and the quantity wasn\'t changed. Check the cart before ordering.');
    expect(result.items[0].rounded).toBeUndefined();
    expect(marksFor(result)).toEqual([]);
  });
  it('short stock on a rounded line says both numbers, and isn\'t marked', async () => {
    shop(sold({ 11: '25' }), {}, 10);
    const result = await build(am({ quantity: 1 }));
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false });
    expect(result.items[0].message).toMatch(/^Short stock: asked for 1, rounded up to 25 because AndyMark sells this in multiples of 25, and the cart holds 10/);
    expect(marksFor(result)).toEqual([]);
  });
  it('the final read still catches a rounded line that moves, and takes the mark and the rounded flag away', async () => {
    const { cart } = shop(sold({ 11: '25' }));
    const result = await buildStore(andymark, andymark.steps!, [am({ quantity: 1 })], hereTab, { ...options, settle: async () => { cart.set('11', 50); } });
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, storeChanged: { asked: 1, holds: 50 } });
    expect(result.items[0].rounded).toBeUndefined();
    expect(result.items[0].message).toBe('The store changed this to 50 after it was added; you asked for 1, rounded up to 25 because AndyMark sells this in multiples of 25. Check the cart before ordering.');
    expect(marksFor(result)).toEqual([]);
  });
  describe('two orders of one part', () => {
    const shared = (asked: number, holds: number) => `AndyMark sells this in multiples of 25. The 2 orders for this part total ${asked}, so the cart holds ${holds} for them together.`;
    const two = (a: number, b: number) => [am({ id: 'a', quantity: a }), am({ id: 'b', quantity: b })];
    const markedAs = (a: number, b: number) => [{ orderId: 'a', quantity: a }, { orderId: 'b', quantity: b }];

    it('a second order of 1 is covered by the 25 the first one left, with one add', async () => {
      const { cart, posts } = shop(sold({ 11: '25' }));
      const result = await build(...two(1, 1));
      expect(posts).toEqual([[{ id: 11, quantity: 25 }]]);
      expect(cart.get('11')).toBe(25);
      expect(result.items.map(item => item.outcome)).toEqual(['flagged', 'flagged']);
      expect(result.items.map(item => item.rounded?.note)).toEqual([shared(2, 25), shared(2, 25)]);
      expect(result.items[1].message).toBe('Already in the cart: it holds 25, so nothing was added.');
      expect(marksFor(result)).toEqual(markedAs(1, 1));
    });
    it('orders that add up to a multiple share it, where each alone would have rounded', async () => {
      const { cart, posts } = shop(sold({ 11: '25' }));
      const result = await build(...two(10, 15));
      expect(posts).toEqual([[{ id: 11, quantity: 25 }]]);
      expect(cart.get('11')).toBe(25);
      expect(result.items.map(item => item.rounded?.note)).toEqual([shared(25, 25), shared(25, 25)]);
      expect(marksFor(result)).toEqual(markedAs(10, 15));
    });
    it('rounds the total, not each order, and the first order\'s words follow the end result', async () => {
      const { cart, posts } = shop(sold({ 11: '25' }));
      const result = await build(...two(20, 10));
      expect(posts).toEqual([[{ id: 11, quantity: 25 }], [{ id: 11, quantity: 25 }]]);
      expect(cart.get('11')).toBe(50);
      expect(result.items.map(item => item.rounded?.note)).toEqual([shared(30, 50), shared(30, 50)]);
    });
    it('flags a whole-multiple order that shares a rounded line', async () => {
      const { cart } = shop(sold({ 11: '25' }));
      const result = await build(...two(25, 1));
      expect(cart.get('11')).toBe(50);
      expect(result.items.map(item => item.outcome)).toEqual(['flagged', 'flagged']);
      expect(result.items[0].rounded?.note).toBe(shared(26, 50));
    });
    it('whole multiples alone just add up, with no flag', async () => {
      const { cart } = shop(sold({ 11: '25' }));
      const result = await build(...two(25, 50));
      expect(cart.get('11')).toBe(75);
      expect(result.items.map(item => item.outcome)).toEqual(['added', 'added']);
      expect(result.items.some(item => item.rounded)).toBe(false);
    });
    it('a retry of both adds nothing and marks both, including the first, which looks over at first', async () => {
      const { cart, posts } = shop(sold({ 11: '25' }));
      await build(...two(20, 10));
      const retry = await build(...two(20, 10));
      expect(posts).toHaveLength(2);
      expect(cart.get('11')).toBe(50);
      expect(retry.items.map(item => [item.outcome, item.confirmed, item.rounded?.note])).toEqual([['flagged', true, shared(30, 50)], ['flagged', true, shared(30, 50)]]);
      expect(retry.items.map(item => item.message)).toEqual(['Already in the cart: it holds 50, so nothing was added.', 'Already in the cart: it holds 50, so nothing was added.']);
      expect(marksFor(retry)).toEqual(markedAs(20, 10));
    });
    it('a later build of a second order of 1 adds nothing to the 25 already there', async () => {
      const { cart, posts } = shop(sold({ 11: '25' }));
      await build(am({ id: 'a', quantity: 1 }));
      const later = await build(am({ id: 'b', quantity: 1 }));
      expect(posts).toHaveLength(1);
      expect(cart.get('11')).toBe(25);
      expect(later.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, rounded: { holds: 25 } });
      expect(later.items[0].message).toBe('Already in the cart: it holds 25, so nothing was added.');
    });
    it('a later build of an order the 25 can\'t cover adds another multiple, and says so', async () => {
      const { cart, posts } = shop(sold({ 11: '25' }), { 11: 25 });
      const later = await build(am({ quantity: 30 }));
      expect(posts).toEqual([[{ id: 11, quantity: 25 }]]);
      expect(cart.get('11')).toBe(50);
      expect(later.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: 'Already in the cart: it held 25, so 25 more were added to reach 50.' });
    });
    it('a second order that fails keeps the first one\'s own account', async () => {
      const { posts } = shop(sold({ 11: '25', 33: '25' }));
      const result = await build(am({ id: 'a', quantity: 1 }), am({ id: 'b', sku: 'AM-3', quantity: 1 }));
      expect(posts).toEqual([[{ id: 11, quantity: 25 }]]);
      expect(result.items.map(item => item.outcome)).toEqual(['flagged', 'failed']);
      expect(result.items[0].rounded?.note).toBe('AndyMark sells this in multiples of 25, so the cart holds 25, not the 1 requested.');
    });
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
    expect(posts).toEqual([[{ id: 11, quantity: 25 }]]);
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
  it('a rounded line stays with its own line: the row can still be ticked, and the next line still goes', async () => {
    const { posts } = shop(sold({ 11: '25', 22: '1' }));
    const rounded = am({ id: 'a', quantity: 1 });
    expect(blockedReason(rounded, andymark)).toBeNull();
    const result = await build(rounded, am({ id: 'b', sku: 'AM-2', quantity: 2 }));
    expect(result.items.map(item => item.outcome)).toEqual(['flagged', 'added']);
    expect(result.stopped).toBeUndefined();
    expect(posts).toEqual([[{ id: 11, quantity: 25 }], [{ id: 22, quantity: 2 }]]);
    expect(marksFor(result).map(mark => mark.orderId)).toEqual(['a', 'b']);
  });
  it('tells the runner the multiple only when it is above 1', async () => {
    shop(sold({ 11: '25', 22: '1' }));
    expect(await andymark.steps!.resolveLine(am(), hereTab)).toEqual({ key: '11', addAs: '11', available: true, soldIn: 25 });
    expect(await andymark.steps!.resolveLine(am({ sku: 'AM-2' }), hereTab)).toEqual({ key: '22', addAs: '22', available: true });
  });
  it('rounds to the smallest multiple at or above the quantity', () => {
    expect([[1, 25], [24, 25], [25, 25], [26, 25], [30, 25], [50, 25], [99, 25], [7, 1], [1, 100]].map(([q, n]) => roundUpTo(q, n))).toEqual([25, 25, 25, 50, 50, 50, 100, 7, 100]);
  });
});
