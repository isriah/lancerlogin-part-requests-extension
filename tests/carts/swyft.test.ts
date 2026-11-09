// Swyft's product page, as a synthetic page that behaves like the real one: options, a + control, related products, and a drawer after an add.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStore } from '../../src/carts/runner';
import { StoreStop } from '../../src/carts/store-method';
import { swyft, swyftAddLine, swyftChoose, swyftLink, swyftReadCart } from '../../src/carts/stores/swyft';
import { VENDORS } from '../../src/vendors';
import { hereTab, options, order } from './helpers';

const KEY = 'swyft.cart.v2';
const steps = swyft.steps!;
declare const jsdom: { reconfigure(settings: { url: string }): void };
const swyftOrder = (extra = {}) => order({ vendor: 'Swyft', urlVendor: 'Swyft', description: 'Test part', sku: 'B-2', productUrl: 'https://swyftrobotics.com/motion/test-part', quantity: 2, unitPrice: null, ...extra });
const cart = () => JSON.parse(localStorage.getItem(KEY) ?? '[]') as { sku: string; quantity: number }[];

interface Variant { sku: string; options: string[]; soldOut?: boolean; id?: string }
interface PageSettings {
  groups?: { label: string; values: string[] }[];
  variants?: Variant[];
  title?: string;
  /** How long clicks are lost for, as they are before the real page has started up. */
  startupMs?: number;
  /** How long before the header shows the cart that's in storage. */
  cartLoadMs?: number;
  /** What the site really does with an add. */
  onAdd?: (sku: string, quantity: number) => void;
  /** Where + stops, if the page sets a limit. */
  limit?: number;
  /** How long the store's server takes to answer about an existing cart. Its answer puts back the count the page had when it asked, as the real site does. */
  syncMs?: number;
}
/** The fetches the page has finished, which is all the store can see of them. */
let finished: { initiatorType: string; name: string }[] = [];
const siteAdd = (sku: string, quantity: number, price = 1299) => {
  const items = cart();
  const line = items.find(item => item.sku === sku);
  if (line) line.quantity += quantity; else items.push({ sku, quantity, unitPrice: price, name: 'Private name' } as never);
  localStorage.setItem(KEY, JSON.stringify(items));
};
const RELATED = '<section id="related"><a href="/motion/other">Other part</a><button id="related-add">Add to Cart</button><button aria-pressed="false" aria-label="Save Other part to wishlist"></button></section>';
function productPage(settings: PageSettings = {}) {
  const groups = settings.groups ?? [{ label: 'Type', values: ['Alpha', 'Beta'] }];
  const variants = settings.variants ?? [{ sku: 'A-1', options: ['Alpha'], id: '111' }, { sku: 'B-2', options: ['Beta'], id: '222' }];
  const started = Date.now() + (settings.startupMs ?? 0);
  const live = () => Date.now() >= started;
  const fromLink = variants.find(v => v.id && v.id === new URLSearchParams(location.search).get('variant'));
  const chosen = [...(fromLink?.options ?? variants[0].options)];
  const current = () => variants.find(v => v.options.every((value, index) => value === chosen[index]));
  const main = document.createElement('main');
  main.innerHTML = `<div class="space-y-6"><div><span>Motion</span><span id="sku"></span></div><div><h1>${settings.title ?? 'Test part'}</h1></div><div class="space-y-4">${groups.map((group, index) => `<div class="space-y-2"><label>${group.label}</label><div>${group.values.map(value => `<button type="button" aria-pressed="false" data-group="${index}">${value}</button>`).join('')}</div></div>`).join('')}</div>
    <div>QTY</div><div class="qty"><button type="button" id="less" aria-label="Decrease quantity"></button><span id="shown">1</span><button type="button" id="more" aria-label="Increase quantity"></button></div><div id="act"></div><button aria-pressed="false">Save</button></div>${RELATED}
    <div class="table">${variants.map(v => `<div class="justify-between"><div><span>${v.options.join(' / ')}</span><span><span>SKU: <!-- -->${v.sku}</span></span></div></div>`.repeat(2)).join('')}</div>
    <script>${variants.map(v => `gid://shopify/ProductVariant/${v.id ?? '0'}`).join(' ')}</script>`;
  const header = document.createElement('button');
  header.setAttribute('aria-label', 'Cart, 0 items');
  const drawer = document.createElement('div');
  drawer.setAttribute('role', 'dialog');
  drawer.hidden = true;
  drawer.innerHTML = '<button aria-label="Increase quantity" id="drawer-more"></button><button id="checkout">Checkout</button>';
  document.body.replaceChildren(header, main, drawer);
  let quantity = 1;
  const clicks = { related: 0, checkout: 0, drawerMore: 0, add: 0 };
  const paint = () => {
    const now = current();
    main.querySelector('#sku')!.textContent = `SKU: ${now?.sku ?? ''}`;
    main.querySelectorAll<HTMLButtonElement>('button[data-group]').forEach(button => button.setAttribute('aria-pressed', String(chosen[Number(button.dataset.group)] === button.textContent)));
    main.querySelector('#shown')!.textContent = String(quantity);
    (main.querySelector('#less') as HTMLButtonElement).disabled = quantity <= 1;
    (main.querySelector('#more') as HTMLButtonElement).disabled = settings.limit !== undefined && quantity >= settings.limit;
    const act = main.querySelector('#act')!;
    act.innerHTML = now?.soldOut ? '<button disabled>Currently sold out</button><button>Notify Me</button>' : '<button id="add">Add to Cart</button>';
    act.querySelector('#add')?.addEventListener('click', () => {
      if (!live()) return;
      clicks.add++;
      (settings.onAdd ?? siteAdd)(now!.sku, quantity);
      header.setAttribute('aria-label', `Cart, ${cart().reduce((sum, item) => sum + item.quantity, 0)} items`);
      drawer.hidden = false;
      setTimeout(() => finished.push({ initiatorType: 'fetch', name: location.href }), 20);
    });
  };
  finished = [{ initiatorType: 'fetch', name: `${location.origin}/other?_rsc=abc` }, { initiatorType: 'img', name: location.href }];
  if (localStorage.getItem('swyft.shopify_cart_id') !== null) {
    const asked = localStorage.getItem(KEY);
    setTimeout(() => { finished.push({ initiatorType: 'fetch', name: location.href }); if (asked !== null) localStorage.setItem(KEY, asked); }, settings.syncMs ?? 0);
  }
  main.querySelectorAll<HTMLButtonElement>('button[data-group]').forEach(button => button.addEventListener('click', () => { if (!live()) return; chosen[Number(button.dataset.group)] = button.textContent!; paint(); }));
  main.querySelector('#more')!.addEventListener('click', () => { if (live()) { quantity++; paint(); } });
  main.querySelector('#less')!.addEventListener('click', () => { if (live()) { quantity--; paint(); } });
  main.querySelector('#related-add')!.addEventListener('click', () => { clicks.related++; siteAdd('OTHER', 1); });
  drawer.querySelector('#checkout')!.addEventListener('click', () => { clicks.checkout++; });
  drawer.querySelector('#drawer-more')!.addEventListener('click', () => { clicks.drawerMore++; });
  setTimeout(() => header.setAttribute('aria-label', `Cart, ${cart().reduce((sum, item) => sum + item.quantity, 0)} items`), settings.cartLoadMs ?? 0);
  paint();
  return { clicks, shown: () => main.querySelector('#shown')!.textContent };
}
const settled = () => new Promise(done => setTimeout(done, 5));

beforeEach(() => {
  jsdom.reconfigure({ url: 'https://swyftrobotics.com/motion/test-part' }); localStorage.clear(); document.title = 'Test part | SWYFT Robotics'; finished = [];
  (performance as unknown as { getEntriesByType: unknown }).getEntriesByType = () => finished;
});
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

describe('the store', () => {
  it('takes its hosts from the vendor list, and asks Chrome for the one host it opens', () => {
    expect(swyft.hosts).toEqual(VENDORS.find(vendor => vendor.id === 'swyft')!.hosts);
    expect(swyft.origins).toEqual(['https://swyftrobotics.com/*']);
    expect(swyft.badge).toBe('item');
    expect(steps.foreground).toBe(true);
    expect(swyft.label).toBe('Swyft');
    expect(swyft.cartUrl).toBe('https://swyftrobotics.com/cart');
    expect(`${swyft.startUrl} ${swyft.cartUrl}`).not.toMatch(/checkout/i);
  });
  it('blocks a link that isn\'t a product on the store', () => {
    expect(swyft.missing!(swyftOrder())).toEqual([]);
    expect(swyft.missing!(swyftOrder({ productUrl: 'https://www.swyftrobotics.com/kits/test-kit?variant=1' }))).toEqual([]);
    expect(swyft.missing!(swyftOrder({ productUrl: 'https://swyftrobotics.com/motion' }))).toHaveLength(1);
    expect(swyft.missing!(swyftOrder({ productUrl: 'https://shop.swyftrobotics.com/motion/test-part' }))).toHaveLength(1);
  });
  it('opens every link on one host, because each host has its own cart, keeping only the saved option', () => {
    expect(swyftLink('https://www.swyftrobotics.com/motion/test-part?variant=22&utm_source=x#top')).toEqual({ url: 'https://swyftrobotics.com/motion/test-part?variant=22', variant: '22' });
    expect(swyftLink('https://swyftrobotics.com/products/test-part')).toEqual({ url: 'https://swyftrobotics.com/products/test-part', variant: null });
    expect(swyftLink('https://swyftrobotics.com/motion/test-part?variant=abc')?.variant).toBeNull();
    expect(swyftLink('https://swyftrobotics.com/motion')).toBeNull();
    expect(swyftLink('not a link')).toBeNull();
  });
  it('never writes the cart, sets a user agent, or names checkout as something to press', () => {
    const source = readFileSync(resolve('src/carts/stores/swyft.ts'), 'utf8');
    expect(source).not.toMatch(/setItem|removeItem|localStorage\s*\[|user-?agent|navigator\.webdriver|document\.cookie/i);
    expect(source.replace(/^\/\/.*$/gm, '')).not.toMatch(/checkout/i);
  });
});
describe('reading the cart', () => {
  const line = (sku: unknown, quantity: unknown, unitPrice: unknown = 1299) => ({ sku, quantity, unitPrice, name: 'Someone else\'s part', image: 'x' });
  it('hands back only the lines asked for, in any case, with the price in dollars', () => {
    localStorage.setItem(KEY, JSON.stringify([line('Sr-Servo-10', 2), line('OTHER', 9), line('SR-SERVO-10', 1)]));
    const lines = swyftReadCart(['SR-SERVO-10'], 'swyftrobotics.com');
    expect(lines).toEqual([{ key: 'SR-SERVO-10', quantity: 3, unitPrice: 12.99 }]);
    expect(JSON.stringify(lines)).not.toMatch(/OTHER|Someone/);
  });
  it('an empty or absent cart is an empty list', () => {
    expect(swyftReadCart(['A'], 'swyftrobotics.com')).toEqual([]);
    localStorage.setItem(KEY, '[]');
    expect(swyftReadCart(['A'], 'swyftrobotics.com')).toEqual([]);
  });
  it('stops rather than guessing zero', () => {
    localStorage.setItem(KEY, '{oops');
    expect(swyftReadCart(['A'], 'swyftrobotics.com')).toMatchObject({ kind: 'stop' });
    localStorage.setItem(KEY, '{"items":[]}');
    expect(swyftReadCart(['A'], 'swyftrobotics.com')).toMatchObject({ kind: 'stop' });
    localStorage.setItem(KEY, JSON.stringify([line('A', 'two')]));
    expect(swyftReadCart(['A'], 'swyftrobotics.com')).toMatchObject({ kind: 'stop' });
    localStorage.setItem(KEY, '[]');
    expect(swyftReadCart(['A'], 'www.swyftrobotics.com')).toMatchObject({ kind: 'stop', detail: expect.stringMatching(/another host/) });
  });
  it('does not write', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    localStorage.setItem(KEY, '[]');
    write.mockClear();
    swyftReadCart(['A'], 'swyftrobotics.com');
    expect(write).not.toHaveBeenCalled();
  });
});
describe('choosing the option', () => {
  const ask = (sku: string | null, description: string | null = 'Test part', variant: string | null = null) => swyftChoose({ sku, variant, description }, 300);
  const belts = { groups: [{ label: 'Tooth count', values: ['40 Tooth', '140 Tooth'] }, { label: 'Width', values: ['5mm Width', '10mm Width'] }], variants: [{ sku: 'B40-5', options: ['40 Tooth', '5mm Width'] }, { sku: 'B40-10', options: ['40 Tooth', '10mm Width'] }, { sku: 'B140-5', options: ['140 Tooth', '5mm Width'] }, { sku: 'B140-10', options: ['140 Tooth', '10mm Width'] }] };
  it('leaves a matching option alone', async () => {
    productPage();
    expect(await ask('a-1')).toEqual({ kind: 'chosen', sku: 'A-1', soldOut: false });
    expect(document.querySelector('button[aria-pressed="true"]')!.textContent).toBe('Alpha');
  });
  it('presses the option for the SKU, and confirms it from what the page then shows', async () => {
    productPage();
    expect(await ask('B-2')).toEqual({ kind: 'chosen', sku: 'B-2', soldOut: false });
    expect(document.querySelector('button[aria-pressed="true"]')!.textContent).toBe('Beta');
  });
  it('presses one option in each group, and doesn\'t take 140 Tooth for 40 Tooth', async () => {
    productPage(belts);
    expect(await ask('B40-10')).toMatchObject({ sku: 'B40-10' });
    productPage(belts);
    expect(await ask('B140-5', 'Test part - 140 Tooth / 5mm Width')).toMatchObject({ sku: 'B140-5' });
  });
  it('handles an option whose own name has a slash', async () => {
    productPage({ groups: [{ label: 'Size', values: ['Plain', '7mm Hex / 15T Collar (10 Pack)'] }], variants: [{ sku: 'P', options: ['Plain'] }, { sku: 'H', options: ['7mm Hex / 15T Collar (10 Pack)'] }] });
    expect(await ask('H')).toMatchObject({ sku: 'H' });
  });
  it('asks again when the page wasn\'t listening yet', async () => {
    productPage({ startupMs: 250 });
    expect(await ask('B-2')).toMatchObject({ kind: 'chosen', sku: 'B-2' });
  });
  it('refuses a SKU the product doesn\'t have, leaving the option alone', async () => {
    productPage();
    expect(await ask('A-')).toEqual({ kind: 'problem', message: 'No option on this product has SKU A-.' });
    expect(document.querySelector('button[aria-pressed="true"]')!.textContent).toBe('Alpha');
  });
  it('refuses when the saved link and the SKU disagree', async () => {
    jsdom.reconfigure({ url: 'https://swyftrobotics.com/motion/test-part?variant=222' });
    productPage();
    expect(await ask('A-1', 'Test part', '222')).toMatchObject({ kind: 'problem', message: expect.stringMatching(/SKU A-1, but the saved link's option is SKU B-2/) });
  });
  it('goes by the SKU when a redirect loses the saved option', async () => {
    productPage();
    expect(await ask('B-2', 'Test part', '111')).toMatchObject({ kind: 'chosen', sku: 'B-2' });
  });
  it('refuses when the description names another option than the SKU', async () => {
    productPage();
    expect(await ask('B-2', 'Test part - Alpha')).toMatchObject({ kind: 'problem', message: expect.stringMatching(/says Alpha, but SKU B-2 is Beta/) });
  });
  it('without a SKU, won\'t settle for whichever option is already pressed', async () => {
    productPage();
    expect(await ask(null)).toMatchObject({ kind: 'problem', message: expect.stringMatching(/several options/) });
    productPage();
    expect(await ask(null, 'Test part - Alpha and Beta')).toMatchObject({ kind: 'problem' });
  });
  it('without a SKU, uses a description that names one option, and says so', async () => {
    productPage();
    expect(await ask(null, 'Test part - Beta')).toMatchObject({ kind: 'chosen', sku: 'B-2', note: expect.stringMatching(/no SKU/) });
  });
  it('without a SKU, needs every group named', async () => {
    productPage(belts);
    expect(await ask(null, 'Test part - 40 Tooth')).toMatchObject({ kind: 'problem' });
  });
  it('without a SKU, uses a saved option the product still has', async () => {
    jsdom.reconfigure({ url: 'https://swyftrobotics.com/motion/test-part?variant=222' });
    productPage();
    expect(await ask(null, 'Test part', '222')).toEqual({ kind: 'chosen', sku: 'B-2', soldOut: false });
  });
  it('refuses a saved option the product no longer has', async () => {
    jsdom.reconfigure({ url: 'https://swyftrobotics.com/motion/test-part?variant=999' });
    productPage();
    expect(await ask(null, 'Test part', '999')).toMatchObject({ kind: 'problem', message: expect.stringMatching(/no longer has/) });
  });
  it('a product with one choice needs nothing more', async () => {
    productPage({ groups: [], variants: [{ sku: 'ONLY', options: [] }] });
    expect(await ask(null)).toEqual({ kind: 'chosen', sku: 'ONLY', soldOut: false });
  });
  it('refuses an item with no SKU to read back', async () => {
    productPage({ groups: [], variants: [{ sku: '', options: [] }] });
    expect(await ask(null)).toMatchObject({ kind: 'problem', message: expect.stringMatching(/no SKU/) });
  }, 8000);
  it('reports a sold-out option, and doesn\'t count Notify Me as adding', async () => {
    productPage({ variants: [{ sku: 'A-1', options: ['Alpha'] }, { sku: 'B-2', options: ['Beta'], soldOut: true }] });
    expect(await ask('B-2')).toEqual({ kind: 'chosen', sku: 'B-2', soldOut: true });
  });
  it('the site\'s 404 comes with status 200, and is a missing product', async () => {
    document.title = 'Product Not Found | SWYFT Robotics';
    document.body.innerHTML = '<h1>This part isn\'t in the build.</h1>';
    expect(await ask('A')).toEqual({ kind: 'not-found' });
  });
  it('a category page is a problem with this line, and an unknown page stops the store', async () => {
    document.body.innerHTML = '<main><div><div><h1>Motion</h1></div></div></main>';
    expect(await ask('A')).toMatchObject({ kind: 'problem', message: expect.stringMatching(/category/) });
    document.body.innerHTML = '<div>Something else</div>';
    expect(await ask('A')).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('a wall that draws itself after loading stops the store', async () => {
    document.body.innerHTML = '<div>Loading</div>';
    setTimeout(() => { document.title = 'Just a moment...'; }, 50);
    expect(await ask('A')).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    document.title = 'Sign in';
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 40 } as DOMRect);
    document.body.innerHTML = '<input type="password">';
    expect(await ask('A')).toMatchObject({ kind: 'stop', reason: 'login' });
  });
});
describe('adding', () => {
  it.each([[1], [2], [5]])('quantity %i: uses the + control, presses Add once, and lands exactly that many', async quantity => {
    const page = productPage(); await settled();
    expect(await swyftAddLine('A-1', quantity, 20)).toEqual({ kind: 'sent' });
    expect(cart()).toMatchObject([{ sku: 'A-1', quantity }]);
    expect(page.clicks.add).toBe(1);
    expect(page.shown()).toBe(String(quantity));
  });
  it('touches only the product\'s own controls, not related products or the drawer', async () => {
    const page = productPage(); await settled();
    await swyftAddLine('A-1', 3, 20);
    expect(page.clicks).toEqual({ related: 0, checkout: 0, drawerMore: 0, add: 1 });
    expect(cart()).toHaveLength(1);
  });
  it.each([[1], [3]])('quantity %i: lost clicks while the page starts up don\'t lose the add or change the count', async quantity => {
    const page = productPage({ startupMs: 200 }); await settled();
    expect(await swyftAddLine('A-1', quantity, 40)).toEqual({ kind: 'sent' });
    expect(cart()).toMatchObject([{ sku: 'A-1', quantity }]);
    expect(page.clicks.add).toBe(1);
  });
  it('stops before sending when the page shows another SKU', async () => {
    const page = productPage(); await settled();
    expect(await swyftAddLine('B-2', 2, 20)).toMatchObject({ kind: 'stop', notSent: true });
    expect(page.clicks.add).toBe(0);
  });
  it('stops before sending when + never responds', async () => {
    const page = productPage({ startupMs: 60_000 }); await settled();
    expect(await swyftAddLine('A-1', 2, 5)).toMatchObject({ kind: 'stop', notSent: true, detail: expect.stringMatching(/did not respond/) });
    expect(page.clicks.add).toBe(0);
  });
  it('waits for the page\'s cart to load, so that an add can\'t save over earlier lines', async () => {
    siteAdd('OTHER', 4);
    productPage({ cartLoadMs: 150 });
    expect(await swyftAddLine('A-1', 1, 20)).toEqual({ kind: 'sent' });
    expect(cart()).toMatchObject([{ sku: 'OTHER', quantity: 4 }, { sku: 'A-1', quantity: 1 }]);
  });
  it('refuses to press Add when the page\'s cart never loads', async () => {
    siteAdd('OTHER', 4);
    const page = productPage({ cartLoadMs: 60_000 });
    expect(await swyftAddLine('A-1', 1, 20)).toMatchObject({ kind: 'stop', notSent: true, detail: expect.stringMatching(/finished loading/) });
    expect(page.clicks.add).toBe(0);
  }, 8000);
  it('waits for the store\'s answer about the cart, whose late arrival would undo the add here and not on the server', async () => {
    siteAdd('A-1', 3);
    localStorage.setItem('swyft.shopify_cart_id', 'test-cart');
    const page = productPage({ syncMs: 300 });
    const early = swyftAddLine('A-1', 2, 20);
    await new Promise(done => setTimeout(done, 150));
    expect(page.clicks.add).toBe(0);
    expect(await early).toEqual({ kind: 'sent' });
    expect(page.clicks.add).toBe(1);
    await new Promise(done => setTimeout(done, 400));
    expect(cart()).toMatchObject([{ sku: 'A-1', quantity: 5 }]);
  });
  it('page data and images don\'t count as that answer, and a new cart has none to wait for', async () => {
    const page = productPage(); await settled();
    expect(await swyftAddLine('A-1', 1, 20)).toEqual({ kind: 'sent' });
    expect(page.clicks.add).toBe(1);
    localStorage.clear();
    localStorage.setItem('swyft.shopify_cart_id', 'test-cart');
    const waiting = productPage({ syncMs: 60_000 }); await settled();
    const outcome = swyftAddLine('A-1', 1, 20);
    await new Promise(done => setTimeout(done, 300));
    expect(waiting.clicks.add).toBe(0);
    finished.push({ initiatorType: 'fetch', name: location.href });
    expect(await outcome).toEqual({ kind: 'sent' });
  }, 12000);
  it('refuses to press Add when the store never answers about the cart', async () => {
    localStorage.setItem('swyft.shopify_cart_id', 'test-cart');
    const page = productPage({ syncMs: 60_000 }); await settled();
    expect(await swyftAddLine('A-1', 1, 20)).toMatchObject({ kind: 'stop', notSent: true, detail: expect.stringMatching(/still being read/) });
    expect(page.clicks.add).toBe(0);
  }, 20000);
  it('hands back the store\'s own words when it became sold out', async () => {
    productPage({ groups: [], variants: [{ sku: 'A-1', options: [], soldOut: true }] }); await settled();
    expect(await swyftAddLine('A-1', 2, 20)).toEqual({ kind: 'refused', message: 'Currently sold out' });
  });
  it('sends what it can when + stops at a limit, and the read-back reports it', async () => {
    productPage({ limit: 3 }); await settled();
    expect(await swyftAddLine('A-1', 5, 20)).toEqual({ kind: 'sent' });
    expect(cart()).toMatchObject([{ quantity: 3 }]);
  });
  it('writes nothing itself', async () => {
    const page = productPage({ onAdd: () => undefined }); await settled();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(await swyftAddLine('A-1', 1, 20).then(() => localStorage.getItem(KEY))).toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(page.clicks.add).toBe(1);
  }, 12000);
});
describe('a whole build', () => {
  // Each load of the product page starts afresh, as a real load does.
  const tabFor = (settings: PageSettings = {}) => ({ ...hereTab, async goto() { productPage(settings); await settled(); } });
  const build = (orders = [swyftOrder()], settings: PageSettings = {}) => buildStore(swyft, steps, orders, tabFor(settings), options);
  it('adds the right option in the right quantity', async () => {
    const result = await build();
    expect(result.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(cart()).toMatchObject([{ sku: 'B-2', quantity: 2 }]);
  });
  it('a retry doesn\'t double', async () => {
    await build();
    const again = await build();
    expect(again.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: expect.stringMatching(/Already in the cart/) });
    expect(cart()).toMatchObject([{ sku: 'B-2', quantity: 2 }]);
  });
  it('tops up a line that\'s short, adding only the difference', async () => {
    siteAdd('B-2', 1);
    const result = await build(undefined);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true });
    expect(cart()).toMatchObject([{ sku: 'B-2', quantity: 2 }]);
  });
  it('two orders for one part add up', async () => {
    await build([swyftOrder({ id: 'one' }), swyftOrder({ id: 'two', quantity: 3 })]);
    expect(cart()).toMatchObject([{ sku: 'B-2', quantity: 5 }]);
  });
  it('reports a price change', async () => {
    const result = await build([swyftOrder({ unitPrice: 10 })]);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: expect.stringMatching(/Price changed.*\$12\.99/) });
  });
  it('a read-back that doesn\'t match isn\'t confirmed', async () => {
    const result = await build(undefined, { onAdd: (sku, quantity) => siteAdd(sku, quantity + 1) });
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/Quantity mismatch/) });
  });
  it('a short cart is reported, not confirmed', async () => {
    const result = await build(undefined, { onAdd: sku => siteAdd(sku, 1) });
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/Short stock/) });
  });
  it('an add that didn\'t land fails', async () => {
    const result = await build(undefined, { onAdd: () => undefined });
    expect(result.items[0]).toMatchObject({ outcome: 'failed', confirmed: false });
  }, 12000);
  it('an ambiguous item is refused, and the next still goes in', async () => {
    const result = await build([swyftOrder({ id: 'vague', sku: null }), swyftOrder({ id: 'clear' })]);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/several options/) });
    expect(result.items[1]).toMatchObject({ outcome: 'added' });
    expect(cart()).toMatchObject([{ sku: 'B-2', quantity: 2 }]);
  });
  it('a sold-out item isn\'t tried', async () => {
    const result = await build(undefined, { variants: [{ sku: 'A-1', options: ['Alpha'] }, { sku: 'B-2', options: ['Beta'], soldOut: true }] });
    expect(result.items[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/out of stock/) });
    expect(cart()).toEqual([]);
  });
  it('a product page that\'s gone is one failed line', async () => {
    const tab = { ...hereTab, async goto() { document.title = 'Product Not Found | SWYFT Robotics'; document.body.innerHTML = '<h1>Gone</h1>'; } };
    const result = await buildStore(swyft, steps, [swyftOrder()], tab, options);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/no longer has/) });
  });
  it('a wall stops the store, and the rest become checklist links', async () => {
    const tab = { ...hereTab, async goto() { throw new StoreStop('bot-check', 'a CAPTCHA or bot check'); } };
    const result = await buildStore(swyft, steps, [swyftOrder({ id: 'one' }), swyftOrder({ id: 'two' })], tab, options);
    expect(result.stopped?.reason).toBe('bot-check');
    expect(result.items.map(item => item.outcome)).toEqual(['checklist', 'checklist']);
    expect(cart()).toEqual([]);
  });
  it('another host stops the read rather than reading the wrong cart', async () => {
    jsdom.reconfigure({ url: 'https://www.swyftrobotics.com/motion/test-part' });
    const result = await build();
    expect(result.stopped?.reason).toBe('unexpected');
    expect(cart()).toEqual([]);
  });
});
