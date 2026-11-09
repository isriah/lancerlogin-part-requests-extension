// The functions that run in a store's tab, against synthetic pages and answers. No real store is contacted.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectPage } from '../../src/carts/page-check';
import { allStoreOrigins, STORES } from '../../src/carts/registry';
import { LineProblem } from '../../src/carts/store-method';
import { mcmasterPart } from '../../src/carts/stores/mcmaster';
import { pololuNumber, pololuReadCart, pololuSubmitQuickAdd, pololu } from '../../src/carts/stores/pololu';
import { addLink, revAddMessage, revReadCart, rev } from '../../src/carts/stores/rev';
import { chooseVariant, shopifyAddLine, shopifyLink, shopifyReadCart, shopifyReadProduct } from '../../src/carts/stores/shopify';
import { wcp } from '../../src/carts/stores/wcp';
import { VENDORS } from '../../src/vendors';
import { hereTab, order } from './helpers';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const stub = (...replies: Response[]) => { let n = 0; const mock = vi.fn(async () => replies[Math.min(n++, replies.length - 1)]); vi.stubGlobal('fetch', mock); return mock; };
afterEach(() => { vi.unstubAllGlobals(); document.title = ''; document.body.replaceChildren(); });
const showAll = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 40 } as DOMRect);

describe('Shopify', () => {
  const variants = [{ id: '11', sku: 'A-1', available: true }, { id: '22', sku: 'A-2', available: false }];
  it('reads the handle and variant from the saved link', () => {
    expect(shopifyLink('https://wcproducts.com/products/test-part?variant=22')).toEqual({ handle: 'test-part', variant: '22' });
    expect(shopifyLink('https://wcproducts.com/collections/test/products/test-part')).toEqual({ handle: 'test-part', variant: null });
    expect(shopifyLink('https://wcproducts.com/pages/x')).toBeNull();
  });
  it('uses the saved variant, confirmed by SKU', () => {
    expect(chooseVariant(variants, '22', 'a-2').chosen.id).toBe('22');
    expect(() => chooseVariant(variants, '22', 'A-1')).toThrow(/SKU A-1, but the saved link's option is SKU A-2/);
    expect(() => chooseVariant(variants, '33', null)).toThrow(LineProblem);
  });
  it('falls back to an exact SKU match', () => {
    expect(chooseVariant(variants, null, 'A-1').chosen.id).toBe('11');
    expect(() => chooseVariant(variants, null, 'A-')).toThrow(/No option/);
  });
  it('won\'t guess between options', () => {
    expect(() => chooseVariant(variants, null, null)).toThrow(/several options/);
    expect(chooseVariant([variants[0]], null, null).chosen.id).toBe('11');
  });
  it('says when a variant has no SKU to confirm against', () => {
    expect(chooseVariant([{ id: '5', sku: '', available: true }], '5', 'X').note).toMatch(/could not be confirmed/);
    expect(chooseVariant([{ id: '5', sku: '', available: true }], null, 'X').note).toMatch(/could not be confirmed/);
  });
  it('reads variants, and only those fields', async () => {
    const mock = stub(json({ title: 'Test', variants: [{ id: 11, sku: ' A-1 ', available: true, price: 100, inventory_quantity: 5 }] }));
    expect(await shopifyReadProduct('test part')).toEqual({ kind: 'ok', variants: [{ id: '11', sku: 'A-1', available: true }] });
    expect(mock.mock.calls[0][0 as never]).toBe('/products/test%20part.js');
  });
  it('reports a missing product, a refusal and a non-data answer differently', async () => {
    stub(new Response('', { status: 404 })); expect(await shopifyReadProduct('x')).toEqual({ kind: 'not-found' });
    stub(new Response('', { status: 429 })); expect(await shopifyReadProduct('x')).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    stub(new Response('<html>')); expect(await shopifyReadProduct('x')).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('hands back only the lines asked for, summing split lines', async () => {
    stub(json({ total_price: 99999, note: 'private', items: [{ variant_id: 11, quantity: 2, price: 1250, title: 'Wanted' }, { variant_id: 11, quantity: 1, price: 1250 }, { variant_id: 99, quantity: 7, price: 1, title: 'Someone else\'s line' }] }));
    const lines = await shopifyReadCart(['11']);
    expect(lines).toEqual([{ key: '11', quantity: 3, unitPrice: 12.5 }]);
    expect(JSON.stringify(lines)).not.toMatch(/private|Someone|99/);
  });
  it('sends one line to /cart/add.js, once, and never a permalink', async () => {
    const mock = stub(json({ items: [] }));
    expect(await shopifyAddLine('11', 2)).toEqual({ kind: 'sent' });
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/cart/add.js');
    expect(JSON.parse(String(init.body))).toEqual({ items: [{ id: 11, quantity: 2 }] });
    expect(init.headers).not.toHaveProperty('User-Agent');
  });
  it('hands the store\'s refusal to the person, and stops on a wall', async () => {
    stub(json({ status: 422, description: 'All 2 are in your cart.' }, 422)); expect(await shopifyAddLine('11', 2)).toEqual({ kind: 'refused', message: 'All 2 are in your cart.' });
    stub(new Response('', { status: 403 })); expect(await shopifyAddLine('11', 2)).toMatchObject({ kind: 'stop', reason: 'bot-check' });
  });
  it('WCP finds a line from its saved link', async () => {
    stub(json({ variants: [{ id: 11, sku: 'A-1', available: true }, { id: 22, sku: 'A-2', available: false }] }));
    const target = await wcp.steps!.resolveLine(order({ vendor: 'WCP', urlVendor: 'WCP', sku: 'A-2', productUrl: 'https://wcproducts.com/products/test-part?variant=22' }), hereTab);
    expect(target).toEqual({ key: '22', addAs: '22', available: false });
  });
});
describe('REV', () => {
  it('reads only the lines asked for, in any case', async () => {
    stub(json([{ lineItems: { physicalItems: [{ sku: 'rev-1', quantity: 2, salePrice: 30, name: 'Wanted' }, { sku: 'REV-9', quantity: 5, salePrice: 1, name: 'Other' }], digitalItems: [] }, email: 'test@example.test' }]));
    const lines = await revReadCart(['REV-1']);
    expect(lines).toEqual([{ key: 'REV-1', quantity: 2, unitPrice: 30 }]);
    expect(JSON.stringify(lines)).not.toMatch(/Other|example\.test/);
  });
  it('an empty cart is an empty list', async () => { stub(json([])); expect(await revReadCart(['X'])).toEqual([]); });
  it('adds with action=add, never action=buy', () => {
    const url = addLink('REV 1&2', 3);
    expect(url).toBe('https://www.revrobotics.com/cart.php?action=add&sku=REV%201%262&qty=3');
    expect(url).not.toMatch(/action=buy/);
    expect(readFileSync(resolve('src/carts/stores/rev.ts'), 'utf8').replace(/^\/\/.*$/gm, '').replace(/\/\*\*.*\*\//g, '')).not.toMatch(/action=buy/);
  });
  it('reads the store\'s refusal after an add', () => {
    document.body.innerHTML = '<div class="alertBox alertBox--error">Unfortunately this product is not available for purchase.</div>';
    expect(revAddMessage()).toMatch(/not available/);
    document.body.innerHTML = '<div class="alertBox alertBox--success">Added.</div>';
    expect(revAddMessage()).toBe('');
  });
  it('resolves by SKU', async () => { expect(await rev.steps!.resolveLine(order({ sku: ' rev-1 ' }), hereTab)).toEqual({ key: 'REV-1', addAs: 'rev-1' }); });
});
describe('Pololu', () => {
  const page = (rows = '') => `<table>${rows}</table><form action="/cart/update" method="post"><textarea name="quick_add"></textarea><button type="submit" name="Add to cart">Add to cart</button></form>`;
  const row = (n: string, q: number) => `<tr class="cart-product"><td class="name"><a href="/product/${n}">#${n} Test</a></td><td><input name="1J${n}[quantity]" value="${q}"></td><td class="product-info price">$15.95</td></tr>`;
  it('reads the number from the link or the SKU', () => {
    expect(pololuNumber({ productUrl: 'https://www.pololu.com/product/2136', sku: null })).toEqual({ number: '2136', conflict: false });
    expect(pololuNumber({ productUrl: null, sku: '#2136' })).toEqual({ number: '2136', conflict: false });
    expect(pololuNumber({ productUrl: 'https://www.pololu.com/product/2136', sku: '999' }).conflict).toBe(true);
  });
  it('reads only the lines asked for', () => {
    document.body.innerHTML = page(row('2136', 2) + row('1', 9));
    expect(pololuReadCart(['2136'])).toEqual([{ key: '2136', quantity: 2, unitPrice: 15.95 }]);
  });
  it('stops on a page that isn\'t the cart', () => {
    document.body.innerHTML = '<h1>Not the cart</h1>';
    expect(pololuReadCart(['2136'])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('fills the Quick add box with one line, and only that form', () => {
    document.body.innerHTML = page();
    const sent = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('form')!.addEventListener('submit', sent);
    expect(pololuSubmitQuickAdd('2136', 2)).toEqual({ kind: 'sent' });
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('2136,2');
    expect(sent).toHaveBeenCalledTimes(1);
  });
  it('refuses a form that goes anywhere else, such as checkout', () => {
    document.body.innerHTML = page().replace('/cart/update', '/checkout');
    expect(pololuSubmitQuickAdd('2136', 2)).toMatchObject({ kind: 'stop' });
  });
  it('a conflict between link and SKU fails the line', async () => {
    await expect(pololu.steps!.resolveLine(order({ vendor: 'Pololu', productUrl: 'https://www.pololu.com/product/2136', sku: '999' }), hereTab)).rejects.toThrow(LineProblem);
  });
});
describe('McMaster', () => {
  it('reads the part from the SKU or the link', () => {
    expect(mcmasterPart({ sku: '91251a537', productUrl: null })).toBe('91251A537');
    expect(mcmasterPart({ sku: 'screws', productUrl: 'https://www.mcmaster.com/91251A537/' })).toBe('91251A537');
    expect(mcmasterPart({ sku: null, productUrl: 'https://www.mcmaster.com/products/screws/' })).toBeNull();
  });
  // Its order page is in real-run.test.ts, in the shapes seen in a signed-in browser.
});
describe('walls', () => {
  it('an ordinary page passes, even with an invisible reCAPTCHA badge', () => {
    showAll();
    document.title = 'Shopping Cart';
    document.body.innerHTML = '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe><a>Log In</a><h1>Your cart</h1>';
    expect(inspectPage()).toEqual({ kind: 'ok' });
  });
  it('a visible password box is a sign-in', () => {
    showAll();
    document.body.innerHTML = '<input type="password">';
    expect(inspectPage()).toMatchObject({ kind: 'stop', reason: 'login' });
  });
  it('asking to log in to continue is a sign-in', () => {
    document.body.innerHTML = '<p>To continue browsing, please log in</p>';
    Object.defineProperty(document.body, 'innerText', { value: 'To continue browsing, please log in', configurable: true });
    expect(inspectPage()).toMatchObject({ kind: 'stop', reason: 'login' });
    delete (document.body as unknown as Record<string, unknown>).innerText;
  });
  it.each(['Just a moment...', 'Attention Required! | Cloudflare', 'Access Denied', 'Access to this page has been denied', 'Robot Check'])('the title "%s" is a bot check', title => {
    document.title = title;
    expect(inspectPage()).toMatchObject({ kind: 'stop', reason: 'bot-check' });
  });
  it('a challenge frame is a bot check', () => {
    showAll();
    document.body.innerHTML = '<iframe src="https://challenges.cloudflare.com/turnstile"></iframe>';
    expect(inspectPage()).toMatchObject({ kind: 'stop', reason: 'bot-check' });
  });
  it('a visible punish frame is a bot check, and a hidden one isn\'t', () => {
    document.body.innerHTML = '<iframe src="https://www.aliexpress.us/_____tmd_____/punish?x5secdata=test"></iframe>';
    const frame = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 0, height: 0 } as DOMRect);
    expect(inspectPage()).toEqual({ kind: 'ok' });
    frame.mockReturnValue({ width: 300, height: 200 } as DOMRect);
    expect(inspectPage()).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    frame.mockRestore();
  });
});
const CHECKED_STORE_FILES = [
  'stores/aliexpress.ts', 'stores/amazon.ts', 'stores/ambrosia.ts', 'stores/andymark.ts', 'stores/bambu.ts', 'stores/checklist.ts', 'stores/ctre.ts',
  'stores/ferrules.ts', 'stores/harborfreight.ts', 'stores/homedepot.ts', 'stores/mcmaster.ts', 'stores/onlinemetals.ts', 'stores/pololu.ts',
  'stores/powerwerx.ts', 'stores/rev.ts', 'stores/sds.ts', 'stores/shopify.ts', 'stores/swyft.ts', 'stores/thrifty.ts', 'stores/vbelts.ts', 'stores/wcp.ts', 'stores/west3d.ts',
];
describe('what ships', () => {
  const manifest = JSON.parse(readFileSync(resolve('public/manifest.json'), 'utf8'));
  it('asks for nothing new: no cookies, no web requests, no always-on store access', () => {
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.declarative_net_request).toBeUndefined();
  });
  it('the service worker holds no store code: builds run in the Carts page', () => {
    expect(readFileSync(resolve('src/background.ts'), 'utf8')).not.toMatch(/carts\/(registry|runner|chrome-tab|stores)|chrome\.tabs\.create/);
  });
  it('no code changes a user agent or names a false identity', () => {
    for (const file of [...CHECKED_STORE_FILES, 'chrome-tab.ts', 'page-check.ts', 'runner.ts']) {
      const source = readFileSync(resolve('src/carts', file), 'utf8');
      expect(source, file).not.toMatch(/user-?agent|navigator\.webdriver|document\.cookie|chrome\.cookies/i);
    }
  });
  it('that check covers every store file', () => {
    expect(readdirSync(resolve('src/carts/stores')).map(file => `stores/${file}`).sort()).toEqual([...CHECKED_STORE_FILES].sort());
  });
  it('every store is under the plugin\'s vendor label, on that vendor\'s hosts', () => {
    expect(new Set(STORES.map(store => store.id)).size).toBe(STORES.length);
    for (const store of STORES) {
      const vendor = VENDORS.find(item => item.label === store.label);
      expect(vendor, store.label).toBeDefined();
      for (const host of store.hosts) expect(vendor!.hosts, `${store.label} ${host}`).toContain(host);
    }
  });
  it('the live script grants every store origin, and refuses what the tab refuses', () => {
    const live = readFileSync(resolve('e2e/carts.live.mjs'), 'utf8');
    const listed = /const STORES = \[(.*)\];/.exec(live)![1];
    for (const origin of allStoreOrigins()) expect(listed, origin).toContain(`'${origin}'`);
    const never = (source: string) => /const NEVER = (\/.*\/i);/.exec(source)![1];
    expect(never(live)).toBe(never(readFileSync(resolve('src/carts/safety.ts'), 'utf8')));
    expect(live).toContain("const HARBOR_FREIGHT_CART = 'https://www.harborfreight.com/checkout/cart';");
  });
  it('the Carts page says the owner\'s notice word for word', () => {
    const html = readFileSync(resolve('carts.html'), 'utf8').replace(/<[^>]+>/g, '');
    expect(html).toContain('No AI places your orders. This extension doesn\'t use AI. It only helps add items to a store\'s cart, after you click Build carts. You review the cart and place every order yourself on the store\'s own site.');
  });
});
