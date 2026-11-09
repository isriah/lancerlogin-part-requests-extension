// Online Metals runs on SAP Hybris. The product page lists each standard length as a radio whose data-variantcode is the SKU, such as 1230_12_0. A line
// picks that radio, sets the quantity and presses the page's own Add To Cart, and the read-back is /en/cart. Custom cuts need a person: they are refused.
// A fresh browser gets Cloudflare's 403 at /en/cart, which stops the store like any other wall. In the owner's signed-in Chrome the cart page and an add by
// hand were seen, and readCart's row shape is what was seen there. docs/CARTS.md says what's still unproven through this code.
import { LineProblem, StoreStop, stopIf, type CartLine, type PageStop, type StoreMethod } from '../store-method';
import type { CartOrder } from '../types';

const HOME = 'https://www.onlinemetals.com';
const HOSTS = ['www.onlinemetals.com', 'onlinemetals.com'];
const CUSTOM_CUT = /custom[\s_-]*cut/i;

/** The product's address, always on the host that was granted, with nothing but its path. Null when it isn't an Online Metals product page. */
export function onlineMetalsLink(raw: string | null): { url: string; pid: string; variant: string | null } | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !HOSTS.includes(url.hostname.toLowerCase())) return null;
    const pid = /\/pid\/([A-Za-z0-9]+)\/?$/.exec(url.pathname)?.[1];
    return pid ? { url: `${HOME}${url.pathname}`, pid, variant: url.searchParams.get('variant') } : null;
  } catch { return null; }
}
/** The one exact variant code this order asks for, from its SKU, or a reason it can't be added. The product page still has to list it. */
export function onlineMetalsVariant(order: Pick<CartOrder, 'productUrl' | 'sku' | 'description'>): { url: string; pid: string; sku: string } {
  const sku = order.sku?.trim() ?? '';
  if (CUSTOM_CUT.test(sku) || CUSTOM_CUT.test(order.description ?? '') || CUSTOM_CUT.test(order.productUrl ?? '')) throw new LineProblem('This is a custom cut, which has to be set up on Online Metals\' site by hand.');
  const link = onlineMetalsLink(order.productUrl);
  if (!link) throw new LineProblem('Online Metals needs a product link with /pid/ in it.');
  if (!sku) throw new LineProblem('Online Metals needs a SKU that says which length, such as 1230_12_0.');
  if (sku.split('_')[0] !== link.pid) throw new LineProblem(`SKU ${sku} isn't a length of the product in the link (${link.pid}).`);
  if (link.variant && link.variant !== sku) throw new LineProblem(`The request says SKU ${sku}, but the saved link says ${link.variant}.`);
  return { url: link.url, pid: link.pid, sku };
}
type ProductAnswer = { kind: 'ok'; available: boolean; price: number | null } | { kind: 'problem'; message: string };
/** Injected on the product page. Finds the one standard length with exactly this code, and says nothing about the others. */
export function onlineMetalsReadProduct(pid: string, sku: string): ProductAnswer | PageStop {
  if (/just a moment|security verification|attention required|access denied/i.test(document.title)) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check' };
  if (/page not found|^404\b/i.test(document.title)) return { kind: 'problem', message: 'The store no longer has this product page.' };
  if (!location.pathname.endsWith(`/pid/${pid}`) && !location.pathname.endsWith(`/pid/${pid}/`)) return { kind: 'stop', reason: 'unexpected', detail: 'a different page from the product link' };
  const form = document.getElementById(`addToCartForm${pid}`);
  if (!form) return { kind: 'stop', reason: 'unexpected', detail: 'a product page without its add form' };
  const radios = [...document.querySelectorAll('input[name="productLength"]')] as HTMLInputElement[];
  const matches = radios.filter(radio => radio.dataset.variantcode === sku);
  if (matches.length > 1) return { kind: 'problem', message: `More than one length on this product has SKU ${sku}.` };
  if (!matches.length) return { kind: 'problem', message: `This product has no standard length with SKU ${sku}. If it's a custom cut or a product with no lengths, add it on the store's site by hand.` };
  const radio = matches[0];
  if (radio.dataset.variantOfferCustomcut === 'true') return { kind: 'problem', message: 'This is a custom cut, which has to be set up on Online Metals\' site by hand.' };
  let available = !radio.disabled;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try { data = JSON.parse(script.textContent ?? ''); } catch { continue; }
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== 'object') return;
      const offer = node as { sku?: unknown; availability?: unknown };
      if (offer.sku === sku && typeof offer.availability === 'string' && /OutOfStock|SoldOut|Discontinued/i.test(offer.availability)) available = false;
      Object.values(node).forEach(walk);
    };
    walk(data);
  }
  const price = Number(radio.value);
  return { kind: 'ok', available, price: radio.value && Number.isFinite(price) ? price : null };
}
/** Injected on /en/cart. Hands back only the lines asked for. Empty has to be said by the page itself, so that a page this can't read is never zero. */
export function onlineMetalsReadCart(keys: string[]): CartLine[] | PageStop {
  if (/just a moment|security verification|attention required|access denied/i.test(document.title)) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check' };
  if (!/^\/(en\/)?cart\/?$/.test(location.pathname)) return { kind: 'stop', reason: 'unexpected', detail: 'a page that is not the cart' };
  const rows = [...document.querySelectorAll('form[action*="/cart/update"]')].filter(form => form.querySelector('input[name="productCode"]'));
  if (!rows.length) {
    const text = document.body?.innerText ?? document.body?.textContent ?? '';
    return /cart is (currently )?empty|no items in (your )?(shopping )?cart|you have 0 items/i.test(text) ? [] : { kind: 'stop', reason: 'unexpected', detail: 'a cart page in a shape this does not know' };
  }
  const lines = new Map<string, CartLine>();
  for (const row of rows) {
    const key = (row.querySelector('input[name="productCode"]') as HTMLInputElement).value.trim();
    if (!keys.includes(key)) continue;
    // Normally inside the form. Otherwise tied to it by a form attribute, or the one box standing with this form and no other, never a box in another form.
    const boxes = [...document.querySelectorAll('input[name="quantity"]')] as HTMLInputElement[];
    let box = (row.querySelector('input[name="quantity"]') as HTMLInputElement | null) ?? boxes.find(node => row.id && node.getAttribute('form') === row.id) ?? null;
    for (let around = row.parentElement; !box && around; around = around.parentElement) {
      if (around.querySelectorAll('form[action*="/cart/update"]').length > 1) break;
      const near = boxes.filter(node => around!.contains(node) && !node.closest('form') && !node.getAttribute('form'));
      if (near.length > 1) break;
      if (near.length) box = near[0];
    }
    const quantity = box && box.value.trim() ? Number(box.value) : NaN;
    if (!Number.isFinite(quantity)) return { kind: 'stop', reason: 'unexpected', detail: 'a cart line with no quantity' };
    const line = lines.get(key);
    if (line) line.quantity += quantity; else lines.set(key, { key, quantity });
  }
  return [...lines.values()];
}
/**
 * Injected on the product page. Picks the one length, sets the quantity and presses that product's own Add To Cart, once. It touches no other control,
 * and its checks all come before the press. It waits for the add's own answer, because leaving the page too soon could cancel it. The read-back decides.
 */
export async function onlineMetalsClickAdd(pid: string, sku: string, quantity: number, waitMs = 10_000): Promise<{ kind: 'sent' } | { kind: 'refused'; message: string } | PageStop> {
  const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
  const stop = (detail: string): PageStop => ({ kind: 'stop', reason: 'unexpected', detail, notSent: true });
  const form = document.getElementById(`addToCartForm${pid}`) as HTMLFormElement | null;
  if (!form || !/\/tkaddtocart\/add$/.test(form.getAttribute('action') ?? '')) return stop('an add form in another shape');
  const radios = ([...document.querySelectorAll('input[name="productLength"]')] as HTMLInputElement[]).filter(radio => radio.dataset.variantcode === sku);
  if (radios.length !== 1) return stop('a product page without this length');
  const button = document.getElementById(`addToCartButton${pid}`) as HTMLButtonElement | null;
  const label = (button?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!button || !form.contains(button) || !/^(add to cart|item in cart)$/i.test(label)) return stop('an add button with another label');
  if (button.disabled) return { kind: 'refused', message: 'The store\'s Add To Cart button is turned off for this item.' };
  const qty = document.getElementById('js-pdp-qty') as HTMLInputElement | null;
  const posted = form.querySelector('input[name="qty"]') as HTMLInputElement | null;
  const code = form.querySelector('input[name="productCodePost"]') as HTMLInputElement | null;
  if (!qty || !posted || !code) return stop('an add form without its quantity');
  if (quantity > Number(qty.max || 9999)) return { kind: 'refused', message: `The store takes at most ${qty.max || 9999} at a time.` };
  // The page's own handler moves the code into the form when a length is picked, and it can take a moment.
  if (!radios[0].checked) radios[0].click();
  for (let tries = 0; tries < 15 && code.value !== sku; tries++) await wait(200);
  if (code.value !== sku || !radios[0].checked) return stop('the page did not select this length');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(qty, String(quantity));
  for (const name of ['input', 'change', 'keyup']) qty.dispatchEvent(new Event(name, { bubbles: true }));
  await wait(200);
  // The same quantity in the field the form sends, in case the page copies it across only when the box loses focus.
  if (posted.value !== String(quantity)) posted.value = String(quantity);
  if (code.value !== sku || qty.value !== String(quantity)) return stop('the page changed this line before it was sent');
  let status: number | null = null;
  let answered = false;
  const watcher = typeof PerformanceObserver === 'function' ? new PerformanceObserver(list => {
    const entry = list.getEntries().find(item => item.name.includes('/tkaddtocart/add')) as (PerformanceEntry & { responseStatus?: number }) | undefined;
    if (entry) { answered = true; status = entry.responseStatus ?? null; }
  }) : null;
  try { watcher?.observe({ type: 'resource' }); } catch { /* The wait below still ends. */ }
  button.click();
  const started = Date.now();
  const shownModal = () => { const box = document.getElementById('miniCartModal')?.getBoundingClientRect(); return !!box && box.width > 0 && box.height > 0; };
  while (!answered && !shownModal() && Date.now() - started < waitMs) await wait(150);
  watcher?.disconnect();
  if (status !== null && [401, 403, 429, 503].includes(status)) return { kind: 'stop', reason: 'bot-check', detail: `the add refused with ${status}` };
  return { kind: 'sent' };
}

export const onlinemetals: StoreMethod = {
  id: 'onlinemetals', label: 'Online Metals', badge: 'item', badgeHelp: 'Picks the length and presses Add To Cart on each product page, one line at a time',
  origins: [`${HOME}/*`], hosts: HOSTS, startUrl: `${HOME}/`, cartUrl: `${HOME}/en/cart`,
  requiredFields: ['sku', 'productUrl', 'quantity'],
  missing: order => order.productUrl && !onlineMetalsLink(order.productUrl) ? ['a product link on Online Metals\' site with /pid/ in it'] : [],
  steps: {
    async resolveLine(order, tab) {
      const { url, pid, sku } = onlineMetalsVariant(order);
      await tab.goto(url);
      const answer = stopIf(await tab.run(onlineMetalsReadProduct, pid, sku));
      if (answer.kind === 'problem') throw new LineProblem(answer.message);
      const repriced = order.unitPrice !== null && answer.price !== null && Math.abs(answer.price - order.unitPrice) >= 0.005;
      return {
        key: sku, addAs: url,
        ...(answer.available ? {} : { available: false }),
        ...(repriced ? { note: `Price changed: requested at $${order.unitPrice!.toFixed(2)}, store shows $${answer.price!.toFixed(2)}.` } : {}),
      };
    },
    async readCart(tab, keys) {
      await tab.goto(`${HOME}/en/cart`);
      return stopIf(await tab.run(onlineMetalsReadCart, keys));
    },
    async addLine(tab, target, quantity) {
      const link = onlineMetalsLink(target.addAs);
      if (!link) throw new StoreStop('unexpected', 'a product address that changed', true);
      await tab.goto(link.url);
      const answer = stopIf(await tab.run(onlineMetalsClickAdd, link.pid, target.key, quantity));
      if (answer.kind === 'refused') throw new LineProblem(answer.message);
    },
  },
};
