// Swyft's Next.js site has no add address, so a line is the product page's own buttons: its options, its + control and its Add to Cart. The cart is
// read from the swyft.cart.v2 entry in localStorage, which only the site writes. Each host keeps its own cart there, so every page opens on the one host the
// site calls canonical. Adds accumulate, and the page shows no stock limit. The drawer that opens after an add holds Checkout, which nothing here touches.
import { isOnStore } from '../safety';
import { LineProblem, stopIf, type CartLine, type LineTarget, type PageStop, type StoreMethod } from '../store-method';
import type { CartOrder } from '../types';

const HOME = 'https://swyftrobotics.com';
const HOST = 'swyftrobotics.com';
/** The categories a product can be under. Old ones redirect, so the address is never what identifies an item: the SKU on the page is. */
const PRODUCT_PATH = /^\/(?:products?|motion|structure|electrical|materials|machines|kits)\/[^/]+\/?$/;

/** The address to open on the canonical host, with only the saved option kept. Null when this isn't a Swyft product link. */
export function swyftLink(raw: string | null): { url: string; variant: string | null } | null {
  if (!raw) return null;
  try {
    const link = new URL(raw);
    if (!PRODUCT_PATH.test(link.pathname)) return null;
    const variant = link.searchParams.get('variant');
    const saved = variant && /^\d+$/.test(variant) ? variant : null;
    return { url: `${HOME}${link.pathname}${saved ? `?variant=${saved}` : ''}`, variant: saved };
  } catch { return null; }
}

/** What the request says about the item. */
export interface SwyftRequest { sku: string | null; variant: string | null; description: string | null }
export type SwyftChoice =
  | { kind: 'chosen'; sku: string; soldOut: boolean; note?: string }
  | { kind: 'problem'; message: string }
  | { kind: 'not-found' };

/**
 * Injected on a product page. Waits for the page, then gets the option the request names pressed. Pressed options are confirmed by the SKU the page
 * then shows. Anything that can't be matched exactly comes back as a problem, even though the page always has some option pressed already.
 */
export async function swyftChoose(request: SwyftRequest, waitMs = 15_000): Promise<SwyftChoice | PageStop> {
  const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
  const clean = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').trim();
  const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();
  const started = Date.now();
  // The block with the title, price, options and quantity. Related products lower down have Add to Cart buttons of their own, so nothing looks outside it.
  const buyBox = () => document.querySelector('main h1')?.parentElement?.parentElement ?? null;
  const shownSku = (box: Element) => [...new Set([...box.querySelectorAll('span')].map(span => /^SKU:\s*(.*)$/.exec(clean(span.textContent))?.[1]).filter((sku): sku is string => sku !== undefined))];
  const buttons = (box: Element) => [...box.querySelectorAll('button')].filter(button => !button.hasAttribute('aria-pressed'));
  for (;;) {
    if ([...document.querySelectorAll('input[type="password"]')].some(node => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })) return { kind: 'stop', reason: 'login', detail: 'a sign-in page', notSent: true };
    if (/just a moment|attention required|verify you are|access denied|robot check/i.test(document.title)) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check', notSent: true };
    if (/product not found/i.test(document.title)) return { kind: 'not-found' };
    const box = buyBox();
    if (box?.querySelector('button[aria-label="Increase quantity"]') && shownSku(box).length) break;
    if (Date.now() - started >= waitMs) {
      if (document.readyState === 'complete' && box) return { kind: 'problem', message: 'This link goes to a page with no item to add, such as a category.' };
      return { kind: 'stop', reason: 'unexpected', detail: 'a product page in another shape', notSent: true };
    }
    await sleep(150);
  }
  const box = buyBox()!;
  const first = shownSku(box);
  if (first.length !== 1) return { kind: 'stop', reason: 'unexpected', detail: 'a product page with more than one SKU at the top', notSent: true };
  // Each set of options sits under its own label, which keeps out the Save button beside Add to Cart.
  const groups = () => [...buyBox()!.querySelectorAll('label')].map(label => [...(label.nextElementSibling?.querySelectorAll<HTMLButtonElement>('button[aria-pressed]') ?? [])]).filter(group => group.length);
  const pressed = (group: HTMLButtonElement[]) => group.find(button => button.getAttribute('aria-pressed') === 'true');
  const press = async (text: string, index: number): Promise<boolean> => {
    // Until the page has finished starting up a click does nothing, and pressing an option that's already pressed changes nothing, so this can ask again.
    for (let tries = 0; tries < 8; tries++) {
      const button = groups()[index]?.find(option => clean(option.textContent) === text);
      if (!button || button.disabled) return false;
      if (button.getAttribute('aria-pressed') === 'true') return true;
      button.click();
      for (let waited = 0; waited < 600; waited += 100) {
        await sleep(100);
        if (groups()[index]?.find(option => clean(option.textContent) === text)?.getAttribute('aria-pressed') === 'true') return true;
      }
    }
    return false;
  };

  const title = clean(document.querySelector('main h1')?.textContent);
  const description = clean(request.description).replace(title, ' ');
  const named = (text: string) => new RegExp(`(?:^|[^a-z0-9])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(description);
  // The options the description names, group by group. Null for a group where it names none or more than one.
  const fromDescription = groups().map(group => { const hits = group.map(option => clean(option.textContent)).filter(named); return hits.length === 1 ? hits[0] : null; });
  const wanted = clean(request.sku);
  const linkKept = !!request.variant && new URLSearchParams(location.search).get('variant') === request.variant;
  let note: string | undefined;

  if (request.variant && linkKept && ![...document.querySelectorAll('script')].some(script => (script.textContent || '').includes(`ProductVariant/${request.variant}`))) {
    return { kind: 'problem', message: 'The saved link points to an option this product no longer has.' };
  }
  if (wanted) {
    if (!same(first[0], wanted)) {
      if (linkKept) return { kind: 'problem', message: `The request says SKU ${wanted}, but the saved link's option is SKU ${first[0]}.` };
      // The list further down the page gives each option's SKU and name, such as "40 Tooth / 5mm Width". It's a guide: what gets pressed is confirmed below.
      const rows = [...document.querySelectorAll('main span')].filter(span => !box.contains(span) && same(clean(span.textContent), `SKU: ${wanted}`));
      const names = [...new Set(rows.map(span => clean(span.closest('.justify-between')?.querySelector('span')?.textContent)))];
      if (!names.length || !names[0]) return { kind: 'problem', message: `No option on this product has SKU ${wanted}.` };
      if (names.length > 1) return { kind: 'problem', message: `More than one option on this product has SKU ${wanted}.` };
      const parts = ` / ${names[0]} / `.toUpperCase();
      for (const [index, group] of groups().entries()) {
        const hits = group.map(option => clean(option.textContent)).filter(text => parts.includes(` / ${text.toUpperCase()} / `));
        if (hits.length !== 1) return { kind: 'problem', message: `Couldn't tell which option has SKU ${wanted}.` };
        if (!await press(hits[0], index)) return { kind: 'problem', message: `The option for SKU ${wanted} couldn't be selected.` };
      }
    }
  } else if (!linkKept) {
    // No SKU and no saved option: only a product with one choice, or a description that names one option in every group that has a choice.
    const choices = groups();
    if (choices.some((group, index) => group.length > 1 && !fromDescription[index])) return { kind: 'problem', message: 'This product has several options, and the saved link, SKU and description don\'t say which one.' };
    for (const [index, text] of fromDescription.entries()) if (text && !await press(text, index)) return { kind: 'problem', message: `The option ${text} couldn't be selected.` };
    if (choices.length) note = 'The request has no SKU, so the option was chosen from its description. Check it in the cart.';
  }
  // The page takes a moment to show what was pressed.
  let sku = '';
  for (let waited = 0; waited < 5000; waited += 200) {
    const top = shownSku(buyBox()!);
    sku = top.length === 1 ? top[0] : '';
    if (sku && (!wanted || same(sku, wanted))) break;
    await sleep(200);
  }
  if (wanted && !same(sku, wanted)) return { kind: 'problem', message: `The page shows SKU ${sku || 'none'} after selecting the option for SKU ${wanted}.` };
  if (!sku) return { kind: 'problem', message: 'The store shows no SKU for this item, so it couldn\'t be confirmed in the cart.' };
  for (const [index, group] of groups().entries()) {
    const on = clean(pressed(group)?.textContent);
    if (fromDescription[index] && on && !same(fromDescription[index]!, on)) return { kind: 'problem', message: `The description says ${fromDescription[index]}, but SKU ${sku} is ${on}.` };
  }
  const now = buyBox()!;
  const canAdd = buttons(now).some(button => /^add to cart$/i.test(clean(button.textContent)) && !button.disabled);
  const soldOut = !canAdd && buttons(now).some(button => /sold out|out of stock/i.test(clean(button.textContent)));
  if (!canAdd && !soldOut) return { kind: 'problem', message: 'This page has no Add to Cart button for this item.' };
  return { kind: 'chosen', sku, soldOut, ...(note ? { note } : {}) };
}

/** Injected. Reads the cart the site keeps in this browser, and never writes it. Hands back only the lines asked for. SKUs compare in upper case. */
export function swyftReadCart(keys: string[], host: string): CartLine[] | PageStop {
  if (location.hostname !== host) return { kind: 'stop', reason: 'unexpected', detail: 'another host, which has a cart of its own' };
  const raw = localStorage.getItem('swyft.cart.v2');
  // Until something is first added, a new browser may have no cart at all.
  if (raw === null) return [];
  let items: { sku?: unknown; quantity?: unknown; unitPrice?: unknown }[];
  try { items = JSON.parse(raw); } catch { return { kind: 'stop', reason: 'unexpected', detail: 'a cart that was not data' }; }
  if (!Array.isArray(items)) return { kind: 'stop', reason: 'unexpected', detail: 'a cart in another shape' };
  const lines = new Map<string, CartLine>();
  for (const item of items) {
    const key = typeof item?.sku === 'string' ? item.sku.trim().toUpperCase() : '';
    if (!keys.includes(key)) continue;
    if (typeof item.quantity !== 'number') return { kind: 'stop', reason: 'unexpected', detail: 'a cart line with no quantity' };
    const line = lines.get(key);
    if (line) line.quantity += item.quantity; else lines.set(key, { key, quantity: item.quantity, unitPrice: typeof item.unitPrice === 'number' ? item.unitPrice / 100 : null });
  }
  return [...lines.values()];
}

/**
 * Injected on the product page that swyftChoose left. Checks the SKU, sets the quantity with the + control and presses Add to Cart once. A click before
 * the page has started up is lost, so the number shown decides each step, not the count of clicks. Quantity 1 presses + and - first to prove the page is
 * listening, because a lost Add to Cart can't safely be pressed again.
 */
export async function swyftAddLine(sku: string, quantity: number, pauseMs = 400): Promise<{ kind: 'sent' } | { kind: 'refused'; message: string } | PageStop> {
  const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
  const clean = (text: string | null | undefined) => (text || '').replace(/\s+/g, ' ').trim();
  const stop = (detail: string): PageStop => ({ kind: 'stop', reason: 'unexpected', detail, notSent: true });
  const box = document.querySelector('main h1')?.parentElement?.parentElement;
  if (!box) return stop('a page with no product');
  const top = [...new Set([...box.querySelectorAll('span')].map(span => /^SKU:\s*(.*)$/.exec(clean(span.textContent))?.[1]).filter(Boolean))];
  if (top.length !== 1 || top[0]!.toUpperCase() !== sku.toUpperCase()) return stop('a product page showing another SKU');
  const controls = [...box.querySelectorAll('button')].filter(button => !button.hasAttribute('aria-pressed'));
  const add = controls.find(button => /^add to cart$/i.test(clean(button.textContent)));
  const more = box.querySelector<HTMLButtonElement>('button[aria-label="Increase quantity"]');
  const less = box.querySelector<HTMLButtonElement>('button[aria-label="Decrease quantity"]');
  if (!add) {
    const message = clean(controls.find(button => /sold out|out of stock/i.test(clean(button.textContent)))?.textContent);
    return message ? { kind: 'refused', message } : stop('a product page with no Add to Cart');
  }
  if (add.disabled) return { kind: 'refused', message: 'The store has Add to Cart turned off for this item.' };
  if (!more || !less) return stop('a product page with no quantity control');
  const shown = () => Number(clean(more.parentElement?.querySelector('span')?.textContent) || NaN);
  if (!Number.isInteger(shown())) return stop('a quantity control with no number');
  const step = async (button: HTMLButtonElement): Promise<boolean> => {
    const from = shown();
    for (let tries = 0; tries < 8; tries++) {
      button.click();
      // A click that lands shows at once, which also keeps this quick in a background tab, where timers run slowly.
      await Promise.resolve();
      if (shown() !== from) return true;
      for (let waited = 0; waited < pauseMs; waited += 50) { await sleep(50); if (shown() !== from) return true; }
    }
    return false;
  };
  const setTo = async (target: number): Promise<PageStop | null> => {
    while (shown() !== target) {
      const button = shown() < target ? more : less;
      // A stock limit on the + control. Nothing has been seen to set one, but the read-back reports the short line if one does.
      if (button.disabled) return button === more ? null : stop('a quantity control that would not go down');
      if (!await step(button)) return stop('a quantity control that did not respond');
    }
    return null;
  };
  if (quantity === 1 && shown() === 1) {
    if (more.disabled) await sleep(1500);
    else { const failed = await setTo(2) ?? await setTo(1); if (failed) return failed; }
  } else { const failed = await setTo(quantity); if (failed) return failed; }
  if (shown() > quantity) return stop('a quantity control that went past the amount asked for');

  // The page's cart loads from localStorage while it starts up. Pressing Add before then could save a cart without the lines already in it.
  const inStorage = () => { try { const items = JSON.parse(localStorage.getItem('swyft.cart.v2') ?? '[]'); return Array.isArray(items) ? items.reduce((sum: number, item: { quantity?: unknown }) => sum + (typeof item?.quantity === 'number' ? item.quantity : 0), 0) : NaN; } catch { return NaN; } };
  const inHeader = () => Number(/^Cart,\s*(\d+)/.exec(document.querySelector('button[aria-label^="Cart,"]')?.getAttribute('aria-label') ?? '')?.[1] ?? NaN);
  for (let waited = 0; inHeader() !== inStorage(); waited += 100) {
    if (waited >= 5000) return stop('a cart that had not finished loading');
    await sleep(100);
  }
  // On loading, a page with a cart asks the store's server about it. If that answer arrives after Add, the site puts the old count back in localStorage
  // while the server keeps the add: seen live, with the cart page then showing 3 at the price of 5. A retry would then add more, so Add waits for the answer.
  // Its own requests are the only fetches to this path without _rsc, which is how the site's page data is fetched.
  const answers = () => performance.getEntriesByType('resource').filter(entry => {
    if ((entry as PerformanceResourceTiming).initiatorType !== 'fetch') return false;
    try { const url = new URL(entry.name); return url.pathname === location.pathname && !url.searchParams.has('_rsc'); } catch { return false; }
  }).length;
  if (localStorage.getItem('swyft.shopify_cart_id') !== null) {
    for (let waited = 0; answers() === 0; waited += 100) {
      if (waited >= 15_000) return stop('a cart that was still being read from the store');
      await sleep(100);
    }
  }
  const before = localStorage.getItem('swyft.cart.v2');
  const asked = answers();
  add.click();
  // Waits for the store to answer the add as well, so that nothing that follows can cut it off.
  for (let waited = 0; waited < 8000 && (localStorage.getItem('swyft.cart.v2') === before || answers() === asked); waited += 100) await sleep(100);
  return { kind: 'sent' };
}

export const swyft: StoreMethod = {
  id: 'swyft', label: 'Swyft', badge: 'item', badgeHelp: 'Presses the product page\'s own buttons, one line at a time',
  origins: [`${HOME}/*`],
  hosts: [HOST, `www.${HOST}`, `m.${HOST}`, `mobile.${HOST}`],
  startUrl: `${HOME}/cart`, cartUrl: `${HOME}/cart`,
  requiredFields: ['productUrl', 'quantity'],
  missing(order: CartOrder) {
    return order.productUrl && !(isOnStore(swyft, order.productUrl) && swyftLink(order.productUrl)) ? ['a product link on Swyft\'s site'] : [];
  },
  steps: {
    // These are real clicks that wait on the page starting up, and they have only been seen working in a tab that's showing.
    foreground: true,
    async resolveLine(order, tab): Promise<LineTarget> {
      const link = swyftLink(order.productUrl);
      if (!link) throw new LineProblem('This needs a product link on Swyft\'s site.');
      await tab.goto(link.url);
      const choice = stopIf(await tab.run(swyftChoose, { sku: order.sku, variant: link.variant, description: order.description }));
      if (choice.kind === 'not-found') throw new LineProblem('The store no longer has this product page.');
      if (choice.kind === 'problem') throw new LineProblem(choice.message);
      return { key: choice.sku.toUpperCase(), addAs: choice.sku, ...(choice.soldOut ? { available: false } : {}), ...(choice.note ? { note: choice.note } : {}) };
    },
    async readCart(tab, keys) { return stopIf(await tab.run(swyftReadCart, keys, HOST)); },
    async addLine(tab, target, quantity) {
      const answer = stopIf(await tab.run(swyftAddLine, target.addAs, quantity, 400));
      if (answer.kind === 'refused') throw new LineProblem(answer.message);
    },
  },
};
