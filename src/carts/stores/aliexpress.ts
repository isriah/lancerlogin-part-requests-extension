// Ali Express: selects the option the request names, sets the quantity and presses the listing's own "Add to cart", never "Buy now". Then the cart page's
// rows read back. Selectors were seen in a signed-in browser with one item, and class names there may come from a build, so anything else stops the store
// or fails the line with nothing added. Bot checks appeared in automated profiles, so the first real run through this code is the owner's.
// Owner decision 2026-11-09: proceed only when the option text saved in the request's description exactly matches a listing option. docs/CARTS.md has the rest.
// A new item comes up ticked for checkout. Those ticks are the store's own and nothing here touches them. The results say so.
// A listing also shows a side mini-cart, whose `.cart-product` rows have their own quantity boxes. Nothing inside one counts as a control of the listing.
import { isOnStore } from '../safety';
import { LineProblem, stopIf, type CartLine, type PageStop, type StoreMethod } from '../store-method';
import type { CartOrder } from '../types';

const HOME = 'https://www.aliexpress.us';
const CART = `${HOME}/p/shoppingcart/index.html`;
const HOSTS = ['aliexpress.com', 'www.aliexpress.com', 'm.aliexpress.com', 'mobile.aliexpress.com', 'aliexpress.us', 'www.aliexpress.us', 'm.aliexpress.us'];

export interface AliOption { name: string; selected: boolean; soldOut: boolean }
export type AliRow = AliOption[];
type ListingAnswer = { kind: 'ok'; rows: AliRow[]; price: string } | { kind: 'not-offered'; message: string };

/** The listing's number. A link to anything but one listing can't say which item was meant. */
export function aliexpressItem(raw: string | null | undefined): string | null {
  if (!raw || !isOnStore({ hosts: HOSTS }, raw)) return null;
  return /^\/item\/(\d+)\.html$/.exec(new URL(raw).pathname)?.[1] ?? null;
}
export const isAliexpressListing = (raw: string): boolean => aliexpressItem(raw) !== null;
/** A price a person would read as US dollars. Another dollar, such as C$ or AU$, isn't. */
export const isUsdPrice = (text: string): boolean => /^(?:US\s*)?\$\s*\d/.test(text.trim());

/**
 * Whether this exact option text stands on its own in the description, the way the reader writes it: "Title - Color: Blue / Size: M". A title that merely
 * contains the words doesn't count, and neither does a longer option that starts with them. Letter case counts.
 */
export function descriptionNames(description: string, option: string): boolean {
  const text = description.replace(/\s+/g, ' ').trim(), name = option.replace(/\s+/g, ' ').trim();
  if (!name) return false;
  for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
    const before = text.slice(0, at), after = text.slice(at + name.length);
    if ((!before || / - $| \/ $|: $|, $/.test(before)) && (!after || /^ - |^ \/ |^, /.test(after))) return true;
  }
  return false;
}
/** One option per row, from the description. Never a guess: no match, two matches or a sold-out match refuses the line, and so does a row left unsaid with a real choice in it. */
export function chooseAliexpressOptions(description: string | null, rows: AliRow[]): string[] {
  const wanted: string[] = [];
  for (const row of rows) {
    if (row.some(option => !option.name)) throw new LineProblem('A listing option has no readable name, so nothing was added.');
    const named = row.filter(option => descriptionNames(description ?? '', option.name));
    if (named.length > 1) throw new LineProblem(`The request's description matches more than one listing option (${named.map(option => option.name).join(', ')}), so nothing was added.`);
    if (named.length === 1) {
      if (row.filter(option => option.name === named[0].name).length > 1) throw new LineProblem(`The listing shows "${named[0].name}" twice, so nothing was added.`);
      if (named[0].soldOut) throw new LineProblem(`The listing shows "${named[0].name}" as sold out, so nothing was added.`);
      wanted.push(named[0].name);
    } else if (row.length !== 1 || !row[0].selected) {
      throw new LineProblem(`The request's description doesn't exactly name one of this listing's options (${row.map(option => option.name).join(', ').slice(0, 200)}), so nothing was added.`);
    }
  }
  return wanted;
}
/**
 * What a cart line is called here. `pick` is what to select. `options` and `known` are for telling cart rows apart: the wanted options and all the options, from
 * rows with a real choice in them. A row with one option, such as a single "Ships From", may not be written in the cart at all, and it can't tell two lines apart.
 */
export function aliexpressKey(item: string, pick: string[], rows: AliRow[]): string {
  const known = [...new Set(rows.filter(row => row.length > 1).flat().map(option => option.name))];
  return JSON.stringify({ item, pick, options: pick.filter(name => known.includes(name)), known });
}

/** Injected on a listing, which draws itself. Reads only its options and its price. Selects nothing. */
export async function aliexpressReadListing(item: string, waitMs = 15_000): Promise<ListingAnswer | PageStop> {
  const started = Date.now();
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const words = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  const ofListing = (node: Element) => shown(node) && !node.closest('.cart-product');
  for (;;) {
    const text = words(document.body?.innerText ?? document.body?.textContent);
    if ([...document.querySelectorAll('iframe[src*="punish"],iframe[src*="_____tmd_____"],#baxia-dialog-content,.baxia-dialog,[id^="nc_"],#px-captcha')].some(shown) || /robot check|captcha|are you a human|verify you are (a )?human/i.test(document.title) || (text.length < 2000 && /slide to verify|please slide|unusual traffic|verify you are (a )?human/i.test(text))) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check' };
    if ([...document.querySelectorAll('input[type="password"],iframe[src*="login"]')].some(shown) || [...document.querySelectorAll('[role="dialog"],[class*="comet-modal"]')].some(node => shown(node) && /\b(?:sign|log) in\b/i.test(node.textContent ?? ''))) return { kind: 'stop', reason: 'login', detail: 'a sign-in page' };
    if (location.pathname !== `/item/${item}.html`) return { kind: 'not-offered', message: 'The saved link went to a different page, so nothing was added.' };
    if ([...document.querySelectorAll('button')].some(node => ofListing(node) && words(node.textContent) === 'Add to cart')) break;
    if (Date.now() - started >= waitMs) return { kind: 'not-offered', message: 'Ali Express shows no Add to cart button for this listing.' };
    await new Promise(done => setTimeout(done, 250));
  }
  // Options draw beside the button. A moment's wait means a listing with options isn't read as one without.
  await new Promise(done => setTimeout(done, 500));
  const rows = [...document.querySelectorAll('[data-sku-row]')].filter(ofListing).map(row => [...row.querySelectorAll('[data-sku-col]')].map(col => {
    const marked = [col, ...col.querySelectorAll('[class*="selected"]')].some(node => /selected/i.test(node.getAttribute('class') ?? '') && !/unselected|not-?selected/i.test(node.getAttribute('class') ?? ''));
    const soldOut = /sold-?out|disabled|unavailable/i.test(col.getAttribute('class') ?? '') || col.getAttribute('aria-disabled') === 'true';
    return { name: words(col.getAttribute('title') || col.querySelector('[title]')?.getAttribute('title')), selected: marked, soldOut };
  }));
  // Option controls that this couldn't read must not pass for a listing with no options.
  if (rows.some(row => !row.length) || (!rows.length && [...document.querySelectorAll('[data-sku-col],[class*="sku-item"],[class*="sku-property"]')].some(node => !node.closest('.cart-product')))) return { kind: 'not-offered', message: 'This listing\'s options couldn\'t be read, so nothing was added.' };
  const price = [...document.querySelectorAll('[class*="price-default--current"],[class*="price--current"],[class*="product-price-current"]')].filter(ofListing).map(node => words(node.textContent)).find(text => text && !/^ends\s*:/i.test(text)) ?? '';
  return { kind: 'ok', rows, price };
}

/**
 * Injected on the cart page, which draws itself. A cart can hold several options of one listing, so a row counts only when it has the item and exactly the
 * options asked for. A row of this item that names no known option could be this line written differently, so that stops the store instead of reading as zero,
 * which would double a retry. Nothing about any other line leaves this function.
 */
export async function aliexpressReadCart(keys: string[], waitMs = 20_000, settleMs = 1500): Promise<CartLine[] | PageStop> {
  const started = Date.now();
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const words = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  /** The known options standing in this text, longest first, so "0.8mm" isn't found inside "0.8mm (5Meter)". */
  const optionsIn = (source: string, known: string[]) => {
    const found: string[] = [];
    let text = source;
    for (const name of [...known].sort((a, b) => b.length - a.length)) {
      for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
        const before = text[at - 1] ?? ' ', after = text[at + name.length] ?? ' ';
        if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) continue;
        found.push(name);
        text = `${text.slice(0, at)} ${text.slice(at + name.length)}`;
        break;
      }
    }
    return found;
  };
  let last = '', since = Date.now();
  for (;;) {
    const text = words(document.body?.innerText ?? document.body?.textContent);
    if ([...document.querySelectorAll('iframe[src*="punish"],iframe[src*="_____tmd_____"],#baxia-dialog-content,.baxia-dialog,[id^="nc_"],#px-captcha')].some(shown) || /robot check|captcha|are you a human|verify you are (a )?human/i.test(document.title) || (text.length < 2000 && /slide to verify|please slide|unusual traffic|verify you are (a )?human/i.test(text))) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check' };
    if ([...document.querySelectorAll('input[type="password"],iframe[src*="login"]')].some(shown) || [...document.querySelectorAll('[role="dialog"],[class*="comet-modal"]')].some(node => shown(node) && /\b(?:sign|log) in\b/i.test(node.textContent ?? ''))) return { kind: 'stop', reason: 'login', detail: 'a sign-in page' };
    if (location.pathname !== '/p/shoppingcart/index.html') return { kind: 'stop', reason: 'unexpected', detail: 'a page that isn\'t the cart' };
    const titles = [document.title, ...[...document.querySelectorAll('h1,h2,h3,[class*="title"]')].filter(shown).map(node => words(node.textContent))];
    const counted = titles.map(title => /^(?:shopping )?cart\s*\((\d+)\)/i.exec(title.trim())?.[1]).find(Boolean);
    const count = counted === undefined ? null : Number(counted);
    const rows = [...document.querySelectorAll('.cart-product')].filter(shown);
    const lines = new Map<string, number>();
    let problem = '', total = 0;
    for (const row of rows) {
      const links = [...row.querySelectorAll('a[href]')].map(link => link.getAttribute('href') ?? '');
      const boxes = ([...row.querySelectorAll('input[class*="input-number-input"]')] as HTMLInputElement[]).filter(shown);
      const quantity = boxes.length === 1 && /^\d+$/.test(boxes[0].value.trim()) ? Number(boxes[0].value) : null;
      total += quantity ?? 0;
      for (const key of keys) {
        const { item, options, known } = JSON.parse(key) as { item: string; options: string[]; known: string[] };
        if (!links.some(link => new RegExp(`(?<!\\d)${item}(?!\\d)`).test(link))) continue;
        if (quantity === null || quantity < 1) { problem = 'a cart line with no quantity'; continue; }
        if (known.length) {
          // Where the option is most likely to be written, then the row without its title, then all of it.
          const plain = row.cloneNode(true) as Element;
          plain.querySelectorAll('a').forEach(link => link.remove());
          const places = [[...row.querySelectorAll('[class*="sku"]')].map(node => words(node.textContent)).join(' , '), words(plain.textContent), words(row.textContent)];
          const found = places.map(place => optionsIn(place, known)).find(list => list.length) ?? [];
          if (!found.length) { problem = 'a cart line this could not read'; continue; }
          const hasAll = options.every(name => found.includes(name));
          if (!hasAll) continue;
          if (found.length !== options.length) { problem = 'a cart line this could not read'; continue; }
        }
        lines.set(key, (lines.get(key) ?? 0) + quantity);
      }
    }
    let complete = false;
    if (!problem) {
      if (rows.length) complete = count === null || rows.length >= count || total === count;
      else complete = count === 0 || (count === null && /(?:cart|bag) is (?:currently )?empty|no items/i.test(text));
    }
    const state = JSON.stringify([rows.length, [...lines], count]);
    if (state !== last) { last = state; since = Date.now(); }
    if (complete && Date.now() - since >= settleMs) return keys.filter(key => lines.has(key)).map(key => ({ key, quantity: lines.get(key)! }));
    if (Date.now() - started >= waitMs) return { kind: 'stop', reason: 'unexpected', detail: problem || 'a cart page this could not read' };
    await new Promise(done => setTimeout(done, 250));
  }
}

/**
 * Injected on the listing. Selects the wanted options, confirms they read as selected, sets the one quantity box and presses the one button labeled exactly
 * "Add to cart", once. An option already selected isn't clicked, because a second click can undo it. "Buy now" is never touched. There's no dialog after an
 * add, so whether it landed is for the read-back to say.
 */
export async function aliexpressPressAdd(item: string, wanted: string[], quantity: number, waitMs = 15_000, settleMs = 3000): Promise<{ kind: 'sent' } | { kind: 'refused'; message: string } | PageStop> {
  const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const words = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  const refused = (message: string) => ({ kind: 'refused' as const, message });
  const ofListing = (node: Element) => shown(node) && !node.closest('.cart-product');
  const wall = (notSent: boolean): PageStop | null => {
    const text = words(document.body?.innerText ?? document.body?.textContent);
    if ([...document.querySelectorAll('iframe[src*="punish"],iframe[src*="_____tmd_____"],#baxia-dialog-content,.baxia-dialog,[id^="nc_"],#px-captcha')].some(shown) || /robot check|captcha|are you a human|verify you are (a )?human/i.test(document.title) || (text.length < 2000 && /slide to verify|please slide|unusual traffic|verify you are (a )?human/i.test(text))) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check', notSent };
    if ([...document.querySelectorAll('input[type="password"],iframe[src*="login"]')].some(shown) || [...document.querySelectorAll('[role="dialog"],[class*="comet-modal"]')].some(node => shown(node) && /\b(?:sign|log) in\b/i.test(node.textContent ?? ''))) return { kind: 'stop', reason: 'login', detail: 'a sign-in page', notSent };
    return null;
  };
  const addButtons = () => [...document.querySelectorAll('button')].filter(node => ofListing(node) && words(node.textContent) === 'Add to cart');
  const nameOf = (col: Element) => words(col.getAttribute('title') || col.querySelector('[title]')?.getAttribute('title'));
  const isSelected = (col: Element) => [col, ...col.querySelectorAll('[class*="selected"]')].some(node => /selected/i.test(node.getAttribute('class') ?? '') && !/unselected|not-?selected/i.test(node.getAttribute('class') ?? ''));
  const rows = () => [...document.querySelectorAll('[data-sku-row]')].filter(ofListing).map(row => [...row.querySelectorAll('[data-sku-col]')].filter(shown));
  const started = Date.now();
  for (;;) {
    const stop = wall(true);
    if (stop) return stop;
    if (addButtons().length) break;
    if (Date.now() - started >= waitMs) return refused('Ali Express shows no Add to cart button for this listing.');
    await wait(250);
  }
  if (location.pathname !== `/item/${item}.html`) return refused('The saved link went to a different page, so nothing was added.');
  await wait(500);
  const allNames = rows().flat().map(nameOf);
  const missing = wanted.find(name => allNames.filter(other => other === name).length !== 1);
  if (missing) return refused(`The listing no longer shows "${missing}" as one clear option, so nothing was added.`);
  for (const name of wanted) {
    const col = rows().flat().find(node => nameOf(node) === name);
    if (!col) return refused(`The listing no longer shows "${name}", so nothing was added.`);
    if (!isSelected(col)) {
      (col as HTMLElement).click();
      for (let tries = 0; tries < 20 && !isSelected(rows().flat().find(node => nameOf(node) === name) ?? col); tries++) await wait(150);
    }
  }
  // Checked once all are clicked, since picking one option can change another row. Each row has one selected, and it's the one wanted or the row's only option.
  for (const row of rows()) {
    const on = row.filter(isSelected);
    if (on.length !== 1 || !(wanted.includes(nameOf(on[0])) || row.length === 1)) return refused('The listing didn\'t keep the requested option selected, so nothing was added.');
  }
  for (const name of wanted) if (!rows().flat().some(node => nameOf(node) === name && isSelected(node))) return refused(`The listing didn't keep "${name}" selected, so nothing was added.`);
  const price = [...document.querySelectorAll('[class*="price-default--current"],[class*="price--current"],[class*="product-price-current"]')].filter(ofListing).map(node => words(node.textContent)).find(text => text && !/^ends\s*:/i.test(text)) ?? '';
  if (!/^(?:US\s*)?\$\s*\d/.test(price)) return refused('Ali Express isn\'t showing this price in US dollars, so nothing was added.');
  const boxes = ([...document.querySelectorAll('input[class*="input-number-input"]')] as HTMLInputElement[]).filter(ofListing);
  if (boxes.length !== 1) return refused('The page doesn\'t show one clear quantity box for this listing, so nothing was added.');
  if (Number(boxes[0].value) !== quantity) {
    // The page's own framework watches for input events, so the value goes in the way typing would and the events follow.
    boxes[0].focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(boxes[0], String(quantity));
    boxes[0].dispatchEvent(new Event('input', { bubbles: true }));
    boxes[0].dispatchEvent(new Event('change', { bubbles: true }));
    boxes[0].blur();
    await wait(500);
    if (Number(boxes[0].value) !== quantity) return refused(`Ali Express's quantity box would not take ${quantity}, so nothing was added.`);
  }
  const buttons = addButtons();
  if (buttons.length !== 1) return refused('The page doesn\'t show one clear Add to cart for this listing, so nothing was added.');
  if (buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true') return refused('Ali Express shows Add to cart as unavailable for this option.');
  const address = `${buttons[0].getAttribute('formaction') ?? ''} ${buttons[0].closest('form')?.getAttribute('action') ?? ''} ${buttons[0].closest('a')?.getAttribute('href') ?? ''}`;
  if (/check\s?out|\bbuy\b|\bpay\b|place.?order/i.test(address)) return { kind: 'stop', reason: 'unexpected', detail: 'an Add to cart that goes somewhere else', notSent: true };
  const stopBefore = wall(true);
  if (stopBefore) return stopBefore;
  buttons[0].click();
  // There's no sign the add landed, so this only gives it time, and watches for a wall drawn because of it.
  const pressed = Date.now();
  while (Date.now() - pressed < settleMs) {
    await wait(200);
    const stop = wall(false);
    if (stop) return stop;
  }
  return { kind: 'sent' };
}

export const aliexpress: StoreMethod = {
  id: 'aliexpress', label: 'Ali Express', badge: 'item', badgeHelp: 'Selects the option named in the request and presses Add to cart, one line at a time',
  // Builds use the .us site. The .com origin is there in case the store sends a listing to it, since a link can be saved from either.
  origins: [`${HOME}/*`, 'https://www.aliexpress.com/*'], hosts: HOSTS, startUrl: CART, cartUrl: CART, requiredFields: ['productUrl', 'quantity'],
  resultNote: 'Ali Express ticks a newly added item for checkout by itself. This leaves those ticks alone, so check them in the cart before you pay.',
  missing: (order: CartOrder) => order.productUrl && !isAliexpressListing(order.productUrl) ? ['a link to one Ali Express listing'] : [],
  steps: {
    // Real clicks on a page that draws itself, seen working only in a tab that's showing.
    foreground: true,
    async resolveLine(order, tab) {
      const item = aliexpressItem(order.productUrl);
      if (!item) throw new LineProblem('This needs a link to one Ali Express listing.');
      const listing = `${HOME}/item/${item}.html`;
      await tab.goto(listing);
      const answer = stopIf(await tab.run(aliexpressReadListing, item));
      if (answer.kind === 'not-offered') throw new LineProblem(answer.message);
      if (!isUsdPrice(answer.price)) throw new LineProblem('Ali Express isn\'t showing this price in US dollars, so nothing was added.');
      const options = chooseAliexpressOptions(order.description, answer.rows);
      return { key: aliexpressKey(item, options, answer.rows), addAs: listing };
    },
    async readCart(tab, keys) {
      await tab.goto(CART);
      return stopIf(await tab.run(aliexpressReadCart, keys));
    },
    async addLine(tab, target, quantity) {
      const { item, pick } = JSON.parse(target.key) as { item: string; pick: string[] };
      await tab.goto(target.addAs);
      const answer = stopIf(await tab.run(aliexpressPressAdd, item, pick, quantity));
      if (answer.kind === 'refused') throw new LineProblem(answer.message);
    },
  },
};
