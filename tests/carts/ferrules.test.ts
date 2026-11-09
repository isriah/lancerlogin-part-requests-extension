// FerrulesDirect through the shared Shopify method, against synthetic answers. No real store is contacted.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStore } from '../../src/carts/runner';
import { isOnStore } from '../../src/carts/safety';
import { LineProblem } from '../../src/carts/store-method';
import { ferrules } from '../../src/carts/stores/ferrules';
import { hereTab, order, options } from './helpers';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => vi.unstubAllGlobals());
const spool = { id: 101, sku: '3TW38RD-328FT', available: true };
const shorter = { id: 102, sku: '3TW38RD-100FT', available: true };
const line = (extra = {}) => order({ vendor: 'FerrulesDirect', urlVendor: 'FerrulesDirect', sku: '3TW38RD-328FT', productUrl: 'https://www.ferrulesdirect.com/products/3tw38rd-328ft', quantity: 2, ...extra });

describe('FerrulesDirect', () => {
  it('is a direct Shopify store on the www host, and accepts links from both hosts', () => {
    expect(ferrules).toMatchObject({ id: 'ferrules', label: 'FerrulesDirect', badge: 'direct', cartUrl: 'https://www.ferrulesdirect.com/cart', origins: ['https://www.ferrulesdirect.com/*'] });
    expect(isOnStore(ferrules, 'https://ferrulesdirect.com/products/x')).toBe(true);
    expect(isOnStore(ferrules, 'https://www.ferrulesdirect.com/products/x')).toBe(true);
    expect(isOnStore(ferrules, 'https://ferrulesdirect.com.evil.test/products/x')).toBe(false);
  });
  it('resolves a one-variant product by its SKU', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ variants: [spool] })));
    expect(await ferrules.steps!.resolveLine(line(), hereTab)).toEqual({ key: '101', addAs: '101', available: true });
  });
  it('refuses a different spool or length: the product\'s one variant has another SKU', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ variants: [shorter] })));
    await expect(ferrules.steps!.resolveLine(line(), hereTab)).rejects.toThrow(/No option on this product has SKU 3TW38RD-328FT/);
  });
  it('refuses a saved variant whose SKU differs from the request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ variants: [shorter] })));
    await expect(ferrules.steps!.resolveLine(line({ productUrl: 'https://www.ferrulesdirect.com/products/x?variant=102' }), hereTab)).rejects.toThrow(LineProblem);
  });
  it('a product with no SKU is added only with a note, and a multi-option product is never guessed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ variants: [{ id: 7, sku: null, available: true }] })));
    expect(await ferrules.steps!.resolveLine(line(), hereTab)).toMatchObject({ key: '7', note: expect.stringMatching(/could not be confirmed/) });
    vi.stubGlobal('fetch', vi.fn(async () => json({ variants: [spool, shorter] })));
    await expect(ferrules.steps!.resolveLine(line({ sku: null }), hereTab)).rejects.toThrow(/several options/);
  });
  it('wants a ferrulesdirect.com product link, not another store\'s', () => {
    expect(ferrules.missing!(line({ productUrl: 'https://wcproducts.com/products/x' }))).toEqual(['a product link on FerrulesDirect\'s site']);
    expect(ferrules.missing!(line())).toEqual([]);
  });
  it('a sold-out variant fails without an add', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ variants: [{ ...spool, available: false }] })));
    expect(await ferrules.steps!.resolveLine(line(), hereTab)).toMatchObject({ available: false });
  });

  // A synthetic store behind fetch: a cart that holds other people's lines too, and a stock cap.
  function shop(cap = Infinity, initial = 0) {
    const cart = new Map<number, number>([[999, 4]]); if (initial) cart.set(101, initial);
    const posts: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/products/')) return json({ variants: [spool] });
      if (url === '/cart.js') return json({ items: [...cart].map(([variant_id, quantity]) => ({ variant_id, quantity, price: 15560 })) });
      if (url === '/cart/add.js') {
        const item = JSON.parse(String(init!.body)).items[0]; posts.push(item);
        if (cap === 0) return json({ status: 422, description: 'All 2 are in your cart.' }, 422);
        cart.set(item.id, Math.min(cap, (cart.get(item.id) ?? 0) + item.quantity)); return json({ items: [] });
      }
      return new Response('', { status: 404 });
    }));
    return { cart, posts };
  }
  const run = (lines = [line()]) => buildStore(ferrules, ferrules.steps!, lines, hereTab, options);
  it('adds once, reads back, and a second run adds nothing', async () => {
    const { cart, posts } = shop();
    const first = await run();
    expect(posts).toEqual([{ id: 101, quantity: 2 }]);
    expect(cart.get(101)).toBe(2); expect(cart.get(999)).toBe(4);
    expect(JSON.stringify(first)).not.toMatch(/999/);
    const second = await run();
    expect(posts).toHaveLength(1);
    expect(JSON.stringify(second)).toMatch(/already in the cart/i);
  });
  it('reports a short-stock cap and does not mark it', async () => {
    shop(1);
    expect(JSON.stringify(await run())).toMatch(/short|stock/i);
  });
  it('a store refusal fails the line and a wall stops the store', async () => {
    shop(0);
    expect(JSON.stringify(await run())).toMatch(/All 2 are in your cart/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    expect(JSON.stringify(await run())).toMatch(/bot|stop|refused/i);
  });
});
