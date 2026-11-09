// Amazon's product page, /dp/<ASIN>: its quantity list and its own Add to cart button, then a read of /gp/cart/view.html. Amazon's add link did nothing for a
// signed-in account, so it isn't used. These shapes, and the cart page's, were seen signed in, and the add worked by hand. A signed-out browser gets a sign-in
// page, which stops the store. Anything that doesn't match exactly stops the store or fails the line with nothing pressed. docs/CARTS.md has what's left to check.
import { isOnStore } from '../safety';
import { LineProblem, StoreStop, stopIf, type CartLine, type PageStop, type StoreMethod, type StoreSteps, type StoreTab } from '../store-method';
import type { CartOrder } from '../types';

const HOME = 'https://www.amazon.com';
const CART = `${HOME}/gp/cart/view.html`;
const HOSTS = ['www.amazon.com', 'amazon.com', 'm.amazon.com', 'mobile.amazon.com'];
const LINK_ASIN = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i;
// A SKU is often the maker's part number, so only the shape of a current Amazon ID counts. Older and book IDs have to come from the link.
const SKU_ASIN = /^B0[A-Z0-9]{8}$/;

/** The ASIN: from an amazon.com link, or a SKU that can only be one. A link anywhere else gives nothing, because an ID there may not mean the same item here. */
export function amazonAsin(order: Pick<CartOrder, 'productUrl' | 'sku'>): { asin: string | null; conflict: boolean } {
  const sku = order.sku?.trim().toUpperCase() ?? '';
  const fromSku = SKU_ASIN.test(sku) ? sku : null;
  if (!order.productUrl) return { asin: fromSku, conflict: false };
  if (!isOnStore({ hosts: HOSTS }, order.productUrl)) return { asin: null, conflict: false };
  const fromLink = LINK_ASIN.exec(new URL(order.productUrl).pathname)?.[1]?.toUpperCase() ?? null;
  return { asin: fromLink ?? fromSku, conflict: !!fromLink && !!fromSku && fromLink !== fromSku };
}
export const amazonProductLink = (asin: string): string => `${HOME}/dp/${encodeURIComponent(asin)}`;

/**
 * Injected after every load, ahead of anything else. The shared check can't see Amazon's sign-in page, which asks for an email with no password box and
 * none of the words that check looks for. It only looks: it never presses "Continue shopping" or anything else on a wall.
 */
export function amazonWall(): { kind: 'ok' } | PageStop {
  const path = location.pathname + location.search;
  if (/^\/(ap|ax)\//.test(location.pathname)) return { kind: 'stop', reason: 'login', detail: 'a sign-in page', notSent: true };
  if (/\/gp\/buy(\/|$)|check\s*-?out/i.test(path)) return { kind: 'stop', reason: 'unexpected', detail: 'a checkout page' };
  const text = (document.body?.innerText ?? document.body?.textContent ?? '').replace(/\s+/g, ' ');
  const shortPage = text.length < 3000;
  if (location.pathname.startsWith('/errors/') || document.querySelector('form[action*="validateCaptcha"]') || shortPage && /characters you see|not a robot|click the button below to continue shopping/i.test(text)) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check', notSent: true };
  if (/hello,\s*sign in/i.test(document.querySelector('#nav-link-accountList')?.textContent ?? '')) return { kind: 'stop', reason: 'login', detail: 'not signed in', notSent: true };
  return { kind: 'ok' };
}
/**
 * Injected on the cart page. Hands back only the lines asked for, plus how many units the active cart holds, which only lets the store see an add land
 * under another ASIN. Saved for Later is not the cart. A cart that shows fewer units than it says it holds may be hiding the line, so that stops rather
 * than reading as zero, which would double it.
 */
export function amazonReadCart(keys: string[]): { lines: CartLine[]; total: number } | PageStop {
  const active = document.querySelector('#sc-active-cart');
  const rows = [...(active?.querySelectorAll('.sc-list-item[data-asin]') ?? [])].filter(row => (row.getAttribute('data-itemtype') ?? 'active') === 'active');
  if (!rows.length) {
    const text = document.body?.innerText ?? document.body?.textContent ?? '';
    return /your amazon cart is empty/i.test(text) ? { lines: [], total: 0 } : { kind: 'stop', reason: 'unexpected', detail: 'a cart page this could not read' };
  }
  const lines = new Map<string, CartLine>();
  let total = 0;
  for (const row of rows) {
    const quantity = Number(row.getAttribute('data-quantity') ?? NaN);
    if (!Number.isInteger(quantity) || quantity < 0) return { kind: 'stop', reason: 'unexpected', detail: 'a cart line with no quantity' };
    total += quantity;
    const key = (row.getAttribute('data-asin') ?? '').trim().toUpperCase();
    if (!keys.includes(key)) continue;
    const price = Number(row.getAttribute('data-price') ?? NaN);
    const unitPrice = Number.isFinite(price) && price > 0 ? price : null;
    const line = lines.get(key);
    if (line) { line.quantity += quantity; if (line.unitPrice !== unitPrice) line.unitPrice = null; }
    else lines.set(key, { key, quantity, unitPrice });
  }
  // The count leaves out unticked lines, so it can be lower than the rows. Only higher means rows are missing.
  const said = /\(\s*([\d,]+)\s+items?\s*\)/i.exec((document.querySelector('#sc-subtotal-label-buybox') ?? document.querySelector('#sc-subtotal-label-activecart'))?.textContent ?? '')?.[1];
  if (said === undefined || Number(said.replaceAll(',', '')) > total) return { kind: 'stop', reason: 'unexpected', detail: 'a cart page that may not show every line' };
  return { lines: [...lines.values()], total };
}
/**
 * Injected on the product page. Checks that the page is this ASIN's and that its own Add to cart button goes where it should, and sets the quantity list. With
 * `press` it also presses that one button. #buy-now-button sits in the same form and is never touched. The form's address has "buy" in it by name, so the address
 * has to start with the exact path instead, and the word rule stays on the pressed control itself. A press has to lead to a new page, so a refusal at that
 * point is a stop, because nothing is coming to wait for.
 */
export async function amazonProductPage(asin: string, quantity: number, press: boolean, waitMs = 5000): Promise<{ kind: 'ready' | 'pressed' } | { kind: 'refused'; message: string } | PageStop> {
  const stop = (detail: string): PageStop => ({ kind: 'stop', reason: 'unexpected', detail, notSent: true });
  const refused = (message: string) => press ? stop('a product page that changed before its button') : { kind: 'refused' as const, message };
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const started = Date.now();
  const controls = () => [...document.querySelectorAll('#add-to-cart-button')].filter(shown);
  while (!controls().length && Date.now() - started < waitMs) await new Promise(done => setTimeout(done, 200));
  const found = controls();
  if (!found.length) return refused('Amazon doesn\'t offer Add to Cart on this item\'s page. It may be unavailable, or need an option chosen there, so nothing was added.');
  if (found.length > 1) return stop('more than one Add to Cart button');
  const add = found[0] as HTMLInputElement;
  const form = add.form;
  if (!form || form.id !== 'addToCart') return stop('an Add to Cart button in another kind of form');
  let goes: URL | null = null;
  try { goes = new URL(form.getAttribute('action') ?? '', location.href); } catch { /* No address, so this form isn't the one expected. */ }
  if (!goes || goes.origin !== location.origin || !goes.pathname.startsWith('/gp/product/handle-buy-box/') || /check\s*-?out|\/gp\/buy/i.test(goes.pathname + goes.search)) return stop('an Add to Cart form that goes somewhere else');
  const never = /check\s*-?out|buy|(^|[^a-z])pay([^a-z]|$)|place.{0,6}order|one-?click|turbo/i;
  const labels = [...(add.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => (id && document.getElementById(id)?.textContent) || ''), add.getAttribute('aria-label') ?? '', add.tagName === 'INPUT' ? add.value : add.textContent ?? ''].map(words => words.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (add.getAttribute('formaction') || [...labels, add.getAttribute('name') ?? ''].some(words => never.test(words)) || !labels.some(words => /^add to (?:your |shopping )?cart$/i.test(words))) return stop('an Add to Cart button with another label');
  // A parent ASIN, or a link sent on to another item, shows up here. What the page would add has to be this one item.
  const inAddress = /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i.exec(location.pathname)?.[1]?.toUpperCase();
  const named = [...new Set([...form.querySelectorAll('input[name="ASIN"]'), ...document.querySelectorAll('#ASIN')])].map(node => (node as HTMLInputElement).value.trim().toUpperCase());
  if (!named.length || named.some(value => value !== asin) || (inAddress && inAddress !== asin)) return refused(`This Amazon page isn't for ${asin} by itself. It may need an option chosen there, so nothing was added.`);
  if (add.disabled || add.getAttribute('aria-disabled') === 'true') return refused('Amazon shows Add to Cart as unavailable for this item.');
  const lists = [...document.querySelectorAll('select#quantity')] as HTMLSelectElement[];
  if (lists.length > 1 || (lists[0]?.form && lists[0].form !== form)) return refused('Amazon\'s page doesn\'t show one clear quantity list for this item, so nothing was added.');
  const list = lists[0];
  if (!list && quantity !== 1) return refused(`Amazon's page has no quantity list for this item, so a quantity of ${quantity} wasn't added.`);
  if (list) {
    const offered = [...list.options].filter(option => !option.disabled).map(option => option.value);
    if (!offered.includes(String(quantity))) return refused(`Amazon doesn't offer a quantity of ${quantity} for this item right now, so nothing was added.`);
    if (list.value !== String(quantity)) {
      list.value = String(quantity);
      list.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (list.value !== String(quantity)) return refused(`Amazon's quantity list would not take ${quantity}, so nothing was added.`);
  }
  if (!press) return { kind: 'ready' };
  add.click();
  return { kind: 'pressed' };
}

/** A fresh set of steps. They remember only the last read's numbers, in memory, so a read-back can see an add that landed under another ASIN. */
export function amazonSteps(): StoreSteps {
  let last: { key: string; quantity: number; total: number } | null = null;
  let waiting: { key: string; quantity: number; total: number } | null = null;
  /** A wall after an add may have landed can't say nothing was sent, so the person is told to check the cart. */
  const wall = async (tab: StoreTab, maybeSent: boolean) => {
    const answer = await tab.run(amazonWall);
    if (answer.kind === 'stop') throw new StoreStop(answer.reason, answer.detail, !maybeSent && answer.notSent);
  };
  return {
    // Real presses on a product page, seen working only in a tab that's showing.
    foreground: true,
    async resolveLine(order) {
      const { asin, conflict } = amazonAsin(order);
      if (conflict) throw new LineProblem(`The link and the SKU give different Amazon ASINs (SKU ${order.sku}).`);
      if (!asin) throw new LineProblem('Amazon needs an ASIN, in an amazon.com product link or the SKU.');
      return { key: asin, addAs: asin };
    },
    async readCart(tab, keys) {
      const sent = waiting;
      waiting = null;
      await tab.goto(CART);
      await wall(tab, !!sent);
      const { lines, total } = stopIf(await tab.run(amazonReadCart, keys));
      const quantityOf = (key: string) => lines.find(line => line.key === key)?.quantity ?? 0;
      if (sent && total > sent.total && quantityOf(sent.key) === sent.quantity) throw new StoreStop('unexpected', 'the cart grew, but not on this line');
      last = { key: keys[0], quantity: quantityOf(keys[0]), total };
      return lines;
    },
    async addLine(tab, target, quantity) {
      waiting = last?.key === target.key ? last : { key: target.key, quantity: 0, total: Infinity };
      // Nothing is pressed until the product page has been checked, so a wall on the way there can't have sent anything.
      try {
        await tab.goto(amazonProductLink(target.addAs));
        await wall(tab, false);
      } catch (error) {
        if (error instanceof StoreStop) throw new StoreStop(error.reason, error.detail, true);
        throw error;
      }
      const page = stopIf(await tab.run(amazonProductPage, target.addAs, quantity, false));
      if (page.kind === 'refused') throw new LineProblem(page.message);
      // Pressed once. The side sheet it leads to has nothing pressed on it, and the runner's read-back says whether it landed.
      stopIf(await tab.runThenLoad(amazonProductPage, target.addAs, quantity, true));
      await wall(tab, true);
    },
  };
}

export const amazon: StoreMethod = {
  id: 'amazon', label: 'Amazon', badge: 'item', badgeHelp: 'Presses Add to cart on each product page, one line at a time. Needs you signed in',
  origins: [`${HOME}/*`], hosts: HOSTS, startUrl: CART, cartUrl: CART,
  requiredFields: ['quantity'],
  missing: order => amazonAsin(order).asin ? [] : ['an ASIN, in an amazon.com product link or the SKU'],
  steps: amazonSteps(),
};
