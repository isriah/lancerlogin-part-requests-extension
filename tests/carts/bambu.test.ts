// BambuLab's injected functions and steps, against synthetic pages shaped like the real ones. No real store is contacted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectPage } from '../../src/carts/page-check';
import { buildStore } from '../../src/carts/runner';
import { allowedInTab } from '../../src/carts/safety';
import { LineProblem, StoreStop, type StoreTab } from '../../src/carts/store-method';
import { bambu, bambuAddOnPage, bambuLink, bambuProductUrl, bambuReadCart, bambuReadProduct, chooseBambuVariant } from '../../src/carts/stores/bambu';
import { hereTab, options, order } from './helpers';

const HOME = 'https://us.store.bambulab.com';
const WHITE = '111', BEIGE = '222', GONE = '333';
const product = (extra = {}) => ({
  '@context': 'https://schema.org', '@type': 'ProductGroup', name: 'Test Filament', url: `${HOME}/products/test-filament`,
  hasVariant: [
    { '@type': 'Product', name: 'Test Filament - White (1) / Refill / 1kg', sku: WHITE, offers: { availability: 'https://schema.org/InStock', price: 5 } },
    { '@type': 'Product', name: 'Test Filament - Beige (2) / Refill / 1kg', sku: BEIGE, offers: [{ availability: 'https://schema.org/InStock', price: 5 }] },
    { '@type': 'Product', name: 'Test Filament - Gone (3) / Refill / 1kg', sku: GONE, offers: { availability: 'https://schema.org/OutOfStock', price: 5 } },
  ], ...extra,
});
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const selected = (option: string, count = 1) => `<button type="button" class="summary"><span><span>Selected</span><span>：</span></span><span>${option}</span><span>× ${count}</span></button>`;
const quantityBox = () => '<div class="space-y-content-3"><div>Quantity</div><div><button type="button" data-action="decrease-quantity">-</button><input name="quantity" value="1"><button type="button">+</button></div></div>';
const bundleBox = '<div class="bundle"><div><button>-</button><input name="quantity" value="1"><button>+</button></div><button id="bundle">Checkout Bundle</button></div>';
/** A product page: the buttons a person sees, a bundle with its own quantity box, and the cart count in the header. */
const page = (option = 'Beige (2) / Refill / 1kg', controls = '<button id="add">Add to Cart</button><button id="buy">Buy Now</button>') =>
  `${ld(product())}<a href="/cart" id="count"></a><h1>Test Filament</h1>${selected(option)}${quantityBox()}${controls}${bundleBox}`;
/** Behaves like the real page: the box only counts once it loses focus, and the summary shows what counts. The limit is the page's own. */
function liveQuantity(limit = 400): { counted: () => number } {
  let counted = 1;
  const box = document.querySelector('input[data-main], [data-action="decrease-quantity"] ~ input') as HTMLInputElement;
  box.addEventListener('focusout', () => {
    counted = Math.min(Number(box.value) || 1, limit);
    box.value = String(counted);
    document.querySelector('.summary span:last-child')!.textContent = `× ${counted}`;
  });
  return { counted: () => counted };
}
/** What a press of Add to Cart does: the cart count in the header goes up by what the page has counted. */
function liveAdd(counted: () => number) {
  const sent: number[] = [];
  document.getElementById('add')!.addEventListener('click', () => { sent.push(counted()); document.getElementById('count')!.textContent = String(sent.reduce((a, b) => a + b, 0)); });
  return sent;
}
/** One visible cart row, and the hidden copy for another screen size, as the real page has them. */
const cartRow = (title: string, option: string, quantity: number, price = '$5.00', hidden = false) => `<div class="${hidden ? 'copy-hidden' : ''}"><div class="row"><div><div><h3>${title}</h3><p>${option}</p></div></div><div><span>${price}</span><div><button disabled>-</button><input maxlength="9" type="text" value="${quantity}"><button>+</button></div></div><button><span>Add 1 more · Get 10% off</span></button></div></div>`;
const cartPage = (rows: string) => `<a href="/cart">3</a><p>Log in to synchronize the items in your shopping cart.</p>${rows}<button id="checkout">Checkout 1 item</button><h2>- You may also like -</h2><div class="suggestions"><div><h3>Test Filament</h3><p>Beige (2) / Refill / 1kg</p></div><div><h3>Other Thing</h3></div></div>`;
const EMPTY = '<p>Log in to synchronize the items in your shopping cart.</p><div>Your shopping cart is empty. Discover great items .</div>';

beforeEach(() => {
  // Layout that hides the other screen size's copy, since jsdom has none of its own.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return (this.closest('.copy-hidden') ? { width: 0, height: 0 } : { width: 100, height: 40 }) as DOMRect;
  });
  history.pushState({}, '', `/products/test-filament?id=${BEIGE}`);
});
afterEach(() => { vi.restoreAllMocks(); document.title = ''; document.head.replaceChildren(); document.body.replaceChildren(); });

describe('the saved link', () => {
  it('reads the product and option', () => {
    expect(bambuLink(`${HOME}/products/test-filament?id=${BEIGE}`)).toEqual({ handle: 'test-filament', id: BEIGE });
    expect(bambuLink(`${HOME}/products/test-filament?from=home`)).toEqual({ handle: 'test-filament', id: null });
    expect(bambuLink(`${HOME}/collections/accessories`)).toBeNull();
    expect(bambuLink(`${HOME}/products/test-filament?id=beige`)).toBeNull();
  });
  it('blocks a link off the store, and allows one on it', () => {
    expect(bambu.missing!(order({ productUrl: 'https://example.test/products/x' }))).toHaveLength(1);
    expect(bambu.missing!(order({ productUrl: `${HOME}/products/test-filament` }))).toEqual([]);
    expect(allowedInTab(bambu, bambuProductUrl('test-filament', BEIGE))).toBe(true);
    expect(allowedInTab(bambu, `${HOME}/checkout`)).toBe(false);
    expect(bambu.origins).toEqual([`${HOME}/*`]);
  });
});
describe('choosing the option', () => {
  const variants = [{ id: WHITE, name: 'White', available: true }, { id: BEIGE, name: 'Beige', available: true }];
  it('uses the saved option, confirmed by SKU', () => {
    expect(chooseBambuVariant(variants, BEIGE, BEIGE).id).toBe(BEIGE);
    expect(() => chooseBambuVariant(variants, BEIGE, WHITE)).toThrow(LineProblem);
    expect(() => chooseBambuVariant(variants, GONE, null)).toThrow(/no longer has/);
  });
  it('falls back to an exact SKU, and never a near one', () => {
    expect(chooseBambuVariant(variants, null, ` ${WHITE} `).id).toBe(WHITE);
    expect(() => chooseBambuVariant(variants, null, '11')).toThrow(/No option/);
  });
  it('won\'t guess between options', () => {
    expect(() => chooseBambuVariant(variants, null, null)).toThrow(/several options/);
    expect(chooseBambuVariant([variants[0]], null, null).id).toBe(WHITE);
  });
  it('refuses two options the cart couldn\'t tell apart', () => {
    expect(() => chooseBambuVariant([variants[0], { ...variants[1], name: 'White' }], WHITE, null)).toThrow(/same name/);
  });
});
describe('reading the product', () => {
  it('reads the options and only those fields', async () => {
    document.body.innerHTML = page();
    expect(await bambuReadProduct('test-filament', 0)).toEqual({ kind: 'ok', variants: [
      { id: WHITE, name: 'Test Filament - White (1) / Refill / 1kg', available: true },
      { id: BEIGE, name: 'Test Filament - Beige (2) / Refill / 1kg', available: true },
      { id: GONE, name: 'Test Filament - Gone (3) / Refill / 1kg', available: false },
    ] });
  });
  it('doesn\'t accept another product\'s page, or a page with no list', async () => {
    document.body.innerHTML = page();
    expect(await bambuReadProduct('another-part', 0)).toEqual({ kind: 'not-listed' });
    document.body.innerHTML = '<h1>Page not found</h1>';
    expect(await bambuReadProduct('test-filament', 0)).toEqual({ kind: 'not-listed' });
  });
  it('stops at a bot check that draws itself after loading', async () => {
    document.title = 'Just a moment...';
    expect(await bambuReadProduct('test-filament', 0)).toMatchObject({ kind: 'stop', reason: 'bot-check' });
  });
});
describe('resolving a line', () => {
  it('resolves to the option named in the link', async () => {
    document.body.innerHTML = page();
    const target = await bambu.steps!.resolveLine(order({ vendor: 'BambuLab', sku: BEIGE, productUrl: `${HOME}/products/test-filament?id=${BEIGE}` }), hereTab);
    expect(target).toEqual({ key: 'Test Filament - Beige (2) / Refill / 1kg', addAs: `${HOME}/products/test-filament?id=${BEIGE}` });
  });
  it('resolves by SKU when the link names no option', async () => {
    document.body.innerHTML = page();
    expect((await bambu.steps!.resolveLine(order({ sku: WHITE, productUrl: `${HOME}/products/test-filament` }), hereTab)).addAs).toBe(`${HOME}/products/test-filament?id=${WHITE}`);
  });
  it('an ambiguous item is refused', async () => {
    document.body.innerHTML = page();
    await expect(bambu.steps!.resolveLine(order({ sku: null, productUrl: `${HOME}/products/test-filament` }), hereTab)).rejects.toThrow(/several options/);
    await expect(bambu.steps!.resolveLine(order({ sku: 'TYPED-BY-HAND', productUrl: `${HOME}/products/test-filament` }), hereTab)).rejects.toThrow(LineProblem);
  });
  it('an option the store lists as out of stock is a line problem', async () => {
    document.body.innerHTML = page();
    await expect(bambu.steps!.resolveLine(order({ sku: null, productUrl: `${HOME}/products/test-filament?id=${GONE}` }), hereTab)).rejects.toThrow(/out of stock/);
  });
});
describe('adding on the page', () => {
  const KEY = 'Test Filament - Beige (2) / Refill / 1kg';
  it('sets the main box, waits for the page to take it, and presses only Add to Cart', async () => {
    document.body.innerHTML = page();
    const { counted } = liveQuantity();
    const sent = liveAdd(counted);
    const never = vi.fn();
    document.getElementById('buy')!.addEventListener('click', never);
    document.getElementById('bundle')!.addEventListener('click', never);
    expect(await bambuAddOnPage(BEIGE, KEY, 2, 2000)).toEqual({ kind: 'sent', cartRose: true });
    expect(sent).toEqual([2]);
    expect(never).not.toHaveBeenCalled();
    expect((document.querySelector('.bundle input') as HTMLInputElement).value).toBe('1');
  });
  it('doesn\'t press when the page never takes the quantity, as with an input event alone', async () => {
    document.body.innerHTML = page();
    const sent = liveAdd(() => 1);
    expect(await bambuAddOnPage(BEIGE, KEY, 2, 500)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/quantity of 2/) });
    expect(sent).toEqual([]);
  });
  it('sends the capped number when the page has its own limit, for the read-back to report', async () => {
    document.body.innerHTML = page();
    const { counted } = liveQuantity(400);
    const sent = liveAdd(counted);
    expect(await bambuAddOnPage(BEIGE, KEY, 999, 2000)).toMatchObject({ kind: 'sent' });
    expect(sent).toEqual([400]);
  });
  it('Notify Me When Available is a refusal, and nothing is pressed', async () => {
    document.body.innerHTML = page('Beige (2) / Refill / 1kg', '<button id="notify">Notify Me When Available</button>');
    const notify = vi.fn();
    document.getElementById('notify')!.addEventListener('click', notify);
    expect(await bambuAddOnPage(BEIGE, KEY, 1, 0)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/Notify Me/) });
    expect(notify).not.toHaveBeenCalled();
  });
  it('refuses when the page has a different option selected', async () => {
    document.body.innerHTML = page('White (1) / Refill / 1kg');
    const sent = liveAdd(() => 1);
    expect(await bambuAddOnPage(BEIGE, KEY, 1, 0)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/different option/) });
    expect(sent).toEqual([]);
  });
  it('refuses when the address or the published list doesn\'t carry the option', async () => {
    document.body.innerHTML = page();
    expect(await bambuAddOnPage(WHITE, KEY, 1, 0)).toMatchObject({ kind: 'refused' });
    history.pushState({}, '', '/products/test-filament?id=999');
    expect(await bambuAddOnPage('999', KEY, 1, 0)).toMatchObject({ kind: 'refused' });
  });
  it('a page with only Buy Now is refused, never pressed', async () => {
    document.body.innerHTML = page('Beige (2) / Refill / 1kg', '<button id="buy">Buy Now</button>');
    const buy = vi.fn();
    document.getElementById('buy')!.addEventListener('click', buy);
    expect(await bambuAddOnPage(BEIGE, KEY, 1, 0)).toMatchObject({ kind: 'refused' });
    expect(buy).not.toHaveBeenCalled();
  });
  it('stops at a bot check or a sign-in, certain that nothing was sent', async () => {
    document.body.innerHTML = page();
    document.title = 'Just a moment...';
    expect(await bambuAddOnPage(BEIGE, KEY, 1, 0)).toMatchObject({ kind: 'stop', reason: 'bot-check', notSent: true });
    document.title = '';
    document.body.innerHTML = `${page()}<input type="password">`;
    expect(await bambuAddOnPage(BEIGE, KEY, 1, 0)).toMatchObject({ kind: 'stop', reason: 'login', notSent: true });
  });
  it('hands back the store\'s message when the cart count doesn\'t move', async () => {
    document.body.innerHTML = `${page()}<div role="alert"></div>`;
    document.getElementById('add')!.addEventListener('click', () => { document.querySelector('[role="alert"]')!.textContent = 'Limit reached'; });
    expect(await bambuAddOnPage(BEIGE, KEY, 1, 500)).toEqual({ kind: 'refused', message: 'Limit reached' });
  }, 10_000);
});
describe('reading the cart', () => {
  const KEY = 'Test Filament - Beige (2) / Refill / 1kg';
  it('reads only the line asked for, once, from the shown copy', async () => {
    document.body.innerHTML = cartPage(cartRow('Test Filament', 'Beige (2) / Refill / 1kg', 1, '$5.00', true) + cartRow('Test Filament', 'Beige (2) / Refill / 1kg', 1) + cartRow('Test Filament', 'White (1) / Refill / 1kg', 7) + cartRow('Other Thing', 'Black', 9));
    const lines = await bambuReadCart([KEY]);
    expect(lines).toEqual([{ key: KEY, quantity: 1, unitPrice: 5 }]);
    expect(JSON.stringify(lines)).not.toMatch(/White|Other/);
  });
  it('another option of the same product isn\'t this line', async () => {
    document.body.innerHTML = cartPage(cartRow('Test Filament', 'White (1) / Refill / 1kg', 7));
    expect(await bambuReadCart([KEY])).toEqual([]);
  });
  it('a suggestion further down the page isn\'t in the cart', async () => {
    document.body.innerHTML = cartPage('');
    expect(await bambuReadCart([KEY, 'Other Thing'])).toEqual([]);
  });
  it('gives a price only when it\'s known to be per unit', async () => {
    document.body.innerHTML = cartPage(cartRow('Test Filament', 'Beige (2) / Refill / 1kg', 2));
    expect(await bambuReadCart([KEY])).toEqual([{ key: KEY, quantity: 2, unitPrice: null }]);
  });
  it('an empty cart has to stay empty before it counts', async () => {
    document.body.innerHTML = EMPTY;
    setTimeout(() => { document.body.innerHTML = cartPage(cartRow('Test Filament', 'Beige (2) / Refill / 1kg', 3)); }, 300);
    expect(await bambuReadCart([KEY], 3000, 1000)).toEqual([{ key: KEY, quantity: 3, unitPrice: null }]);
    document.body.innerHTML = EMPTY;
    expect(await bambuReadCart([KEY], 3000, 300)).toEqual([]);
  });
  it('stops on a page it can\'t recognize, and never guesses zero', async () => {
    document.body.innerHTML = '<h1>Something else</h1>';
    expect(await bambuReadCart([KEY], 0)).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('stops on a line with no readable quantity', async () => {
    document.body.innerHTML = cartPage(cartRow('Test Filament', 'Beige (2) / Refill / 1kg', 1).replace('value="1"', 'value=""'));
    expect(await bambuReadCart([KEY])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('stops at a wall', async () => {
    document.title = 'Just a moment...';
    expect(await bambuReadCart([KEY], 0)).toMatchObject({ kind: 'stop', reason: 'bot-check' });
    document.title = '';
    document.body.innerHTML = '<input type="password">';
    expect(await bambuReadCart([KEY], 0)).toMatchObject({ kind: 'stop', reason: 'login' });
  });
});
describe('the check after each load', () => {
  it('the real Cloudflare page stops the store', () => {
    document.title = 'Just a moment...';
    document.body.innerHTML = '<p>Performing security verification</p>';
    expect(inspectPage()).toMatchObject({ kind: 'stop', reason: 'bot-check' });
  });
  it('the cart\'s sign-in banner isn\'t a wall', () => {
    document.body.innerHTML = cartPage('');
    Object.defineProperty(document.body, 'innerText', { value: 'Log in to synchronize the items in your shopping cart. Log In Now', configurable: true });
    expect(inspectPage()).toEqual({ kind: 'ok' });
    delete (document.body as unknown as Record<string, unknown>).innerText;
  });
});
describe('the whole line, through the runner', () => {
  const KEY = 'Test Filament - Beige (2) / Refill / 1kg';
  /** A tab whose goto swaps in the synthetic page for that address, and a cart that behaves like the store's. */
  function store(start = 0, opts: { limit?: number; cartName?: string } = {}) {
    const state = { cart: start, sent: [] as number[], visited: [] as string[] };
    const tab: StoreTab = {
      ...hereTab,
      async goto(url) {
        state.visited.push(url);
        expect(allowedInTab(bambu, url)).toBe(true);
        if (new URL(url).pathname === '/cart') {
          document.body.innerHTML = state.cart ? cartPage(cartRow(opts.cartName ?? 'Test Filament', 'Beige (2) / Refill / 1kg', state.cart)) : EMPTY;
          history.pushState({}, '', '/cart');
          return;
        }
        const here = new URL(url);
        history.pushState({}, '', here.pathname + here.search);
        document.body.innerHTML = page();
        document.getElementById('count')!.textContent = state.cart ? String(state.cart) : '';
        const { counted } = liveQuantity(opts.limit);
        document.getElementById('add')!.addEventListener('click', () => { const n = counted(); state.sent.push(n); state.cart += n; document.getElementById('count')!.textContent = String(state.cart); });
      },
    };
    return { state, tab };
  }
  const orders = [order({ vendor: 'BambuLab', urlVendor: 'BambuLab', sku: BEIGE, productUrl: `${HOME}/products/test-filament?id=${BEIGE}`, unitPrice: null, quantity: 2 })];
  it('adds the requested quantity, and a retry doesn\'t double', async () => {
    const { state, tab } = store();
    const first = await buildStore(bambu, bambu.steps!, orders, tab, options);
    expect(first.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(state.sent).toEqual([2]);
    const retry = await buildStore(bambu, bambu.steps!, orders, tab, options);
    expect(retry.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: expect.stringMatching(/Already in the cart/) });
    expect(state.sent).toEqual([2]);
    expect(state.visited.every(url => !/checkout/i.test(url))).toBe(true);
  }, 30_000);
  it('adds only the difference when the cart already holds some', async () => {
    const { state, tab } = store(1);
    const result = await buildStore(bambu, bambu.steps!, orders, tab, options);
    expect(state.sent).toEqual([1]);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true });
  }, 30_000);
  it('a limit of one can\'t be told from a quantity that didn\'t take, so nothing is sent', async () => {
    const { tab } = store(0, { limit: 1 });
    const result = await buildStore(bambu, bambu.steps!, orders, tab, options);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', confirmed: false, message: expect.stringMatching(/quantity of 2/) });
  }, 30_000);
  it('a capped quantity is reported as short stock', async () => {
    const { state, tab } = store(0, { limit: 3 });
    const result = await buildStore(bambu, bambu.steps!, [{ ...orders[0], quantity: 5 }], tab, options);
    expect(state.sent).toEqual([3]);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/Short stock/) });
  }, 30_000);
  it('a read-back above the target is flagged as a mismatch and not marked', async () => {
    const { state, tab } = store();
    const doubling: StoreTab = { ...tab, async goto(url) { await tab.goto(url); document.getElementById('add')?.addEventListener('click', () => { state.cart += 2; }); } };
    const result = await buildStore(bambu, bambu.steps!, orders, doubling, options);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/Quantity mismatch/) });
  }, 30_000);
  it('stops rather than reporting nothing added, when the cart count rose but the row doesn\'t match', async () => {
    const { state, tab } = store(0, { cartName: 'Test Filam…' });
    const result = await buildStore(bambu, bambu.steps!, orders, tab, options);
    expect(state.sent).toEqual([2]);
    expect(result.stopped?.reason).toBe('unexpected');
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/could not be read back/) });
  }, 30_000);
  it('a wall during the build leaves the rest as checklist items', async () => {
    const tab: StoreTab = { ...hereTab, async goto() { throw new StoreStop('bot-check', 'a CAPTCHA or bot check'); } };
    const result = await buildStore(bambu, bambu.steps!, [orders[0], { ...orders[0], id: 'order-2' }], tab, options);
    expect(result.stopped?.reason).toBe('bot-check');
    expect(result.items.map(item => item.outcome)).toEqual(['checklist', 'checklist']);
  });
});
describe('what the file doesn\'t do', () => {
  it('never calls the store\'s API, and uses no fetch at all', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve('src/carts/stores/bambu.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/fetch\(|XMLHttpRequest|na-store-api|mall-order|user-?agent|document\.cookie/i);
  });
  it('each injected function runs from its own text alone, as Chrome runs it', async () => {
    const alone = <F extends (...args: never[]) => unknown>(func: F): F => new Function(`return (${func.toString()})`)() as F;
    document.body.innerHTML = page();
    expect(await alone(bambuReadProduct)('test-filament', 0)).toMatchObject({ kind: 'ok' });
    const { counted } = liveQuantity();
    const sent = liveAdd(counted);
    expect(await alone(bambuAddOnPage)(BEIGE, 'Test Filament - Beige (2) / Refill / 1kg', 2, 2000)).toMatchObject({ kind: 'sent' });
    expect(sent).toEqual([2]);
    document.body.innerHTML = cartPage(cartRow('Test Filament', 'Beige (2) / Refill / 1kg', 2));
    expect(await alone(bambuReadCart)(['Test Filament - Beige (2) / Refill / 1kg'])).toMatchObject([{ quantity: 2 }]);
  });
});
