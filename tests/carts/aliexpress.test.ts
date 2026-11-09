// Ali Express's steps against a synthetic store in jsdom, built from what was seen in a signed-in browser. No real store is contacted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStore, checklistResult, marksFor } from '../../src/carts/runner';
import { allowedInTab, isForbiddenUrl } from '../../src/carts/safety';
import { blockedReason } from '../../src/carts/selection';
import { type StoreTab } from '../../src/carts/store-method';
import { aliexpress, aliexpressItem, aliexpressKey, aliexpressPressAdd, aliexpressReadCart, aliexpressReadListing, chooseAliexpressOptions, descriptionNames, isAliexpressListing, isUsdPrice, type AliRow } from '../../src/carts/stores/aliexpress';
import { VENDORS, vendorForUrl } from '../../src/vendors';
import { order, options } from './helpers';

const ITEM = '3256802967050384';
const LISTING = `https://www.aliexpress.us/item/${ITEM}.html`;
const PATH = `/item/${ITEM}.html`;
const CART_PATH = '/p/shoppingcart/index.html';
const WIRE = '0.8mm (5Meter)', THICK = '1.0mm (5Meter)';
const aliOrder = (extra = {}) => order({ vendor: 'Ali Express', urlVendor: 'Ali Express', sku: null, productUrl: LISTING, quantity: 2, unitPrice: null, description: `Solder wire - Size: ${WIRE}`, ...extra });
const steps = aliexpress.steps!;
const at = (path: string) => window.history.pushState({}, '', path);
const col = (name: string, selected = false, extra = '') => `<div data-sku-col="1-${name.length}" title="${name}" class="sku-item--text--x${selected ? ' sku-item--selected--x' : ''}${extra}"><span>${name}</span></div>`;
const skuRow = (cols: string) => `<div data-sku-row="1">${cols}</div>`;
const listingPage = (rows: string, price = '$0.46', button = '<button id="add"><span>Add to cart</span></button>') => `<h1>Solder wire</h1><div class="price--current--x">${price}</div>${rows}<input class="comet-v2-input-number-input" value="1"><button id="buy">Buy now</button>${button}`;
const cartRow = (item: string, optionText: string, quantity: number) => `<div class="cart-product"><a href="//www.aliexpress.us/item/${item}.html?x=1">Solder wire ${optionText ? '' : 'plain'}</a><div class="cart-product-sku--x">${optionText}</div><input class="comet-v2-input-number-input" value="${quantity}"><button class="trash">x</button></div>`;
const cartPage = (rows: string, count: number) => `<h1>Cart (${count})</h1><label><input type="checkbox" id="tick">Select all</label>${rows}<button id="checkout">Checkout</button>`;
const PUNISH = '<iframe src="https://www.aliexpress.us/_____tmd_____/punish?x5secdata=test"></iframe>';

/** The store in small. Clicking an option selects it, and clicking it again takes that away. Add accumulates per item and option. */
function fakeSite(config: { rowsHtml?: string; price?: string; stock?: number; wallOn?: 'cart' | 'product'; wallHtml?: string; refuseSelect?: boolean } = {}) {
  const cart = new Map<string, number>();
  const log = { gotos: [] as string[], adds: [] as [string, number][], buy: 0, checkout: 0, ticks: 0, optionClicks: [] as string[] };
  const tab: StoreTab = {
    async goto(url) {
      log.gotos.push(url);
      const path = new URL(url).pathname;
      at(path);
      const isCart = path === CART_PATH;
      if (config.wallOn === (isCart ? 'cart' : 'product')) { document.body.innerHTML = config.wallHtml ?? PUNISH; return; }
      if (isCart) {
        const count = [...cart.values()].length;
        document.body.innerHTML = cartPage([...cart].map(([key, quantity]) => cartRow(ITEM, key, quantity)).join(''), count);
        document.getElementById('tick')!.addEventListener('click', () => log.ticks++);
        document.getElementById('checkout')!.addEventListener('click', () => log.checkout++);
        return;
      }
      document.body.innerHTML = listingPage(config.rowsHtml ?? skuRow(col(WIRE) + col(THICK, true)), config.price);
      document.querySelectorAll('[data-sku-col]').forEach(node => node.addEventListener('click', () => {
        log.optionClicks.push(node.getAttribute('title')!);
        if (config.refuseSelect) return;
        node.parentElement!.querySelectorAll('[data-sku-col]').forEach(other => { if (other !== node) other.className = 'sku-item--text--x'; });
        node.className = /selected/.test(node.className) ? 'sku-item--text--x' : 'sku-item--text--x sku-item--selected--x';
      }));
      document.getElementById('buy')!.addEventListener('click', () => log.buy++);
      document.getElementById('add')!.addEventListener('click', () => {
        const asked = Number(document.querySelector<HTMLInputElement>('input')!.value);
        const name = document.querySelector('[data-sku-col][class*="selected"]')?.getAttribute('title') ?? '';
        log.adds.push([name, asked]);
        cart.set(name, Math.min((cart.get(name) ?? 0) + asked, config.stock ?? Infinity));
      });
    },
    async run(func, ...args) {
      if ((func as unknown) === aliexpressPressAdd) { const [item, wanted, quantity] = args as unknown as [string, string[], number]; return await aliexpressPressAdd(item, wanted, quantity, 200, 50) as never; }
      if ((func as unknown) === aliexpressReadListing) return await aliexpressReadListing((args as unknown as [string])[0], 200) as never;
      if ((func as unknown) === aliexpressReadCart) return await aliexpressReadCart((args as unknown as [string[]])[0], 300, 20) as never;
      return await func(...args) as never;
    },
    async runThenLoad(func, ...args) { return await func(...args) as never; },
  };
  return { cart, log, tab };
}
const build = (tab: StoreTab, orders = [aliOrder()]) => buildStore(aliexpress, steps, orders, tab, options);
const option = (name: string, extra: Partial<AliRow[number]> = {}) => ({ name, selected: false, soldOut: false, ...extra });

beforeEach(() => { vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 40 } as DOMRect); });
afterEach(() => { vi.restoreAllMocks(); document.title = ''; document.body.replaceChildren(); at('/'); });

describe('Ali Express: what it is', () => {
  it('is item by item and asks only for its own two sites', () => {
    expect(aliexpress).toMatchObject({ id: 'aliexpress', badge: 'item', origins: ['https://www.aliexpress.us/*', 'https://www.aliexpress.com/*'] });
    expect(steps.foreground).toBe(true);
  });
  it('matches the vendor list: same label and the same hosts, including aliexpress.us', () => {
    const vendor = VENDORS.find(v => v.id === 'aliexpress')!;
    expect(aliexpress.label).toBe(vendor.label);
    expect(aliexpress.hosts).toEqual(vendor.hosts);
    expect(vendorForUrl(LISTING)?.label).toBe(aliexpress.label);
    expect(vendorForUrl('https://www.aliexpress.com/item/1.html')?.label).toBe(aliexpress.label);
  });
  it('its start and cart links are the cart, on the store, and never checkout', () => {
    expect(aliexpress.cartUrl).toBe('https://www.aliexpress.us/p/shoppingcart/index.html');
    expect(aliexpress.startUrl).toBe(aliexpress.cartUrl);
    expect(allowedInTab(aliexpress, aliexpress.cartUrl!)).toBe(true);
    expect(isForbiddenUrl(aliexpress.cartUrl!)).toBe(false);
  });
  it('accepts a link to one listing, on either site', () => {
    expect(isAliexpressListing(LISTING)).toBe(true);
    expect(aliexpressItem('https://www.aliexpress.com/item/1000000000000000.html?sku_id=1')).toBe('1000000000000000');
    expect(blockedReason(aliOrder(), aliexpress)).toBeNull();
  });
  it('blocks a link that doesn\'t say which item, or isn\'t the store\'s', () => {
    for (const link of ['https://www.aliexpress.us/w/wholesale-test.html', 'https://www.aliexpress.us/store/1', 'https://aliexpress.example.test/item/1.html', 'http://www.aliexpress.us/item/1.html', 'not a link']) {
      expect(isAliexpressListing(link), link).toBe(false);
      expect(blockedReason(aliOrder({ productUrl: link }), aliexpress), link).toMatch(/a link to one Ali Express listing/);
    }
  });
  it('needs a link and a quantity, and no SKU', () => {
    expect(blockedReason(aliOrder({ productUrl: null }), aliexpress)).toMatch(/a product link/);
    expect(blockedReason(aliOrder({ quantity: null }), aliexpress)).toMatch(/a quantity/);
  });
  it('with no store access it gives the person a checklist line, and marks nothing', () => {
    const result = checklistResult(aliexpress, [aliOrder()], { noAccess: true });
    expect(result.badge).toBe('checklist');
    expect(result.items).toMatchObject([{ outcome: 'checklist', confirmed: false }]);
  });
  it('US dollars only', () => {
    for (const price of ['$0.46', 'US $8.50', 'US$8.50', ' $1,234.00 ']) expect(isUsdPrice(price), price).toBe(true);
    for (const price of ['€8.50', 'CA$8.50', 'C$8.50', 'AU $8.50', '8.50', '¥60', '']) expect(isUsdPrice(price), price).toBe(false);
  });
});

describe('Ali Express: matching the saved option', () => {
  it('finds an option standing on its own, the way the reader writes it', () => {
    for (const text of [WIRE, `Solder wire - ${WIRE}`, `Solder wire - Size: ${WIRE}`, `Solder wire - Size: ${WIRE} / Ships From: China`, `Solder wire - Ships From: China / ${WIRE}`]) expect(descriptionNames(text, WIRE), text).toBe(true);
  });
  it('doesn\'t count the words inside something else', () => {
    expect(descriptionNames('Solder wire 0.8mm (5Meter)', WIRE)).toBe(false);
    expect(descriptionNames(`Solder wire - ${WIRE} extra`, WIRE)).toBe(false);
    expect(descriptionNames('Wire - 0.8mm (5Meter)', '0.8mm')).toBe(false);
    expect(descriptionNames('Wire - 10.8mm', '0.8mm')).toBe(false);
    expect(descriptionNames('Wire - 0.8MM (5METER)', WIRE)).toBe(false);
    expect(descriptionNames('Wire', '')).toBe(false);
  });
  it('picks the one named option in each row', () => {
    expect(chooseAliexpressOptions(`Wire - Size: ${WIRE} / Color: Black`, [[option(WIRE), option(THICK)], [option('Black'), option('Red')]])).toEqual([WIRE, 'Black']);
  });
  it('refuses when none match, even with one already selected', () => {
    expect(() => chooseAliexpressOptions('Solder wire', [[option(WIRE, { selected: true }), option(THICK)]])).toThrow(/doesn't exactly name/);
  });
  it('refuses an empty description', () => {
    expect(() => chooseAliexpressOptions(null, [[option(WIRE), option(THICK)]])).toThrow(/doesn't exactly name/);
  });
  it('refuses when two options in a row match', () => {
    expect(() => chooseAliexpressOptions('Wire - Red / Blue', [[option('Red'), option('Blue')]])).toThrow(/more than one/);
  });
  it('refuses when a listing shows the same name twice', () => {
    expect(() => chooseAliexpressOptions('Wire - Red', [[option('Red'), option('Red')]])).toThrow(/more than one|twice/);
  });
  it('refuses a sold-out match and a nameless option', () => {
    expect(() => chooseAliexpressOptions('Wire - Red', [[option('Red', { soldOut: true }), option('Blue')]])).toThrow(/sold out/);
    expect(() => chooseAliexpressOptions('Wire - Red', [[option('Red'), option('')]])).toThrow(/no readable name/);
  });
  it('refuses when only one row of two is named', () => {
    expect(() => chooseAliexpressOptions('Wire - Red', [[option('Red'), option('Blue')], [option('S'), option('M')]])).toThrow(/doesn't exactly name/);
  });
  it('lets a row with one selected option pass unsaid, but not an unselected one', () => {
    expect(chooseAliexpressOptions('Wire - Red', [[option('Red'), option('Blue')], [option('China', { selected: true })]])).toEqual(['Red']);
    expect(() => chooseAliexpressOptions('Wire - Red', [[option('Red'), option('Blue')], [option('China')]])).toThrow(/doesn't exactly name/);
  });
  it('a listing with no options has nothing to match', () => {
    expect(chooseAliexpressOptions('Anything', [])).toEqual([]);
  });
});

describe('Ali Express: a build', () => {
  it('clicks the named option, confirms it, sets the quantity and presses only Add to cart', async () => {
    const { cart, log, tab } = fakeSite();
    const result = await build(tab);
    expect(log.optionClicks).toEqual([WIRE]);
    expect(log.adds).toEqual([[WIRE, 2]]);
    expect(cart.get(WIRE)).toBe(2);
    expect(log).toMatchObject({ buy: 0, checkout: 0, ticks: 0 });
    expect(result.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(log.gotos).toEqual([LISTING, 'https://www.aliexpress.us/p/shoppingcart/index.html', LISTING, 'https://www.aliexpress.us/p/shoppingcart/index.html']);
  });
  it('goes to the .us listing whichever site the link was saved from', async () => {
    const { log, tab } = fakeSite();
    await build(tab, [aliOrder({ productUrl: `https://www.aliexpress.com/item/${ITEM}.html?sku_id=7` })]);
    expect(log.gotos[0]).toBe(LISTING);
  });
  it('doesn\'t click an option that\'s already selected, because that could undo it', async () => {
    const { log, tab } = fakeSite({ rowsHtml: skuRow(col(WIRE, true) + col(THICK)) });
    await build(tab);
    expect(log.optionClicks).toEqual([]);
    expect(log.adds).toEqual([[WIRE, 2]]);
  });
  it('says the store ticks new items, and never touches a tick', async () => {
    const { log, tab } = fakeSite();
    const result = await build(tab);
    expect(result.resultNote).toMatch(/ticks a newly added item for checkout by itself/);
    expect(log.ticks).toBe(0);
  });
  it('a retry adds nothing', async () => {
    const { cart, log, tab } = fakeSite();
    await build(tab);
    const again = await build(tab);
    expect(log.adds).toEqual([[WIRE, 2]]);
    expect(cart.get(WIRE)).toBe(2);
    expect(again.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: 'Already in the cart: it holds 2, so nothing was added.' });
  });
  it('adds accumulate, so only the difference goes in', async () => {
    const { cart, log, tab } = fakeSite();
    cart.set(WIRE, 1);
    await build(tab, [aliOrder({ quantity: 3 })]);
    expect(log.adds).toEqual([[WIRE, 2]]);
    expect(cart.get(WIRE)).toBe(3);
  });
  it('another option of the same listing in the cart doesn\'t count as this one', async () => {
    const { cart, log, tab } = fakeSite();
    cart.set(THICK, 5);
    const result = await build(tab);
    expect(log.adds).toEqual([[WIRE, 2]]);
    expect(cart.get(WIRE)).toBe(2);
    expect(cart.get(THICK)).toBe(5);
    expect(result.items[0].confirmed).toBe(true);
  });
  it('a read-back that doesn\'t match is short stock, and isn\'t marked', async () => {
    const { tab } = fakeSite({ stock: 1 });
    const result = await build(tab);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/Short stock: asked for 2, and the cart holds 1/) });
    expect(marksFor(result)).toEqual([]);
  });
  it('a robot check on the cart stops the store, and the rest become links', async () => {
    const { log, tab } = fakeSite({ wallOn: 'cart' });
    const result = await build(tab, [aliOrder({ id: 'a' }), aliOrder({ id: 'b' })]);
    expect(result.stopped?.reason).toBe('bot-check');
    expect(log.adds).toEqual([]);
    expect(result.items.map(item => item.outcome)).toEqual(['checklist', 'checklist']);
  });
  it('a robot check on the listing stops the store', async () => {
    const { log, tab } = fakeSite({ wallOn: 'product' });
    const result = await build(tab);
    expect(result.stopped?.reason).toBe('bot-check');
    expect(log.adds).toEqual([]);
  });
  it('a sign-in stops the store', async () => {
    const { log, tab } = fakeSite({ wallOn: 'product', wallHtml: '<div role="dialog"><h2>Sign in</h2><input type="password"></div>' });
    const result = await build(tab);
    expect(result.stopped?.reason).toBe('login');
    expect(log.adds).toEqual([]);
  });
  it('no exact option in the description fails the line, with nothing clicked', async () => {
    const { log, tab } = fakeSite();
    const result = await build(tab, [aliOrder({ description: 'Solder wire 0.8mm' })]);
    expect(result.stopped).toBeUndefined();
    expect(result.items[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/doesn't exactly name/) });
    expect(log.optionClicks).toEqual([]);
    expect(log.adds).toEqual([]);
  });
  it('an ambiguous description fails the line, with nothing clicked', async () => {
    const { log, tab } = fakeSite();
    const result = await build(tab, [aliOrder({ description: `Solder wire - ${WIRE} / ${THICK}` })]);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/more than one/) });
    expect(log.optionClicks).toEqual([]);
  });
  it('an option that won\'t stay selected fails the line, with Add to cart unpressed', async () => {
    const { log, tab } = fakeSite({ refuseSelect: true });
    const result = await build(tab);
    expect(result.items[0]).toMatchObject({ outcome: 'failed' });
    expect(log.adds).toEqual([]);
  });
  it.each(['€8.50', 'CA$8.50', ''])('a price of "%s" fails the line', async price => {
    const { log, tab } = fakeSite({ price });
    const result = await build(tab);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/US dollars/) });
    expect(log.gotos).toEqual([LISTING]);
    expect(log.adds).toEqual([]);
  });
  it('a sold-out option fails the line', async () => {
    const { log, tab } = fakeSite({ rowsHtml: skuRow(col(WIRE, false, ' sku-item--soldOut--x') + col(THICK)) });
    const result = await build(tab);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/sold out/) });
    expect(log.adds).toEqual([]);
  });
});

describe('Ali Express: pressing Add to cart', () => {
  it('refuses a label that only contains the words, and never takes Buy now', async () => {
    at(PATH);
    document.body.innerHTML = listingPage('', '$1.00', '<button id="add">Add to cart now</button>');
    const buy = vi.fn();
    document.getElementById('buy')!.addEventListener('click', buy);
    expect(await aliexpressPressAdd(ITEM, [], 1, 50, 10)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/no Add to cart/) });
    expect(buy).not.toHaveBeenCalled();
  });
  it('refuses two Add to cart buttons', async () => {
    at(PATH);
    document.body.innerHTML = listingPage('', '$1.00', '<button>Add to cart</button><button>Add to cart</button>');
    expect(await aliexpressPressAdd(ITEM, [], 1, 50, 10)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/one clear Add to cart/) });
  });
  it('refuses a price that changes away from US dollars once the option is chosen', async () => {
    at(PATH);
    document.body.innerHTML = listingPage(skuRow(col(WIRE, true) + col(THICK)), '€1.00');
    expect(await aliexpressPressAdd(ITEM, [WIRE], 1, 50, 10)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/US dollars/) });
  });
  it('refuses an option no longer on the page', async () => {
    at(PATH);
    document.body.innerHTML = listingPage(skuRow(col(THICK, true) + col('2.0mm')));
    expect(await aliexpressPressAdd(ITEM, [WIRE], 1, 50, 10)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/no longer shows/) });
  });
  it('refuses when the quantity box won\'t take the number', async () => {
    at(PATH);
    document.body.innerHTML = listingPage('');
    const box = document.querySelector<HTMLInputElement>('input')!;
    box.addEventListener('input', () => { box.value = '1'; });
    expect(await aliexpressPressAdd(ITEM, [], 5, 50, 10)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/would not take 5/) });
  });
  it('refuses a page for another listing', async () => {
    at('/item/999.html');
    document.body.innerHTML = listingPage('');
    expect(await aliexpressPressAdd(ITEM, [], 1, 50, 10)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/different page/) });
  });
  it('a robot check drawn after the press is a stop that may have sent', async () => {
    at(PATH);
    document.body.innerHTML = listingPage('');
    document.getElementById('add')!.addEventListener('click', () => document.body.insertAdjacentHTML('beforeend', PUNISH));
    const answer = await aliexpressPressAdd(ITEM, [], 1, 50, 300);
    expect(answer).toMatchObject({ kind: 'stop', reason: 'bot-check', notSent: false });
  });
});

describe('Ali Express: reading a listing', () => {
  it('reads each option\'s name, whether it\'s selected, and the price', async () => {
    at(PATH);
    document.body.innerHTML = listingPage(skuRow(col(WIRE, true) + col(THICK)));
    expect(await aliexpressReadListing(ITEM, 50)).toEqual({ kind: 'ok', price: '$0.46', rows: [[{ name: WIRE, selected: true, soldOut: false }, { name: THICK, selected: false, soldOut: false }]] });
  });
  it('an image option can hold its name on an inner element', async () => {
    at(PATH);
    document.body.innerHTML = listingPage('<div data-sku-row="1"><div data-sku-col="1-1"><img title="Black"></div></div>');
    expect(await aliexpressReadListing(ITEM, 50)).toMatchObject({ rows: [[{ name: 'Black' }]] });
  });
  it('option controls it can\'t read don\'t pass as a listing with none', async () => {
    at(PATH);
    document.body.innerHTML = listingPage('<div class="sku-item--property--x"><div>Color</div></div>');
    expect(await aliexpressReadListing(ITEM, 50)).toMatchObject({ kind: 'not-offered' });
    document.body.innerHTML = listingPage('<div data-sku-row="1"></div>');
    expect(await aliexpressReadListing(ITEM, 50)).toMatchObject({ kind: 'not-offered' });
  });
  it('a listing with no options reads as an empty list', async () => {
    at(PATH);
    document.body.innerHTML = listingPage('');
    expect(await aliexpressReadListing(ITEM, 50)).toMatchObject({ kind: 'ok', rows: [] });
  });
  it('a product whose name says robot isn\'t a robot check', async () => {
    at(PATH);
    document.title = 'Robot arm bracket - AliExpress';
    document.body.innerHTML = listingPage('');
    expect(await aliexpressReadListing(ITEM, 50)).toMatchObject({ kind: 'ok' });
  });
  it.each(['<iframe src="https://x.test/_____tmd_____/punish"></iframe>', '<div id="baxia-dialog-content"></div>', '<p>Please slide to verify</p>'])('%s is a bot check', async html => {
    at(PATH);
    document.body.innerHTML = html;
    expect(await aliexpressReadListing(ITEM, 50)).toMatchObject({ kind: 'stop', reason: 'bot-check' });
  });
  it('no Add to cart button means the line can\'t be added', async () => {
    at(PATH);
    document.body.innerHTML = '<h1>Sold out</h1>';
    expect(await aliexpressReadListing(ITEM, 50)).toMatchObject({ kind: 'not-offered' });
  });
});

describe('Ali Express: reading the cart', () => {
  beforeEach(() => at(CART_PATH));
  const rowsWith = (names: string[]): AliRow[] => [names.map(name => option(name))];
  const keyFor = (item: string, pick: string[], names: string[]) => aliexpressKey(item, pick, rowsWith(names));
  const read = (keys: string[]) => aliexpressReadCart(keys, 200, 10);
  const wire = keyFor(ITEM, [WIRE], [WIRE, THICK]);
  it('needs both the item and the option', async () => {
    document.body.innerHTML = cartPage(cartRow(ITEM, THICK, 4) + cartRow(ITEM, WIRE, 2) + cartRow('999', WIRE, 9), 3);
    expect(await read([wire])).toEqual([{ key: wire, quantity: 2 }]);
  });
  it('a longer item number isn\'t this item', async () => {
    document.body.innerHTML = cartPage(cartRow(`9${ITEM}`, WIRE, 9), 1);
    expect(await read([wire])).toEqual([]);
  });
  it('doesn\'t find a short option inside a longer one', async () => {
    const short = keyFor(ITEM, ['0.8mm'], ['0.8mm', WIRE]);
    document.body.innerHTML = cartPage(cartRow(ITEM, WIRE, 2), 1);
    expect(await read([short])).toEqual([]);
  });
  it('stops when a row of this item names no known option, since it could be this line', async () => {
    document.body.innerHTML = cartPage(cartRow(ITEM, 'Written differently', 2), 1);
    expect(await read([wire])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('a row of two rows\' options counts only with both', async () => {
    const rows = [[option('Black'), option('Red')], [option('S'), option('M')]];
    const key = aliexpressKey(ITEM, ['Black', 'M'], rows);
    document.body.innerHTML = cartPage(cartRow(ITEM, 'Black, S', 1) + cartRow(ITEM, 'Black, M', 3), 2);
    expect(await read([key])).toEqual([{ key, quantity: 3 }]);
  });
  it('a single-option row left unwritten in the cart doesn\'t hide the line', async () => {
    const rows = [[option(WIRE), option(THICK)], [option('China', { selected: true })]];
    const key = aliexpressKey(ITEM, [WIRE], rows);
    document.body.innerHTML = cartPage(cartRow(ITEM, WIRE, 2), 1);
    expect(await read([key])).toEqual([{ key, quantity: 2 }]);
  });
  it('a listing with no options counts any row of that item', async () => {
    const key = aliexpressKey(ITEM, [], []);
    document.body.innerHTML = cartPage(cartRow(ITEM, '', 2), 1);
    expect(await read([key])).toEqual([{ key, quantity: 2 }]);
  });
  it('an empty cart reads empty, from its title', async () => {
    document.body.innerHTML = '<h1>Cart (0)</h1>';
    expect(await read([wire])).toEqual([]);
  });
  it('stops rather than read zero when the title says there are rows it can\'t see', async () => {
    document.body.innerHTML = '<h1>Cart (2)</h1>';
    expect(await read([wire])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('stops at a row with no quantity', async () => {
    document.body.innerHTML = cartPage(`<div class="cart-product"><a href="/item/${ITEM}.html">x</a>${WIRE}</div>`, 1);
    expect(await read([wire])).toMatchObject({ kind: 'stop', detail: 'a cart line with no quantity' });
  });
  it('stops at a page that isn\'t the cart, and at walls', async () => {
    at('/other');
    expect(await read([wire])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
    at(CART_PATH);
    document.body.innerHTML = PUNISH;
    expect(await read([wire])).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    document.body.innerHTML = '<input type="password">';
    expect(await read([wire])).toMatchObject({ kind: 'stop', reason: 'login' });
  });
});
