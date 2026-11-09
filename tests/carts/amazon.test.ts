// Amazon's injected functions and whole builds, against synthetic pages shaped like the real signed-in ones. No real store is contacted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStore } from '../../src/carts/runner';
import { allowedInTab } from '../../src/carts/safety';
import { LineProblem, StoreStop, type StoreTab } from '../../src/carts/store-method';
import { amazon, amazonAsin, amazonProductLink, amazonProductPage, amazonReadCart, amazonSteps, amazonWall } from '../../src/carts/stores/amazon';
import { order, options } from './helpers';

const ASIN = 'B0TESTAAA1', OTHER = 'B0TESTBBB2';
const at = (path: string, html: string) => { history.pushState(null, '', path); document.body.innerHTML = html; };
const row = (asin: string, quantity: number, price = 19.99, type = 'active') => `<div class="a-row sc-list-item" data-asin="${asin}" data-quantity="${quantity}" data-price="${price}" data-itemtype="${type}"><span>Secret title of ${asin}</span></div>`;
const cartPage = (lines: [string, number][], extra = '') => {
  const count = lines.reduce((sum, [, quantity]) => sum + quantity, 0);
  const body = lines.length ? `<div id="sc-active-cart"><form id="activeCartViewForm">${lines.map(([asin, quantity]) => row(asin, quantity)).join('')}<span id="sc-subtotal-label-activecart">Subtotal (${count} item${count === 1 ? '' : 's'}):</span><input name="proceedToRetailCheckout" type="submit" value="Proceed to checkout"></form></div>` : '<div id="sc-active-cart"><h3>Your Amazon Cart is empty</h3></div>';
  return `<a id="nav-link-accountList">Hello, Test Student A</a>${body}${extra}`;
};
/** As seen signed in: Add to cart and Buy Now in one form, whose address has "buy" in its name, with a quantity list for "Only 6 left". */
const quantityList = (offered = 6) => `<select id="quantity" name="quantity" autocomplete="off">${Array.from({ length: offered }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join('')}</select>`;
const productPage = (asin = ASIN, opts: { list?: string; add?: string; action?: string; extra?: string; formAsin?: string } = {}) => `<a id="nav-link-accountList">Hello, Test Student A</a><h1>Test panel cable</h1><input type="hidden" id="ASIN" value="${asin}"><form id="addToCart" method="post" action="${opts.action ?? '/gp/product/handle-buy-box/ref=dp_start-bbf_1_glance'}"><input type="hidden" name="ASIN" value="${opts.formAsin ?? asin}">${opts.list ?? quantityList()}<span id="submit.add-to-cart-announce">Add to Cart</span>${opts.add ?? '<input id="add-to-cart-button" type="submit" name="submit.add-to-cart" value="Add to cart" aria-labelledby="submit.add-to-cart-announce">'}<input id="buy-now-button" type="submit" name="submit.buy-now" value="Buy Now">${opts.extra ?? ''}</form>`;
const SHEET = '<h1>Added to cart</h1><a id="sheet-cart" href="/gp/cart/view.html">Go to Cart</a><a id="sheet-checkout" href="/checkout/entry/cart">Proceed to checkout</a>';

beforeEach(() => { vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 40 } as DOMRect); });
afterEach(() => { at('/', ''); });

describe('finding the ASIN', () => {
  it('reads it from the link in every form Amazon writes', () => {
    for (const link of [`https://www.amazon.com/dp/${ASIN}`, `https://www.amazon.com/Test-Bracket/dp/${ASIN}/ref=sr_1_1?th=1&psc=1`, `https://www.amazon.com/gp/product/${ASIN}`, `https://amazon.com/gp/aw/d/${ASIN}?x=1`]) {
      expect(amazonAsin({ productUrl: link, sku: null })).toEqual({ asin: ASIN, conflict: false });
    }
    expect(amazonAsin({ productUrl: `https://www.amazon.com/dp/${ASIN.toLowerCase()}`, sku: null }).asin).toBe(ASIN);
  });
  it('reads a book\'s ID from a link, and only an unmistakable one from a SKU', () => {
    expect(amazonAsin({ productUrl: 'https://www.amazon.com/dp/0306406152', sku: null }).asin).toBe('0306406152');
    expect(amazonAsin({ productUrl: null, sku: ` ${ASIN.toLowerCase()} ` }).asin).toBe(ASIN);
    for (const sku of ['0306406152', 'BRACKETS12', 'REV-21-1651', 'B0SHORT']) expect(amazonAsin({ productUrl: null, sku }).asin).toBeNull();
  });
  it('a maker\'s part number next to a link is ignored, and two different ASINs are a conflict', () => {
    expect(amazonAsin({ productUrl: `https://www.amazon.com/dp/${ASIN}`, sku: 'REV-21-1651' })).toEqual({ asin: ASIN, conflict: false });
    expect(amazonAsin({ productUrl: `https://www.amazon.com/dp/${ASIN}`, sku: OTHER }).conflict).toBe(true);
  });
  it('a link with no one item, or on another site, gives nothing, whatever the SKU says', () => {
    expect(amazonAsin({ productUrl: 'https://www.amazon.com/s?k=brackets', sku: null }).asin).toBeNull();
    expect(amazonAsin({ productUrl: `https://www.amazon.ca/dp/${ASIN}`, sku: ASIN }).asin).toBeNull();
    expect(amazonAsin({ productUrl: `https://www.amazon.com.example.test/dp/${ASIN}`, sku: null }).asin).toBeNull();
    expect(amazonAsin({ productUrl: 'https://amzn.to/abc', sku: ASIN }).asin).toBeNull();
    expect(amazonAsin({ productUrl: 'not a link', sku: ASIN }).asin).toBeNull();
  });
  it('an order with no ASIN can\'t be ticked, and a conflict fails its line', async () => {
    expect(amazon.missing!(order({ sku: 'REV-21-1651', productUrl: null }))).toEqual(['an ASIN, in an amazon.com product link or the SKU']);
    expect(amazon.missing!(order({ sku: ASIN, productUrl: null }))).toEqual([]);
    await expect(amazonSteps().resolveLine(order({ sku: OTHER, productUrl: `https://www.amazon.com/dp/${ASIN}` }), {} as StoreTab)).rejects.toThrow(LineProblem);
  });
});
describe('the request', () => {
  it('is the product page, with nothing else in the address', () => {
    const link = amazonProductLink(ASIN);
    expect(link).toBe(`https://www.amazon.com/dp/${ASIN}`);
    expect(allowedInTab(amazon, link)).toBe(true);
    expect(allowedInTab(amazon, amazon.cartUrl!)).toBe(true);
    expect(allowedInTab(amazon, amazon.startUrl!)).toBe(true);
    expect(allowedInTab(amazon, 'https://www.amazon.com/gp/product/handle-buy-box/ref=dp_start-bbf_1_glance')).toBe(true);
    expect(allowedInTab(amazon, 'https://www.amazon.com/cart/smart-wagon')).toBe(true);
  });
  it('runs in front, and its words say what it does now', () => {
    expect(amazon.steps!.foreground).toBe(true);
    expect(amazon.badge).toBe('item');
    expect(amazon.badgeHelp).toMatch(/product page/);
    expect(amazon.badgeHelp).not.toMatch(/add link|confirm/i);
    expect(readFileSync(resolve('src/carts/stores/amazon.ts'), 'utf8')).not.toMatch(/aws\/cart\/add/);
  });
  it('the store\'s source sets no identity and reads no cookies', () => {
    expect(readFileSync(resolve('src/carts/stores/amazon.ts'), 'utf8')).not.toMatch(/user-?agent|navigator\.webdriver|document\.cookie|chrome\.cookies|associatetag|tag=/i);
  });
});
describe('reading the cart', () => {
  it('hands back only the line asked for, not the rest of the cart', () => {
    at('/gp/cart/view.html', cartPage([[ASIN, 2], [OTHER, 7]]));
    const answer = amazonReadCart([ASIN]);
    expect(answer).toEqual({ lines: [{ key: ASIN, quantity: 2, unitPrice: 19.99 }], total: 9 });
    expect(JSON.stringify(answer)).not.toMatch(/Secret|B0TESTBBB2/);
  });
  it('adds up split lines, and gives no price when they differ', () => {
    at('/gp/cart/view.html', `<div id="sc-active-cart">${row(ASIN, 1, 10)}${row(ASIN, 2, 12)}<span id="sc-subtotal-label-activecart">Subtotal (3 items):</span></div>`);
    expect(amazonReadCart([ASIN])).toEqual({ lines: [{ key: ASIN, quantity: 3, unitPrice: null }], total: 3 });
  });
  it('Saved for Later is not the cart', () => {
    at('/gp/cart/view.html', cartPage([], `<div id="sc-saved-cart">${row(ASIN, 5, 10, 'saved')}</div>`));
    expect(amazonReadCart([ASIN])).toEqual({ lines: [], total: 0 });
    at('/gp/cart/view.html', `<div id="sc-active-cart">${row(ASIN, 5, 10, 'saved')}<h3>Your Amazon Cart is empty</h3></div>`);
    expect(amazonReadCart([ASIN])).toEqual({ lines: [], total: 0 });
  });
  it('an unticked line lowers the count, and that is fine', () => {
    at('/gp/cart/view.html', `<div id="sc-active-cart">${row(ASIN, 2)}${row(OTHER, 1)}<span id="sc-subtotal-label-activecart">Subtotal (1 item):</span></div>`);
    expect(amazonReadCart([ASIN])).toMatchObject({ lines: [{ key: ASIN, quantity: 2 }] });
  });
  it('a long cart that doesn\'t show every line stops, so a hidden line can\'t read as zero', () => {
    at('/gp/cart/view.html', `<div id="sc-active-cart">${row(OTHER, 1)}<span id="sc-subtotal-label-activecart">Subtotal (1,040 items):</span></div>`);
    expect(amazonReadCart([ASIN])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it.each([
    ['a page it can\'t recognize', '<h1>Something else</h1>'],
    ['a line with no quantity', `<div id="sc-active-cart"><div class="sc-list-item" data-asin="${ASIN}"></div><span id="sc-subtotal-label-activecart">Subtotal (1 item):</span></div>`],
    ['lines with no count', `<div id="sc-active-cart">${row(ASIN, 2)}</div>`],
  ])('stops on %s, and never guesses zero', (_name, html) => {
    at('/gp/cart/view.html', html);
    expect(amazonReadCart([ASIN])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
});
describe('walls', () => {
  it('passes an ordinary cart, even one naming checkout on a button', () => {
    at('/gp/cart/view.html', cartPage([[ASIN, 1]]));
    expect(amazonWall()).toEqual({ kind: 'ok' });
  });
  it('the real sign-in address is a login, though it has no password box', () => {
    at('/ap/signin?openid.return_to=x', '<h1>Sign in or create account</h1><input type="email"><button>Continue</button>');
    expect(amazonWall()).toEqual({ kind: 'stop', reason: 'login', detail: 'a sign-in page', notSent: true });
  });
  it('a cart showing the signed-out greeting is a login, before anything is sent', () => {
    at('/gp/cart/view.html', '<a id="nav-link-accountList">Hello, sign in Account &amp; Lists</a><h3>Your Amazon Cart is empty</h3>');
    expect(amazonWall()).toMatchObject({ kind: 'stop', reason: 'login', notSent: true });
  });
  it.each([
    ['the CAPTCHA form', '/gp/cart/view.html', '<form action="/errors/validateCaptcha"><input name="field-keywords"></form>'],
    ['the error address', '/errors/validateCaptcha', '<p>Sorry</p>'],
    ['the typed-characters page', '/gp/cart/view.html', '<p>Enter the characters you see below</p>'],
    ['the soft check', '/gp/cart/view.html', '<p>Click the button below to continue shopping</p><button>Continue shopping</button>'],
  ])('%s is a bot check', (_name, path, html) => {
    at(path, html);
    expect(amazonWall()).toMatchObject({ kind: 'stop', reason: 'bot-check' });
  });
  it('a product named like a wall on a long page isn\'t one', () => {
    at('/gp/cart/view.html', cartPage([[ASIN, 1]], `<p>Toy: not a robot. ${'x'.repeat(4000)}</p>`));
    expect(amazonWall()).toEqual({ kind: 'ok' });
  });
  it('Amazon\'s checkout addresses stop the store here too, if one is ever reached after loading', () => {
    for (const path of ['/gp/buy/spc/handlers/display.html', '/checkout/entry/cart']) {
      at(path, '<h1>Review your order</h1>');
      expect(amazonWall()).toMatchObject({ kind: 'stop', reason: 'unexpected' });
    }
  });
});
describe('the product page', () => {
  const PATH = `/dp/${ASIN}`;
  const page = (quantity = 2, press = true) => amazonProductPage(ASIN, quantity, press, 0);
  const watch = () => {
    const pressed: string[] = [], buy = vi.fn();
    document.getElementById('add-to-cart-button')?.addEventListener('click', event => { event.preventDefault(); pressed.push((document.getElementById('quantity') as HTMLSelectElement | null)?.value ?? 'no list'); });
    document.getElementById('buy-now-button')?.addEventListener('click', event => { event.preventDefault(); buy(); });
    return { pressed, buy };
  };
  it('checks and sets the quantity first, and presses only when told to, only Add to cart', async () => {
    at(PATH, productPage());
    const { pressed, buy } = watch();
    const changed = vi.fn();
    document.getElementById('quantity')!.addEventListener('change', changed);
    expect(await page(2, false)).toEqual({ kind: 'ready' });
    expect(pressed).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect((document.getElementById('quantity') as HTMLSelectElement).value).toBe('2');
    expect(await page(2, true)).toEqual({ kind: 'pressed' });
    expect(pressed).toEqual(['2']);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(buy).not.toHaveBeenCalled();
  });
  it('the real form address, with "buy" in its name, passes, and so does a page address with a title', async () => {
    at(`/Test-Panel-Cable/dp/${ASIN}`, productPage(ASIN, { action: 'https://www.amazon.com/gp/product/handle-buy-box/ref=x'.replace('https://www.amazon.com', location.origin) }));
    expect(await page(2, false)).toEqual({ kind: 'ready' });
  });
  it.each([
    ['a form that goes to checkout', () => productPage(ASIN, { action: '/checkout/entry/cart' }), 'goes somewhere else'],
    ['Amazon\'s buy path', () => productPage(ASIN, { action: '/gp/buy/spc/handlers/display.html' }), 'goes somewhere else'],
    ['the right path with checkout after it', () => productPage(ASIN, { action: '/gp/product/handle-buy-box/checkout' }), 'goes somewhere else'],
    ['a form going off the store', () => productPage(ASIN, { action: 'https://example.test/gp/product/handle-buy-box/x' }), 'goes somewhere else'],
    ['a form with no address', () => productPage(ASIN).replace(/ action="[^"]*"/, ' action="//"'), 'goes somewhere else'],
    ['a button with an address of its own', () => productPage(ASIN, { add: '<input id="add-to-cart-button" type="submit" value="Add to cart" formaction="/gp/buy/spc">' }), 'another label'],
    ['a button labeled Buy Now', () => productPage(ASIN, { add: '<input id="add-to-cart-button" type="submit" value="Buy Now">' }), 'another label'],
    ['a button announced as something else', () => productPage(ASIN, { add: '<input id="add-to-cart-button" type="submit" value="Continue">' }).replace('Add to Cart</span>', 'x</span>'), 'another label'],
    ['two buttons with that id', () => productPage(ASIN, { extra: '<input id="add-to-cart-button" type="submit" value="Add to cart">' }), 'more than one'],
    ['a button outside the form', () => `${productPage(ASIN, { add: '' })}<input id="add-to-cart-button" type="submit" value="Add to cart">`, 'another kind of form'],
    ['a button in another form', () => `<form id="other" action="/gp/product/handle-buy-box/x"><input type="hidden" name="ASIN" value="${ASIN}"><input id="add-to-cart-button" type="submit" value="Add to cart"></form>`, 'another kind of form'],
  ])('stops on %s, and presses nothing', async (_name, html, detail) => {
    at(PATH, html());
    const clicked = vi.fn((event: Event) => event.preventDefault());
    document.addEventListener('click', clicked);
    expect(await page()).toMatchObject({ kind: 'stop', reason: 'unexpected', detail: expect.stringContaining(detail), notSent: true });
    expect(clicked).not.toHaveBeenCalled();
    document.removeEventListener('click', clicked);
  });
  it.each([
    ['no Add to Cart, as when unavailable or a parent needing a choice', () => productPage(ASIN, { add: '' }), /doesn't offer Add to Cart/, 2],
    ['a hidden Add to Cart', () => productPage(ASIN, { add: '<input id="add-to-cart-button" type="submit" value="Add to cart" hidden>' }), /doesn't offer Add to Cart/, 2],
    ['another item in the form', () => productPage(ASIN, { formAsin: OTHER }), /isn't for/, 2],
    ['another item on the page', () => productPage(OTHER, { formAsin: ASIN }), /isn't for/, 2],
    ['no item named', () => productPage(ASIN).replace(/<input type="hidden"[^>]*>/g, ''), /isn't for/, 2],
    ['a quantity the list doesn\'t offer', () => productPage(), /doesn't offer a quantity of 7/, 7],
    ['a disabled button', () => productPage(ASIN, { add: '<input id="add-to-cart-button" type="submit" value="Add to cart" disabled>' }), /unavailable/, 2],
    ['no list, for more than one', () => productPage(ASIN, { list: '' }), /no quantity list.*quantity of 2/, 2],
    ['a list in another form', () => `${productPage(ASIN, { list: '' })}<form>${quantityList()}</form>`, /one clear quantity list/, 2],
    ['two lists', () => `${productPage()}${quantityList()}`, /one clear quantity list/, 2],
  ])('refuses %s, in plain words, with nothing pressed', async (_name, html, message, quantity) => {
    at(PATH, html());
    const clicked = vi.fn((event: Event) => event.preventDefault());
    document.addEventListener('click', clicked);
    // jsdom has no layout, so a hidden attribute needs the page's own answer for its size.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) { return (this.hasAttribute('hidden') ? { width: 0, height: 0 } : { width: 100, height: 40 }) as DOMRect; });
    expect(await page(quantity, false)).toEqual({ kind: 'refused', message: expect.stringMatching(message) });
    expect(clicked).not.toHaveBeenCalled();
    document.removeEventListener('click', clicked);
  });
  it('no list is fine for one', async () => {
    at(PATH, productPage(ASIN, { list: '' }));
    const { pressed } = watch();
    expect(await page(1, true)).toEqual({ kind: 'pressed' });
    expect(pressed).toEqual(['no list']);
  });
  it('a list outside the form, belonging to no form, is still this page\'s list', async () => {
    at(PATH, `${quantityList()}${productPage(ASIN, { list: '' })}`);
    expect(await page(2, false)).toEqual({ kind: 'ready' });
  });
  it('a page that changed by the press is a stop that says nothing was sent, since no load will follow', async () => {
    at(PATH, productPage(ASIN, { add: '' }));
    expect(await page(2, true)).toMatchObject({ kind: 'stop', reason: 'unexpected', notSent: true });
  });
  it('waits a moment for a button that draws itself', async () => {
    at(PATH, productPage(ASIN, { add: '' }));
    setTimeout(() => document.getElementById('addToCart')!.insertAdjacentHTML('beforeend', '<input id="add-to-cart-button" type="submit" value="Add to cart">'), 100);
    expect(await amazonProductPage(ASIN, 2, false, 2000)).toEqual({ kind: 'ready' });
  });
  it('runs from its own text alone, as Chrome runs it', async () => {
    at(PATH, productPage());
    const copy = new Function(`return (${amazonProductPage.toString()})`)() as typeof amazonProductPage;
    expect(await copy(ASIN, 2, false, 0)).toEqual({ kind: 'ready' });
  });
});
describe('a whole build', () => {
  interface Sim { cart?: Map<string, number>; onPress?: (asin: string, quantity: number, cart: Map<string, number>) => void; signedOut?: boolean; productWall?: string; productHtml?: (asin: string) => string; backToProduct?: boolean }
  /** A tab that behaves like Amazon as seen signed in: the product page's button leads to a side sheet, and the add shows on the cart page. */
  function simTab(sim: Sim) {
    const cart = sim.cart ?? new Map<string, number>();
    const visits: string[] = [];
    const log = { presses: [] as number[], buyPresses: 0, sheetPresses: 0 };
    const showCart = () => at('/gp/cart/view.html', sim.signedOut ? '<a id="nav-link-accountList">Hello, sign in</a><h3>Your Amazon Cart is empty</h3>' : cartPage([...cart]));
    const onPress = sim.onPress ?? ((asin, quantity) => cart.set(asin, (cart.get(asin) ?? 0) + quantity));
    const showProduct = (asin: string) => {
      at(`/dp/${asin}`, sim.productHtml?.(asin) ?? productPage(asin));
      document.getElementById('addToCart')?.addEventListener('submit', event => event.preventDefault());
      document.getElementById('add-to-cart-button')?.addEventListener('click', () => { const quantity = Number((document.getElementById('quantity') as HTMLSelectElement | null)?.value ?? 1); log.presses.push(quantity); onPress(asin, quantity, cart); });
      document.getElementById('buy-now-button')?.addEventListener('click', () => { log.buyPresses++; });
    };
    let shownAsin = '';
    const tab: StoreTab = {
      async goto(url) {
        visits.push(url);
        const { pathname } = new URL(url);
        if (!pathname.startsWith('/dp/')) { showCart(); return; }
        if (sim.productWall) { at('/ap/signin', sim.productWall); return; }
        shownAsin = pathname.slice(4);
        showProduct(shownAsin);
      },
      async run(func, ...args) { return await func(...args) as never; },
      async runThenLoad(func, ...args) {
        const answer = await func(...args);
        if (sim.backToProduct) showProduct(shownAsin);
        else {
          at('/cart/smart-wagon', SHEET);
          document.getElementById('sheet-cart')!.addEventListener('click', () => { log.sheetPresses++; });
          document.getElementById('sheet-checkout')!.addEventListener('click', () => { log.sheetPresses++; });
        }
        return answer as never;
      },
    };
    return { tab, cart, visits, log };
  }
  const line = (extra = {}) => order({ vendor: 'Amazon', urlVendor: 'Amazon', sku: null, productUrl: `https://www.amazon.com/dp/${ASIN}`, unitPrice: null, quantity: 2, ...extra });
  const build = (tab: StoreTab, orders = [line()]) => buildStore(amazon, amazonSteps(), orders, tab, options);

  it('presses once on the product page, reads back, and goes nowhere near checkout', async () => {
    const sim = simTab({});
    const result = await build(sim.tab);
    expect(result.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(sim.cart.get(ASIN)).toBe(2);
    expect(sim.log).toEqual({ presses: [2], buyPresses: 0, sheetPresses: 0 });
    expect(sim.visits).toEqual([amazon.cartUrl, amazonProductLink(ASIN), amazon.cartUrl, amazon.cartUrl]);
    expect(sim.visits.every(url => allowedInTab(amazon, url))).toBe(true);
  });
  it('a retry adds nothing', async () => {
    const sim = simTab({});
    await build(sim.tab);
    const again = await build(sim.tab);
    expect(again.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: expect.stringMatching(/Already in the cart/) });
    expect(sim.cart.get(ASIN)).toBe(2);
    expect(sim.visits.filter(url => url.includes('/dp/'))).toHaveLength(1);
    expect(sim.log.presses).toEqual([2]);
  });
  it('adds only the difference to a cart already holding some', async () => {
    const sim = simTab({ cart: new Map([[ASIN, 1]]) });
    await build(sim.tab);
    expect(sim.log.presses).toEqual([1]);
    expect(sim.cart.get(ASIN)).toBe(2);
  });
  it('reports short stock, and a read-back that doesn\'t match, without marking them', async () => {
    const short = await build(simTab({ onPress: (asin, _q, cart) => cart.set(asin, 1) }).tab);
    expect(short.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/Short stock/) });
    const over = await build(simTab({ onPress: (asin, _q, cart) => cart.set(asin, 3) }).tab);
    expect(over.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/Quantity mismatch/) });
    const none = await build(simTab({ onPress: () => undefined }).tab);
    expect(none.items[0]).toMatchObject({ outcome: 'failed', confirmed: false });
  });
  it('an add that lands under another ASIN stops the store and asks the person to look', async () => {
    const result = await build(simTab({ onPress: (_asin, quantity, cart) => cart.set(OTHER, quantity) }).tab, [line(), line({ id: 'order-2', productUrl: `https://www.amazon.com/dp/${OTHER}` })]);
    expect(result.stopped?.reason).toBe('unexpected');
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/Check the cart/) });
    expect(result.items[1].outcome).toBe('checklist');
  });
  it('signed out, it stops at the first read: no product page, and every item a checklist link', async () => {
    const sim = simTab({ signedOut: true });
    const result = await build(sim.tab, [line(), line({ id: 'order-2' })]);
    expect(result.stopped?.reason).toBe('login');
    expect(result.items.map(item => item.outcome)).toEqual(['checklist', 'checklist']);
    expect(sim.visits).toEqual([amazon.cartUrl]);
  });
  it('a sign-in at the product page stops the store, says nothing was sent, and types or presses nothing', async () => {
    const sim = simTab({ productWall: '<h1>Sign in or create account</h1><input id="email" type="email"><input id="next" type="submit" value="Continue">' });
    const typed = vi.fn();
    document.addEventListener('input', typed);
    const result = await build(sim.tab, [line(), line({ id: 'order-2' })]);
    expect(result.stopped?.reason).toBe('login');
    expect(result.stopped?.message).toMatch(/add these yourself/i);
    expect(result.items.map(item => item.outcome)).toEqual(['checklist', 'checklist']);
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('');
    expect(typed).not.toHaveBeenCalled();
    document.removeEventListener('input', typed);
  });
  it('the shared check stopping on the way to the product page says nothing was sent too', async () => {
    const sim = simTab({});
    const goto = sim.tab.goto;
    sim.tab.goto = async url => { if (url.includes('/dp/')) throw new StoreStop('bot-check', 'a CAPTCHA or bot check'); await goto(url); };
    const result = await build(sim.tab);
    expect(result.stopped?.reason).toBe('bot-check');
    expect(result.items[0].outcome).toBe('checklist');
    expect(sim.log.presses).toEqual([]);
  });
  it.each([
    ['no Add to Cart', { productHtml: (asin: string) => productPage(asin, { add: '' }) }, /doesn't offer Add to Cart/],
    ['a quantity it doesn\'t offer', { productHtml: (asin: string) => productPage(asin, { list: quantityList(1) }) }, /doesn't offer a quantity of 2/],
    ['a page for a child of the parent asked for', { productHtml: (asin: string) => productPage(asin, { formAsin: OTHER }) }, /isn't for/],
  ])('%s fails that line, with nothing pressed, and the store carries on', async (_name, config, message) => {
    const sim = simTab(config);
    const result = await build(sim.tab);
    expect(result.stopped).toBeUndefined();
    expect(result.items[0]).toMatchObject({ outcome: 'failed', confirmed: false, message: expect.stringMatching(message) });
    expect(sim.log.presses).toEqual([]);
    expect(sim.cart.size).toBe(0);
  }, 15_000);
  it('a wall after the button was pressed says to check the cart, because the add may have landed', async () => {
    const sim = simTab({});
    const load = sim.tab.runThenLoad;
    sim.tab.runThenLoad = async (func, ...args) => { const answer = await load(func, ...args); at('/ap/signin', '<h1>Sign in</h1>'); return answer as never; };
    const result = await build(sim.tab);
    expect(result.stopped?.reason).toBe('login');
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/Check the cart/) });
  });
  it('a wall at the read-back says the same', async () => {
    const sim = simTab({});
    const goto = sim.tab.goto;
    sim.tab.goto = async url => { await goto(url); if (sim.log.presses.length) at('/errors/validateCaptcha', '<p>Sorry</p>'); };
    const result = await build(sim.tab);
    expect(result.stopped?.reason).toBe('bot-check');
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/Check the cart/) });
  });
  it('a product page that comes back after the press isn\'t pressed again, and the read-back decides', async () => {
    const sim = simTab({ backToProduct: true, onPress: () => undefined });
    const result = await build(sim.tab);
    expect(sim.log.presses).toEqual([2]);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', confirmed: false, message: expect.stringMatching(/did not add/) });
  });
  it('as seen: the read-back finds the real row, with the buybox subtotal, after the cart had 3 items', async () => {
    const sim = simTab({ cart: new Map([[OTHER, 3]]) });
    const result = await build(sim.tab);
    expect(result.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(sim.cart.get(ASIN)).toBe(2);
  });
  it('an ambiguous line fails alone, and the next one still goes', async () => {
    const sim = simTab({});
    const result = await build(sim.tab, [line({ id: 'order-1', sku: OTHER }), line({ id: 'order-2' })]);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/different Amazon ASINs/) });
    expect(result.items[1]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(sim.cart.has(OTHER)).toBe(false);
  });
  it('a new price is flagged', async () => {
    const result = await build(simTab({}).tab, [line({ unitPrice: 15 })]);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: expect.stringMatching(/Price changed/) });
  });
});
