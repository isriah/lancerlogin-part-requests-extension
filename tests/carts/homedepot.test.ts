// Home Depot's steps against a synthetic store in jsdom, built from what was seen in a signed-in browser. No real store is contacted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectPage } from '../../src/carts/page-check';
import { buildStore, checklistResult, marksFor } from '../../src/carts/runner';
import { allowedInTab } from '../../src/carts/safety';
import { blockedReason } from '../../src/carts/selection';
import { StoreStop, type StoreTab } from '../../src/carts/store-method';
import { homedepot, homedepotItem, homedepotPressAdd, homedepotReadCart } from '../../src/carts/stores/homedepot';
import { VENDORS } from '../../src/vendors';
import { order, options } from './helpers';

const ITEM = '204647886';
const PATH = `/p/Everbilt-1-4-in-20-Zinc-Plated-Hex-Nut-801736/${ITEM}`;
const LINK = `https://www.homedepot.com${PATH}`;
const line = (extra = {}) => order({ vendor: 'Home Depot', urlVendor: 'Home Depot', sku: null, productUrl: LINK, quantity: 3, unitPrice: null, ...extra });
const steps = homedepot.steps!;
const at = (path: string) => window.history.pushState({}, '', path);
const DELIVERY = '<button data-testid="deliveryTile" aria-pressed="true">Delivery Free</button>';
const PICKUP = '<button data-testid="pickupTile" aria-pressed="false">Pickup Today</button>';
const productPage = (tiles = `${DELIVERY}${PICKUP}`, button = '<button id="add">Add to Cart</button>', extra = '') => `<header><span data-testid="header-cart-count">0</span></header><h1>Hex Nut</h1><div data-component="price:Price:v1">14 ¢</div>${tiles}<button>Please Select</button>
  <div data-component="add-to-cart:AddToCart:v1"><input id="qty" type="text" class="sui-input-base-input" value="1">${button}</div>${extra}<aside><h2>You may also like</h2><button id="rec">Add to Cart</button></aside>`;
const panel = '<div role="dialog" id="panel"><h2>Added to Cart</h2><p>Qty 1</p><h3>Don\'t Forget These</h3><div data-component="add-to-cart:AddToCart:v1"><input type="text" value="1"><button id="upsell">Add to Cart</button></div></div>';
const cartRow = (item: string, quantity: number, extra = 'Save For Later') => `<div data-component="cart-item:CartItem:v2"><a href="/p/Test-Thing/${item}">Test thing</a><input class="sui-input-base-input" value="${quantity}"><button>${extra}</button></div>`;
const savedRow = (item: string) => `<div data-component="cart-item:CartItem:v2"><a href="/p/Saved-Thing/${item}">Saved thing</a><button>Move to Cart</button></div>`;
const cartPage = (rows: string, badge: number | null, saved = '') => `<span data-testid="header-cart-count">${badge ?? ''}</span><h1>Cart</h1>${rows || '<p>Your cart is empty</p>'}${saved ? `<h2>Saved For Later (1)</h2>${saved}` : ''}<button id="checkout">Checkout</button>`;
const OOPS = '<h1>Oops!! Something went wrong.</h1><p>Please refresh page</p><button>Refresh</button>';

/** The store in small: Add to Cart adds to a map and opens the panel, and the cart page shows the map with its rows arriving a moment later. */
function fakeSite(config: { tiles?: string; button?: string; productExtra?: string; stock?: number; saved?: string; wallOn?: 'cart' | 'product'; lazyMs?: number } = {}) {
  const cart = new Map<string, number>();
  const log = { gotos: [] as string[], adds: [] as number[], rec: 0, upsell: 0, checkout: 0 };
  const tab: StoreTab = {
    async goto(url) {
      log.gotos.push(url);
      const path = new URL(url).pathname;
      at(path);
      const isCart = path === '/cart';
      if (config.wallOn === (isCart ? 'cart' : 'product')) { document.title = 'Error Page'; document.body.innerHTML = OOPS; const answer = inspectPage(); if (answer.kind === 'stop') throw new StoreStop(answer.reason, answer.detail); return; }
      if (isCart) {
        const total = [...cart.values()].reduce((sum, value) => sum + value, 0);
        document.body.innerHTML = cartPage('', total);
        document.querySelector('p')?.remove();
        const draw = () => { document.body.innerHTML = cartPage([...cart].map(([item, quantity]) => cartRow(item, quantity)).join(''), total, config.saved); document.getElementById('checkout')!.addEventListener('click', () => log.checkout++); };
        if (config.lazyMs) setTimeout(draw, config.lazyMs); else draw();
        return;
      }
      document.body.innerHTML = productPage(config.tiles, config.button, config.productExtra);
      document.getElementById('rec')!.addEventListener('click', () => log.rec++);
      document.getElementById('add')?.addEventListener('click', () => {
        const asked = Number((document.getElementById('qty') as HTMLInputElement).value);
        log.adds.push(asked);
        cart.set(ITEM, Math.min((cart.get(ITEM) ?? 0) + asked, config.stock ?? Infinity));
        document.body.insertAdjacentHTML('beforeend', panel);
        document.getElementById('upsell')!.addEventListener('click', () => log.upsell++);
      });
    },
    async run(func, ...args) {
      if ((func as unknown) === homedepotPressAdd) { const [item, quantity] = args as unknown as [string, number]; return await homedepotPressAdd(item, quantity, 200, 50) as never; }
      if ((func as unknown) === homedepotReadCart) return await homedepotReadCart((args as unknown as [string[]])[0], 1500, 20) as never;
      return await func(...args) as never;
    },
    async runThenLoad(func, ...args) { return await func(...args) as never; },
  };
  return { cart, log, tab };
}
const build = (tab: StoreTab, orders = [line()]) => buildStore(homedepot, steps, orders, tab, options);

beforeEach(() => { vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 40 } as DOMRect); });
afterEach(() => { vi.restoreAllMocks(); document.title = ''; document.body.replaceChildren(); at('/'); });

describe('Home Depot: what it is', () => {
  it('is item by item, says so, and says what happens to a pickup or delivery choice', () => {
    expect(homedepot).toMatchObject({ id: 'homedepot', label: 'Home Depot', badge: 'item', origins: ['https://www.homedepot.com/*'] });
    expect(homedepot.badgeHelp).toMatch(/pickup or delivery choice already selected is kept and flagged/);
    expect(steps.foreground).toBe(true);
  });
  it('matches the plugin\'s vendor label and hosts', () => {
    const vendor = VENDORS.find(v => v.id === 'homedepot')!;
    expect(homedepot.label).toBe(vendor.label);
    expect([...homedepot.hosts].sort()).toEqual([...vendor.hosts].sort());
  });
  it('starts at and links to the store\'s own cart page, never checkout', () => {
    expect(homedepot.cartUrl).toBe('https://www.homedepot.com/cart');
    expect(homedepot.startUrl).toBe('https://www.homedepot.com/cart');
    expect(allowedInTab(homedepot, homedepot.cartUrl!)).toBe(true);
  });
  it('reads the item number only from a link to one product', () => {
    expect(homedepotItem(LINK)).toBe(ITEM);
    expect(homedepotItem(`${LINK}?MERCH=REC-_-x`)).toBe(ITEM);
    expect(homedepotItem('https://homedepot.com/p/100000001/')).toBe('100000001');
    for (const other of [
      'https://www.homedepot.com/p/reviews/Test-Washer/100000001/4',
      'https://www.homedepot.com/p/questions/Test-Washer/100000001/1',
      'https://www.homedepot.com/b/Hardware-Fasteners/N-5yc1vZc2ck',
      'https://www.homedepot.com/cart',
      'https://www.homedepot.com/checkout/p/100000001',
      'https://www.homedepot.com.example.test/p/Test/100000001',
      'http://www.homedepot.com/p/Test/100000001',
      'not a link',
      '',
      null,
    ]) expect(homedepotItem(other), String(other)).toBeNull();
  });
  it('can be ticked with a product link and a quantity, and needs no SKU', () => {
    expect(blockedReason(line(), homedepot)).toBeNull();
  });
  it('refuses an order with no link, or a link that doesn\'t name one item', () => {
    expect(blockedReason(line({ productUrl: null }), homedepot)).toBe('Home Depot needs a product link. Add it in Notion.');
    expect(blockedReason(line({ productUrl: 'https://www.homedepot.com/b/Hardware/N-5yc1vZc2ck' }), homedepot)).toBe('Home Depot needs a product link on homedepot.com. Add it in Notion.');
  });
  it('refuses a missing or part quantity, and a link to another vendor', () => {
    expect(blockedReason(line({ quantity: null }), homedepot)).toMatch(/a quantity/);
    expect(blockedReason(line({ quantity: 1.5 }), homedepot)).toMatch(/whole-number/);
    expect(blockedReason(line({ urlVendor: 'REV' }), homedepot)).toMatch(/Fix it in Notion/);
  });
  it('with no store access it hands the person the link and quantity, and marks nothing', () => {
    const result = checklistResult(homedepot, [line({ id: 'a' })], { noAccess: true });
    expect(result).toMatchObject({ storeId: 'homedepot', badge: 'checklist', cartUrl: 'https://www.homedepot.com/cart' });
    expect(result.items.map(item => [item.outcome, item.order.productUrl, item.order.quantity, item.confirmed])).toEqual([['checklist', LINK, 3, false]]);
    expect(marksFor(result)).toEqual([]);
  });
});

describe('Home Depot: a build', () => {
  it('presses only the page\'s own Add to Cart, once, with the quantity, and flags the kept choice by name', async () => {
    const { cart, log, tab } = fakeSite();
    const result = await build(tab);
    expect(cart.get(ITEM)).toBe(3);
    expect(log.adds).toEqual([3]);
    expect(log).toMatchObject({ rec: 0, upsell: 0, checkout: 0 });
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: 'Home Depot\'s selected choice was kept: Delivery. Check it in the cart.' });
    expect(log.gotos).toEqual(['https://www.homedepot.com/cart', LINK, 'https://www.homedepot.com/cart', 'https://www.homedepot.com/cart']);
  });
  it('names a preselected pickup too, and clicks neither tile', async () => {
    const tiles = '<button data-testid="deliveryTile" aria-pressed="false">Delivery</button><button data-testid="pickupTile" aria-pressed="true">Pickup</button>';
    const { tab } = fakeSite({ tiles });
    const clicks = vi.fn();
    const result = await buildStore(homedepot, steps, [line()], { ...tab, async goto(url) { await tab.goto(url); document.querySelectorAll('[data-testid$="Tile"]').forEach(node => node.addEventListener('click', clicks)); } }, options);
    expect(result.items[0].message).toMatch(/kept: Pickup\./);
    expect(clicks).not.toHaveBeenCalled();
  });
  it('a retry adds nothing', async () => {
    const { cart, log, tab } = fakeSite();
    await build(tab);
    const again = await build(tab);
    expect(cart.get(ITEM)).toBe(3);
    expect(log.adds).toEqual([3]);
    expect(again.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: 'Already in the cart: it holds 3, so nothing was added.' });
  });
  it('tops up by the difference only', async () => {
    const { cart, log, tab } = fakeSite();
    cart.set(ITEM, 1);
    const result = await build(tab);
    expect(log.adds).toEqual([2]);
    expect(cart.get(ITEM)).toBe(3);
    expect(result.items[0].message).toMatch(/it held 1, so 2 more were added to reach 3/);
  });
  it('a read-back that doesn\'t match is short stock, and isn\'t marked', async () => {
    const { tab } = fakeSite({ stock: 2 });
    const result = await build(tab);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/Short stock: asked for 3, and the cart holds 2/) });
    expect(marksFor(result)).toEqual([]);
  });
  it('a read-back that went too far is a quantity mismatch, and isn\'t marked', async () => {
    const { cart, tab } = fakeSite();
    const result = await buildStore(homedepot, { ...steps, async addLine(_tab, target) { cart.set(target.key, 9); } }, [line()], tab, options);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/Quantity mismatch/) });
  });
  it('Saved For Later doesn\'t count, so a saved item still gets added', async () => {
    const { cart, log, tab } = fakeSite({ saved: savedRow(ITEM) });
    const result = await build(tab);
    expect(log.adds).toEqual([3]);
    expect(cart.get(ITEM)).toBe(3);
    expect(result.items[0].confirmed).toBe(true);
  });
  it('waits for rows that load late, so a retry still adds nothing', async () => {
    const { cart, log, tab } = fakeSite({ lazyMs: 600 });
    cart.set(ITEM, 3);
    const result = await build(tab);
    expect(log.adds).toEqual([]);
    expect(result.items[0].message).toMatch(/Already in the cart/);
  });
  it('the Oops page on the cart stops the store, with nothing sent', async () => {
    const { log, tab } = fakeSite({ wallOn: 'cart' });
    const result = await build(tab, [line({ id: 'a' }), line({ id: 'b' })]);
    expect(result.stopped?.reason).toBe('bot-check');
    expect(log.adds).toEqual([]);
    expect(result.items.map(item => item.outcome)).toEqual(['checklist', 'checklist']);
  });
  it('the Oops page on the product stops the store too', async () => {
    const { log, tab } = fakeSite({ wallOn: 'product' });
    const result = await build(tab);
    expect(result.stopped?.reason).toBe('bot-check');
    expect(log.adds).toEqual([]);
  });
  it('no choice selected fails the line, and the next one is still tried', async () => {
    const { log, tab } = fakeSite({ tiles: '<button data-testid="deliveryTile" aria-pressed="false">Delivery</button><button data-testid="pickupTile" aria-pressed="false">Pickup</button>' });
    const result = await build(tab);
    expect(result.stopped).toBeUndefined();
    expect(result.items[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/no pickup or delivery choice selected/) });
    expect(log.adds).toEqual([]);
  });
  it('no choice shown at all fails the line', async () => {
    const { log, tab } = fakeSite({ tiles: '' });
    const result = await build(tab);
    expect(result.items[0].outcome).toBe('failed');
    expect(log.adds).toEqual([]);
  });
  it('a store or ZIP prompt fails the line', async () => {
    const { log, tab } = fakeSite({ productExtra: '<div role="dialog"><p>Enter your ZIP code to see options</p><input></div>' });
    const result = await build(tab);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/store or ZIP/) });
    expect(log.adds).toEqual([]);
  });
  it('a disabled Add to Cart fails the line, with "Please Select" pills on the page or not', async () => {
    const { log, tab } = fakeSite({ button: '<button id="add" disabled>Add to Cart</button>' });
    const result = await build(tab);
    expect(result.items[0].outcome).toBe('failed');
    expect(log.adds).toEqual([]);
  });
  it('a "Please Select" pill beside a selected choice doesn\'t block an enabled button', async () => {
    const { cart, tab } = fakeSite();
    await build(tab);
    expect(cart.get(ITEM)).toBe(3);
  });
});

describe('Home Depot: pressing Add to Cart', () => {
  it('refuses a page for another item', async () => {
    at('/p/Other-Thing/999999999');
    document.body.innerHTML = productPage();
    expect(await homedepotPressAdd(ITEM, 1, 50, 50)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/not item/) });
  });
  it('refuses two Add to Cart blocks', async () => {
    at(PATH);
    document.body.innerHTML = productPage() + '<div data-component="add-to-cart:Other"><button>Add to Cart</button></div>';
    expect(await homedepotPressAdd(ITEM, 1, 50, 50)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/one clear Add to Cart/) });
  });
  it('doesn\'t take a label that only contains the words', async () => {
    at(PATH);
    document.body.innerHTML = productPage(undefined, '<button id="add">Add to Cart and Check Out</button>');
    expect(await homedepotPressAdd(ITEM, 1, 50, 50)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/no Add to Cart/) });
  });
  it('refuses when the quantity box won\'t take the number', async () => {
    at(PATH);
    document.body.innerHTML = productPage();
    const box = document.getElementById('qty') as HTMLInputElement;
    box.addEventListener('input', () => { box.value = '1'; });
    expect(await homedepotPressAdd(ITEM, 5, 50, 50)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/would not take 5/) });
  });
  it('stops at a button that goes to checkout', async () => {
    at(PATH);
    document.body.innerHTML = productPage(undefined, '<form action="/checkout"><button id="add">Add to Cart</button></form>');
    expect(await homedepotPressAdd(ITEM, 1, 50, 50)).toMatchObject({ kind: 'stop', notSent: true });
  });
  it('stops at a sign-in', async () => {
    at(PATH);
    document.body.innerHTML = '<input type="password">';
    expect(await homedepotPressAdd(ITEM, 1, 50, 50)).toMatchObject({ kind: 'stop', reason: 'login', notSent: true });
  });
});

describe('Home Depot: reading the cart', () => {
  beforeEach(() => at('/cart'));
  const read = (keys: string[]) => homedepotReadCart(keys, 400, 20);
  it('hands back only the lines asked for, and adds rows of one item together', async () => {
    document.body.innerHTML = cartPage(cartRow('111111111', 2) + cartRow('111111111', 1) + cartRow('222222222', 7), 10);
    expect(await read(['111111111'])).toEqual([{ key: '111111111', quantity: 3 }]);
  });
  it('an item in Saved For Later reads as not in the cart', async () => {
    document.body.innerHTML = cartPage(cartRow('111111111', 1), 1, savedRow('222222222'));
    expect(await read(['111111111', '222222222'])).toEqual([{ key: '111111111', quantity: 1 }]);
  });
  it('a row under the heading with a quantity box still doesn\'t count', async () => {
    document.body.innerHTML = cartPage(cartRow('111111111', 1), 1, cartRow('222222222', 4, 'Move to Cart'));
    expect(await read(['222222222'])).toEqual([]);
  });
  it('a row marked saved with no heading loaded yet doesn\'t count', async () => {
    document.body.innerHTML = cartPage(cartRow('111111111', 1) + savedRow('222222222'), 1);
    expect(await read(['222222222'])).toEqual([]);
  });
  it('stops when a row below the heading offers to be saved, because the two signs disagree', async () => {
    document.body.innerHTML = cartPage(cartRow('111111111', 1), 1, cartRow('222222222', 4));
    expect(await read(['222222222'])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('an empty cart reads empty, once it has held', async () => {
    document.body.innerHTML = cartPage('', 0);
    expect(await read(['111111111'])).toEqual([]);
  });
  it('stops rather than read zero when the badge says there are rows it can\'t see', async () => {
    document.body.innerHTML = '<span data-testid="header-cart-count">2</span><h1>Cart</h1>';
    expect(await read(['111111111'])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('stops rather than read short when only some rows have loaded', async () => {
    document.body.innerHTML = cartPage(cartRow('111111111', 1), 2);
    expect(await read(['111111111'])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('agrees with a badge that counts units or one that counts lines', async () => {
    document.body.innerHTML = cartPage(cartRow('111111111', 5), 5);
    expect(await read(['111111111'])).toEqual([{ key: '111111111', quantity: 5 }]);
    document.body.innerHTML = cartPage(cartRow('111111111', 5), 1);
    expect(await read(['111111111'])).toEqual([{ key: '111111111', quantity: 5 }]);
  });
  it('stops at a row with no quantity or no readable item', async () => {
    document.body.innerHTML = cartPage('<div data-component="cart-item:CartItem:v2"><a href="/p/Test/111111111">Thing</a></div>', 1);
    expect(await read(['111111111'])).toMatchObject({ kind: 'stop', detail: 'a cart line with no quantity' });
    document.body.innerHTML = cartPage('<div data-component="cart-item:CartItem:v2"><input class="sui-input-base-input" value="1"></div>', 1);
    expect(await read(['111111111'])).toMatchObject({ kind: 'stop', detail: 'a cart line this could not read' });
  });
  it('stops at a page with no rows and no sign of being empty', async () => {
    document.body.innerHTML = '<h1>Something else</h1>';
    expect(await read(['111111111'])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('stops at the Oops page and at a sign-in', async () => {
    document.title = 'Error Page';
    document.body.innerHTML = OOPS;
    expect(await read(['111111111'])).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    document.title = '';
    document.body.innerHTML = '<input type="password">';
    expect(await read(['111111111'])).toMatchObject({ kind: 'stop', reason: 'login' });
  });
});

describe('the shared page check and the Oops page', () => {
  it('stops the store on the title alone, and on the words alone', () => {
    document.title = 'Error Page';
    document.body.innerHTML = '<p>Anything</p>';
    expect(inspectPage()).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    document.title = 'Cart';
    document.body.innerHTML = OOPS;
    Object.defineProperty(document.body, 'innerText', { value: 'Oops!! Something went wrong. Please refresh page Refresh', configurable: true });
    expect(inspectPage()).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    delete (document.body as unknown as Record<string, unknown>).innerText;
  });
  it('leaves a long page that happens to say it alone', () => {
    document.title = 'Project guide';
    Object.defineProperty(document.body, 'innerText', { value: `Oops! Something went wrong with my deck. ${'word '.repeat(600)}`, configurable: true });
    expect(inspectPage()).toEqual({ kind: 'ok' });
    delete (document.body as unknown as Record<string, unknown>).innerText;
  });
});
