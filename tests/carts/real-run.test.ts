// Facts from the first real run in a signed-in browser, one block per finding, using the markup shapes seen there. No real store is contacted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interpretOrders } from '../../src/client';
import { blockedReason, groupOrders, leftOutOf, rowFor } from '../../src/carts/selection';
import { buildStore, stopMessage } from '../../src/carts/runner';
import { StoreStop, type StoreTab } from '../../src/carts/store-method';
import { aliexpressPressAdd, aliexpressReadListing, isUsdPrice } from '../../src/carts/stores/aliexpress';
import { amazonReadCart } from '../../src/carts/stores/amazon';
import { bambuAddOnPage } from '../../src/carts/stores/bambu';
import { harborFreightSku, harborfreight } from '../../src/carts/stores/harborfreight';
import { mcmaster, mcmasterPasteLine, mcmasterReadCart } from '../../src/carts/stores/mcmaster';
import { onlineMetalsReadCart } from '../../src/carts/stores/onlinemetals';
import { powerwerxReadCart } from '../../src/carts/stores/powerwerx';
import { fakeStore, hereTab, options, order } from './helpers';

const at = (path: string, html = '') => { history.pushState({}, '', path); document.body.innerHTML = html; };
const visible = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
  return (this.closest('.copy-hidden,[hidden]') ? { width: 0, height: 0 } : { width: 100, height: 40 }) as DOMRect;
});
beforeEach(() => { visible(); });
afterEach(() => { vi.restoreAllMocks(); document.title = ''; document.head.replaceChildren(); at('/'); });

describe('1. why a store stopped', () => {
  it('a stop keeps the store\'s own fixed words, separately from the message', async () => {
    const { store, steps } = fakeStore(new Map());
    steps.readCart = async () => { throw new StoreStop('unexpected', 'a cart line with no SKU'); };
    const result = await buildStore(store, steps, [order()], hereTab, options);
    expect(result.stopped).toMatchObject({ reason: 'unexpected', detail: 'a cart line with no SKU' });
    expect(result.stopped?.message).toMatch(/a page this didn't expect/);
  });
  it('a stop with no words of its own has no detail, rather than the bare reason', async () => {
    const { store, steps } = fakeStore(new Map());
    steps.readCart = async () => { throw new StoreStop('login'); };
    expect((await buildStore(store, steps, [order()], hereTab, options)).stopped?.detail).toBeUndefined();
  });
  it('the final read says what it saw too, and nothing about the cart beyond those words', async () => {
    const cart = new Map<string, number>();
    const { store, steps } = fakeStore(cart);
    const read = steps.readCart;
    let reads = 0;
    steps.readCart = async (tab, keys) => { if (++reads === 3) throw new StoreStop('unexpected', 'a cart page in another shape'); return read(tab, keys); };
    const result = await buildStore(store, steps, [order({ description: 'Secret bracket' })], hereTab, options);
    expect(result.finalCheckDetail).toBe('a cart page in another shape');
    expect(JSON.stringify([result.stopped, result.finalCheckDetail])).not.toMatch(/Secret/);
  });
});

describe('7. a line that was sent, whose read-back failed', () => {
  it('the top message doesn\'t tell the person to add it themselves', async () => {
    const cart = new Map<string, number>();
    const { store, steps } = fakeStore(cart);
    const read = steps.readCart;
    let reads = 0;
    steps.readCart = async (tab, keys) => { if (++reads === 2) throw new StoreStop('unexpected', 'a cart line with no SKU'); return read(tab, keys); };
    const result = await buildStore(store, steps, [order(), order({ id: 'b', sku: 'TEST-2' })], hereTab, options);
    expect(cart.get('TEST-1')).toBe(2);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, message: expect.stringMatching(/could not be read back/) });
    expect(result.items[1].outcome).toBe('checklist');
    expect(result.stopped?.message).toMatch(/Check the cart before adding anything yourself/);
    expect(result.stopped?.message).not.toMatch(/Add these yourself|or add these/i);
    expect(result.stopped?.detail).toBe('a cart line with no SKU');
  });
  it('a stop before anything was sent still says to add them', () => {
    for (const reason of ['login', 'bot-check', 'unexpected'] as const) {
      expect(stopMessage('X', reason)).toMatch(/add these yourself/i);
      expect(stopMessage('X', reason, true)).not.toMatch(/add these yourself/i);
    }
  });
});

describe('2. Online Metals\' cart', () => {
  const SKU = '1234_12_12';
  /** As seen: the filled cart's form, with hidden inputs, and a quantity box that may or may not be inside it. */
  const form = (entry: number, code: string, inside = '<input type="hidden" name="quantity" value="1">') => `<form id="updateCartForm${entry}" class="js-updateform" action="/en/cart/update" method="post"><input type="hidden" name="productCode" value="${code}"><input type="hidden" name="baseProductCode" value="${code.split('_')[0]}"><input type="hidden" name="entryNumber" value="${entry}">${inside}</form>`;
  beforeEach(() => at('/en/cart'));
  it('reads "You have 0 items in your cart" as empty', () => {
    document.body.innerHTML = '<h1>My Cart</h1><p>You have 0 items in your cart</p>';
    expect(onlineMetalsReadCart([SKU])).toEqual([]);
  });
  it('a page saying neither that nor showing rows still stops', () => {
    document.body.innerHTML = '<h1>My Cart</h1><p>You have 10 items in your cart</p>';
    expect(onlineMetalsReadCart([SKU])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
  it('reads the real form, without needing "You have 1 item" anywhere', () => {
    document.body.innerHTML = `<h1>My Cart</h1>${form(0, SKU)}${form(1, '5678_12_0')}`;
    const lines = onlineMetalsReadCart([SKU]);
    expect(lines).toEqual([{ key: SKU, quantity: 1 }]);
    expect(JSON.stringify(lines)).not.toMatch(/5678/);
  });
  it('allows the quantity box to sit outside the form, beside it', () => {
    document.body.innerHTML = `<div class="row">${form(0, SKU, '')}<input name="quantity" value="3"></div><div class="row">${form(1, '5678_12_0', '')}<input name="quantity" value="9"></div>`;
    expect(onlineMetalsReadCart([SKU])).toEqual([{ key: SKU, quantity: 3 }]);
  });
  it('allows one tied to the form by name', () => {
    document.body.innerHTML = `${form(0, SKU, '')}${form(1, '5678_12_0', '')}<input name="quantity" form="updateCartForm1" value="9"><input name="quantity" form="updateCartForm0" value="2">`;
    expect(onlineMetalsReadCart([SKU])).toEqual([{ key: SKU, quantity: 2 }]);
  });
  it('stops when it can\'t tell which outside box is this line\'s, or one is only in another form', () => {
    document.body.innerHTML = `${form(0, SKU, '')}<input name="quantity" value="1"><input name="quantity" value="2">`;
    expect(onlineMetalsReadCart([SKU])).toMatchObject({ kind: 'stop', detail: 'a cart line with no quantity' });
    document.body.innerHTML = `${form(0, SKU, '')}<form action="/en/tkaddtocart/add"><input name="quantity" value="4"></form>`;
    expect(onlineMetalsReadCart([SKU])).toMatchObject({ kind: 'stop', detail: 'a cart line with no quantity' });
    document.body.innerHTML = `${form(0, SKU, '')}${form(1, '5678_12_0', '')}<input name="quantity" value="1">`;
    expect(onlineMetalsReadCart([SKU])).toMatchObject({ kind: 'stop', detail: 'a cart line with no quantity' });
  });
});

describe('3. McMaster\'s order page', () => {
  const PART = '91251A537';
  const line = (n: number, part: string, quantity: string) => `<input id="line-part-number-input-${n}" class="line-part-number-input" value="${part}"><input id="line-quantity-input-${n}" class="line-quantity-input" value="${quantity}">`;
  const newRow = (n: number) => `<input id="new-line-part-number-input-${n}" class="new-line-part-number-input" value=""><input id="new-line-quantity-input-${n}" class="new-line-quantity-input" value="">`;
  const FEEDBACK = '<textarea id="message-input" placeholder="Let us know what you need."></textarea>';
  const OPENER = '<button class="switch-mode-link">Paste part numbers and quantities</button>';
  const PASTE = '<textarea id="bulk-lines-textarea" placeholder="3313N116  2"></textarea>';
  const ADD = '<button class="button-primary button-add-bulk-lines">Add</button>';
  const CHECKOUT = '<button id="co">Check Out</button>';
  /** The feedback box comes first in the document, as it does on the real page. */
  const page = (rest: string) => `${FEEDBACK}${rest}${CHECKOUT}<div>Merchandise\t$0.00</div>`;
  /** The opener draws the paste box, as the real one does. */
  const openable = () => {
    document.body.innerHTML = page(`${OPENER}<div id="area"></div>`);
    document.querySelector('.switch-mode-link')!.addEventListener('click', () => { document.getElementById('area')!.innerHTML = PASTE + ADD; }, { once: true });
  };

  describe('reading', () => {
    const read = (keys: string[], waitMs = 300) => mcmasterReadCart(keys, waitMs, 0);
    it('reads a line from its two boxes, matched by number, and only the lines asked for', async () => {
      document.body.innerHTML = page(`${line(1, ` ${PART.toLowerCase()} `, '1')}${line(2, '98689A112', '9')}${newRow(3)}`);
      const lines = await read([PART, '1A1']);
      expect(lines).toEqual([{ key: PART, quantity: 1 }]);
      expect(JSON.stringify(lines)).not.toMatch(/98689/);
    });
    it('adds up a part on two lines', async () => {
      document.body.innerHTML = page(`${line(1, PART, '1')}${line(2, PART, '2')}`);
      expect(await read([PART])).toEqual([{ key: PART, quantity: 3 }]);
    });
    it('text on the page isn\'t a line, and neither is an empty new row', async () => {
      document.body.innerHTML = page(`${OPENER}<p>${PART}</p>${newRow(1)}`);
      expect(await read([PART])).toEqual([]);
    });
    it('a new row is never read as a line, even holding the part', async () => {
      document.body.innerHTML = page(`${OPENER}<input id="new-line-part-number-input-1" class="new-line-part-number-input line-part-number-input" value="${PART}"><input id="new-line-quantity-input-1" class="new-line-quantity-input line-quantity-input" value="4">`);
      expect(await read([PART])).toEqual([]);
    });
    it.each([
      ['no quantity box', `<input id="line-part-number-input-1" class="line-part-number-input" value="${PART}"><input id="line-quantity-input-2" class="line-quantity-input" value="1">`, 'an order line with no quantity box'],
      ['a part box with no number', `<input class="line-part-number-input" value="${PART}"><input id="line-quantity-input-1" class="line-quantity-input" value="1">`, 'an order line with no quantity box'],
      ['an empty quantity', line(1, PART, ''), 'an order line with no quantity'],
      ['a quantity that isn\'t a number', line(1, PART, 'many'), 'an order line with no quantity'],
    ])('stops on %s, instead of reading zero', async (_name, html, detail) => {
      document.body.innerHTML = page(html);
      expect(await read([PART])).toMatchObject({ kind: 'stop', reason: 'unexpected', detail });
    });
    it('knows the order page by its boxes, once the words have gone', async () => {
      document.body.innerHTML = `${FEEDBACK}${PASTE}`;
      expect(await read([PART])).toEqual([]);
      document.body.innerHTML = `${FEEDBACK}${newRow(1)}`;
      expect(await read([PART])).toEqual([]);
      document.body.innerHTML = `${FEEDBACK}${line(1, PART, '2')}`;
      expect(await read([PART])).toEqual([{ key: PART, quantity: 2 }]);
    });
    it('stops on a page that\'s none of those', async () => {
      document.body.innerHTML = '<h1>Something else</h1>';
      expect(await read([PART], 0)).toMatchObject({ kind: 'stop', reason: 'unexpected', detail: 'an order page without the paste control' });
    });
    it('keeps its sign-in check, ahead of a hidden order page', async () => {
      document.body.innerHTML = '<h1>Loading</h1>';
      setTimeout(() => { document.body.innerHTML = '<p>To continue browsing, please log in</p>'; }, 150);
      expect(await read([PART], 2000)).toMatchObject({ kind: 'stop', reason: 'login' });
      document.body.innerHTML = `${page(OPENER)}<input type="password">`;
      expect(await read([PART])).toMatchObject({ kind: 'stop', reason: 'login' });
    });
    it('waits for an order page that draws itself', async () => {
      document.body.innerHTML = '<h1>Loading</h1>';
      setTimeout(() => { document.body.innerHTML = page(line(1, PART, '3')); }, 150);
      expect(await read([PART], 2000)).toEqual([{ key: PART, quantity: 3 }]);
    });
    it('holds on until the lines stop changing, so late rows aren\'t read as zero', async () => {
      document.body.innerHTML = page(OPENER);
      setTimeout(() => { document.getElementById('co')!.insertAdjacentHTML('beforebegin', line(1, PART, '3')); }, 150);
      expect(await mcmasterReadCart([PART], 2000, 400)).toEqual([{ key: PART, quantity: 3 }]);
    });
    it('a total with no lines is never zero', async () => {
      document.body.innerHTML = `${FEEDBACK}${OPENER}<div>Merchandise\t$21.40</div>`;
      expect(await read([PART])).toMatchObject({ kind: 'stop', reason: 'unexpected', detail: 'an order total with no lines to read' });
    });
  });

  describe('pasting', () => {
    const watch = () => {
      const pressed: string[] = [], checkout = vi.fn();
      document.querySelector('.button-add-bulk-lines')?.addEventListener('click', () => pressed.push((document.getElementById('bulk-lines-textarea') as HTMLTextAreaElement).value));
      document.getElementById('co')!.addEventListener('click', checkout);
      return { pressed, checkout };
    };
    it('opens the paste box, fills that box and not the feedback box, and presses its Add', async () => {
      openable();
      const checkout = vi.fn(), pressed: string[] = [];
      document.getElementById('co')!.addEventListener('click', checkout);
      document.querySelector('.switch-mode-link')!.addEventListener('click', () => {
        document.querySelector('.button-add-bulk-lines')!.addEventListener('click', () => pressed.push((document.getElementById('bulk-lines-textarea') as HTMLTextAreaElement).value));
      });
      expect(await mcmasterPasteLine(PART, 1)).toEqual({ kind: 'sent' });
      expect(pressed).toEqual([`${PART}\t1`]);
      expect((document.getElementById('message-input') as HTMLTextAreaElement).value).toBe('');
      expect(checkout).not.toHaveBeenCalled();
    });
    it('needs no opener when the paste box is already open', async () => {
      document.body.innerHTML = page(`${PASTE}${ADD}`);
      const { pressed } = watch();
      expect(await mcmasterPasteLine(PART, 2)).toEqual({ kind: 'sent' });
      expect(pressed).toEqual([`${PART}\t2`]);
    });
    it('stops with nothing typed when the opener opens no paste box, even with the feedback box showing', async () => {
      document.body.innerHTML = page(OPENER);
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        const answer = mcmasterPasteLine(PART, 1);
        await vi.runAllTimersAsync();
        expect(await answer).toEqual({ kind: 'stop', reason: 'unexpected', detail: 'the paste box did not open', notSent: true });
      } finally { vi.useRealTimers(); }
      expect((document.getElementById('message-input') as HTMLTextAreaElement).value).toBe('');
    });
    it('stops with nothing typed on a page with neither', async () => {
      document.body.innerHTML = page('');
      expect(await mcmasterPasteLine(PART, 1)).toMatchObject({ kind: 'stop', detail: 'an order page without the paste control', notSent: true });
      expect((document.getElementById('message-input') as HTMLTextAreaElement).value).toBe('');
    });
    it.each([
      ['no Add at all', '', true],
      ['an Add with another label', '<button class="button-primary button-add-bulk-lines">Check Out</button>', false],
      ['two of them', ADD + ADD, false],
      ['one that\'s turned off', '<button class="button-primary button-add-bulk-lines" disabled>Add</button>', false],
    ])('presses nothing with %s', async (_name, buttons) => {
      document.body.innerHTML = page(`${PASTE}${buttons}<button>Add</button>`);
      const click = vi.fn();
      document.querySelectorAll('button').forEach(node => node.addEventListener('click', click));
      expect(await mcmasterPasteLine(PART, 1)).toMatchObject({ kind: 'stop', detail: 'the paste box has no ADD button', notSent: true });
      expect(click).not.toHaveBeenCalled();
    });
    it('stops when the page doesn\'t keep what was typed', async () => {
      document.body.innerHTML = page(`${PASTE}${ADD}`);
      document.getElementById('bulk-lines-textarea')!.addEventListener('input', event => { (event.target as HTMLTextAreaElement).value = ''; });
      const { pressed } = watch();
      expect(await mcmasterPasteLine(PART, 1)).toMatchObject({ kind: 'stop', detail: 'the paste box did not keep this line', notSent: true });
      expect(pressed).toEqual([]);
    });
  });

  it('a whole line through the runner: adds once, and a second build adds nothing', async () => {
    const cart = new Map<string, number>();
    const draw = () => {
      const rows = [...cart].map(([part, quantity], index) => line(index + 1, part, String(quantity))).join('');
      document.body.innerHTML = page(`${OPENER}<div id="area"></div>${rows}${newRow(cart.size + 1)}`);
      document.querySelector('.switch-mode-link')!.addEventListener('click', () => {
        document.getElementById('area')!.innerHTML = PASTE + ADD;
        document.querySelector('.button-add-bulk-lines')!.addEventListener('click', () => {
          const [part, quantity] = (document.getElementById('bulk-lines-textarea') as HTMLTextAreaElement).value.split('\t');
          cart.set(part, (cart.get(part) ?? 0) + Number(quantity));
          draw();
        });
      });
    };
    draw();
    const tab: StoreTab = { goto: async () => draw(), run: hereTab.run, runThenLoad: hereTab.runThenLoad };
    const line1 = order({ vendor: 'McMaster', urlVendor: 'McMaster', sku: PART, productUrl: `https://www.mcmaster.com/${PART}/`, quantity: 1, unitPrice: null });
    const first = await buildStore(mcmaster, mcmaster.steps!, [line1], tab, options);
    expect(first.stopped).toBeUndefined();
    expect(first.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(cart.get(PART)).toBe(1);
    const second = await buildStore(mcmaster, mcmaster.steps!, [line1], tab, options);
    expect(second.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: expect.stringMatching(/Already in the cart/) });
    expect(cart.get(PART)).toBe(1);
  }, 20_000);
});

describe('4. Amazon\'s subtotal', () => {
  const ASIN = 'B0TESTAAA1', OTHER = 'B0TESTBBB2', SAVED = 'B0TESTCCC3';
  const row = (asin: string, type: string, quantity = 1) => `<div class="a-row sc-list-item" data-asin="${asin}" data-itemtype="${type}" data-quantity="${quantity}" data-price="19.99"></div>`;
  const buybox = (count: number, id = 'sc-subtotal-label-buybox') => `<div id="sc-subtotal-sections-container-retail-buybox"><span id="${id}">Subtotal (${count} items):</span><span id="sc-subtotal-amount-buybox">$59.97</span></div>`;
  it('reads the real buybox label, with 3 active rows and 10 saved', () => {
    const saved = Array.from({ length: 10 }, (_, index) => row(index ? `B0SAVED${String(index).padStart(3, '0')}` : SAVED, 'saved')).join('');
    at('/gp/cart/view.html', `<span id="nav-cart-count">3</span><div id="sc-active-cart">${row(ASIN, 'active')}${row(OTHER, 'active')}${row('B0TESTDDD4', 'active')}</div><div id="sc-saved-cart">${saved}</div>${buybox(3)}`);
    expect(amazonReadCart([ASIN, SAVED])).toEqual({ lines: [{ key: ASIN, quantity: 1, unitPrice: 19.99 }], total: 3 });
  });
  it('a saved row reads as not in the cart, even if it sits inside the active list', () => {
    at('/gp/cart/view.html', `<div id="sc-active-cart">${row(ASIN, 'active')}${row(SAVED, 'saved', 5)}</div>${buybox(1)}`);
    expect(amazonReadCart([SAVED])).toEqual({ lines: [], total: 1 });
  });
  it('keeps the old label as a fallback', () => {
    at('/gp/cart/view.html', `<div id="sc-active-cart">${row(ASIN, 'active')}</div><span id="sc-subtotal-label-activecart">Subtotal (1 item):</span>`);
    expect(amazonReadCart([ASIN])).toMatchObject({ total: 1 });
  });
  it('stops with neither label, or when the label counts more than the rows show', () => {
    at('/gp/cart/view.html', `<div id="sc-active-cart">${row(ASIN, 'active')}</div>`);
    expect(amazonReadCart([ASIN])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
    at('/gp/cart/view.html', `<div id="sc-active-cart">${row(ASIN, 'active')}</div>${buybox(3)}`);
    expect(amazonReadCart([ASIN])).toMatchObject({ kind: 'stop', reason: 'unexpected' });
  });
});

describe('5. Ali Express\'s price', () => {
  const ITEM = '3256802967050384';
  const PATH = `/item/${ITEM}.html`;
  const ADD = '<input class="comet-v2-input-number-input" value="1"><button id="buy">Buy now</button><button id="add"><span>Add to cart</span></button>';
  /** As seen: the hashed class, inside a wrapper whose text runs on. */
  const price = (current = '$0.46') => `<div class="price-default--priceWrap--Abc123"><div class="price-default--currentWrap--A_MNgCG">${current}</div><span>Save $0.18</span><span>$0.64</span></div>`;
  const read = async (html: string) => { at(PATH, `<h1>Solder wire</h1>${html}${ADD}`); return aliexpressReadListing(ITEM, 200); };
  it('reads the price by itself from the real class', async () => {
    expect(await read(price())).toMatchObject({ kind: 'ok', price: '$0.46' });
  });
  it('still reads the older classes', async () => {
    expect(await read('<div class="price--current--x">$1.20</div>')).toMatchObject({ kind: 'ok', price: '$1.20' });
    expect(await read('<div class="product-price-current">US $3.00</div>')).toMatchObject({ kind: 'ok', price: 'US $3.00' });
  });
  it('skips a sale timer and an empty or hidden box, and takes the first price after them', async () => {
    expect(await read(`<div class="price-default--currentTime--x">Ends : 12:00:00</div><div class="price-default--currentEmpty--x"> </div><div class="copy-hidden"><div class="price-default--currentOld--x">$9.99</div></div>${price()}`)).toMatchObject({ kind: 'ok', price: '$0.46' });
  });
  it('a page with only a timer has no price, and another currency still isn\'t US dollars', async () => {
    const timer = await read('<div class="price-default--currentTime--x">Ends : 12:00:00</div>') as { price: string };
    expect(timer.price).toBe('');
    expect(isUsdPrice(timer.price)).toBe(false);
    const other = await read(price('C$0.46')) as { price: string };
    expect(isUsdPrice(other.price)).toBe(false);
  });
  it('pressing Add uses the same read, and presses only Add to cart', async () => {
    at(PATH, `<h1>Solder wire</h1>${price()}${ADD}`);
    const add = vi.fn(), buy = vi.fn();
    document.getElementById('add')!.addEventListener('click', add);
    document.getElementById('buy')!.addEventListener('click', buy);
    expect(await aliexpressPressAdd(ITEM, [], 1, 200, 10)).toEqual({ kind: 'sent' });
    expect(add).toHaveBeenCalledTimes(1);
    expect(buy).not.toHaveBeenCalled();
  });
  it('pressing Add refuses with only a timer showing', async () => {
    at(PATH, `<h1>Solder wire</h1><div class="price-default--currentTime--x">Ends : 12:00:00</div>${ADD}`);
    const add = vi.fn();
    document.getElementById('add')!.addEventListener('click', add);
    expect(await aliexpressPressAdd(ITEM, [], 1, 200, 10)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/US dollars/) });
    expect(add).not.toHaveBeenCalled();
  });
});

describe('6. BambuLab in a narrow window', () => {
  const ID = '222', KEY = 'Test Filament - Beige (2) / Refill / 1kg';
  const ld = `<script type="application/ld+json">${JSON.stringify({ '@type': 'ProductGroup', name: 'Test Filament', url: 'https://us.store.bambulab.com/products/test-filament', hasVariant: [{ name: KEY, sku: ID }, { name: 'Test Filament - White (1) / Refill / 1kg', sku: '111' }] })}</script>`;
  const summary = (count = 1) => `<button type="button" class="summary"><span>Selected：</span><span>Beige (2) / Refill / 1kg</span><span>× ${count}</span></button>`;
  const main = (id: string, value = '1') => `<div class="copy-hidden"><div><button type="button" data-action="decrease-quantity">-</button><input id="${id}" name="quantity" value="${value}"><button type="button">+</button></div></div>`;
  const BAR = '<button id="add" type="submit" data-action="add-to-cart">Add to Cart</button><button id="buy" type="submit" data-action="buy-now">Buy Now</button>';
  /** The sticky bar's one Add to Cart, beside hidden copies of the main box, one in its form. A bundle box is there too. */
  const narrow = (value = '1') => `${ld}<a href="/cart" id="count"></a>${summary()}<form id="buy-form">${main('form-box', value)}${BAR}</form>${main('other-box', value)}<div class="bundle"><div><button>-</button><input name="quantity" value="1"></div></div>`;
  const wire = (limit = 400) => {
    const box = document.getElementById('form-box') as HTMLInputElement, sent: number[] = [], buy = vi.fn();
    let counted = Number(box.value);
    box.addEventListener('focusout', () => {
      counted = Math.min(Number(box.value) || 1, limit);
      box.value = String(counted);
      document.querySelector('.summary span:last-child')!.textContent = `× ${counted}`;
    });
    document.getElementById('buy-form')!.addEventListener('submit', event => event.preventDefault());
    document.getElementById('add')!.addEventListener('click', () => { sent.push(counted); document.getElementById('count')!.textContent = String(sent.reduce((a, b) => a + b, 0)); });
    document.getElementById('buy')!.addEventListener('click', buy);
    return { sent, buy, box };
  };
  beforeEach(() => history.pushState({}, '', `/products/test-filament?id=${ID}`));
  it('quantity 1, with the hidden box already at 1, presses the one Add to Cart', async () => {
    document.body.innerHTML = narrow();
    const { sent, buy } = wire();
    expect(await bambuAddOnPage(ID, KEY, 1, 1000)).toEqual({ kind: 'sent', cartRose: true });
    expect(sent).toEqual([1]);
    expect(buy).not.toHaveBeenCalled();
  });
  describe('as on the real page, where the bar\'s button has no form', () => {
    const formless = (first = '1', second = '1') => `${ld}<a href="/cart" id="count"></a>${summary()}${main('box-a', first)}${main('box-b', second)}${BAR}`;
    const press = () => { const sent = vi.fn(), buy = vi.fn(); document.getElementById('add')!.addEventListener('click', () => { sent(); document.getElementById('count')!.textContent = '1'; }); document.getElementById('buy')!.addEventListener('click', buy); return { sent, buy }; };
    it('quantity 1 presses Add to Cart, with every hidden copy already at 1', async () => {
      document.body.innerHTML = formless();
      const { sent, buy } = press();
      expect(await bambuAddOnPage(ID, KEY, 1, 1000)).toEqual({ kind: 'sent', cartRose: true });
      expect(sent).toHaveBeenCalledOnce();
      expect(buy).not.toHaveBeenCalled();
    });
    it('another quantity is refused, says to widen the window, and changes no box', async () => {
      document.body.innerHTML = formless();
      const { sent, buy } = press();
      const answer = await bambuAddOnPage(ID, KEY, 3, 300);
      expect(answer).toMatchObject({ kind: 'refused', message: expect.stringMatching(/narrow.*quantity of 3.*wider/i) });
      expect(sent).not.toHaveBeenCalled();
      expect(buy).not.toHaveBeenCalled();
      expect((document.getElementById('box-a') as HTMLInputElement).value).toBe('1');
    });
    it('quantity 1 is refused when a hidden copy says something else', async () => {
      document.body.innerHTML = formless('1', '2');
      const { sent } = press();
      expect(await bambuAddOnPage(ID, KEY, 1, 300)).toMatchObject({ kind: 'refused' });
      expect(sent).not.toHaveBeenCalled();
    });
  });
  it('another quantity goes in the hidden box of the button\'s form, and no other', async () => {
    document.body.innerHTML = narrow();
    const { sent, buy } = wire();
    expect(await bambuAddOnPage(ID, KEY, 3, 2000)).toEqual({ kind: 'sent', cartRose: true });
    expect(sent).toEqual([3]);
    expect(buy).not.toHaveBeenCalled();
    expect((document.getElementById('other-box') as HTMLInputElement).value).toBe('1');
    expect((document.querySelector('.bundle input') as HTMLInputElement).value).toBe('1');
  });
  it('refuses clearly when the hidden box won\'t keep the number', async () => {
    document.body.innerHTML = narrow();
    const { sent, buy } = wire();
    document.getElementById('form-box')!.addEventListener('input', event => { (event.target as HTMLInputElement).value = '1'; });
    expect(await bambuAddOnPage(ID, KEY, 3, 500)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/quantity of 3/) });
    expect(sent).toEqual([]);
    expect(buy).not.toHaveBeenCalled();
  });
  it('fails closed with two hidden boxes in its form, or none', async () => {
    document.body.innerHTML = `${ld}${summary()}<form>${main('a')}${main('b')}${BAR}</form>`;
    expect(await bambuAddOnPage(ID, KEY, 1, 300)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/one clear quantity box/) });
    document.body.innerHTML = `${ld}${summary()}<form>${BAR}</form>${main('a')}`;
    expect(await bambuAddOnPage(ID, KEY, 1, 300)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/one clear quantity box/) });
  });
  it('never takes Buy Now for Add to Cart, whatever it says', async () => {
    document.body.innerHTML = `${ld}${summary()}<form>${main('a')}<button id="buy" type="submit" data-action="buy-now">Add to Cart</button></form>`;
    const buy = vi.fn();
    document.getElementById('buy')!.addEventListener('click', buy);
    expect(await bambuAddOnPage(ID, KEY, 1, 300)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/didn't offer Add to Cart/) });
    expect(buy).not.toHaveBeenCalled();
  });
  it('still needs the page to say which option is selected', async () => {
    document.body.innerHTML = `${ld}<form>${main('a')}${BAR}</form>`;
    const add = vi.fn();
    document.getElementById('add')!.addEventListener('click', add);
    expect(await bambuAddOnPage(ID, KEY, 1, 300)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/which option is selected/) });
    expect(add).not.toHaveBeenCalled();
  });
});

describe('7. PowerWerx\'s cart row', () => {
  const row = (sku: string, extra = '', quantity = '1') => `<tr class="apt-row" data-hub-row data-qty="1"><td><span class="apt-row-sku">${sku}</span></td><td><input class="apt-qty-input" data-qty-input value="${quantity}"></td><td>$99.99 ea</td>${extra}</tr>`;
  const cart = (rows: string, count = 1) => `<div id="cartPaneRoot"><span id="hubPaneData" data-count="${count}"></span><table><tbody>${rows}</tbody></table></div>`;
  it('strips the SKU: prefix, and a row with no unit-price cell has no price rather than stopping', () => {
    at('/cart', cart(row('SKU: PowerpoleBag')));
    expect(powerwerxReadCart(['PowerpoleBag'])).toEqual([{ key: 'PowerpoleBag', quantity: 1, unitPrice: null }]);
  });
  it('still compares exactly, including case and a longer SKU', () => {
    at('/cart', cart(row('SKU: PowerpoleBag')));
    expect(powerwerxReadCart(['powerpolebag'])).toEqual([]);
    expect(powerwerxReadCart(['PowerpoleBa'])).toEqual([]);
    at('/cart', cart(row('SKU: PowerpoleBag-2')));
    expect(powerwerxReadCart(['PowerpoleBag'])).toEqual([]);
  });
  it('reads a price when the cell is there', () => {
    at('/cart', cart(row('SKU: PowerpoleBag', '<td data-unit-price>$99.99</td>')));
    expect(powerwerxReadCart(['PowerpoleBag'])).toEqual([{ key: 'PowerpoleBag', quantity: 1, unitPrice: 99.99 }]);
  });
  it('keeps the older cell as a fallback', () => {
    at('/cart', cart('<tr data-hub-row><td class="apt-cell-sku">PowerpoleBag</td><td><input data-qty-input value="2"></td></tr>'));
    expect(powerwerxReadCart(['PowerpoleBag'])).toMatchObject([{ key: 'PowerpoleBag', quantity: 2 }]);
  });
  it('stops on a row with neither, an SKU cell saying nothing else, or no quantity', () => {
    at('/cart', cart('<tr data-hub-row><td>Something</td></tr>'));
    expect(powerwerxReadCart(['PowerpoleBag'])).toMatchObject({ kind: 'stop', detail: 'a cart line with no SKU' });
    at('/cart', cart(row('SKU:')));
    expect(powerwerxReadCart(['PowerpoleBag'])).toMatchObject({ kind: 'stop', detail: 'a cart line with no SKU' });
    at('/cart', cart(row('SKU: PowerpoleBag', '', '')));
    expect(powerwerxReadCart(['PowerpoleBag'])).toMatchObject({ kind: 'stop', detail: 'a cart line with no quantity' });
  });
});

describe('the changed functions stay self-contained', () => {
  it.each([
    ['mcmasterReadCart', mcmasterReadCart, ['1A1', 0, 0]],
    ['mcmasterPasteLine', mcmasterPasteLine, ['1A1', 1]],
    ['onlineMetalsReadCart', onlineMetalsReadCart, [['1A1']]],
    ['amazonReadCart', amazonReadCart, [['1A1']]],
    ['powerwerxReadCart', powerwerxReadCart, [['1A1']]],
    ['aliexpressReadListing', aliexpressReadListing, ['1', 0]],
    ['aliexpressPressAdd', aliexpressPressAdd, ['1', [], 1, 0, 0]],
    ['bambuAddOnPage', bambuAddOnPage, ['1', 'x', 1, 0]],
  ] as [string, (...args: unknown[]) => unknown, unknown[]][])('%s runs from its own text alone, as Chrome runs it', async (_name, func, args) => {
    document.body.innerHTML = '<h1>Nothing here</h1>';
    const copy = new Function(`return (${func.toString()})`)() as (...args: unknown[]) => unknown;
    expect(await copy(...args)).toBeTruthy();
  });
});

describe('9. a row never goes missing silently', () => {
  const valid = (extra = {}) => order({ id: 'hf', vendor: 'Harbor Freight', urlVendor: 'Harbor Freight', sku: '94725', productUrl: 'https://www.harborfreight.com/sae-and-metric-long-reach-hex-key-set-36-piece-94725.html', quantity: 1, description: 'Test hex key set', ...extra });
  it('the real Harbor Freight row is valid, groups under its store, and starts ticked', () => {
    expect(harborFreightSku(valid())).toEqual({ sku: '94725', conflict: false });
    expect(blockedReason(valid(), harborfreight)).toBeNull();
    const row = rowFor(valid());
    expect(row).toMatchObject({ blocked: null, startsTicked: true, store: { id: 'harborfreight' } });
    expect(groupOrders([valid()]).map(group => group.store.id)).toEqual(['harborfreight']);
    expect(leftOutOf(groupOrders([valid()]), new Map())).toEqual([]);
  });
  it.each([
    ['unticked by a person', valid(), new Map([['hf', false]]), /was unticked/],
    ['already in someone\'s cart', valid({ cartMarks: [{ memberName: 'Test Student B', deviceLabel: '', quantity: 1, markedMs: 1, expiresMs: 2, ownDevice: false }] }), new Map(), /already in someone's cart/],
    ['SLOW', valid({ statusGroup: 'SLOW' }), new Map(), /SLOW requests start unticked/],
    ['INCOMPLETE', valid({ statusGroup: 'INCOMPLETE' }), new Map(), /INCOMPLETE requests start unticked/],
    ['a vendor that disagrees with the link', valid({ vendor: 'Home Depot' }), new Map(), /the product link goes to/],
    ['no quantity', valid({ quantity: null }), new Map(), /needs a quantity/],
  ])('a row left out as %s is listed, saying why', (_name, row, ticks, why) => {
    const left = leftOutOf(groupOrders([row]), ticks as Map<string, boolean>);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ order: { id: 'hf' }, store: { label: 'Harbor Freight' }, why: expect.stringMatching(why) });
  });
  it('a row this end can\'t read is counted with the skipped rows, not dropped without a word', () => {
    const good = { id: 'p1', statusGroup: 'NORMAL' };
    const answer = interpretOrders({ status: 200, parsed: true, retryAfter: null, body: { orders: [good, { id: 'p2', statusGroup: 'SOMETHING NEW' }, { statusGroup: 'NORMAL' }], skippedRows: 1 } });
    expect(answer).toMatchObject({ kind: 'orders', orders: [{ id: 'p1' }], skippedRows: 3 });
  });
});
