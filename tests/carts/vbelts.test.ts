// V-Belt Guys is a plain Shopify store. Its variant SKUs contain spaces ("VBG-HAT-GRAY AIR"), and a SKU captured from a product page can be
// a longer string than the variant's own SKU, so matching stays exact and refuses everything else. Synthetic answers only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStore, marksFor } from '../../src/carts/runner';
import { LineProblem } from '../../src/carts/store-method';
import { isOnStore } from '../../src/carts/safety';
import { shopifyAddLine, shopifyLink } from '../../src/carts/stores/shopify';
import { vbelts } from '../../src/carts/stores/vbelts';
import { hereTab, options, order } from './helpers';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => { vi.unstubAllGlobals(); });
const URL_ = 'https://www.vbeltguys.com/products/6515271-bobcat-oem-equivalent-variable-speed-belt';
const captured = 'VBL15167 air 2926V616 AIR 2926V616';
const product = (sku: string, extra: object[] = []) => json({ variants: [{ id: 501, sku, available: true }, ...extra] });
const stubFetch = (...replies: Response[]) => { let n = 0; const mock = vi.fn(async (_u: unknown, _i?: unknown) => replies[Math.min(n++, replies.length - 1)]); vi.stubGlobal('fetch', mock); return mock; };
const vb = (extra = {}) => order({ vendor: 'V-Belt Guys', urlVendor: 'V-Belt Guys', sku: captured, productUrl: URL_, ...extra });
const steps = vbelts.steps!;

/** A fake store behind fetch: product, cart and add answers, with an optional stock cap and another line already in the cart. */
function fakeShop(sku: string, stock = Infinity) {
  const cart = new Map<number, number>([[999, 7]]); const posts: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/products/')) return product(sku);
    if (url === '/cart.js') return json({ items: [...cart].map(([variant_id, quantity]) => ({ variant_id, quantity, price: 6764 })) });
    if (url === '/cart/add.js') {
      const item = JSON.parse(String(init!.body)).items[0]; posts.push(item);
      cart.set(item.id, Math.min(stock, (cart.get(item.id) ?? 0) + item.quantity));
      return json({});
    }
    throw new Error(`unexpected request ${url}`);
  }));
  return { cart, posts };
}

describe('V-Belt Guys', () => {
  it('is the Shopify direct method for its own site', () => {
    expect(vbelts).toMatchObject({ id: 'vbelts', label: 'V-Belt Guys', badge: 'direct', cartUrl: 'https://www.vbeltguys.com/cart' });
    expect(vbelts.origins).toEqual(['https://www.vbeltguys.com/*']);
    expect(isOnStore(vbelts, URL_)).toBe(true);
    expect(isOnStore(vbelts, 'https://vbeltguys.com/products/x')).toBe(true);
    expect(isOnStore(vbelts, 'https://www.vbeltguys.com.evil.test/products/x')).toBe(false);
    expect(vbelts.missing!(vb())).toEqual([]);
    expect(vbelts.missing!(vb({ productUrl: 'https://www.revrobotics.com/products/x' }))).toHaveLength(1);
  });
  it('asks the product answer for the handle as written', async () => {
    expect(shopifyLink(`${URL_}?variant=44228817977466`)).toEqual({ handle: '6515271-bobcat-oem-equivalent-variable-speed-belt', variant: '44228817977466' });
    const mock = stubFetch(product(captured));
    await steps.resolveLine(vb(), hereTab);
    expect(mock.mock.calls[0][0]).toBe('/products/6515271-bobcat-oem-equivalent-variable-speed-belt.js');
  });
  it('matches a SKU that contains spaces exactly, ignoring case and outer spaces', async () => {
    stubFetch(product('VBG-HAT-GRAY AIR'));
    expect(await steps.resolveLine(vb({ sku: ' vbg-hat-gray air ' }), hereTab)).toEqual({ key: '501', addAs: '501', available: true });
  });
  it('resolves the captured long SKU only when the variant really has it', async () => {
    stubFetch(product(captured));
    expect(await steps.resolveLine(vb(), hereTab)).toMatchObject({ key: '501' });
  });
  it('refuses a captured SKU that is not the variant SKU, even on a one-variant product', async () => {
    stubFetch(product('VBL15167 AIR'));
    await expect(steps.resolveLine(vb(), hereTab)).rejects.toThrow(/No option on this product has SKU VBL15167 air 2926V616 AIR 2926V616/);
    stubFetch(product('2926V616 AIR'));
    await expect(steps.resolveLine(vb(), hereTab)).rejects.toThrow(LineProblem);
  });
  it('does not match a partial, a space-collapsed or a space-doubled SKU', async () => {
    for (const sku of ['VBL15167 air 2926V616', 'VBL15167 air  2926V616 AIR 2926V616', 'VBL15167air2926V616AIR2926V616']) {
      stubFetch(product(captured));
      await expect(steps.resolveLine(vb({ sku }), hereTab)).rejects.toThrow(LineProblem);
    }
  });
  it('refuses an ambiguous product: a duplicate SKU, or several options and nothing to choose by', async () => {
    stubFetch(product(captured, [{ id: 502, sku: captured, available: true }]));
    await expect(steps.resolveLine(vb(), hereTab)).rejects.toThrow(/More than one option/);
    stubFetch(json({ variants: [{ id: 1, sku: 'A', available: true }, { id: 2, sku: 'B', available: true }] }));
    await expect(steps.resolveLine(vb({ sku: null }), hereTab)).rejects.toThrow(/several options/);
  });
  it('checks a saved ?variant= against the SKU and will not follow it to a different SKU', async () => {
    stubFetch(product('OTHER SKU'));
    await expect(steps.resolveLine(vb({ productUrl: `${URL_}?variant=501` }), hereTab)).rejects.toThrow(/SKU OTHER SKU/);
    stubFetch(product(captured));
    expect(await steps.resolveLine(vb({ productUrl: `${URL_}?variant=501` }), hereTab)).toMatchObject({ key: '501' });
  });
  it('allows a variant that lists no SKU, but says it could not be confirmed', async () => {
    stubFetch(product(''));
    expect((await steps.resolveLine(vb(), hereTab)).note).toMatch(/could not be confirmed/);
  });
  it('a missing product is the person to handle; a 403 stops the store', async () => {
    stubFetch(new Response('', { status: 404 }));
    await expect(steps.resolveLine(vb(), hereTab)).rejects.toThrow(/no longer has/);
    stubFetch(new Response('', { status: 403 }));
    await expect(steps.resolveLine(vb(), hereTab)).rejects.toMatchObject({ reason: 'bot-check' });
  });
  it('the add is a POST of the variant ID alone to /cart/add.js, never a checkout address', async () => {
    const mock = stubFetch(json({}));
    expect(await shopifyAddLine('501', 3)).toEqual({ kind: 'sent' });
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/cart/add.js');
    expect(JSON.parse(String(init.body))).toEqual({ items: [{ id: 501, quantity: 3 }] });
    expect(url).not.toMatch(/checkout|\/cart\/\d/);
  });
  it('builds a line, leaves other cart lines alone, and a retry adds nothing', async () => {
    const { cart, posts } = fakeShop('VBG-HAT-GRAY AIR');
    const o = vb({ sku: 'VBG-HAT-GRAY AIR', quantity: 4, unitPrice: 67.64 });
    const first = await buildStore(vbelts, steps, [o], hereTab, options);
    expect(first.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(marksFor(first)).toEqual([{ orderId: 'order-1', quantity: 4 }]);
    const second = await buildStore(vbelts, steps, [o], hereTab, options);
    expect(second.items[0].message).toMatch(/Already in the cart/);
    expect(posts).toEqual([{ id: 501, quantity: 4 }]);
    expect(cart.get(501)).toBe(4);
    expect(cart.get(999)).toBe(7);
  });
  it('reports a short-stock cap and does not mark it', async () => {
    fakeShop('VBG-HAT-GRAY AIR', 2);
    const result = await buildStore(vbelts, steps, [vb({ sku: 'VBG-HAT-GRAY AIR', quantity: 4, unitPrice: 67.64 })], hereTab, options);
    expect(result.items[0].outcome).toBe('flagged');
    expect(result.items[0].confirmed).toBe(false);
    expect(marksFor(result)).toEqual([]);
  });
  it('adds nothing for a captured SKU that does not match, and sends no add', async () => {
    const { posts } = fakeShop('VBL15167 AIR');
    const result = await buildStore(vbelts, steps, [vb({ quantity: 2 })], hereTab, options);
    expect(posts).toEqual([]);
    expect(result.items[0].outcome).toBe('failed');
    expect(marksFor(result)).toEqual([]);
  });
  it('a bot-check answer from the cart stops the store with nothing marked', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/products/') ? product('X') : new Response('', { status: 429 })));
    const result = await buildStore(vbelts, steps, [vb({ sku: 'X' })], hereTab, options);
    expect(result.items[0].outcome).not.toBe('added');
    expect(marksFor(result)).toEqual([]);
  });
});
