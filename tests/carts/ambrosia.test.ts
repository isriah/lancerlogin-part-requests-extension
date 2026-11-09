// Ambrosia Filament is a plain Shopify store. Spool size and color are variants, and a few variants have no SKU.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStore } from '../../src/carts/runner';
import { isOnStore } from '../../src/carts/safety';
import { StoreStop } from '../../src/carts/store-method';
import { ambrosia } from '../../src/carts/stores/ambrosia';
import { hereTab, options, order } from './helpers';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const link = (handle: string, variant?: number) => `https://ambrosiafilament.com/products/${handle}${variant ? `?variant=${variant}` : ''}`;
const o = (extra = {}) => order({ vendor: 'Ambrosia Filament', urlVendor: 'Ambrosia Filament', sku: 'AMB5537BLA', productUrl: link('pet-gf', 111), quantity: 2, unitPrice: 35.99, ...extra });
const product = { variants: [{ id: 111, sku: 'AMB5537BLA', available: true }, { id: 222, sku: 'AMB5539VOR', available: true }, { id: 333, sku: '', available: true }, { id: 444, sku: '', available: false }] };
afterEach(() => vi.unstubAllGlobals());

/** A fake storefront: /products/<h>.js, /cart.js and /cart/add.js over one cart. */
function storefront(cap = Infinity) {
  const cart = new Map<number, number>(), calls: string[] = [], addBodies: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.startsWith('/products/')) return json(product);
    if (url === '/cart.js') return json({ items: [...cart].map(([variant_id, quantity]) => ({ variant_id, quantity, price: 3599 })) });
    if (url === '/cart/add.js') {
      const { items } = JSON.parse(String(init!.body)); addBodies.push(items);
      for (const { id, quantity } of items) cart.set(id, Math.min(cap, (cart.get(id) ?? 0) + quantity));
      return json({ items });
    }
    return new Response('', { status: 404 });
  }));
  return { cart, calls, addBodies };
}

describe('Ambrosia Filament', () => {
  it('is a direct Shopify store with its own hosts, and nothing else', () => {
    expect(ambrosia).toMatchObject({ id: 'ambrosia', label: 'Ambrosia Filament', badge: 'direct', origins: ['https://ambrosiafilament.com/*'], startUrl: 'https://ambrosiafilament.com/cart' });
    expect(isOnStore(ambrosia, 'https://ambrosiafilament.com/products/x')).toBe(true);
    expect(isOnStore(ambrosia, 'https://wcproducts.com/products/x')).toBe(false);
    expect(ambrosia.missing!(o({ productUrl: 'https://wcproducts.com/products/x' }))).toHaveLength(1);
  });
  it('picks the spool/color variant from the saved link, confirmed by SKU', async () => {
    storefront();
    expect(await ambrosia.steps!.resolveLine(o(), hereTab)).toEqual({ key: '111', addAs: '111', available: true });
    await expect(ambrosia.steps!.resolveLine(o({ sku: 'AMB5539VOR' }), hereTab)).rejects.toThrow(/SKU AMB5539VOR, but the saved link/);
  });
  it('finds the variant by exact SKU when the link names none', async () => {
    storefront();
    expect(await ambrosia.steps!.resolveLine(o({ productUrl: link('pet-gf'), sku: 'amb5539vor' }), hereTab)).toMatchObject({ key: '222' });
  });
  it('refuses a product with several spool options when nothing says which', async () => {
    storefront();
    await expect(ambrosia.steps!.resolveLine(o({ productUrl: link('pet-gf'), sku: null }), hereTab)).rejects.toThrow(/several options/);
    await expect(ambrosia.steps!.resolveLine(o({ productUrl: link('pet-gf'), sku: 'AMB-NOPE' }), hereTab)).rejects.toThrow(/No option/);
  });
  describe('variants with no SKU', () => {
    it('are used only when the saved link names the exact variant, with a note that the SKU was not confirmed', async () => {
      storefront();
      expect(await ambrosia.steps!.resolveLine(o({ productUrl: link('pet-gf', 333), sku: 'AMB-ANY' }), hereTab)).toMatchObject({ key: '333', note: expect.stringMatching(/could not be confirmed/) });
    });
    it('are never guessed from a SKU or from nothing when the product has other options', async () => {
      storefront();
      await expect(ambrosia.steps!.resolveLine(o({ productUrl: link('pet-gf'), sku: 'AMB-ANY' }), hereTab)).rejects.toThrow(/No option/);
      await expect(ambrosia.steps!.resolveLine(o({ productUrl: link('pet-gf'), sku: null }), hereTab)).rejects.toThrow(/several options/);
    });
    it('a link variant the product no longer has is refused', async () => {
      storefront();
      await expect(ambrosia.steps!.resolveLine(o({ productUrl: link('pet-gf', 999) }), hereTab)).rejects.toThrow(/no longer has/);
    });
    it('a single-variant product with no SKU is added, with the same note', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => json({ variants: [{ id: 7, sku: '', available: true }] })));
      expect(await ambrosia.steps!.resolveLine(o({ productUrl: link('gift-card'), sku: 'GC-1' }), hereTab)).toMatchObject({ key: '7', note: expect.stringMatching(/could not be confirmed/) });
    });
    it('a sold-out variant fails the line without an add', async () => {
      const { addBodies } = storefront();
      const result = await buildStore(ambrosia, ambrosia.steps!, [o({ productUrl: link('pet-gf', 444), sku: null })], hereTab, options);
      expect(result.items[0].outcome).toBe('failed');
      expect(addBodies).toEqual([]);
    });
  });
  it('adds one line to /cart/add.js, a retry adds nothing, and no checkout is touched', async () => {
    const { cart, calls, addBodies } = storefront();
    const first = await buildStore(ambrosia, ambrosia.steps!, [o()], hereTab, options);
    expect(first.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    const second = await buildStore(ambrosia, ambrosia.steps!, [o()], hereTab, options);
    expect(second.items[0].confirmed).toBe(true);
    expect(cart.get(111)).toBe(2);
    expect(addBodies).toEqual([[{ id: 111, quantity: 2 }]]);
    expect(calls.join('\n')).not.toMatch(/checkout|\/cart\/\d+:\d+/);
  });
  it('flags short stock when the store caps the add, and does not confirm it', async () => {
    storefront(1);
    const result = await buildStore(ambrosia, ambrosia.steps!, [o({ quantity: 3 })], hereTab, options);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false });
  });
  it('a bot check stops the store', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('local_rate_limited', { status: 429 })));
    await expect(ambrosia.steps!.resolveLine(o(), hereTab)).rejects.toBeInstanceOf(StoreStop);
  });
});
