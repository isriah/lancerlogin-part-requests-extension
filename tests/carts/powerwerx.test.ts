// PowerWerx's Quick Entry against a synthetic store built from the page's own script. No real store is contacted.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStore } from '../../src/carts/runner';
import { allowedInTab } from '../../src/carts/safety';
import { LineProblem, StoreStop, type StoreTab } from '../../src/carts/store-method';
import { powerwerx, powerwerxPasteAndAdd, powerwerxReadCart, powerwerxSku } from '../../src/carts/stores/powerwerx';
import { options, order } from './helpers';

const steps = powerwerx.steps!;
const WAIT = 400;
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

interface Synthetic {
  /** What the store matches a pasted SKU to. Absent means no match. */
  catalog?: Record<string, string>;
  minimum?: number;
  /** The store caps what it really adds, as short stock does. */
  cap?: number;
  /** The cart, by the store's SKU. */
  cart?: Map<string, number>;
  /** Answers the match with this status, as Cloudflare does. */
  parseStatus?: number;
  mode?: string;
  combine?: string;
  commitRefusal?: string;
}
/** The whole page, with a Checkout submit, the store's own Search & Add button and an empty-cart link. Clicking any of those is recorded as touched. */
function quickEntry(store: Synthetic = {}) {
  const touched: string[] = [];
  const cart = store.cart ?? new Map<string, number>();
  document.body.innerHTML = `
    <form method="post" action="/cart" data-hub-checkout-form><input type="hidden" name="__RequestVerificationToken" value="synthetic"><button type="submit" name="checkout" value="checkout" class="button-1 apt-hub-strip-checkout" data-hub-checkout>Checkout</button></form>
    <a id="empty" href="/emptycart">Empty cart</a>
    <div id="quickEntryRoot">
      <button type="button" class="button-1 apt-qe-addall" data-qe-addall disabled>Add All to Cart (0)</button>
      <textarea id="qePaste"></textarea><button type="button" class="button-1 apt-qe-parse" data-qe-parse>Match Items</button>
      <div id="qeGridWrap" style="display:none"><div id="qeGrid"></div><button type="button" class="button-1 apt-qe-gridreview" data-qe-gridreview>Add <span>0</span> <span>Items</span> To Cart</button></div>
    </div>
    <div id="fancybox-content"></div>`;
  document.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); touched.push('checkout submit'); });
  for (const selector of ['.apt-hub-strip-checkout', '.apt-qe-addall', '#empty']) document.querySelector(selector)!.addEventListener('click', event => { event.preventDefault(); touched.push(selector); });
  const grid = document.querySelector('#qeGrid')!, review = document.querySelector('.apt-qe-gridreview') as HTMLButtonElement, modalHolder = document.querySelector('#fancybox-content')!;
  let pasted: { asked: string; matched: string | undefined; quantity: number } | null = null;
  document.querySelector('.apt-qe-parse')!.addEventListener('click', () => setTimeout(() => {
    if (store.parseStatus) {
      vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ name: `${location.origin}/cart/quick-entry/parse`, responseStatus: store.parseStatus } as never]);
      modalHolder.innerHTML = 'Oops! Could not read the list.';
      return;
    }
    const [asked, typed] = (document.querySelector('#qePaste') as HTMLTextAreaElement).value.split(/,\s*/);
    const matched = store.catalog?.[asked];
    const quantity = Math.max(Number(typed), store.minimum ?? 1);
    pasted = { asked, matched, quantity };
    grid.innerHTML = matched
      ? `<div data-qe-fixrow data-line="1" data-status="matched" data-productid="77"><span class="apt-cell-sku"> ${matched} </span><input class="apt-qe-fixqty" value="${quantity}"></div>`
      : `<div data-qe-fixrow data-line="1" data-status="notfound"><input class="apt-qe-fixsku" value="${asked}"><input class="apt-qe-fixqty" value="${quantity}"></div>`;
    review.innerHTML = `Add <span>${matched ? 1 : 0}</span> <span>${matched ? 'Item' : 'Items'}</span> To Cart`;
  }, 10));
  review.addEventListener('click', () => setTimeout(() => {
    modalHolder.innerHTML = `<div class="apt-modal-review" data-mode="${store.mode ?? 'append'}"><div data-hub-row data-productid="77" data-addable="true"><input type="checkbox" class="apt-row-select" checked><input data-qty-input value="${pasted!.quantity}">${store.combine ? `<span data-combine><input type="radio" value="${store.combine}" checked></span>` : ''}</div><div data-review-foot><button type="button" data-review-commit>Add <span data-commit-count>1</span> <span data-commit-noun>Item</span> To Cart</button></div></div>`;
    modalHolder.querySelector('[data-review-commit]')!.addEventListener('click', () => {
      touched.push('commit');
      setTimeout(() => {
        if (store.commitRefusal) { modalHolder.querySelector('[data-review-foot]')!.insertAdjacentHTML('beforebegin', `<div data-review-error>${store.commitRefusal}</div>`); return; }
        const adding = Math.min(pasted!.quantity, store.cap ?? Infinity);
        cart.set(pasted!.matched!, (cart.get(pasted!.matched!) ?? 0) + adding);
        modalHolder.innerHTML = '';
      }, 10);
    });
  }, 10));
  return { touched, cart };
}
function cartPage(cart: Map<string, number>, price = '$4.25') {
  const total = [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
  document.body.innerHTML = `<div id="cartPaneRoot"><span id="hubPaneData" data-count="${total}"></span>${[...cart].map(([sku, quantity]) => `<div data-hub-row data-productid="77" data-qty="${quantity}"><span class="apt-cell-sku">${sku}</span><input data-qty-input value="${quantity}"><span data-unit-price>${price}</span></div>`).join('')}</div>`;
}
/** A tab that draws the page for the address it goes to, and refuses what the real tab would. */
function storeTab(store: Synthetic) {
  store.cart ??= new Map();
  const seen: string[] = [], pages: string[][] = [];
  const tab: StoreTab = {
    async goto(url) {
      if (!allowedInTab(powerwerx, url)) throw new StoreStop('unexpected', 'refused');
      seen.push(new URL(url).pathname);
      if (new URL(url).pathname === '/cart') cartPage(store.cart!);
      else pages.push(quickEntry(store).touched);
    },
    async run(func, ...args) {
      // The real address waits fifteen seconds for an answer. A test doesn't.
      if (func === (powerwerxPasteAndAdd as unknown)) args = [args[0], args[1], WAIT] as never;
      return await func(...args) as never;
    },
    async runThenLoad(func, ...args) { return await func(...args) as never; },
  };
  return { tab, seen, touched: () => pages.flat() };
}
const line = (extra = {}) => order({ vendor: 'PowerWerx', urlVendor: 'PowerWerx', sku: 'Splice-1614', productUrl: null, unitPrice: null, ...extra });
const CATALOG = { 'Splice-1614': 'Splice-1614' };

describe('the request', () => {
  it('uses the SKU exactly, and the store\'s own addresses, never a checkout', () => {
    expect(powerwerxSku({ sku: ' Splice-1614 ' })).toBe('Splice-1614');
    expect(allowedInTab(powerwerx, powerwerx.startUrl!)).toBe(true);
    expect(allowedInTab(powerwerx, powerwerx.cartUrl!)).toBe(true);
    expect(allowedInTab(powerwerx, 'https://powerwerx.com/cart/quick-entry')).toBe(true);
    expect(allowedInTab(powerwerx, 'https://powerwerx.com/checkout')).toBe(false);
  });
  it.each(['Two Words', 'A,B', 'A\tB', '#comment', ''])('refuses a SKU the paste box would misread: "%s"', async sku => {
    expect(powerwerxSku({ sku })).toBeNull();
    await expect(steps.resolveLine(line({ sku }), storeTab({}).tab)).rejects.toThrow(LineProblem);
  });
  it('says what a badly written SKU needs before anyone ticks it', () => {
    expect(powerwerx.missing!(line({ sku: 'Two Words' }))).toEqual(['a single SKU with no spaces or commas']);
    expect(powerwerx.missing!(line())).toEqual([]);
    expect(powerwerx.missing!(line({ sku: null }))).toEqual([]); // requiredFields already says it needs a SKU.
  });
  it('pastes one line as "SKU, quantity" and adds it', async () => {
    const page = quickEntry({ catalog: CATALOG });
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toEqual({ kind: 'sent' });
    expect((document.querySelector('#qePaste') as HTMLTextAreaElement).value).toBe('Splice-1614, 2');
    expect(page.cart.get('Splice-1614')).toBe(2);
    expect(page.touched).toEqual(['commit']);
  });
});
describe('the checkout on the same page', () => {
  it('a full add never touches Checkout, the Search & Add button or the empty-cart link', async () => {
    const page = quickEntry({ catalog: CATALOG });
    const clicked: string[] = [];
    const watch = (event: Event) => { clicked.push((event.target as Element).className || (event.target as Element).tagName); };
    document.addEventListener('click', watch, true);
    await powerwerxPasteAndAdd('Splice-1614', 2, WAIT);
    document.removeEventListener('click', watch, true);
    expect(clicked).toEqual(['button-1 apt-qe-parse', 'button-1 apt-qe-gridreview', 'BUTTON']);
    expect(page.touched).not.toContain('checkout submit');
    expect(page.touched).not.toContain('.apt-hub-strip-checkout');
    expect(page.touched).not.toContain('.apt-qe-addall');
    expect(page.touched).not.toContain('#empty');
    expect(clicked.join()).not.toMatch(/checkout/i);
  });
  it.each([
    ['the match button', '.apt-qe-parse'],
    ['the grid\'s add button', '.apt-qe-gridreview'],
  ])('refuses %s when it has become a checkout submit', async (_name, selector) => {
    const page = quickEntry({ catalog: CATALOG });
    const form = document.querySelector('form')!;
    const swap = () => {
      const control = document.querySelector(selector) as HTMLButtonElement;
      control.type = 'submit'; control.name = 'checkout'; control.textContent = 'Checkout';
      form.appendChild(control);
      control.addEventListener('click', () => page.touched.push('checkout submit'));
    };
    if (selector === '.apt-qe-parse') swap();
    else {
      // The grid's button changes once the match has drawn it.
      document.querySelector('.apt-qe-parse')!.addEventListener('click', () => setTimeout(swap, 20));
    }
    const answer = await powerwerxPasteAndAdd('Splice-1614', 2, WAIT);
    expect(answer).toMatchObject({ kind: 'stop', notSent: true });
    expect(page.touched).toEqual([]);
    expect(page.cart.size).toBe(0);
  });
  it('refuses a review window whose button says Checkout', async () => {
    const page = quickEntry({ catalog: CATALOG });
    const watcher = new MutationObserver(() => { const commit = document.querySelector('[data-review-commit]'); if (commit) commit.textContent = 'Add and Checkout'; });
    watcher.observe(document.querySelector('#fancybox-content')!, { childList: true });
    const answer = await powerwerxPasteAndAdd('Splice-1614', 2, WAIT);
    watcher.disconnect();
    expect(answer).toMatchObject({ kind: 'stop', notSent: true });
    expect(page.touched).toEqual([]);
  });
  it('refuses a review button that counts one item but also says Checkout', async () => {
    const page = quickEntry({ catalog: CATALOG });
    const watcher = new MutationObserver(() => { const commit = document.querySelector('[data-review-commit]'); if (commit && !/Checkout/.test(commit.textContent ?? '')) commit.innerHTML = 'Add <span data-commit-count>1</span> and Checkout'; });
    watcher.observe(document.querySelector('#fancybox-content')!, { childList: true });
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toMatchObject({ kind: 'stop', notSent: true });
    watcher.disconnect();
    expect(page.touched).toEqual([]);
  });
  it('refuses an add button that otherwise looks right but sits in a form, which is how Checkout is built', async () => {
    const page = quickEntry({ catalog: CATALOG });
    const watcher = new MutationObserver(() => {
      const commit = document.querySelector('[data-review-commit]');
      if (!commit || commit.closest('form')) return;
      const form = document.createElement('form');
      commit.replaceWith(form);
      form.appendChild(commit);
    });
    watcher.observe(document.querySelector('#fancybox-content')!, { childList: true });
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toMatchObject({ kind: 'stop', notSent: true });
    watcher.disconnect();
    expect(page.touched).toEqual([]);
  });
  it('the source names no checkout control or address to go to, and no empty-cart address', () => {
    const code = readFileSync(resolve('src/carts/stores/powerwerx.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/apt-hub-strip-checkout|\/checkout|action=buy|emptycart|apt-qe-addall|\.submit\(/);
    expect(code).not.toMatch(/user-?agent|navigator\.webdriver|document\.cookie/i);
  });
});
describe('a wrong item is worse than no item', () => {
  it('a match to another SKU is refused, and nothing is added', async () => {
    const page = quickEntry({ catalog: { 'Splice-1614': 'Splice-1614-RED' } });
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toEqual({ kind: 'refused', message: 'The request says SKU Splice-1614, but PowerWerx matched it to SKU Splice-1614-RED.' });
    expect(page.touched).toEqual([]);
  });
  it('a match that differs only in case is refused too', async () => {
    const page = quickEntry({ catalog: { 'splice-1614': 'Splice-1614' } });
    expect(await powerwerxPasteAndAdd('splice-1614', 2, WAIT)).toMatchObject({ kind: 'refused' });
    expect(page.touched).toEqual([]);
  });
  it('no match is refused', async () => {
    const page = quickEntry({ catalog: {} });
    expect(await powerwerxPasteAndAdd('NOT-A-SKU', 2, WAIT)).toEqual({ kind: 'refused', message: 'PowerWerx has no exact match for SKU NOT-A-SKU.' });
    expect(page.touched).toEqual([]);
  });
  it('more than one line back is refused', async () => {
    const page = quickEntry({ catalog: CATALOG });
    document.querySelector('#qeGrid')!.innerHTML = '<div data-qe-fixrow data-status="matched" data-productid="1"><span class="apt-cell-sku">Splice-1614</span></div><div data-qe-fixrow data-status="matched" data-productid="2"><span class="apt-cell-sku">Splice-1614</span></div>';
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/2 lines/) });
    expect(page.touched).toEqual([]);
  });
  it('a store minimum that would change the quantity is refused, not converted', async () => {
    const page = quickEntry({ catalog: CATALOG, minimum: 10 });
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/would add 10 of SKU Splice-1614, not 2/) });
    expect(page.touched).toEqual([]);
  });
  it.each([['the replace mode', { mode: 'replace' }], ['"set the total"', { combine: 'set-total' }]])('won\'t commit a review in %s, which would overwrite the cart', async (_name, extra) => {
    const page = quickEntry({ catalog: CATALOG, ...extra });
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toMatchObject({ kind: 'stop', notSent: true });
    expect(page.touched).toEqual([]);
  });
});
describe('walls', () => {
  it('a challenge on the match stops the store, and says nothing was sent', async () => {
    const page = quickEntry({ catalog: CATALOG, parseStatus: 403 });
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toEqual({ kind: 'stop', reason: 'bot-check', detail: 'the match was refused with a challenge', notSent: true });
    expect(page.touched).toEqual([]);
  });
  it('a build that meets the challenge turns every item into a checklist link', async () => {
    const { tab } = storeTab({ catalog: CATALOG, parseStatus: 403 });
    const orders = [line({ id: 'a' }), line({ id: 'b', sku: 'Other-1' })];
    const result = await buildStore(powerwerx, steps, orders, tab, options);
    expect(result.stopped?.reason).toBe('bot-check');
    expect(result.items.map(item => item.outcome)).toEqual(['checklist', 'checklist']);
    expect(result.items.map(item => item.confirmed)).toEqual([false, false]);
  });
  it('a page without the paste box stops the store', async () => {
    document.body.innerHTML = '<h1>Something else</h1>';
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toMatchObject({ kind: 'stop', reason: 'unexpected', notSent: true });
  });
  it('a match that never answers stops the store, rather than guess', async () => {
    quickEntry({ catalog: CATALOG });
    document.querySelector('.apt-qe-parse')!.replaceWith(Object.assign(document.createElement('button'), { type: 'button', className: 'apt-qe-parse', textContent: 'Match Items' }));
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, 150)).toMatchObject({ kind: 'stop', reason: 'unexpected', notSent: true });
  });
  it('a challenge doesn\'t wait out the clock', async () => {
    quickEntry({ catalog: CATALOG, parseStatus: 403 });
    const started = Date.now();
    await powerwerxPasteAndAdd('Splice-1614', 2, 5000);
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it('the page\'s general failure, with no status to read, stops the store and isn\'t treated as a refusal of this item', async () => {
    quickEntry({ catalog: CATALOG });
    const match = document.querySelector('.apt-qe-parse')!;
    match.replaceWith(Object.assign(document.createElement('button'), { type: 'button', className: 'apt-qe-parse', textContent: 'Match Items', onclick: () => { document.querySelector('#fancybox-content')!.textContent = 'Oops! Could not read the list.'; } }));
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toMatchObject({ kind: 'stop', reason: 'unexpected', notSent: true });
  });
  it('the store\'s own warning about a list is passed on for that line', async () => {
    quickEntry({ catalog: CATALOG });
    const match = document.querySelector('.apt-qe-parse')!;
    match.replaceWith(Object.assign(document.createElement('button'), { type: 'button', className: 'apt-qe-parse', textContent: 'Match Items', onclick: () => { document.querySelector('#fancybox-content')!.textContent = 'Oops! That list is too long.'; } }));
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toEqual({ kind: 'refused', message: 'That list is too long.' });
  });
  it('a challenge on the review stops the store before anything is committed', async () => {
    const page = quickEntry({ catalog: CATALOG });
    document.querySelector('.apt-qe-gridreview')!.addEventListener('click', event => {
      event.stopImmediatePropagation();
      vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ name: `${location.origin}/cart/batch/stage`, responseStatus: 403 } as never]);
    }, { capture: true });
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toMatchObject({ kind: 'stop', reason: 'bot-check', notSent: true });
    expect(page.touched).toEqual([]);
  });
  it('a commit button with no type attribute, outside any form, is still the add button', async () => {
    const page = quickEntry({ catalog: CATALOG });
    const watcher = new MutationObserver(() => document.querySelector('[data-review-commit]')?.removeAttribute('type'));
    watcher.observe(document.querySelector('#fancybox-content')!, { childList: true });
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toEqual({ kind: 'sent' });
    watcher.disconnect();
    expect(page.cart.get('Splice-1614')).toBe(2);
  });
  it('the store\'s refusal to add is passed on in its own words', async () => {
    quickEntry({ catalog: CATALOG, commitRefusal: 'This item is out of stock.' });
    expect(await powerwerxPasteAndAdd('Splice-1614', 2, WAIT)).toEqual({ kind: 'refused', message: 'This item is out of stock.' });
  });
});
describe('reading the cart', () => {
  it('hands back only the lines asked for, by the exact SKU, and sums split lines', () => {
    cartPage(new Map([['Splice-1614', 2], ['Other-1', 9]]));
    document.querySelector('#cartPaneRoot')!.insertAdjacentHTML('beforeend', '<div data-hub-row><span class="apt-cell-sku">Splice-1614</span><input data-qty-input value="1"></div>');
    const lines = powerwerxReadCart(['Splice-1614']);
    expect(lines).toEqual([{ key: 'Splice-1614', quantity: 3, unitPrice: 4.25 }]);
    expect(JSON.stringify(lines)).not.toMatch(/Other/);
    expect(powerwerxReadCart(['splice-1614'])).toEqual([]);
  });
  it('an empty cart is an empty list', () => {
    cartPage(new Map());
    expect(powerwerxReadCart(['Splice-1614'])).toEqual([]);
  });
  it('never guesses zero from a page it can\'t read', () => {
    document.body.innerHTML = '<h1>Not the cart</h1>';
    expect(powerwerxReadCart(['X'])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
    document.body.innerHTML = '<div id="cartPaneRoot"><span id="hubPaneData" data-count="3"></span></div>';
    expect(powerwerxReadCart(['X'])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
    document.body.innerHTML = '<div id="cartPaneRoot"><span id="hubPaneData" data-count="1"></span><div data-hub-row></div></div>';
    expect(powerwerxReadCart(['X'])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
    document.body.innerHTML = '<div id="cartPaneRoot"><span id="hubPaneData" data-count="1"></span><div data-hub-row><span class="apt-cell-sku">X</span><input data-qty-input value="many"></div></div>';
    expect(powerwerxReadCart(['X'])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
});
describe('whole builds, with the runner', () => {
  it('adds, confirms, reads the cart page each time, and never leaves the cart pages', async () => {
    const store: Synthetic = { catalog: CATALOG };
    const { tab, seen, touched } = storeTab(store);
    const result = await buildStore(powerwerx, steps, [line()], tab, options);
    expect(result.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(store.cart!.get('Splice-1614')).toBe(2);
    expect(touched()).toEqual(['commit']);
    expect(seen).toEqual(['/cart', '/cart/quick-entry', '/cart']);
  });
  it('a retry doesn\'t double', async () => {
    const store: Synthetic = { catalog: CATALOG };
    const { tab, seen } = storeTab(store);
    await buildStore(powerwerx, steps, [line()], tab, options);
    seen.length = 0;
    const again = await buildStore(powerwerx, steps, [line()], tab, options);
    expect(store.cart!.get('Splice-1614')).toBe(2);
    expect(again.items[0].outcome).toBe('flagged');
    expect(again.items[0].message).toMatch(/Already in the cart/);
    expect(seen).toEqual(['/cart']); // Quick Entry was never opened.
  });
  it('tops up only the difference when the cart holds some already', async () => {
    const store: Synthetic = { catalog: CATALOG, cart: new Map([['Splice-1614', 1]]) };
    const { tab } = storeTab(store);
    const result = await buildStore(powerwerx, steps, [line()], tab, options);
    expect(store.cart!.get('Splice-1614')).toBe(2);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true });
  });
  it('short stock is reported and not marked', async () => {
    const store: Synthetic = { catalog: CATALOG, cap: 1 };
    const { tab } = storeTab(store);
    const result = await buildStore(powerwerx, steps, [line()], tab, options);
    expect(result.items[0].message).toMatch(/Short stock: asked for 2, and the cart holds 1/);
    expect(result.items[0].confirmed).toBe(false);
  });
  it('a read-back that doesn\'t match is flagged and not marked', async () => {
    const store: Synthetic = { catalog: CATALOG };
    const { tab } = storeTab(store);
    const realRun = tab.run.bind(tab);
    tab.run = (async (func: never, ...args: never[]) => {
      const answer = await (realRun as (f: never, ...a: never[]) => Promise<unknown>)(func, ...args);
      if (func === (powerwerxPasteAndAdd as never)) store.cart!.set('Splice-1614', 5); // Something else changed it.
      return answer;
    }) as never;
    const result = await buildStore(powerwerx, steps, [line()], tab, options);
    expect(result.items[0].message).toMatch(/Quantity mismatch/);
    expect(result.items[0].confirmed).toBe(false);
  });
  it('a wrong match fails that one line, and the next still goes', async () => {
    const store: Synthetic = { catalog: { 'Splice-1614': 'Splice-1614-RED', 'Other-1': 'Other-1' } };
    const { tab } = storeTab(store);
    const result = await buildStore(powerwerx, steps, [line({ id: 'a' }), line({ id: 'b', sku: 'Other-1' })], tab, options);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', confirmed: false });
    expect(result.items[0].message).toMatch(/matched it to SKU Splice-1614-RED/);
    expect(result.items[1]).toMatchObject({ outcome: 'added', confirmed: true });
    expect([...store.cart!.keys()]).toEqual(['Other-1']);
  });
});
