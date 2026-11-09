// Online Metals' injected functions and its whole flow, against synthetic pages shaped like its product page. No real store is contacted. The cart page's
// shape is the Hybris pattern: a real one has not been seen, because /en/cart answers a fresh browser with Cloudflare's 403.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectPage } from '../../src/carts/page-check';
import { buildStore } from '../../src/carts/runner';
import { allowedInTab } from '../../src/carts/safety';
import { LineProblem, StoreStop, stopIf, type StoreTab } from '../../src/carts/store-method';
import { onlineMetalsClickAdd, onlineMetalsLink, onlineMetalsReadCart, onlineMetalsReadProduct, onlineMetalsVariant, onlinemetals } from '../../src/carts/stores/onlinemetals';
import { order, options } from './helpers';

const PID = '9999';
const SKU = `${PID}_24_0`;
const LINK = `https://www.onlinemetals.com/en/buy/test-metal/test-bar/pid/${PID}`;
const line = (extra = {}) => order({ vendor: 'Online Metals', urlVendor: 'Online Metals', sku: SKU, productUrl: LINK, unitPrice: 38.02, ...extra });
const go = (path: string) => history.pushState({}, '', path);
const radio = (code: string, price: string, checked = false, extra = '') => `<input type="radio" id="selectedVariant${code}" class="select-length" name="productLength" value="${price}" data-variantcode="${code}" ${checked ? 'checked' : ''} ${extra}>`;
const offers = (availability = 'InStock') => `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ offers: { offers: [{ '@type': 'Offer', sku: SKU, availability: `http://schema.org/${availability}` }] } }] })}</script>`;
const pdp = ({ radios = radio(`${PID}_12_0`, '19.51', true) + radio(SKU, '38.02'), ld = offers(), action = '/en/tkaddtocart/add', button = 'Add To Cart' } = {}) => `${ld}
  <input type="hidden" id="selector${PID}"><div class="custom-cut-radio"><input type="radio" class="pdpCustomCut" id="custom-cut-${PID}" name="productLengthCustomCut"></div>${radios}
  <input type="number" value="1" id="js-pdp-qty" min="1" max="9999">
  <form id="addToCartForm${PID}" action="${action}" method="post"><input type="hidden" name="qty" id="qty" value="1"><input type="hidden" name="productCodePost" id="productCode${PID}" value="${PID}_12_0">
  <button id="addToCartButton${PID}" type="button"><span>${button}</span></button></form><a id="co" href="/en/checkout">Check Out</a>`;
/** What the page's own scripts do: a picked length goes into the form. */
const wirePage = () => {
  for (const node of document.querySelectorAll('input[name="productLength"]')) node.addEventListener('change', () => { (document.querySelector('input[name="productCodePost"]') as HTMLInputElement).value = (node as HTMLInputElement).dataset.variantcode!; });
};
const cartRow = (code: string, quantity: number | string) => `<form action="/en/cart/update" method="post" id="updateCartForm"><input type="hidden" name="productCode" value="${code}"><input name="quantity" value="${quantity}"></form>`;
/** Stands in for the browser's report of the add's answer. */
let answer: { name: string; responseStatus: number } | null = null;
class FakeObserver {
  constructor(private report: (list: { getEntries(): unknown[] }) => void) {}
  observe() { button().addEventListener('click', () => { if (answer) this.report({ getEntries: () => [answer] }); }); }
  disconnect() { /* Nothing to stop. */ }
}
const button = () => document.getElementById(`addToCartButton${PID}`)!;

beforeEach(() => { answer = { name: 'https://www.onlinemetals.com/en/tkaddtocart/add', responseStatus: 200 }; vi.stubGlobal('PerformanceObserver', FakeObserver); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.title = ''; document.body.replaceChildren(); go('/'); });

describe('the request', () => {
  it('takes only a product page on the store, on the granted host', () => {
    expect(onlineMetalsLink(`https://onlinemetals.com/buy/x/pid/${PID}?variant=${SKU}`)).toEqual({ url: `https://www.onlinemetals.com/buy/x/pid/${PID}`, pid: PID, variant: SKU });
    expect(onlineMetalsLink('https://www.onlinemetals.com/en/cart')).toBeNull();
    expect(onlineMetalsLink(`https://example.test/pid/${PID}`)).toBeNull();
    expect(onlinemetals.missing!(line({ productUrl: 'https://www.onlinemetals.com/en/cart' }))).toHaveLength(1);
    expect(onlinemetals.missing!(line())).toEqual([]);
  });
  it('the SKU picks the length', () => { expect(onlineMetalsVariant(line())).toEqual({ url: LINK, pid: PID, sku: SKU }); });
  it('refuses a custom cut, however it shows up', () => {
    for (const extra of [{ sku: 'custom cut 17in' }, { description: 'Custom-cut bar, 17 in' }, { productUrl: `${LINK}?customCut=true` }]) expect(() => onlineMetalsVariant(line(extra)), JSON.stringify(extra)).toThrow(/custom cut/);
  });
  it('won\'t guess a length', () => {
    expect(() => onlineMetalsVariant(line({ sku: null }))).toThrow(/needs a SKU/);
    expect(() => onlineMetalsVariant(line({ sku: `1_24_0` }))).toThrow(/isn't a length/);
    expect(() => onlineMetalsVariant(line({ productUrl: `${LINK}?variant=${PID}_12_0` }))).toThrow(/saved link says/);
  });
});
describe('the product page', () => {
  beforeEach(() => go(`/en/buy/test-metal/test-bar/pid/${PID}`));
  it('finds exactly the length asked for, with its price', () => {
    document.body.innerHTML = pdp();
    expect(onlineMetalsReadProduct(PID, SKU)).toEqual({ kind: 'ok', available: true, price: 38.02 });
  });
  it('refuses a near miss, the bare product and a custom length, which have no radio', () => {
    document.body.innerHTML = pdp();
    for (const sku of [`${SKU}0`, PID, `${PID}_17_5`]) expect(onlineMetalsReadProduct(PID, sku)).toMatchObject({ kind: 'problem', message: expect.stringMatching(/no standard length/) });
  });
  it('refuses two lengths with one code', () => {
    document.body.innerHTML = pdp({ radios: radio(SKU, '1') + radio(SKU, '2') });
    expect(onlineMetalsReadProduct(PID, SKU)).toMatchObject({ kind: 'problem', message: expect.stringMatching(/More than one/) });
  });
  it('refuses a radio that is a marketplace custom cut', () => {
    document.body.innerHTML = pdp({ radios: radio(SKU, '1', false, 'data-variant-offer-customcut="true"') });
    expect(onlineMetalsReadProduct(PID, SKU)).toMatchObject({ kind: 'problem', message: expect.stringMatching(/custom cut/) });
  });
  it('reads out of stock from the store\'s own offer data', async () => {
    document.body.innerHTML = pdp({ ld: offers('OutOfStock') });
    expect(onlineMetalsReadProduct(PID, SKU)).toMatchObject({ kind: 'ok', available: false });
    const result = await buildStore(onlinemetals, onlinemetals.steps!, [line()], { goto: async () => undefined, run: async (f: never, ...a: never[]) => (f as (...x: never[]) => unknown)(...a), runThenLoad: async () => undefined } as unknown as StoreTab, options);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/out of stock/), confirmed: false });
  });
  it('stops on a page that isn\'t this product', () => {
    document.body.innerHTML = pdp();
    go('/en/somewhere-else');
    expect(onlineMetalsReadProduct(PID, SKU)).toMatchObject({ kind: 'stop', reason: 'unexpected' });
    go(`/en/buy/x/pid/${PID}`);
    document.body.innerHTML = '<h1>Something else</h1>';
    expect(onlineMetalsReadProduct(PID, SKU)).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('a missing product fails this line only', () => {
    document.title = 'Page Not Found | Online Metals';
    expect(onlineMetalsReadProduct(PID, SKU)).toMatchObject({ kind: 'problem' });
  });
});
describe('the add', () => {
  const posted: { code: string; qty: string }[] = [];
  const ready = (page = pdp()) => {
    posted.length = 0;
    document.body.innerHTML = page;
    wirePage();
    button().addEventListener('click', () => posted.push({ code: (document.querySelector('input[name="productCodePost"]') as HTMLInputElement).value, qty: (document.querySelector('input[name="qty"]') as HTMLInputElement).value }));
  };
  it('picks the length, sets the quantity and presses Add To Cart once, and nothing else', async () => {
    ready();
    const checkout = vi.fn();
    document.getElementById('co')!.addEventListener('click', checkout);
    expect(await onlineMetalsClickAdd(PID, SKU, 3)).toEqual({ kind: 'sent' });
    expect(posted).toEqual([{ code: SKU, qty: '3' }]);
    expect((document.getElementById(`selectedVariant${SKU}`) as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('js-pdp-qty') as HTMLInputElement).value).toBe('3');
    expect((document.getElementById(`custom-cut-${PID}`) as HTMLInputElement).checked).toBe(false);
    expect(checkout).not.toHaveBeenCalled();
  });
  it('doesn\'t press if the page never selected the length', async () => {
    vi.useFakeTimers();
    ready();
    for (const node of document.querySelectorAll('input[name="productLength"]')) node.replaceWith(node.cloneNode());
    const pending = onlineMetalsClickAdd(PID, SKU, 3);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ kind: 'stop', reason: 'unexpected', notSent: true });
    expect(posted).toEqual([]);
    vi.useRealTimers();
  });
  it('refuses a form that goes anywhere else, and a button with any other label', async () => {
    ready(pdp({ action: '/en/checkout' }));
    expect(await onlineMetalsClickAdd(PID, SKU, 1)).toMatchObject({ kind: 'stop', notSent: true });
    ready(pdp({ button: 'Buy Now' }));
    expect(await onlineMetalsClickAdd(PID, SKU, 1)).toMatchObject({ kind: 'stop', notSent: true });
    expect(posted).toEqual([]);
  });
  it('a quantity the store can\'t take is refused, not reduced', async () => {
    ready();
    expect(await onlineMetalsClickAdd(PID, SKU, 10_000)).toMatchObject({ kind: 'refused' });
    expect(posted).toEqual([]);
  });
  it('a 403 to the add itself is a bot check, and may have landed', async () => {
    ready();
    answer = { name: 'https://www.onlinemetals.com/en/tkaddtocart/add', responseStatus: 403 };
    const stopped = await onlineMetalsClickAdd(PID, SKU, 1);
    expect(stopped).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    expect((stopped as { notSent?: boolean }).notSent).toBeUndefined();
  });
  it('ends its wait even with no answer, so the read-back decides', async () => {
    ready();
    answer = null;
    expect(await onlineMetalsClickAdd(PID, SKU, 1, 10)).toEqual({ kind: 'sent' });
  });
});
describe('the cart', () => {
  beforeEach(() => go('/en/cart'));
  it('reads only the lines asked for, summing split lines', () => {
    document.body.innerHTML = cartRow(SKU, 2) + cartRow(SKU, 1) + cartRow('8888_12_0', 9);
    const lines = onlineMetalsReadCart([SKU]);
    expect(lines).toEqual([{ key: SKU, quantity: 3 }]);
    expect(JSON.stringify(lines)).not.toMatch(/8888/);
  });
  it('a length of the same product is another line', () => {
    document.body.innerHTML = cartRow(`${PID}_12_0`, 5);
    expect(onlineMetalsReadCart([SKU])).toEqual([]);
  });
  it('empty only when the page says so', () => {
    document.body.innerHTML = '<h1>Your shopping cart is empty</h1>';
    expect(onlineMetalsReadCart([SKU])).toEqual([]);
    document.body.innerHTML = '<h1>Cart</h1><div class="some-new-layout">Test bar</div>';
    expect(onlineMetalsReadCart([SKU])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('stops on a line with no quantity, and on a page that isn\'t the cart', () => {
    document.body.innerHTML = cartRow(SKU, '');
    expect(onlineMetalsReadCart([SKU])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
    go('/en/login');
    expect(onlineMetalsReadCart([SKU])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('Cloudflare\'s page is a bot check, never an empty cart', () => {
    document.title = 'Just a moment...';
    document.body.innerHTML = '<h1>Performing security verification</h1>';
    expect(onlineMetalsReadCart([SKU])).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    expect(inspectPage()).toMatchObject({ kind: 'stop', reason: 'bot-check' });
  });
});
/** The whole store: a simulated site behind a tab that runs the real injected functions, with the same rules the real tab has. */
function site(start: Record<string, number> = {}, { capAt = Infinity, wallAt = '' } = {}) {
  const cart = new Map(Object.entries(start));
  const visited: string[] = [];
  const tab: StoreTab = {
    async goto(url) {
      if (!allowedInTab(onlinemetals, url)) throw new StoreStop('unexpected', 'refused');
      visited.push(url);
      const { pathname } = new URL(url);
      go(pathname);
      document.title = '';
      if (wallAt && pathname.includes(wallAt)) { document.title = 'Just a moment...'; document.body.innerHTML = '<h1>Performing security verification</h1>'; }
      else if (pathname.endsWith('/en/cart')) document.body.innerHTML = [...cart].map(([code, quantity]) => cartRow(code, quantity)).join('') || '<p>Your shopping cart is empty</p>';
      else {
        document.body.innerHTML = pdp();
        wirePage();
        button().addEventListener('click', () => {
          const code = (document.querySelector('input[name="productCodePost"]') as HTMLInputElement).value, qty = Number((document.querySelector('input[name="qty"]') as HTMLInputElement).value);
          cart.set(code, Math.min(capAt, (cart.get(code) ?? 0) + qty));
        });
      }
      stopIf(inspectPage());
    },
    async run(func, ...args) { return await func(...args) as never; },
    async runThenLoad(func, ...args) { return await func(...args) as never; },
  };
  return { cart, visited, tab };
}
describe('a build', () => {
  const build = (tab: StoreTab, orders = [line()]) => buildStore(onlinemetals, onlinemetals.steps!, orders, tab, options);
  it('adds the requested length and quantity, confirmed by the cart, and never goes near checkout', async () => {
    const { cart, visited, tab } = site();
    const result = await build(tab);
    expect(result.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect([...cart]).toEqual([[SKU, 2]]);
    expect(visited.filter(url => /checkout/i.test(url))).toEqual([]);
  });
  it('a retry doesn\'t double', async () => {
    const { cart, tab } = site();
    await build(tab);
    const again = await build(tab);
    expect(again.items[0]).toMatchObject({ outcome: 'flagged', message: expect.stringMatching(/Already in the cart/), confirmed: true });
    expect(cart.get(SKU)).toBe(2);
  });
  it('adds only the difference when the cart holds some already', async () => {
    const { cart, tab } = site({ [SKU]: 1 });
    expect((await build(tab)).items[0]).toMatchObject({ outcome: 'flagged', confirmed: true });
    expect(cart.get(SKU)).toBe(2);
  });
  it('reports short stock from the read-back, and doesn\'t mark it', async () => {
    const { tab } = site({}, { capAt: 1 });
    expect((await build(tab)).items[0]).toMatchObject({ outcome: 'flagged', message: expect.stringMatching(/Short stock/), confirmed: false });
  });
  it('reports a mismatch from the read-back, and doesn\'t mark it', async () => {
    const { tab, cart } = site();
    const real = tab.goto.bind(tab);
    tab.goto = async url => { await real(url); if (!url.endsWith('/en/cart')) button().addEventListener('click', () => cart.set(SKU, 7)); };
    expect((await build(tab)).items[0]).toMatchObject({ outcome: 'flagged', message: expect.stringMatching(/Quantity mismatch/), confirmed: false });
  });
  it('flags a new price', async () => {
    const { tab } = site();
    expect((await build(tab, [line({ unitPrice: 30 })])).items[0]).toMatchObject({ outcome: 'flagged', message: expect.stringMatching(/Price changed/), confirmed: true });
  });
  it('a custom cut fails its line, and the store carries on', async () => {
    const { cart, tab } = site();
    const result = await build(tab, [line({ id: 'cut', description: 'Custom cut, 17 in', sku: `${PID}_17_0` }), line()]);
    expect(result.items.map(item => item.outcome)).toEqual(['failed', 'added']);
    expect([...cart]).toEqual([[SKU, 2]]);
  });
  it('the 403 at the cart stops the store before anything is sent', async () => {
    const { cart, tab } = site({}, { wallAt: '/en/cart' });
    const result = await build(tab, [line(), line({ id: 'second', sku: `${PID}_12_0` })]);
    expect(result.stopped?.reason).toBe('bot-check');
    expect(result.items.map(item => item.outcome)).toEqual(['checklist', 'checklist']);
    expect(cart.size).toBe(0);
  });
  it('a wall at the read-back says the add needs checking', async () => {
    const { tab } = site();
    const real = tab.goto.bind(tab);
    let carts = 0;
    tab.goto = async url => { if (url.endsWith('/en/cart') && ++carts === 2) throw new StoreStop('bot-check', 'a CAPTCHA or bot check'); await real(url); };
    const result = await build(tab);
    expect(result.stopped?.reason).toBe('bot-check');
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', message: expect.stringMatching(/could not be read back/), confirmed: false });
  });
  it('a product page behind a wall stops the store', async () => {
    const { tab } = site({}, { wallAt: '/pid/' });
    await expect(onlinemetals.steps!.resolveLine(line(), tab)).rejects.toThrow(StoreStop);
  });
  it('a product link that vanished is a line problem', async () => {
    await expect(onlinemetals.steps!.resolveLine(line({ productUrl: null }), site().tab)).rejects.toThrow(LineProblem);
  });
});
describe('the rules', () => {
  it('declares the store as the owner chose', () => {
    expect(onlinemetals).toMatchObject({ id: 'onlinemetals', label: 'Online Metals', badge: 'item', origins: ['https://www.onlinemetals.com/*'], cartUrl: 'https://www.onlinemetals.com/en/cart' });
    expect(allowedInTab(onlinemetals, onlinemetals.startUrl!)).toBe(true);
    expect(allowedInTab(onlinemetals, onlinemetals.cartUrl!)).toBe(true);
    expect(allowedInTab(onlinemetals, 'https://www.onlinemetals.com/en/checkout')).toBe(false);
  });
  it('has no user agent, cookies or checkout address in its source', () => {
    const source = readFileSync(resolve('src/carts/stores/onlinemetals.ts'), 'utf8');
    expect(source).not.toMatch(/user-?agent|navigator\.webdriver|document\.cookie|chrome\.cookies|checkout|turnstile/i);
  });
});
