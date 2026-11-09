// Amazon's injected functions and whole builds, against synthetic pages. No real store is contacted. The page shapes are from public descriptions,
// not from a signed-in account, so these prove what the code does with those shapes and not that Amazon's pages have them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStore } from '../../src/carts/runner';
import { allowedInTab } from '../../src/carts/safety';
import { LineProblem, type StoreTab } from '../../src/carts/store-method';
import { amazon, amazonAddLink, amazonAddPage, amazonAsin, amazonReadCart, amazonSteps, amazonWall } from '../../src/carts/stores/amazon';
import { order, options } from './helpers';

const ASIN = 'B0TESTAAA1', OTHER = 'B0TESTBBB2';
const at = (path: string, html: string) => { history.pushState(null, '', path); document.body.innerHTML = html; };
const row = (asin: string, quantity: number, price = 19.99, type = 'active') => `<div class="a-row sc-list-item" data-asin="${asin}" data-quantity="${quantity}" data-price="${price}" data-itemtype="${type}"><span>Secret title of ${asin}</span></div>`;
const cartPage = (lines: [string, number][], extra = '') => {
  const count = lines.reduce((sum, [, quantity]) => sum + quantity, 0);
  const body = lines.length ? `<div id="sc-active-cart"><form id="activeCartViewForm">${lines.map(([asin, quantity]) => row(asin, quantity)).join('')}<span id="sc-subtotal-label-activecart">Subtotal (${count} item${count === 1 ? '' : 's'}):</span><input name="proceedToRetailCheckout" type="submit" value="Proceed to checkout"></form></div>` : '<div id="sc-active-cart"><h3>Your Amazon Cart is empty</h3></div>';
  return `<a id="nav-link-accountList">Hello, Test Student A</a>${body}${extra}`;
};
const confirmPage = (asin: string, quantity: number, extra = '') => `<form action="/gp/aws/cart/add.html" method="post"><input type="hidden" name="ASIN.1" value="${asin}"><input type="hidden" name="Quantity.1" value="${quantity}"><span class="a-button"><input id="yes" class="a-button-input" type="submit" name="add"><span class="a-button-text">Add to Cart</span></span>${extra}</form>`;
const buyNow = '<input id="buy" type="submit" name="submit.buy-now" value="Buy Now">';

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
  it('is the add link, with the quantity as given and nothing else', () => {
    const link = amazonAddLink(ASIN, 12);
    expect(link).toBe(`https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=${ASIN}&Quantity.1=12`);
    expect(allowedInTab(amazon, link)).toBe(true);
    expect(allowedInTab(amazon, amazon.cartUrl!)).toBe(true);
    expect(allowedInTab(amazon, amazon.startUrl!)).toBe(true);
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
describe('the add page', () => {
  const add = '/gp/aws/cart/add.html?ASIN.1=x';
  it('presses only the named button, and only when told to', () => {
    at(add, confirmPage(ASIN, 2, buyNow.replace('type="submit"', 'type="hidden"')));
    const pressed = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('form')!.addEventListener('submit', pressed);
    expect(amazonAddPage(ASIN, 2, false)).toEqual({ kind: 'confirm' });
    expect(pressed).not.toHaveBeenCalled();
    expect(amazonAddPage(ASIN, 2, true)).toEqual({ kind: 'pressed' });
    expect(pressed).toHaveBeenCalledTimes(1);
  });
  it('works on the address the link redirects to', () => {
    at('/associates/addtocart?ASIN.1=x', confirmPage(ASIN, 2));
    expect(amazonAddPage(ASIN, 2, false)).toEqual({ kind: 'confirm' });
  });
  it.each([
    ['a form with Buy Now in it', () => confirmPage(ASIN, 2, buyNow)],
    ['a form that goes to checkout', () => confirmPage(ASIN, 2).replace('/gp/aws/cart/add.html', '/checkout/entry')],
    ['a button that goes to checkout', () => confirmPage(ASIN, 2).replace('name="add"', 'formaction="/gp/buy/spc"')],
    ['only Proceed to checkout', () => '<form><input name="ASIN.1" value="B0TESTAAA1" type="hidden"><input type="submit" value="Proceed to checkout"></form>'],
    ['only Buy Now', () => `<form><input name="ASIN.1" value="B0TESTAAA1" type="hidden">${buyNow}</form>`],
    ['only Continue', () => '<form><input name="ASIN.1" value="B0TESTAAA1" type="hidden"><input type="submit" value="Continue"></form>'],
    ['another item', () => confirmPage(OTHER, 2)],
    ['two items', () => confirmPage(ASIN, 2, `<input type="hidden" name="ASIN.2" value="${OTHER}">`)],
    ['a recommendation in the form', () => confirmPage(ASIN, 2, `<a href="/dp/${OTHER}">Also try</a>`)],
    ['no item named', () => '<form><input type="submit" value="Add to Cart"></form>'],
    ['another quantity', () => confirmPage(ASIN, 5)],
    ['two Add to Cart buttons', () => confirmPage(ASIN, 2) + confirmPage(ASIN, 2)],
    ['a button outside any form', () => '<button>Add to Cart</button>'],
    ['nothing to press', () => '<h1>Thanks</h1>'],
  ])('refuses %s, and presses nothing', (_name, html) => {
    at(add, html());
    const clicked = vi.fn((event: Event) => event.preventDefault());
    document.addEventListener('click', clicked);
    expect(amazonAddPage(ASIN, 2, true)).toMatchObject({ kind: 'stop', reason: 'unexpected' });
    expect(clicked).not.toHaveBeenCalled();
    document.removeEventListener('click', clicked);
  });
  it('a product page or anywhere else isn\'t an add page, even with the right button', () => {
    at(`/dp/${ASIN}`, confirmPage(ASIN, 2));
    expect(amazonAddPage(ASIN, 2, true)).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('hands over the store\'s own refusal instead of pressing', () => {
    at(add, `<div class="a-alert-error">This item is currently unavailable.</div>${confirmPage(ASIN, 2)}`);
    expect(amazonAddPage(ASIN, 2, true)).toEqual({ kind: 'refused', message: 'This item is currently unavailable.' });
  });
  it('recognizes the pages an add can land on', () => {
    for (const path of ['/gp/cart/view.html', '/cart/smart-wagon', '/gp/huc/view.html']) { at(path, ''); expect(amazonAddPage(ASIN, 2, true)).toEqual({ kind: 'landed' }); }
  });
});
describe('a whole build', () => {
  interface Sim { cart?: Map<string, number>; confirm?: boolean; onPress?: (asin: string, quantity: number, cart: Map<string, number>) => void; signedOut?: boolean; addPage?: string; pressAgain?: boolean }
  /** A tab that behaves like Amazon as far as it's been described. */
  function simTab(sim: Sim) {
    const cart = sim.cart ?? new Map<string, number>();
    const visits: string[] = [];
    let presses = 0;
    const showCart = () => at('/gp/cart/view.html', sim.signedOut ? '<a id="nav-link-accountList">Hello, sign in</a><h3>Your Amazon Cart is empty</h3>' : cartPage([...cart]));
    const onPress = sim.onPress ?? ((asin, quantity) => cart.set(asin, (cart.get(asin) ?? 0) + quantity));
    const tab: StoreTab = {
      async goto(url) {
        visits.push(url);
        const link = new URL(url);
        if (link.pathname !== '/gp/aws/cart/add.html') { showCart(); return; }
        const [asin, quantity] = [link.searchParams.get('ASIN.1')!, Number(link.searchParams.get('Quantity.1'))];
        if (sim.addPage) { at('/ap/signin', sim.addPage); return; }
        if (sim.confirm === false) { onPress(asin, quantity, cart); showCart(); return; }
        at(`/associates/addtocart${link.search}`, confirmPage(asin, quantity));
        document.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); presses++; onPress(asin, quantity, cart); });
      },
      async run(func, ...args) { return await func(...args) as never; },
      async runThenLoad(func, ...args) { const answer = await func(...args); if (!sim.pressAgain) showCart(); return answer as never; },
    };
    return { tab, cart, visits, presses: () => presses };
  }
  const line = (extra = {}) => order({ vendor: 'Amazon', urlVendor: 'Amazon', sku: null, productUrl: `https://www.amazon.com/dp/${ASIN}`, unitPrice: null, quantity: 2, ...extra });
  const build = (tab: StoreTab, orders = [line()]) => buildStore(amazon, amazonSteps(), orders, tab, options);

  it('confirms once, reads back, and goes nowhere near checkout', async () => {
    const sim = simTab({});
    const result = await build(sim.tab);
    expect(result.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(sim.cart.get(ASIN)).toBe(2);
    expect(sim.presses()).toBe(1);
    expect(sim.visits).toEqual([amazon.cartUrl, amazonAddLink(ASIN, 2), amazon.cartUrl]);
    expect(sim.visits.every(url => allowedInTab(amazon, url))).toBe(true);
  });
  it('works when the link adds with no confirm page', async () => {
    const sim = simTab({ confirm: false });
    expect((await build(sim.tab)).items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(sim.presses()).toBe(0);
  });
  it('a retry adds nothing', async () => {
    const sim = simTab({});
    await build(sim.tab);
    const again = await build(sim.tab);
    expect(again.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: expect.stringMatching(/Already in the cart/) });
    expect(sim.cart.get(ASIN)).toBe(2);
    expect(sim.visits.filter(url => url.includes('/add.html'))).toHaveLength(1);
  });
  it('adds only the difference to a cart already holding some', async () => {
    const sim = simTab({ cart: new Map([[ASIN, 1]]) });
    await build(sim.tab);
    expect(sim.visits).toContain(amazonAddLink(ASIN, 1));
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
  it('signed out, it stops at the first read: no add link, and every item a checklist link', async () => {
    const sim = simTab({ signedOut: true });
    const result = await build(sim.tab, [line(), line({ id: 'order-2' })]);
    expect(result.stopped?.reason).toBe('login');
    expect(result.items.map(item => item.outcome)).toEqual(['checklist', 'checklist']);
    expect(sim.visits).toEqual([amazon.cartUrl]);
  });
  it('a sign-in at the add link stops the store, and nothing is typed or pressed', async () => {
    const sim = simTab({ addPage: '<h1>Sign in or create account</h1><input id="email" type="email"><input id="next" type="submit" value="Continue">' });
    const typed = vi.fn();
    document.addEventListener('input', typed);
    const result = await build(sim.tab, [line(), line({ id: 'order-2' })]);
    expect(result.stopped?.reason).toBe('login');
    expect(result.items.map(item => item.outcome)).toEqual(['checklist', 'checklist']);
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('');
    expect(typed).not.toHaveBeenCalled();
    document.removeEventListener('input', typed);
  });
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
    sim.tab.goto = async url => { await goto(url); if (sim.presses()) at('/errors/validateCaptcha', '<p>Sorry</p>'); };
    const result = await build(sim.tab);
    expect(result.stopped?.reason).toBe('bot-check');
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/Check the cart/) });
  });
  it('a confirm page that comes back is never pressed twice', async () => {
    const sim = simTab({ pressAgain: true });
    const result = await build(sim.tab);
    expect(sim.presses()).toBe(1);
    expect(result.stopped?.reason).toBe('unexpected');
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false });
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
