// SDS: synthetic product and cart answers only. No real store is contacted.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStore, marksFor } from '../../src/carts/runner';
import { LineProblem, StoreStop } from '../../src/carts/store-method';
import { chooseSdsVariant, sds, sdsReadProduct, titleIn, type SdsVariant } from '../../src/carts/stores/sds';
import { hereTab, options, order } from './helpers';

afterEach(() => vi.unstubAllGlobals());
const v = (id: string, title: string, extra: Partial<SdsVariant> = {}): SdsVariant => ({ id, title, sku: '', available: true, ...extra });
const variants = [
  v('11', 'Kraken X60 / Molded Spike Grip / Unassembled'),
  v('22', 'Kraken X60 / Molded Spike Grip / Assembled'),
  v('33', 'Falcon 500 / Molded Spike Grip / Unassembled', { available: false }),
];
const URL_BASE = 'https://www.swervedrivespecialties.com/products/test-module';

describe('SDS variant choice', () => {
  it('uses the saved ?variant= with no SKU or description', () => {
    expect(chooseSdsVariant(variants, '22', null, null).chosen.id).toBe('22');
  });
  it('fails a saved variant the product no longer has', () => {
    expect(() => chooseSdsVariant(variants, '99', null, null)).toThrow(/no longer has/);
  });
  it('fails when the link and the description name different options', () => {
    expect(() => chooseSdsVariant(variants, '22', null, 'Kraken X60 / Molded Spike Grip / Unassembled')).toThrow(/but the description names/);
  });
  it('accepts a link that agrees with the description', () => {
    expect(chooseSdsVariant(variants, '11', null, 'Module - Kraken X60 / Molded Spike Grip / Unassembled').chosen.id).toBe('11');
  });
  it('matches the exact variant title in the description, ignoring case and spacing', () => {
    expect(chooseSdsVariant(variants, null, null, 'MK5n - kraken x60/molded spike grip /  UNASSEMBLED').chosen.id).toBe('11');
  });
  it('does not take Assembled for part of Unassembled', () => {
    expect(titleIn('Kraken X60 / Molded Spike Grip / Assembled', 'Kraken X60 / Molded Spike Grip / Unassembled')).toBe(false);
    expect(chooseSdsVariant(variants, null, null, 'Kraken X60 / Molded Spike Grip / Assembled').chosen.id).toBe('22');
  });
  it('refuses a partial title, no match, and no description', () => {
    expect(() => chooseSdsVariant(variants, null, null, 'Kraken X60 / Molded Spike Grip')).toThrow(LineProblem);
    expect(() => chooseSdsVariant(variants, null, null, 'Some other module')).toThrow(/several options/);
    expect(() => chooseSdsVariant(variants, null, null, null)).toThrow(/several options/);
  });
  it('refuses a description that fits two options', () => {
    expect(() => chooseSdsVariant(variants, null, null, 'Kraken X60 / Molded Spike Grip / Unassembled or Kraken X60 / Molded Spike Grip / Assembled')).toThrow(/more than one option/);
  });
  it('accepts a one-option product, and never a Default Title match in text', () => {
    expect(chooseSdsVariant([v('5', 'Default Title')], null, null, 'Default Title').chosen.id).toBe('5');
    expect(titleIn('Default Title', 'Default Title')).toBe(false);
  });
  it('checks a SKU when the store has one, and ignores it when the store has none', () => {
    const withSku = [v('1', 'A', { sku: 'S-1' }), v('2', 'B', { sku: 'S-2' })];
    expect(chooseSdsVariant(withSku, null, 's-2', null).chosen.id).toBe('2');
    expect(() => chooseSdsVariant(withSku, '1', 'S-2', null)).toThrow(/SKU S-2, but/);
    expect(chooseSdsVariant(variants, '11', 'ANY-SKU', null).chosen.id).toBe('11');
  });
  it('does not match a variant title that is only part of a longer word', () => {
    expect(titleIn('Black', 'Blackout')).toBe(false);
    expect(titleIn('Black', 'Color: Black.')).toBe(true);
  });
});

describe('SDS reading and building', () => {
  it('reads only ID, title, SKU and availability', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ title: 'T', variants: [{ id: 11, title: 'A / B', sku: null, available: true, price: 5, inventory_quantity: 9 }] }))));
    expect(await sdsReadProduct('x')).toEqual({ kind: 'ok', variants: [{ id: '11', title: 'A / B', sku: '', available: true }] });
  });
  it('stops on a wall', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    expect(await sdsReadProduct('x')).toMatchObject({ kind: 'stop', reason: 'bot-check' });
  });

  /** A synthetic store: product answer, a cart, and an add. `cap` limits the quantity per line, as short stock does. */
  function store(opts: { cap?: number; wall?: boolean; other?: boolean } = {}) {
    const cart = new Map<string, number>(opts.other ? [['999', 4]] : []);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${input}`);
      if (opts.wall) return new Response('', { status: 403 });
      if (input.startsWith('/products/')) return new Response(JSON.stringify({ variants: variants.map(x => ({ id: Number(x.id), title: x.title, sku: '', available: x.available })) }));
      if (input === '/cart.js') return new Response(JSON.stringify({ note: 'private', items: [...cart].map(([id, quantity]) => ({ variant_id: Number(id), quantity, price: 39500, title: 'Private line' })) }));
      if (input === '/cart/add.js') {
        const { id, quantity } = JSON.parse(String(init!.body)).items[0];
        cart.set(String(id), Math.min((cart.get(String(id)) ?? 0) + quantity, opts.cap ?? 1e9));
        return new Response('{}');
      }
      return new Response('', { status: 404 });
    }));
    return { cart, calls };
  }
  const one = (extra = {}) => order({ vendor: 'SDS', urlVendor: 'SDS', sku: null, description: 'Test module', productUrl: URL_BASE + '?variant=11', quantity: 2, unitPrice: 395, ...extra });

  it('adds the variant from the link with the right request, reads back, and marks', async () => {
    const { cart, calls } = store({ other: true });
    const result = await buildStore(sds, sds.steps!, [one()], hereTab, options);
    expect(cart.get('11')).toBe(2);
    expect(cart.get('999')).toBe(4);
    expect(calls).toContain('POST /cart/add.js');
    expect(calls.some(c => /checkout|\/cart\/\d+:\d+/.test(c))).toBe(false);
    expect(result.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(marksFor(result)).toEqual([{ orderId: 'order-1', quantity: 2 }]);
  });
  it('adds the variant named in the description when the link has none', async () => {
    const { cart } = store();
    await buildStore(sds, sds.steps!, [one({ productUrl: URL_BASE, description: 'Test module - Kraken X60 / Molded Spike Grip / Assembled' })], hereTab, options);
    expect(cart.get('22')).toBe(2);
  });
  it('a retry does not double', async () => {
    const { cart, calls } = store();
    await buildStore(sds, sds.steps!, [one()], hereTab, options);
    const second = await buildStore(sds, sds.steps!, [one()], hereTab, options);
    expect(cart.get('11')).toBe(2);
    expect(calls.filter(c => c === 'POST /cart/add.js')).toHaveLength(1);
    expect(second.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true });
  });
  it('reports a short-stock cap and does not mark it', async () => {
    store({ cap: 1 });
    const result = await buildStore(sds, sds.steps!, [one()], hereTab, options);
    expect(result.items[0].outcome).toBe('flagged');
    expect(marksFor(result)).toEqual([]);
  });
  it('an ambiguous item is refused and nothing is added', async () => {
    const { cart, calls } = store();
    const result = await buildStore(sds, sds.steps!, [one({ productUrl: URL_BASE })], hereTab, options);
    expect(result.items[0].outcome).toBe('failed');
    expect(cart.size).toBe(0);
    expect(calls).not.toContain('POST /cart/add.js');
  });
  it('a sold-out option is not tried', async () => {
    const { cart } = store();
    const result = await buildStore(sds, sds.steps!, [one({ productUrl: URL_BASE + '?variant=33' })], hereTab, options);
    expect(cart.size).toBe(0);
    expect(result.items[0].outcome).toBe('failed');
  });
  it('a wall stops the store', async () => {
    store({ wall: true });
    await expect(sds.steps!.resolveLine(one(), hereTab)).rejects.toBeInstanceOf(StoreStop);
  });
  it('wants a product link on SDS', () => {
    expect(sds.missing!(one({ productUrl: 'https://example.test/products/x' }))).toHaveLength(1);
    expect(sds.missing!(one())).toEqual([]);
    expect(sds.missing!(one({ productUrl: 'https://swervedrivespecialties.com/products/x' }))).toEqual([]);
  });
  it('is direct, asks only for its own origins, and never starts at checkout', () => {
    expect(sds).toMatchObject({ id: 'sds', label: 'SDS', badge: 'direct' });
    expect(sds.origins.every(o => o.includes('swervedrivespecialties.com'))).toBe(true);
    expect(sds.cartUrl).not.toMatch(/checkout/);
  });
});
