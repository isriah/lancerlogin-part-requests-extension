// BambuLab isn't a Shopify storefront. The product page lists its options as published data, and `?id=<option>` selects one. The add is the page's
// own quantity box and Add to Cart button, and the read-back is the /cart page's row. The page talks to the store's API itself; nothing here calls it.
// The quantity box only counts once it loses focus: with just an input event the page sent quantity 1, so the page's own "Selected ... × N" is checked first.
import { isOnStore } from '../safety';
import { LineProblem, StoreStop, stopIf, type CartLine, type PageStop, type StoreMethod } from '../store-method';
import type { CartOrder } from '../types';

const HOME = 'https://us.store.bambulab.com';

export interface BambuVariant { id: string; name: string; available: boolean }
type ProductAnswer = { kind: 'ok'; variants: BambuVariant[] } | { kind: 'not-listed' };
type AddAnswer = { kind: 'sent'; cartRose: boolean } | { kind: 'refused'; message: string };

/** The product and option in a saved link. An `id` that isn't a plain number isn't an option, so that link can't be used. */
export function bambuLink(raw: string | null): { handle: string; id: string | null } | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const handle = /^\/products\/([^/?#]+)\/?$/.exec(url.pathname)?.[1];
    const id = url.searchParams.get('id');
    if (!handle || (id !== null && !/^\d+$/.test(id))) return null;
    return { handle: decodeURIComponent(handle), id };
  } catch { return null; }
}
/** The saved option first, confirmed against the SKU. Otherwise an exact SKU match. Otherwise only a product with one option. Never a guess. */
export function chooseBambuVariant(variants: BambuVariant[], id: string | null, sku: string | null): BambuVariant {
  const wanted = sku?.trim() || '';
  const one = (found: BambuVariant): BambuVariant => {
    if (variants.filter(v => v.name === found.name).length > 1) throw new LineProblem('Two options on this product have the same name, so the cart couldn\'t tell them apart.');
    return found;
  };
  if (id) {
    const chosen = variants.find(v => v.id === id);
    if (!chosen) throw new LineProblem('The saved link points to an option this product no longer has.');
    if (wanted && wanted !== chosen.id) throw new LineProblem(`The request says SKU ${wanted}, but the saved link's option is ${chosen.id}.`);
    return one(chosen);
  }
  if (wanted) {
    const chosen = variants.find(v => v.id === wanted);
    if (!chosen) throw new LineProblem(`No option on this product has SKU ${wanted}.`);
    return one(chosen);
  }
  if (variants.length === 1) return one(variants[0]);
  throw new LineProblem('This product has several options, and the saved link and SKU don\'t say which one.');
}
/** Injected on a product page. Reads only each option's ID, name and whether it's in stock, from the page's published data. */
export async function bambuReadProduct(handle: string, waitMs = 10_000): Promise<ProductAnswer | PageStop> {
  const started = Date.now();
  for (;;) {
    if (/just a moment/i.test(document.title)) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check' };
    const shownPassword = [...document.querySelectorAll('input[type="password"]')].some(node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; });
    if (shownPassword) return { kind: 'stop', reason: 'login', detail: 'a sign-in page' };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data: unknown;
      try { data = JSON.parse(script.textContent || ''); } catch { continue; }
      for (const entry of [data].flat() as { '@type'?: unknown; url?: unknown; hasVariant?: unknown }[]) {
        if (entry?.['@type'] !== 'ProductGroup' || !entry.hasVariant) continue;
        let path = '';
        try { path = new URL(String(entry.url)).pathname.replace(/\/$/, ''); } catch { /* No address, so this isn't confirmed as the product asked for. */ }
        if (path !== `/products/${handle}`) return { kind: 'not-listed' };
        const variants = ([entry.hasVariant].flat() as { sku?: unknown; name?: unknown; offers?: unknown }[]).map(v => ({
          id: String(v.sku ?? '').trim(), name: String(v.name ?? '').replace(/\s+/g, ' ').trim(),
          // Only the store saying it has stock counts as in stock.
          available: ([v.offers].flat() as { availability?: unknown }[]).some(offer => /\/InStock$/.test(String(offer?.availability))),
        }));
        return variants.every(v => v.id && v.name) ? { kind: 'ok', variants } : { kind: 'not-listed' };
      }
    }
    if (Date.now() - started >= waitMs) return { kind: 'not-listed' };
    await new Promise(done => setTimeout(done, 250));
  }
}
/**
 * Injected on the cart page, which draws itself after loading. Hands back only the lines asked for. A line is its product title and option text,
 * because a row carries no ID or link. The page holds a second, hidden copy of each row for other screen sizes, which isn't counted.
 */
export async function bambuReadCart(keys: string[], waitMs = 12_000, emptyMs = 1_500): Promise<CartLine[] | PageStop> {
  const started = Date.now();
  const clean = (node: Element | null | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  let emptySince = 0;
  for (;;) {
    if (/just a moment/i.test(document.title)) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check' };
    if ([...document.querySelectorAll('input[type="password"]')].some(shown)) return { kind: 'stop', reason: 'login', detail: 'a sign-in page' };
    // Only read to know the cart has drawn. Nothing here ever presses it.
    const drawn = [...document.querySelectorAll('button')].some(node => shown(node) && /^checkout \d+ items?$/i.test(clean(node)));
    if (drawn) break;
    // An empty cart can show for a moment before the lines arrive, so it has to stay empty.
    const empty = [...document.querySelectorAll('p,div,span,h1,h2,h3')].some(node => node.children.length === 0 && shown(node) && /^your shopping cart is empty/i.test(clean(node)));
    if (!empty) emptySince = 0;
    else if (!emptySince) emptySince = Date.now();
    else if (Date.now() - emptySince >= emptyMs) return [];
    if (Date.now() - started >= waitMs) return { kind: 'stop', reason: 'unexpected', detail: 'a cart page this could not read' };
    await new Promise(done => setTimeout(done, 200));
  }
  const lines = new Map<string, CartLine>();
  for (const title of document.querySelectorAll('h3')) {
    if (!shown(title)) continue;
    // Up from the title to the first box that holds a quantity. A suggestion further down the page reaches several titles first, so it isn't a row.
    let row: Element | null = title.parentElement;
    for (let depth = 0; row && depth < 6 && !row.querySelector('input[type="text"]'); depth++) row = row.parentElement;
    const inputs = row?.querySelectorAll('input[type="text"]');
    if (!row || inputs?.length !== 1 || row.querySelectorAll('h3').length !== 1) continue;
    const option = title.nextElementSibling?.tagName === 'P' ? clean(title.nextElementSibling) : '';
    const key = option ? `${clean(title)} - ${option}` : clean(title);
    if (!keys.includes(key)) continue;
    const text = (inputs[0] as HTMLInputElement).value.trim();
    if (!/^\d+$/.test(text) || Number(text) < 1) return { kind: 'stop', reason: 'unexpected', detail: 'a cart line with no quantity' };
    const quantity = Number(text);
    const prices = [...row.querySelectorAll('span')].map(clean).filter(words => /^\$[\d,]+(\.\d+)?$/.test(words));
    // The row's price is only known to be a unit price for one unit, and only when it's the one price shown.
    const unitPrice = quantity === 1 && prices.length === 1 ? Number(prices[0].slice(1).replaceAll(',', '')) : null;
    const line = lines.get(key);
    if (line) { line.quantity += quantity; line.unitPrice = null; } else lines.set(key, { key, quantity, unitPrice });
  }
  return [...lines.values()];
}
/**
 * Injected on the product page at `?id=<option>`. Confirms the page has that option selected, sets the one main quantity box, checks the page took
 * it, and presses the one button labeled exactly "Add to Cart". Buy Now, Checkout Bundle and everything else are never touched.
 */
export async function bambuAddOnPage(id: string, key: string, quantity: number, waitMs = 12_000): Promise<AddAnswer | PageStop> {
  const started = Date.now();
  const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
  const late = () => Date.now() - started >= waitMs;
  const clean = (node: Element) => (node.textContent ?? '').replace(/\s+/g, ' ').trim();
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const buttons = () => [...document.querySelectorAll('button')];
  const notSent = (message: string): AddAnswer => ({ kind: 'refused', message });
  const inCart = () => Math.max(0, ...[...document.querySelectorAll('a[href="/cart"]')].map(node => Number(clean(node)) || 0));
  // The page's own summary, in the copy for each screen size: "Selected：Beige (10201) / Refill / 1kg × 2".
  const summary = () => buttons().map(node => /^Selected\s*[:：]\s*(.+?)\s*×\s*(\d+)$/.exec(clean(node))).filter(found => !!found).map(found => ({ option: found[1], count: Number(found[2]) }));
  if (new URLSearchParams(location.search).get('id') !== id) return notSent('The product page didn\'t open on the requested option.');
  let group = '', many = true, listed = false;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try { data = JSON.parse(script.textContent || ''); } catch { continue; }
    for (const entry of [data].flat() as { '@type'?: unknown; name?: unknown; hasVariant?: unknown }[]) {
      if (entry?.['@type'] !== 'ProductGroup' || !entry.hasVariant) continue;
      const variants = [entry.hasVariant].flat() as { sku?: unknown }[];
      group = String(entry.name ?? '').replace(/\s+/g, ' ').trim();
      many = variants.length > 1;
      listed = variants.some(v => String(v.sku ?? '').trim() === id);
    }
  }
  if (!listed || !group) return notSent('The product page doesn\'t list the requested option.');
  // Wait for the page to finish drawing, for the Add to Cart button or for a sign that this can't be added.
  let add: HTMLButtonElement | undefined, box: HTMLInputElement | undefined;
  for (;;) {
    if (/just a moment/i.test(document.title)) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check', notSent: true };
    if ([...document.querySelectorAll('input[type="password"]')].some(shown)) return { kind: 'stop', reason: 'login', detail: 'a sign-in page', notSent: true };
    if (buttons().some(node => shown(node) && /notify me when available/i.test(clean(node)))) return notSent('BambuLab shows Notify Me When Available for this option, so it can\'t be added now.');
    const adds = buttons().filter(node => shown(node) && /^add to cart$/i.test(clean(node)) && node.getAttribute('data-action') !== 'buy-now');
    // Bundles further down the page have their own quantity boxes. The main one sits beside its own decrease button.
    const mains = ([...document.querySelectorAll('input[name="quantity"]')] as HTMLInputElement[]).filter(node => node.parentElement?.querySelector('[data-action="decrease-quantity"]'));
    const boxes = mains.filter(shown);
    if (adds.length > 1 || boxes.length > 1) return { kind: 'stop', reason: 'unexpected', detail: 'a product page with several Add to Cart controls', notSent: true };
    // In a window under about 1000px wide, Add to Cart is on a bottom bar and every main box is hidden, with more than one of them. Only the one in the button's own form is its box.
    const addForm = adds[0]?.form;
    const hidden = !boxes.length && addForm ? mains.filter(node => node.form === addForm) : [];
    const main = boxes.length ? boxes[0] : hidden.length === 1 ? hidden[0] : undefined;
    if (adds.length === 1 && main && (!many || summary().length > 0)) { add = adds[0]; box = main; break; }
    if (late()) return notSent(!adds.length ? 'The product page didn\'t offer Add to Cart for this option.' : !main ? 'The product page shows Add to Cart without one clear quantity box for it, so nothing was added.' : 'The product page doesn\'t show which option is selected, so nothing was added.');
    await wait(250);
  }
  if (add.disabled || add.closest('a')) return notSent('The product page\'s Add to Cart isn\'t available for this option.');
  const named = () => summary().every(found => `${group} - ${found.option}` === key);
  if (!named()) return notSent('The product page has a different option selected than the one requested.');
  let shownCount = Number(box.value);
  for (;;) {
    if (shownCount !== quantity) {
      // The way a person types and tabs away. Real focus events may not fire in every tab state, or on a hidden box, so the page also gets the focusout it listens for.
      box.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, String(quantity));
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
      box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      box.blur();
      await wait(400);
    }
    shownCount = Number(box.value);
    const counts = summary().map(found => found.count);
    // A lower number that isn't the starting 1 is the store's own limit. The read-back reports it as short stock.
    const settled = shownCount === quantity || (shownCount > 1 && shownCount < quantity);
    if (settled && counts.every(count => count === shownCount)) break;
    if (late()) return notSent(`The page didn't take a quantity of ${quantity}, so nothing was added.`);
    await wait(400);
  }
  if (!named()) return notSent('The product page changed its selected option, so nothing was added.');
  const before = inCart();
  add.click();
  // Leaving too early could cancel the add. The page's cart count says it landed. The runner's read-back decides either way.
  for (let tries = 0; tries < 24 && inCart() === before; tries++) await wait(250);
  const cartRose = inCart() > before;
  if (!cartRose) {
    const message = [...document.querySelectorAll('[role="alert"],[data-sonner-toast]')].filter(shown).map(clean).find(Boolean);
    if (message) return { kind: 'refused', message: message.slice(0, 300) };
  }
  await wait(300);
  return { kind: 'sent', cartRose };
}

export const bambuProductUrl = (handle: string, id: string): string => `${HOME}/products/${encodeURIComponent(handle)}?id=${id}`;

/** The page's cart count went up for these lines, so their read-back has to find them. */
const landed = new Set<string>();

export const bambu: StoreMethod = {
  id: 'bambu', label: 'BambuLab', badge: 'item', badgeHelp: 'Uses each product page\'s Add to Cart, one line at a time',
  origins: [`${HOME}/*`], hosts: ['us.store.bambulab.com', 'www.us.store.bambulab.com'], startUrl: `${HOME}/cart`, cartUrl: `${HOME}/cart`,
  requiredFields: ['productUrl', 'quantity'],
  missing(order: CartOrder) {
    if (order.productUrl && !(isOnStore(bambu, order.productUrl) && bambuLink(order.productUrl))) return ['a product link on BambuLab\'s site'];
    return [];
  },
  steps: {
    // Only ever run in front: that's how it was seen working, and the quantity box depends on focus.
    foreground: true,
    async resolveLine(order, tab) {
      const link = bambuLink(order.productUrl);
      if (!link) throw new LineProblem('This needs a product link on BambuLab\'s site.');
      await tab.goto(`${HOME}/products/${encodeURIComponent(link.handle)}${link.id ? `?id=${link.id}` : ''}`);
      const product = stopIf(await tab.run(bambuReadProduct, link.handle));
      if (product.kind === 'not-listed') throw new LineProblem('This page doesn\'t list the product in the saved link, so the option couldn\'t be confirmed.');
      const chosen = chooseBambuVariant(product.variants, link.id, order.sku);
      if (!chosen.available) throw new LineProblem('BambuLab shows this option as out of stock (Notify Me When Available).');
      return { key: chosen.name, addAs: bambuProductUrl(link.handle, chosen.id) };
    },
    async readCart(tab, keys) {
      await tab.goto(`${HOME}/cart`);
      const lines = stopIf(await tab.run(bambuReadCart, keys));
      // A row whose name didn't match would read as "not in the cart", and a second build would add it again. Stop and have the person look instead.
      for (const key of keys) if (landed.delete(key) && !lines.some(line => line.key === key)) throw new StoreStop('unexpected', 'the cart count went up, but the line could not be found');
      return lines;
    },
    async addLine(tab, target, quantity) {
      await tab.goto(target.addAs);
      const id = new URL(target.addAs).searchParams.get('id')!;
      const answer = stopIf(await tab.run(bambuAddOnPage, id, target.key, quantity));
      if (answer.kind === 'refused') throw new LineProblem(answer.message);
      if (answer.cartRose) landed.add(target.key);
    },
  },
};
