// Amazon's add link, /gp/aws/cart/add.html, then its confirm button when it shows one, then a read of /gp/cart/view.html. A signed-out browser gets a
// sign-in page, which stops the store. It has never run signed in, so the signed-in pages here come from public descriptions: anything that doesn't
// match exactly stops the store with nothing pressed. docs/CARTS.md says what the owner has to check.
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
export const amazonAddLink = (asin: string, quantity: number): string => `${HOME}/gp/aws/cart/add.html?ASIN.1=${encodeURIComponent(asin)}&Quantity.1=${quantity}`;

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
  const said = /\(\s*([\d,]+)\s+items?\s*\)/i.exec(document.querySelector('#sc-subtotal-label-activecart')?.textContent ?? '')?.[1];
  if (said === undefined || Number(said.replaceAll(',', '')) > total) return { kind: 'stop', reason: 'unexpected', detail: 'a cart page that may not show every line' };
  return { lines: [...lines.values()], total };
}
/**
 * Injected on whatever the add link led to. Says which page it is, and with `press` also presses the confirm button. That button has to be the only
 * one labeled Add to Cart, in a form that names this ASIN and no other and has no way to buy. Anything else is refused and nothing is pressed.
 */
export function amazonAddPage(asin: string, quantity: number, press: boolean): { kind: 'confirm' | 'pressed' | 'landed' } | { kind: 'refused'; message: string } | PageStop {
  const path = location.pathname;
  if (path === '/gp/cart/view.html' || /^\/cart(\/|$)/.test(path) || path.startsWith('/gp/huc/')) return { kind: 'landed' };
  if (path !== '/gp/aws/cart/add.html' && !path.startsWith('/associates/addtocart')) return { kind: 'stop', reason: 'unexpected', detail: 'a page the add link should not lead to' };
  const stop = (detail: string): PageStop => ({ kind: 'stop', reason: 'unexpected', detail });
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const alert = [...document.querySelectorAll('.a-alert-error, .a-box-error')].filter(shown).map(node => (node.textContent ?? '').replace(/\s+/g, ' ').trim()).find(Boolean);
  if (alert) return { kind: 'refused', message: alert.slice(0, 300) };
  const never = /check\s*-?out|buy|(^|[^a-z])pay([^a-z]|$)|place.{0,6}order|one-?click|turbo/i;
  const names = (node: Element): string[] => {
    const box = node as HTMLInputElement;
    const named = (node.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => (id && document.getElementById(id)?.textContent) || '');
    return [...named, node.getAttribute('aria-label') ?? '', node.getAttribute('alt') ?? '', node.getAttribute('title') ?? '', node.textContent ?? '', node.tagName === 'INPUT' ? box.value : '', node.closest('.a-button')?.textContent ?? ''].map(words => words.replace(/\s+/g, ' ').trim()).filter(Boolean);
  };
  const buttons = (within: ParentNode) => [...within.querySelectorAll('input[type="submit"],input[type="image"],input[type="button"],button')].filter(shown);
  const risky = (node: Element) => [...names(node), node.getAttribute('name') ?? '', node.id, node.getAttribute('formaction') ?? ''].some(words => never.test(words));
  const confirm = buttons(document).filter(node => !risky(node) && names(node).some(words => /^add to (your |shopping )?cart$/i.test(words)));
  if (confirm.length !== 1) return stop(confirm.length ? 'more than one Add to Cart button' : 'an add page without its Add to Cart button');
  const form = (confirm[0] as HTMLInputElement).form;
  if (!form || never.test(form.getAttribute('action') ?? '') || buttons(form).some(risky)) return stop('an Add to Cart button in another kind of form');
  // What the form itself says it will add, which has to be this one item. Saying nothing isn't good enough.
  const named = new Set<string>();
  for (const node of form.querySelectorAll('input[name^="ASIN" i]')) named.add((node as HTMLInputElement).value.trim().toUpperCase());
  for (const node of form.querySelectorAll('[data-asin]')) { const value = node.getAttribute('data-asin')?.trim().toUpperCase(); if (value) named.add(value); }
  for (const node of form.querySelectorAll('a[href]')) { const value = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i.exec(node.getAttribute('href') ?? '')?.[1]?.toUpperCase(); if (value) named.add(value); }
  if (named.size !== 1 || !named.has(asin)) return stop('an Add to Cart form that doesn\'t name only this item');
  for (const node of form.querySelectorAll('input[name^="Quantity" i],select[name^="Quantity" i]')) if ((node as HTMLInputElement).value.trim() !== String(quantity)) return stop('an Add to Cart form with another quantity');
  if (!press) return { kind: 'confirm' };
  (confirm[0] as HTMLElement).click();
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
      await tab.goto(amazonAddLink(target.addAs, quantity));
      await wall(tab, false);
      let page = stopIf(await tab.run(amazonAddPage, target.addAs, quantity, false));
      if (page.kind === 'confirm') {
        // Pressed once. If the same page comes back, it's not pressed again.
        stopIf(await tab.runThenLoad(amazonAddPage, target.addAs, quantity, true));
        await wall(tab, true);
        page = stopIf(await tab.run(amazonAddPage, target.addAs, quantity, false));
        if (page.kind === 'confirm') throw new StoreStop('unexpected', 'the add page came back after its button');
      }
      if (page.kind === 'refused') throw new LineProblem(page.message);
    },
  };
}

export const amazon: StoreMethod = {
  id: 'amazon', label: 'Amazon', badge: 'item', badgeHelp: 'Uses Amazon\'s add link and its confirm button, one line at a time. Needs you signed in',
  origins: [`${HOME}/*`], hosts: HOSTS, startUrl: CART, cartUrl: CART,
  requiredFields: ['quantity'],
  missing: order => amazonAsin(order).asin ? [] : ['an ASIN, in an amazon.com product link or the SKU'],
  steps: amazonSteps(),
};
