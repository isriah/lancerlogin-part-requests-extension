// Facts from the real runs in a signed-in browser, one block per finding, using the markup shapes seen there. No real store is contacted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interpretOrders } from '../../src/client';
import { blockedReason, groupOrders, leftOutOf, rowFor } from '../../src/carts/selection';
import { buildStore, stopMessage } from '../../src/carts/runner';
import { StoreStop, type StoreTab } from '../../src/carts/store-method';
import { aliexpressPressAdd, aliexpressReadListing, isUsdPrice } from '../../src/carts/stores/aliexpress';
import { amazonReadCart } from '../../src/carts/stores/amazon';
import { harborFreightReadCart, harborFreightSku, harborfreight } from '../../src/carts/stores/harborfreight';
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

describe('run 2: Harbor Freight\'s cart line has no SKU text', () => {
  const SKU = '94725', HREF = '/sae-and-metric-long-reach-hex-key-set-36-piece-94725.html';
  /** As seen: the link twice, a select with the quantity, and no "SKU" anywhere. */
  const line = (index: number, href: string, quantity: number) => `<div class="line"><a href="${href}"><img alt="">Picture</a><div><button>Remove</button><a href="${href}">PITTSBURGH SAE And Metric Long-Reach Hex Key Set, 36-Piece</a></div><label>Qty: <select id="quantity${index}">${[1, 2, 3, 4].map(n => `<option value="${n}"${n === quantity ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>`;
  const cart = (rows: string) => `<h1>My Cart (1 Items)</h1>${rows}<a href="/checkout/shipping">Checkout</a>`;
  const read = (keys = [SKU]) => harborFreightReadCart(keys, 0, 0);
  beforeEach(() => at('/checkout/cart'));
  it('reads the SKU from the link and the quantity from the select', async () => {
    document.body.innerHTML = cart(line(0, HREF, 1));
    expect(await read()).toEqual([{ key: SKU, quantity: 1 }]);
    document.body.innerHTML = cart(line(0, HREF, 3));
    expect(await read()).toEqual([{ key: SKU, quantity: 3 }]);
  });
  it('hands back only the line asked for, and adds up one SKU on two lines', async () => {
    document.body.innerHTML = cart(line(0, HREF, 2) + line(1, '/other-thing-11111.html', 4));
    const lines = await read();
    expect(lines).toEqual([{ key: SKU, quantity: 2 }]);
    expect(JSON.stringify(lines)).not.toMatch(/11111/);
    document.body.innerHTML = cart(line(0, HREF, 2) + line(1, HREF, 1));
    expect(await read()).toEqual([{ key: SKU, quantity: 3 }]);
  });
  it('another line\'s item isn\'t this line', async () => {
    document.body.innerHTML = cart(line(0, '/other-thing-11111.html', 4));
    expect(await read()).toEqual([]);
  });
  it('a title with a short number, or a suffix after the SKU, still gives the SKU', async () => {
    document.body.innerHTML = cart(line(0, '/set-36-piece-94725-2.html', 1));
    expect(await read()).toEqual([{ key: SKU, quantity: 1 }]);
  });
  it('stops on a line with two different product links', async () => {
    document.body.innerHTML = cart('<div><a href="/a-11111.html">A</a><a href="/b-22222.html">B</a><select id="quantity0"><option selected>1</option></select></div>');
    expect(await read()).toMatchObject({ kind: 'stop', reason: 'unexpected', detail: 'a cart line this could not read' });
  });
  it('stops when a link and SKU text disagree', async () => {
    document.body.innerHTML = cart('<div><a href="/a-11111.html">A</a><span>SKU 22222</span><select id="quantity0"><option selected>1</option></select></div>');
    expect(await read()).toMatchObject({ kind: 'stop', detail: 'a cart line this could not read' });
  });
  it('stops on a control with no link or SKU of its own, rather than borrowing a neighbor\'s or the page\'s', async () => {
    document.body.innerHTML = cart(`<div id="list"><div><select id="quantity0"><option selected>1</option></select></div>${line(1, HREF, 2)}</div>`);
    expect(await read()).toMatchObject({ kind: 'stop', detail: 'a cart line this could not read' });
    document.body.innerHTML = `<a href="${HREF}">Promoted</a><div><select id="quantity0"><option selected>1</option></select></div>`;
    expect(await read(['11111'])).toEqual([]);
  });
  it('still falls back to "SKU n" text, with no product link', async () => {
    document.body.innerHTML = cart('<div><a href="/help">Help</a><span>SKU 94725</span> <select id="quantity0"><option selected>2</option></select></div>');
    expect(await read()).toEqual([{ key: SKU, quantity: 2 }]);
  });
  it('a key whose link is on the page with no line read for it stops, instead of reading zero', async () => {
    document.body.innerHTML = cart(`${line(0, '/other-thing-11111.html', 4)}<a href="${HREF}">Hex key set</a>`);
    expect(await read()).toMatchObject({ kind: 'stop', detail: 'a cart line this could not read' });
    // A link ending in two numbers reads as the first, so the second is on the page with no line.
    document.body.innerHTML = cart(line(0, '/thing-11111-94725.html', 4));
    expect(await read()).toMatchObject({ kind: 'stop', detail: 'a cart line this could not read' });
  });
  it('the real empty page reads as empty', async () => {
    document.body.innerHTML = '<h1>My Cart (0 Items)</h1><p>Your cart is empty.</p>';
    expect(await read()).toEqual([]);
  });
  it('a whole build with the real line: added once, confirmed, and a second build adds nothing', async () => {
    const held = { quantity: 0, adds: [] as number[] };
    const tab: StoreTab = {
      ...hereTab,
      async goto(url) {
        const { pathname } = new URL(url);
        if (pathname === '/checkout/cart') { at(pathname, held.quantity ? cart(line(0, HREF, held.quantity)) : '<h1>My Cart (0 Items)</h1><p>Your cart is empty.</p>'); return; }
        at(HREF, `<a href="/checkout/cart" aria-label="Cart"><span id="count">${held.quantity}</span></a><main><h1>Hex key set</h1><p>SKU: ${SKU}</p><input id="qty" name="qty" value="1"><button id="add">Add to Cart</button></main>`);
        document.getElementById('add')!.addEventListener('click', () => { const n = Number((document.getElementById('qty') as HTMLInputElement).value); held.adds.push(n); held.quantity += n; document.getElementById('count')!.textContent = String(held.quantity); });
      },
    };
    const line1 = order({ vendor: 'Harbor Freight', urlVendor: 'Harbor Freight', sku: SKU, productUrl: `https://www.harborfreight.com${HREF}`, quantity: 1, unitPrice: null });
    const first = await buildStore(harborfreight, harborfreight.steps!, [line1], tab, options);
    expect(first.stopped).toBeUndefined();
    expect(first.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    const second = await buildStore(harborfreight, harborfreight.steps!, [line1], tab, options);
    expect(second.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: expect.stringMatching(/Already in the cart/) });
    expect(held.adds).toEqual([1]);
  }, 30_000);
});

describe('run 2: Ali Express\'s mini-cart on the listing page', () => {
  const ITEM = '3256802967050384', PATH = `/item/${ITEM}.html`;
  const PRICE = '<div class="price-default--currentWrap--A_MNgCG">$0.46</div>';
  /** As seen: the listing's box and buttons in their own wraps, and two rows of the side mini-cart with boxes of their own. */
  const action = '<div class="action--wrap--abc"><input id="own" class="comet-v2-input-number-input" value="1"></div><div class="action--stickyWrap--abc"><button id="buy">Buy now</button><button id="add"><span>Add to cart</span></button></div>';
  const miniRow = (extra = '') => `<div class="cart-product"><a href="/item/1111.html">Other</a><input class="comet-v2-input-number-input" value="5">${extra}</div>`;
  const page = (extra = '') => `<h1>Solder wire</h1>${PRICE}${action}<aside>${miniRow(extra)}${miniRow()}</aside>`;
  const watch = () => {
    const add = vi.fn(), buy = vi.fn(), set = vi.fn();
    document.getElementById('add')!.addEventListener('click', add);
    document.getElementById('buy')!.addEventListener('click', buy);
    document.querySelectorAll('.cart-product input').forEach(node => node.addEventListener('input', set));
    return { add, buy, set };
  };
  it('sets the listing\'s own box and leaves the mini-cart\'s alone', async () => {
    at(PATH, page());
    const { add, buy, set } = watch();
    expect(await aliexpressPressAdd(ITEM, [], 2, 200, 10)).toEqual({ kind: 'sent' });
    expect((document.getElementById('own') as HTMLInputElement).value).toBe('2');
    expect(add).toHaveBeenCalledTimes(1);
    expect(buy).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect([...document.querySelectorAll('.cart-product input')].map(node => (node as HTMLInputElement).value)).toEqual(['5', '5']);
  });
  it('an Add to cart inside the mini-cart doesn\'t count, or get pressed', async () => {
    at(PATH, page('<button id="mini"><span>Add to cart</span></button>'));
    const mini = vi.fn();
    document.getElementById('mini')!.addEventListener('click', mini);
    expect(await aliexpressPressAdd(ITEM, [], 1, 200, 10)).toEqual({ kind: 'sent' });
    expect(mini).not.toHaveBeenCalled();
    at(PATH, `<h1>Solder wire</h1>${PRICE}<aside>${miniRow('<button><span>Add to cart</span></button>')}</aside>`);
    expect(await aliexpressReadListing(ITEM, 0)).toMatchObject({ kind: 'not-offered' });
    expect(await aliexpressPressAdd(ITEM, [], 1, 0, 10)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/no Add to cart/) });
  });
  it('a price, or an option in a mini-cart row, isn\'t the listing\'s', async () => {
    const inRow = '<div class="price--current--x">C$9.00</div><div class="sku-item--x" data-sku-row><div data-sku-col title="Other">Other</div></div>';
    at(PATH, `<aside>${miniRow(inRow)}</aside><h1>Solder wire</h1>${PRICE}${action}`);
    expect(await aliexpressReadListing(ITEM, 200)).toEqual({ kind: 'ok', rows: [], price: '$0.46' });
    expect(await aliexpressPressAdd(ITEM, [], 2, 200, 10)).toEqual({ kind: 'sent' });
  });
  it('two boxes of the listing\'s own still refuse', async () => {
    at(PATH, `${page()}<input class="comet-v2-input-number-input" value="1">`);
    const { add } = watch();
    expect(await aliexpressPressAdd(ITEM, [], 2, 200, 10)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/one clear quantity box/) });
    expect(add).not.toHaveBeenCalled();
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
    ['harborFreightReadCart', harborFreightReadCart, [['94725'], 0, 0]],
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
