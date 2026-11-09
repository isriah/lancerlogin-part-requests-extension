// Harbor Freight's steps against a synthetic store in jsdom. No real store is contacted. These page shapes are from the research, not from a real page,
// because the real one showed a bot check. See the comment at the top of the store's file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectPage } from '../../src/carts/page-check';
import { buildStore } from '../../src/carts/runner';
import { allowedInTab, isForbiddenUrl } from '../../src/carts/safety';
import { LineProblem, StoreStop, type StoreTab } from '../../src/carts/store-method';
import { harborFreightPressAdd, harborFreightReadCart, harborFreightReadProduct, harborFreightSearch, harborFreightSku, harborfreight } from '../../src/carts/stores/harborfreight';
import { order, options } from './helpers';

const steps = harborfreight.steps!;
const SKU = '58089';
const PRODUCT = `/test-gloves-${SKU}.html`;
const at = (path: string) => window.history.pushState({}, '', path);
const product = (extra = '', button = '<button id="add">Add to Cart</button>') => `<header><a href="/checkout/cart" aria-label="Cart"><span id="count">0</span></a></header><main><section id="buy"><h1>Test gloves</h1><p>SKU ${SKU}</p><label>Qty <input id="qty" name="qty" value="1"></label>${extra}${button}</section></main><aside><h2>You may also like</h2><p>SKU 11111</p><button id="other">Add to Cart</button></aside>`;
const cartRow = (sku: string, quantity: number) => `<div class="line"><a href="/thing-${sku}.html">Thing</a><span>SKU ${sku}</span><input name="quantity" value="${quantity}"><span>$9.99</span></div>`;
const cartPage = (rows: string) => `<h1>Shopping Cart</h1>${rows || '<p>Your cart is empty</p>'}<button id="checkout">Proceed to Checkout</button>`;
const WALL = '<h1>Before we continue...</h1><p>Press &amp; Hold to confirm you are a human (and not a bot).</p><div id="px-captcha"></div>';

/** A small fake of the store: search goes to the product, Add to Cart adds to a map, the cart page shows the map. Refuses what the tab would refuse. */
function fakeSite(config: { stock?: number; productExtra?: string; searchLandsOn?: string; wallOn?: string } = {}) {
  const cart = new Map<string, number>();
  const log = { gotos: [] as string[], adds: [] as number[], checkoutClicks: 0, otherClicks: 0 };
  const tab: StoreTab = {
    async goto(url) {
      log.gotos.push(url);
      const parsed = new URL(url);
      if (isForbiddenUrl(url)) throw new StoreStop('unexpected', 'refused a checkout address');
      const path = parsed.pathname === '/search' ? (config.searchLandsOn ?? PRODUCT) : parsed.pathname;
      at(path);
      if (config.wallOn && path.includes(config.wallOn)) { document.title = 'Access to this page has been denied'; document.body.innerHTML = WALL; return; }
      if (path === '/checkout/cart') {
        document.body.innerHTML = cartPage([...cart].map(([sku, quantity]) => cartRow(sku, quantity)).join(''));
        document.getElementById('checkout')!.addEventListener('click', () => log.checkoutClicks++);
        return;
      }
      document.body.innerHTML = product(config.productExtra);
      document.getElementById('other')!.addEventListener('click', () => log.otherClicks++);
      document.getElementById('add')?.addEventListener('click', () => {
        const asked = Number((document.getElementById('qty') as HTMLInputElement).value);
        log.adds.push(asked);
        const held = cart.get(SKU) ?? 0;
        cart.set(SKU, Math.min(held + asked, config.stock ?? Infinity));
        document.getElementById('count')!.textContent = String(cart.get(SKU));
      });
    },
    async run(func, ...args) { return await func(...args) as never; },
    async runThenLoad(func, ...args) { return await func(...args) as never; },
  };
  return { cart, log, tab };
}
const hfOrder = (extra = {}) => order({ vendor: 'Harbor Freight', urlVendor: 'Harbor Freight', sku: SKU, productUrl: `https://www.harborfreight.com${PRODUCT}`, unitPrice: null, ...extra });
const build = (tab: StoreTab, orders = [hfOrder()]) => buildStore(harborfreight, steps, orders, tab, options);

beforeEach(() => { vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 40 } as DOMRect); });
afterEach(() => { vi.restoreAllMocks(); document.title = ''; document.body.replaceChildren(); at('/'); });

describe('Harbor Freight SKU', () => {
  it('reads the SKU from the field or the link', () => {
    expect(harborFreightSku({ sku: ' 58089 ', productUrl: null })).toEqual({ sku: SKU, conflict: false });
    expect(harborFreightSku({ sku: 'SKU 58089', productUrl: null })).toEqual({ sku: SKU, conflict: false });
    expect(harborFreightSku({ sku: null, productUrl: `https://www.harborfreight.com${PRODUCT}` })).toEqual({ sku: SKU, conflict: false });
  });
  it('a link with several numbers needs the field to say which', () => {
    const productUrl = 'https://www.harborfreight.com/thing-58089-64546.html';
    expect(harborFreightSku({ sku: null, productUrl }).sku).toBeNull();
    expect(harborFreightSku({ sku: '64546', productUrl })).toEqual({ sku: '64546', conflict: false });
  });
  it('a disagreement, or a SKU that isn\'t a number, is a conflict and not a guess', () => {
    expect(harborFreightSku({ sku: '12345', productUrl: `https://www.harborfreight.com${PRODUCT}` }).conflict).toBe(true);
    expect(harborFreightSku({ sku: 'gloves', productUrl: `https://www.harborfreight.com${PRODUCT}` }).conflict).toBe(true);
  });
  it('blocks a row it can\'t work out, in Carts, before anything runs', () => {
    expect(harborfreight.missing!(hfOrder({ sku: null, productUrl: null }))).toEqual(['a SKU number, in the SKU field or the link']);
    expect(harborfreight.missing!(hfOrder({ sku: '12345' }))).toEqual(['a SKU number that matches its product link']);
    expect(harborfreight.missing!(hfOrder())).toEqual([]);
  });
  it('searches by the exact SKU', () => { expect(harborFreightSearch(SKU)).toBe('https://www.harborfreight.com/search?q=58089'); });
});
describe('finding the product', () => {
  it('resolves to the product page the search reached, by SKU', async () => {
    const { tab, log } = fakeSite();
    expect(await steps.resolveLine(hfOrder(), tab)).toEqual({ key: SKU, addAs: `https://www.harborfreight.com${PRODUCT}` });
    expect(log.gotos).toEqual(['https://www.harborfreight.com/search?q=58089']);
  });
  it('refuses a page for another SKU', async () => {
    at('/other-99999.html');
    document.body.innerHTML = '<h1>Other</h1><p>SKU 99999</p>';
    expect(await harborFreightReadProduct(SKU, 0)).toMatchObject({ kind: 'not-found', message: expect.stringContaining('SKU 99999') });
  });
  it('refuses a list of results, and a matching address whose page says something else', async () => {
    at('/search');
    document.body.innerHTML = '<p>SKU 58089</p><p>SKU 58090</p>';
    expect(await harborFreightReadProduct(SKU, 0)).toMatchObject({ kind: 'not-found' });
    at(PRODUCT);
    document.body.innerHTML = '<h1>Test</h1><p>SKU 11111</p><p>SKU 58089</p>';
    expect(await harborFreightReadProduct(SKU, 0)).toMatchObject({ kind: 'not-found' });
  });
  it('a line that can\'t be matched is the line\'s problem, and the store carries on', async () => {
    const { tab, cart } = fakeSite({ searchLandsOn: '/search' });
    document.body.innerHTML = '';
    await expect(steps.resolveLine(hfOrder({ sku: '12345' }), tab)).rejects.toThrow(LineProblem);
    expect(cart.size).toBe(0);
  });
  it('waits for a page that draws itself', async () => {
    at(PRODUCT);
    document.body.innerHTML = '<p>Loading</p>';
    setTimeout(() => { document.body.innerHTML = product(); }, 300);
    expect(await harborFreightReadProduct(SKU, 3000)).toEqual({ kind: 'ok', path: PRODUCT });
  });
});
describe('reading the cart', () => {
  beforeEach(() => at('/checkout/cart'));
  it('hands back only the lines asked for, and nothing about the others', async () => {
    document.body.innerHTML = cartPage(cartRow(SKU, 2) + cartRow('99999', 7));
    const lines = await harborFreightReadCart([SKU]);
    expect(lines).toEqual([{ key: SKU, quantity: 2 }]);
    expect(JSON.stringify(lines)).not.toMatch(/99999|9\.99/);
  });
  it('adds up one SKU on two lines, such as a split between pickup and shipping', async () => {
    document.body.innerHTML = cartPage(cartRow(SKU, 2) + cartRow(SKU, 3));
    expect(await harborFreightReadCart([SKU])).toEqual([{ key: SKU, quantity: 5 }]);
  });
  it('leaves out a line that isn\'t there', async () => {
    document.body.innerHTML = cartPage(cartRow('99999', 7));
    expect(await harborFreightReadCart([SKU])).toEqual([]);
  });
  it('an empty cart has to stay empty before it counts', async () => {
    document.body.innerHTML = cartPage('');
    expect(await harborFreightReadCart([SKU], 3000, 0)).toEqual([]);
    setTimeout(() => { document.body.innerHTML = cartPage(cartRow(SKU, 4)); }, 300);
    expect(await harborFreightReadCart([SKU], 3000, 1000)).toEqual([{ key: SKU, quantity: 4 }]);
  });
  it('never guesses zero from a page it can\'t recognize', async () => {
    document.body.innerHTML = '<h1>Shopping Cart</h1><p>Something else</p>';
    expect(await harborFreightReadCart([SKU], 0)).toMatchObject({ kind: 'stop', reason: 'unexpected' });
    at('/some-other-page');
    document.body.innerHTML = cartPage('');
    expect(await harborFreightReadCart([SKU], 0, 0)).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('stops on a line it can\'t read: a shared quantity, a blank one, or the SKU with no box', async () => {
    document.body.innerHTML = cartPage(`<div>SKU ${SKU} SKU 99999<input name="quantity" value="2"></div>`);
    expect(await harborFreightReadCart([SKU], 0)).toMatchObject({ kind: 'stop', reason: 'unexpected' });
    document.body.innerHTML = cartPage(`<div>SKU ${SKU}<input name="quantity" value=""></div>`);
    expect(await harborFreightReadCart([SKU], 0)).toMatchObject({ kind: 'stop', reason: 'unexpected' });
    document.body.innerHTML = cartPage(`${cartRow('99999', 1)}<div>SKU ${SKU}</div>`);
    expect(await harborFreightReadCart([SKU], 0)).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('a promo code box isn\'t a quantity', async () => {
    document.body.innerHTML = cartPage(`${cartRow(SKU, 2)}<input name="coupon" value="3">`);
    expect(await harborFreightReadCart([SKU])).toEqual([{ key: SKU, quantity: 2 }]);
  });
});
describe('pressing Add to Cart', () => {
  beforeEach(() => at(PRODUCT));
  const press = (quantity = 2, sku = SKU) => harborFreightPressAdd(sku, quantity, 0, 1000);
  it('sets this product\'s quantity and presses its own button once, and nothing else', async () => {
    document.body.innerHTML = product();
    const asked: string[] = [], other = vi.fn();
    document.getElementById('add')!.addEventListener('click', () => { asked.push((document.getElementById('qty') as HTMLInputElement).value); document.getElementById('count')!.textContent = '2'; });
    document.getElementById('other')!.addEventListener('click', other);
    expect(await press()).toEqual({ kind: 'sent' });
    expect(asked).toEqual(['2']);
    expect(other).not.toHaveBeenCalled();
  });
  it('tells the page\'s framework about the quantity', async () => {
    document.body.innerHTML = product();
    const heard = vi.fn();
    document.getElementById('qty')!.addEventListener('input', heard);
    await harborFreightPressAdd(SKU, 2, 0, 0);
    expect(heard).toHaveBeenCalledTimes(1);
  });
  it('presses nothing in the confirmation', async () => {
    document.body.innerHTML = product();
    const checkout = vi.fn();
    document.getElementById('add')!.addEventListener('click', () => {
      const box = document.createElement('div');
      box.setAttribute('role', 'dialog');
      box.innerHTML = '<p>Added to Cart</p><p>Pick up at your store, or ship it</p><a id="co" href="/checkout/shipping">Checkout</a>';
      document.body.append(box);
      document.getElementById('co')!.addEventListener('click', checkout);
    });
    expect(await press()).toEqual({ kind: 'sent' });
    expect(checkout).not.toHaveBeenCalled();
  });
  it('fails a required pickup or shipping choice with nothing selected, and chooses nothing', async () => {
    const clicked = vi.fn();
    for (const choice of [
      '<label><input type="radio" name="fulfillment" value="pickup">In-Store Pickup</label><label><input type="radio" name="fulfillment" value="ship">Ship to Home</label>',
      '<button aria-pressed="false">Ship to Home</button>',
      '<div role="radio" aria-checked="false">In-Store Pickup</div>',
      '<div role="tab" aria-selected="false">Delivery</div>',
    ]) {
      document.body.innerHTML = product(choice);
      document.getElementById('add')!.addEventListener('click', clicked);
      expect(await press()).toMatchObject({ kind: 'refused', message: expect.stringMatching(/pickup or shipping choice.*none is selected/) });
      expect(document.querySelector('input[type="radio"]:checked')).toBeNull();
    }
    expect(clicked).not.toHaveBeenCalled();
  });
  it.each([
    ['a checked radio', '<label><input type="radio" name="fulfillment" value="pickup">In-Store Pickup</label><label><input type="radio" name="fulfillment" value="ship" checked>Ship to Home</label>'],
    ['a pressed button', '<button aria-pressed="false">In-Store Pickup</button><button aria-pressed="true">Ship to Home</button>'],
    ['a checked role', '<div role="radio" aria-checked="false">In-Store Pickup</div><div role="radio" aria-checked="true">Ship to Home</div>'],
    ['a selected tab', '<div role="tab" aria-selected="false">In-Store Pickup</div><div role="tab" aria-selected="true">Ship to Home</div>'],
  ])('keeps a choice already selected by %s, and names it', async (_name, choice) => {
    document.body.innerHTML = product(choice);
    const clicked = vi.fn(), asked = vi.fn();
    document.getElementById('buy')!.addEventListener('click', event => { if ((event.target as Element).id !== 'add') clicked(); });
    document.getElementById('add')!.addEventListener('click', asked);
    const answer = await harborFreightPressAdd(SKU, 2, 0, 0);
    expect(answer).toEqual({ kind: 'sent', kept: 'Ship to Home' });
    expect(asked).toHaveBeenCalledTimes(1);
    expect(clicked).not.toHaveBeenCalled();
  });
  it('says no choice was kept when the page offers none', async () => {
    document.body.innerHTML = product();
    expect(await harborFreightPressAdd(SKU, 2, 0, 0)).toEqual({ kind: 'sent' });
  });
  it('a store or ZIP prompt still fails the line, even with a choice selected', async () => {
    const selected = '<label><input type="radio" name="fulfillment" value="ship" checked>Ship to Home</label>';
    const clicked = vi.fn();
    for (const page of [
      `${product(selected)}<div role="dialog"><p>Select your store</p></div>`,
      product(`${selected}<input name="zipCode" placeholder="ZIP code">`),
    ]) {
      document.body.innerHTML = page;
      document.getElementById('add')!.addEventListener('click', clicked);
      expect(await press()).toMatchObject({ kind: 'refused', message: expect.stringMatching(/store or ZIP/) });
    }
    expect(clicked).not.toHaveBeenCalled();
  });
  it('a ZIP box the page already filled in is not a prompt', async () => {
    document.body.innerHTML = product('<label><input type="radio" name="fulfillment" value="ship" checked>Ship to Home</label><input name="zipCode" value="00000">');
    expect(await harborFreightPressAdd(SKU, 2, 0, 0)).toMatchObject({ kind: 'sent', kept: 'Ship to Home' });
  });
  it('doesn\'t answer a store or ZIP prompt', async () => {
    document.body.innerHTML = `${product()}<div role="dialog"><p>Enter your ZIP code</p><input name="zip"></div>`;
    const clicked = vi.fn();
    document.getElementById('add')!.addEventListener('click', clicked);
    expect(await press()).toMatchObject({ kind: 'refused', message: expect.stringMatching(/store or ZIP/) });
    expect(clicked).not.toHaveBeenCalled();
    expect((document.querySelector('input[name="zip"]') as HTMLInputElement).value).toBe('');
  });
  it('reports a prompt that appears after the press, and presses nothing more', async () => {
    document.body.innerHTML = product();
    document.getElementById('add')!.addEventListener('click', () => { const box = document.createElement('div'); box.setAttribute('role', 'dialog'); box.textContent = 'Select your store'; document.body.append(box); });
    expect(await press()).toMatchObject({ kind: 'refused', message: expect.stringMatching(/after Add to Cart/) });
  });
  it('refuses another SKU\'s page, two buttons for the product, and no clear quantity box', async () => {
    document.body.innerHTML = product();
    expect(await press(2, '12345')).toMatchObject({ kind: 'refused', message: expect.stringContaining('SKU 58089') });
    document.body.innerHTML = product('<button>Add to Cart</button>');
    expect(await press()).toMatchObject({ kind: 'refused', message: expect.stringContaining('one clear Add to Cart') });
    document.body.innerHTML = product('<input name="qty2" value="1">');
    expect(await press()).toMatchObject({ kind: 'refused', message: expect.stringContaining('one clear quantity box') });
    document.body.innerHTML = product().replace(/<label>.*<\/label>/, '');
    expect(await press()).toMatchObject({ kind: 'refused', message: expect.stringContaining('one clear quantity box') });
  });
  it('quantity 1 needs no box', async () => {
    document.body.innerHTML = product().replace(/<label>.*<\/label>/, '');
    expect(await harborFreightPressAdd(SKU, 1, 0, 0)).toEqual({ kind: 'sent' });
  });
  it('refuses a disabled button, and a button named anything else', async () => {
    document.body.innerHTML = product('', '<button id="add" disabled>Add to Cart</button>').replace(/<aside>.*<\/aside>/, '');
    expect(await press()).toMatchObject({ kind: 'refused', message: expect.stringContaining('unavailable') });
    document.body.innerHTML = product('', '<button id="add">Buy Now</button>').replace(/<aside>.*<\/aside>/, '');
    expect(await press()).toMatchObject({ kind: 'refused', message: expect.stringContaining('no Add to Cart') });
  });
  it('an Add to Cart that goes to checkout stops the store, with nothing pressed', async () => {
    document.body.innerHTML = product('', '<form action="/checkout/shipping"><button id="add">Add to Cart</button></form>');
    const clicked = vi.fn();
    document.getElementById('add')!.addEventListener('click', event => { event.preventDefault(); clicked(); });
    expect(await press()).toMatchObject({ kind: 'stop', reason: 'unexpected', notSent: true });
    expect(clicked).not.toHaveBeenCalled();
  });
  it('a quantity box that won\'t take the number is refused', async () => {
    document.body.innerHTML = product().replace('<input id="qty" name="qty" value="1">', '<select id="qty" name="qty"><option value="1">1</option></select>');
    expect(await press(5)).toMatchObject({ kind: 'refused', message: expect.stringContaining('would not take 5') });
  });
});
describe('walls', () => {
  it('the bot check a fresh browser really got is seen by the shared check after loading', () => {
    document.title = 'Access to this page has been denied';
    document.body.innerHTML = WALL;
    Object.defineProperty(document.body, 'innerText', { value: 'Before we continue... Press & Hold to confirm you are a human (and not a bot). Reference ID test', configurable: true });
    expect(inspectPage()).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    delete (document.body as unknown as Record<string, unknown>).innerText;
  });
  it('a wall drawn after loading stops every step, and pressing never starts', async () => {
    at(PRODUCT);
    document.body.innerHTML = '<p>Before we continue... Press &amp; Hold to confirm you are a human (and not a bot).</p>';
    expect(await harborFreightReadProduct(SKU, 0)).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    expect(await harborFreightReadCart([SKU], 0)).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    expect(await harborFreightPressAdd(SKU, 2, 0, 0)).toMatchObject({ kind: 'stop', reason: 'bot-check', notSent: true });
  });
  it('the challenge element alone is enough', async () => {
    at('/checkout/cart');
    document.body.innerHTML = `${cartPage(cartRow(SKU, 2))}<div id="px-captcha"></div>`;
    expect(await harborFreightReadCart([SKU], 0)).toMatchObject({ kind: 'stop', reason: 'bot-check' });
  });
  it('a long page about a press-and-hold tool isn\'t a wall', async () => {
    at(PRODUCT);
    document.body.innerHTML = product(`<p>Press and hold the trigger. ${'Details. '.repeat(300)}</p>`);
    expect(await harborFreightReadProduct(SKU, 0)).toEqual({ kind: 'ok', path: PRODUCT });
  });
  it('a sign-in stops the store', async () => {
    at('/checkout/cart');
    document.body.innerHTML = '<input type="password">';
    expect(await harborFreightReadCart([SKU], 0)).toMatchObject({ kind: 'stop', reason: 'login' });
  });
});
describe('a whole build, through the runner', () => {
  it('adds, confirms and marks, and a second build adds nothing', async () => {
    const { tab, cart, log } = fakeSite();
    const first = await build(tab);
    expect(first.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(log.adds).toEqual([2]);
    expect(cart.get(SKU)).toBe(2);
    const again = await build(tab);
    expect(again.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: expect.stringContaining('Already in the cart') });
    expect(log.adds).toEqual([2]);
    expect(cart.get(SKU)).toBe(2);
    expect(log.checkoutClicks).toBe(0);
    expect(log.otherClicks).toBe(0);
    expect(log.gotos.every(url => !/checkout/i.test(url) || url === 'https://www.harborfreight.com/checkout/cart')).toBe(true);
  }, 20_000);
  it('short stock is flagged and not marked', async () => {
    const { tab } = fakeSite({ stock: 1 });
    const result = await build(tab);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringContaining('Short stock') });
  }, 20_000);
  it('a read-back that doesn\'t match is flagged and not marked', async () => {
    const site = fakeSite();
    const realRun = site.tab.run;
    // A store that adds more than it was asked for.
    site.tab.run = async (func, ...args) => {
      const answer = await realRun(func, ...args);
      if (func === (harborFreightPressAdd as unknown)) site.cart.set(SKU, 5);
      return answer as never;
    };
    const result = await build(site.tab);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringContaining('Quantity mismatch') });
  }, 20_000);
  it('a selected pickup-or-ship choice is kept: the line is added, confirmed and flagged', async () => {
    const { tab, cart, log } = fakeSite({ productExtra: '<label><input type="radio" name="how" value="ship" checked>Ship to Home</label>' });
    const result = await build(tab);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: expect.stringContaining('choice was kept: Ship to Home') });
    expect(result.stopped).toBeUndefined();
    expect(log.adds).toEqual([2]);
    expect(cart.get(SKU)).toBe(2);
  }, 20_000);
  it('a kept choice flags only the line it was kept on', async () => {
    const site = fakeSite();
    const plain = await build(site.tab);
    expect(plain.items[0]).toMatchObject({ outcome: 'added', message: '' });
  }, 20_000);
  it('a pickup-or-ship choice with nothing selected fails the line with the reason, adds nothing, and the store carries on', async () => {
    const { tab, cart, log } = fakeSite({ productExtra: '<label><input type="radio" name="how" value="pickup">In-Store Pickup</label><label><input type="radio" name="how" value="ship">Ship to Home</label>' });
    const result = await build(tab);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', confirmed: false, message: expect.stringContaining('none is selected') });
    expect(result.stopped).toBeUndefined();
    expect(log.adds).toEqual([]);
    expect(cart.size).toBe(0);
  }, 20_000);
  it('a store or ZIP prompt fails the line even with a choice selected, and adds nothing', async () => {
    const { tab, cart, log } = fakeSite({ productExtra: '<label><input type="radio" name="how" value="ship" checked>Ship to Home</label><input name="zip" placeholder="Enter ZIP">' });
    const result = await build(tab);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', confirmed: false, message: expect.stringContaining('store or ZIP') });
    expect(log.adds).toEqual([]);
    expect(cart.size).toBe(0);
  }, 20_000);
  it('a bot check stops the store and leaves the rest as checklist items', async () => {
    const { tab, log } = fakeSite({ wallOn: PRODUCT });
    const result = await build(tab, [hfOrder({ id: 'a' }), hfOrder({ id: 'b' })]);
    expect(result.stopped).toMatchObject({ reason: 'bot-check' });
    expect(result.items.map(item => item.outcome)).toEqual(['checklist', 'checklist']);
    expect(log.adds).toEqual([]);
  });
  it('if the tab refuses the cart address, the store stops at the first read and nothing is sent', async () => {
    const { tab, log } = fakeSite();
    const goto = tab.goto;
    tab.goto = async url => { if (url.includes('/checkout/')) throw new StoreStop('unexpected', 'refused an address outside the store or at checkout'); await goto(url); };
    const result = await build(tab);
    expect(result.stopped).toMatchObject({ reason: 'unexpected' });
    expect(result.items[0]).toMatchObject({ outcome: 'checklist', confirmed: false });
    expect(log.adds).toEqual([]);
  });
});
describe('what the file promises', () => {
  it('is item by item, asks for one origin, and its cart is the cart page', () => {
    expect(harborfreight).toMatchObject({ id: 'harborfreight', label: 'Harbor Freight', badge: 'item', origins: ['https://www.harborfreight.com/*'], cartUrl: 'https://www.harborfreight.com/checkout/cart' });
    expect(harborfreight.startUrl).toBe('https://www.harborfreight.com/');
  });
  it('the real tab rule lets it reach its cart page and nothing else under checkout', () => {
    expect(allowedInTab(harborfreight, harborfreight.cartUrl!)).toBe(true);
    expect(allowedInTab(harborfreight, 'https://www.harborfreight.com/checkout/shipping')).toBe(false);
  });
  it('sets no user agent, and reads no cookies', () => {
    expect(readFileSync(resolve('src/carts/stores/harborfreight.ts'), 'utf8')).not.toMatch(/user-?agent|navigator\.webdriver|document\.cookie|chrome\.cookies/i);
  });
});
