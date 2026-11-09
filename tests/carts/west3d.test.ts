// West3D: the Shopify method plus the refusal of kits with custom (YMQ dropdown) options. Synthetic pages and answers only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineProblem, StoreStop, type StoreTab } from '../../src/carts/store-method';
import { optionsWait, west3d, west3dCustomOptions } from '../../src/carts/stores/west3d';
import { isOnStore } from '../../src/carts/safety';
import { buildStore } from '../../src/carts/runner';
import { hereTab, options, order } from './helpers';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const stub = (...replies: Response[]) => { let n = 0; const mock = vi.fn(async () => replies[Math.min(n++, replies.length - 1)]); vi.stubGlobal('fetch', mock); return mock; };
optionsWait.ms = 150; // A plain product always waits this long for options that never come.
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); document.head.replaceChildren(); });

const VARIANT = 46111298027732;
const product = () => json({ variants: [{ id: VARIANT, sku: 'QID2573', available: true }] });
const wiper = order({ vendor: 'West3D', urlVendor: 'West3D', sku: 'QID2573', productUrl: 'https://west3d.com/products/qidi-plus4-silicone-wiper-5-pack-for-nozzle-cleaning', quantity: 2, unitPrice: 2.54 });
const box = (title: string, native = false) => `<div class="ymq-options-box${native ? ' ymq-shopify-option-box' : ''}"><div class="ymq-option-title"><span class="ymq-option-title-right-name">${title}</span></div><select class="ymq-dropdown ymq-option-native-select"><option>x</option></select></div>`;
const PRODUCT_PAGE = '<form action="/cart/add"></form><style id="ymq-option-app-style"></style>';
/** What the live page does: a product page where the options app ran. With options it keeps a <ymq-option> element holding the boxes; without, the app removes it. */
const page = (inner: string | null) => {
  document.head.innerHTML = '<meta property="og:type" content="product">';
  document.body.innerHTML = PRODUCT_PAGE + (inner === null ? '' : `<ymq-option ymq-option-product-id="1" ymq-option-block-type="os2">${inner}</ymq-option>`);
};
/** A tab that records where it went and runs injected functions here. */
function trackedTab() { const visited: string[] = []; const tab: StoreTab = { ...hereTab, async goto(url) { visited.push(url); } }; return { tab, visited }; }

describe('West3D store', () => {
  it('is a direct Shopify store on its own host, with only that origin', () => {
    expect(west3d).toMatchObject({ id: 'west3d', label: 'West3D', badge: 'direct', origins: ['https://west3d.com/*'], cartUrl: 'https://west3d.com/cart', startUrl: 'https://west3d.com/cart', requiredFields: ['productUrl', 'quantity'] });
    expect(isOnStore(west3d, 'https://west3d.com/products/x')).toBe(true);
    expect(isOnStore(west3d, 'https://west3d.com.evil.test/products/x')).toBe(false);
    expect(west3d.missing!(order({ productUrl: 'https://wcproducts.com/products/x' }))).toEqual(['a product link on West3D\'s site']);
    expect(west3d.missing!(wiper)).toEqual([]);
  });
  it('resolves a plain item to its variant, confirmed by SKU, and visits only that product page', async () => {
    stub(product()); page(null);
    const { tab, visited } = trackedTab();
    expect(await west3d.steps!.resolveLine(wiper, tab)).toEqual({ key: String(VARIANT), addAs: String(VARIANT), available: true });
    expect(visited).toEqual(['https://west3d.com/products/qidi-plus4-silicone-wiper-5-pack-for-nozzle-cleaning']);
  });
  it('refuses a SKU that does not match, before opening any page', async () => {
    stub(product()); page(null);
    const { tab, visited } = trackedTab();
    await expect(west3d.steps!.resolveLine({ ...wiper, sku: 'WES0080' }, tab)).rejects.toThrow(/No option on this product has SKU WES0080/);
    expect(visited).toEqual([]);
  });
  it('refuses a kit with custom dropdown options rather than adding the wrong kit', async () => {
    stub(product()); page(box('Size', true) + box('Remove Raspberry Pi') + box('Include Printed Parts'));
    const attempt = west3d.steps!.resolveLine(wiper, hereTab);
    await expect(attempt).rejects.toBeInstanceOf(LineProblem);
    stub(product());
    await expect(west3d.steps!.resolveLine(wiper, hereTab)).rejects.toThrow(/custom options \(Remove Raspberry Pi, Include Printed Parts\)/);
  });
  it('refuses when the page is not the shape expected, instead of guessing', async () => {
    stub(product()); document.body.innerHTML = '<p>Something else</p>';
    await expect(west3d.steps!.resolveLine(wiper, hereTab)).rejects.toThrow(/couldn't be checked/);
  });
  it('stops the store on a wall while loading the product page', async () => {
    stub(product());
    const wall: StoreTab = { ...hereTab, async goto() { throw new StoreStop('bot-check', 'a security check'); } };
    await expect(west3d.steps!.resolveLine(wiper, wall)).rejects.toBeInstanceOf(StoreStop);
  });
  it('stops the store when the product lookup is refused', async () => {
    stub(new Response('', { status: 403 }));
    await expect(west3d.steps!.resolveLine(wiper, hereTab)).rejects.toBeInstanceOf(StoreStop);
  });
  it('a pack is added as the quantity asked, never converted, through /cart/add.js', async () => {
    const mock = stub(json({ items: [] }));
    await west3d.steps!.addLine(hereTab, { key: '1', addAs: String(VARIANT) }, 3);
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/cart/add.js');
    expect(JSON.parse(String(init.body))).toEqual({ items: [{ id: VARIANT, quantity: 3 }] });
  });
  it('reads the cart back for the variant asked for, and only that', async () => {
    stub(json({ items: [{ variant_id: VARIANT, quantity: 2, price: 254 }, { variant_id: 5, quantity: 9, price: 1 }] }));
    expect(await west3d.steps!.readCart(hereTab, [String(VARIANT)])).toEqual([{ key: String(VARIANT), quantity: 2, unitPrice: 2.54 }]);
  });
});

describe('West3D custom option check', () => {
  it('finds a plain product: the app ran and removed its options element', async () => { page(null); expect(await west3dCustomOptions(300)).toEqual({ kind: 'plain' }); });
  it('treats the native variant picker alone as plain', async () => { page(box('Material', true)); expect(await west3dCustomOptions(300)).toEqual({ kind: 'plain' }); });
  it('finds any other box as custom, with its title', async () => { page(box('Material', true) + box('Frame')); expect(await west3dCustomOptions(300)).toEqual({ kind: 'custom', names: ['Frame'] }); });
  it('finds a loose dropdown with no box as custom', async () => { page('<select class="ymq-dropdown"><option>x</option></select>'); expect(await west3dCustomOptions(300)).toEqual({ kind: 'custom', names: ['an option'] }); });
  it('waits for options the page draws late', async () => {
    page('');
    setTimeout(() => { document.querySelector('ymq-option')!.innerHTML = box('Frame'); }, 400);
    expect(await west3dCustomOptions(3000)).toEqual({ kind: 'custom', names: ['Frame'] });
  });
  it('never calls a page plain without evidence: not a product page, the app absent, or an element that stays empty', async () => {
    document.body.innerHTML = '<main></main>'; expect(await west3dCustomOptions(100)).toEqual({ kind: 'unreadable' });
    page(null); document.querySelector('#ymq-option-app-style')!.remove(); expect(await west3dCustomOptions(100)).toEqual({ kind: 'unreadable' });
    page(null); document.head.replaceChildren(); expect(await west3dCustomOptions(100)).toEqual({ kind: 'unreadable' });
    page(''); expect(await west3dCustomOptions(100)).toEqual({ kind: 'unreadable' });
  });
});

describe('West3D through the runner, against a store that keeps a cart', () => {
  /** Answers /products/x.js, /cart.js and /cart/add.js the way Shopify does, accumulating adds. `cap` limits the cart. */
  function shop(cap = Infinity) {
    let held = 0; const adds: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/products/')) return product();
      if (url === '/cart/add.js') { const q = JSON.parse(String(init!.body)).items[0].quantity as number; adds.push(q); held = Math.min(cap, held + q); return json({ items: [] }); }
      if (url === '/cart.js') return json({ items: held ? [{ variant_id: VARIANT, quantity: held, price: 254 }, { variant_id: 7, quantity: 4, price: 100 }] : [{ variant_id: 7, quantity: 4, price: 100 }] });
      return new Response('', { status: 404 });
    }));
    return { adds };
  }
  it('adds the pack once, reads it back, and a second build adds nothing', async () => {
    const { adds } = shop(); page(null);
    const first = await buildStore(west3d, west3d.steps!, [wiper], hereTab, options);
    expect(first.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    const second = await buildStore(west3d, west3d.steps!, [wiper], hereTab, options);
    expect(adds).toEqual([2]);
    expect(second.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true });
  });
  it('reports short stock when the store caps the cart', async () => {
    const { adds } = shop(1); page(null);
    const result = await buildStore(west3d, west3d.steps!, [wiper], hereTab, options);
    expect(adds).toEqual([2]);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false });
    expect(result.items[0].message).toMatch(/short|only/i);
  });
  it('adds nothing for a kit with custom options, and says why', async () => {
    const { adds } = shop(); page(box('Frame'));
    const result = await buildStore(west3d, west3d.steps!, [wiper], hereTab, options);
    expect(adds).toEqual([]);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', confirmed: false });
    expect(result.items[0].message).toMatch(/custom options/);
  });
  it('stops the store, adding nothing, when the product page is a security check', async () => {
    const { adds } = shop(); page(null);
    const wall: StoreTab = { ...hereTab, async goto() { throw new StoreStop('bot-check', 'a security check'); } };
    const result = await buildStore(west3d, west3d.steps!, [wiper], wall, options);
    expect(adds).toEqual([]);
    expect(result.items[0].outcome).toBe('checklist');
  });
});
