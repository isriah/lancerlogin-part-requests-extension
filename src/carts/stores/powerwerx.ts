// PowerWerx's Quick Entry page: paste "SKU, quantity", Match Items, then the matched grid's add button, then the review window's add button. Written from
// the page's own script, and an add has landed this way in the owner's own browser. Cloudflare answers the match request with a challenge in a fresh browser,
// so it stops there in one. The same page holds a Checkout submit, and /cart has an empty-cart address. This touches neither.
import { LineProblem, stopIf, type CartLine, type PageStop, type StoreMethod } from '../store-method';
import type { CartOrder } from '../types';

const HOME = 'https://powerwerx.com';
const QUICK_ENTRY = `${HOME}/cart/quick-entry`;
const CART = `${HOME}/cart`;

/**
 * The SKU as it can be pasted, or null. The page splits a line on commas, spaces and tabs and skips lines starting with #, so a SKU holding any of
 * those would be read as something else. Case is kept, because a matched SKU has to be exactly the one requested.
 */
export function powerwerxSku(order: Pick<CartOrder, 'sku'>): string | null {
  const sku = order.sku?.trim() ?? '';
  return sku && !/[\s,]/.test(sku) && !sku.startsWith('#') ? sku : null;
}
/** Injected on /cart. Hands back only the lines asked for, by the SKU exactly as the store writes it. A non-empty cart it can't read stops the store. */
export function powerwerxReadCart(keys: string[]): CartLine[] | PageStop {
  const root = document.querySelector('#cartPaneRoot');
  const count = Number(document.querySelector('#hubPaneData')?.getAttribute('data-count') ?? NaN);
  if (!root || !Number.isFinite(count)) return { kind: 'stop', reason: 'unexpected', detail: 'a cart page in another shape' };
  const rows = [...root.querySelectorAll('[data-hub-row]')];
  if (count > 0 && !rows.length) return { kind: 'stop', reason: 'unexpected', detail: 'a cart with items and no lines to read' };
  const lines = new Map<string, CartLine>();
  for (const row of rows) {
    // Written "SKU: PowerpoleBag" on the real cart row. The match is still exact, and case counts.
    const key = ((row.querySelector('.apt-row-sku') ?? row.querySelector('.apt-cell-sku'))?.textContent ?? '').trim().replace(/^SKU\s*:\s*/i, '').trim();
    if (!key) return { kind: 'stop', reason: 'unexpected', detail: 'a cart line with no SKU' };
    if (!keys.includes(key)) continue;
    const said = (row.querySelector('[data-qty-input]') as HTMLInputElement | null)?.value ?? row.getAttribute('data-qty') ?? '';
    const quantity = said.trim() ? Number(said) : NaN;
    if (!Number.isFinite(quantity)) return { kind: 'stop', reason: 'unexpected', detail: 'a cart line with no quantity' };
    // The real row's price cell wasn't seen, so a missing one means no price, and the read still stands.
    const price = Number(/\$\s*([\d,]+(?:\.\d+)?)/.exec(row.querySelector('[data-unit-price]')?.textContent ?? '')?.[1]?.replace(/,/g, ''));
    const line = lines.get(key);
    if (line) line.quantity += quantity; else lines.set(key, { key, quantity, unitPrice: Number.isFinite(price) && price > 0 ? price : null });
  }
  return [...lines.values()];
}
/**
 * Injected on Quick Entry. Pastes one line and matches it. Adds only if the grid shows that one line, matched, at exactly this SKU and quantity, and the
 * review window says the same. A control is pressed only if it is the named one, sits outside any form, and doesn't mention checkout.
 */
export async function powerwerxPasteAndAdd(sku: string, quantity: number, waitMs = 15_000): Promise<{ kind: 'sent' } | { kind: 'refused'; message: string } | PageStop> {
  const never = /check\s?out|place (your )?order|submit order|buy|\bpay\b/i;
  const words = (node: Element | null | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const pressable = (node: HTMLButtonElement | null, label: RegExp): node is HTMLButtonElement =>
    !!node && !node.disabled && !node.closest('form') && node.getAttribute('type') !== 'submit' && !node.hasAttribute('name') && !node.hasAttribute('data-hub-checkout') && !never.test(words(node)) && label.test(words(node));
  // jQuery hides a refused request behind a general message, so the address's own answer is what tells a challenge from anything else.
  const walled = (path: string) => {
    try { return (performance.getEntriesByType('resource') as (PerformanceEntry & { responseStatus?: number })[]).some(entry => new URL(entry.name, location.href).pathname === path && [401, 403, 429, 503].includes(entry.responseStatus ?? 0)); }
    catch { return false; }
  };
  const message = () => words(document.querySelector('#fancybox-content:not(:has(.apt-modal-review))')).replace(/^Oops!\s*/, '') || words(document.querySelector('#bar-notification .content'));
  const until = async <T>(found: () => T | null | undefined | false): Promise<T | null> => {
    const started = Date.now();
    for (;;) {
      const answer = found();
      if (answer) return answer;
      if (Date.now() - started >= waitMs) return null;
      await new Promise(done => setTimeout(done, 100));
    }
  };
  const nothing = (detail: string, reason: 'unexpected' | 'bot-check' = 'unexpected'): PageStop => ({ kind: 'stop', reason, detail, notSent: true });

  const box = document.querySelector('#qePaste') as HTMLTextAreaElement | null;
  const match = document.querySelector('.apt-qe-parse') as HTMLButtonElement | null;
  if (!box || !pressable(match, /^match items$/i)) return nothing('a Quick Entry page without its paste box');
  const earlier = message();
  box.value = `${sku}, ${quantity}`;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  match.click();

  // Whichever comes first: the grid, a refused request, or the store saying something.
  await until(() => document.querySelector('[data-qe-fixrow]') || walled('/cart/quick-entry/parse') || (message() && message() !== earlier));
  if (walled('/cart/quick-entry/parse')) return nothing('the match was refused with a challenge', 'bot-check');
  const rows = [...document.querySelectorAll('[data-qe-fixrow]')];
  if (!rows.length) {
    const said = message();
    if (said && said !== earlier && !/could not read the list/i.test(said)) return { kind: 'refused', message: said.slice(0, 300) };
    return nothing('the match gave no answer this could read');
  }
  if (rows.length !== 1) return { kind: 'refused', message: `PowerWerx read this as ${rows.length} lines, so nothing was added.` };
  const row = rows[0];
  const seen = words(row.querySelector('.apt-cell-sku'));
  if (row.getAttribute('data-status') !== 'matched') return { kind: 'refused', message: `PowerWerx has no exact match for SKU ${sku}.` };
  if (seen !== sku) return { kind: 'refused', message: `The request says SKU ${sku}, but PowerWerx matched it to SKU ${seen || 'unknown'}.` };
  const matched = row.getAttribute('data-productid');
  if (!matched) return nothing('a matched line with no product');
  const shownQuantity = Number((row.querySelector('.apt-qe-fixqty') as HTMLInputElement | null)?.value);
  if (shownQuantity !== quantity) return { kind: 'refused', message: `PowerWerx would add ${shownQuantity || 'a different number'} of SKU ${sku}, not ${quantity}, so nothing was added. It may have a minimum order.` };

  const review = document.querySelector('.apt-qe-gridreview') as HTMLButtonElement | null;
  if (!pressable(review, /^add 1 item to cart$/i)) return nothing('the matched grid without its one add button');
  review.click();

  await until(() => document.querySelector('.apt-modal-review') || walled('/cart/batch/stage') || (message() && message() !== earlier));
  const modal = document.querySelector('.apt-modal-review');
  if (!modal) {
    if (walled('/cart/batch/stage')) return nothing('the review was refused with a challenge', 'bot-check');
    const said = message();
    return said && said !== earlier ? { kind: 'refused', message: said.slice(0, 300) } : nothing('the review window did not open');
  }
  const lines = [...modal.querySelectorAll('[data-hub-row]')];
  if (lines.length !== 1) return nothing('a review window with other lines in it');
  const line = lines[0];
  // "Replace" and "set the total" would overwrite what the cart holds. Only a plain add leaves the runner's sums true.
  if (modal.getAttribute('data-mode') !== 'append' || (line.querySelector('[data-combine] input:checked') as HTMLInputElement | null)?.value === 'set-total') return nothing('a review window that would overwrite the cart');
  if (line.getAttribute('data-productid') !== matched) return { kind: 'refused', message: `The review window shows a different product from the match for SKU ${sku}, so nothing was added.` };
  if (line.getAttribute('data-addable') !== 'true' || !(line.querySelector('.apt-row-select') as HTMLInputElement | null)?.checked) return { kind: 'refused', message: `PowerWerx won't add SKU ${sku} right now.` };
  if (Number((line.querySelector('[data-qty-input]') as HTMLInputElement | null)?.value) !== quantity) return { kind: 'refused', message: `PowerWerx changed the quantity of SKU ${sku} in its review, so nothing was added. It may have a minimum order or short stock.` };
  const commit = modal.querySelector('[data-review-commit]') as HTMLButtonElement | null;
  if (!pressable(commit, /\badd\b/i) || words(commit.querySelector('[data-commit-count]')) !== '1') return nothing('a review window without its one add button');
  commit.click();

  // From here it may have landed, so the runner's read-back decides. A store's refusal is passed on with its own words.
  const shut = await until(() => !commit.isConnected || !!words(modal.querySelector('[data-review-error]')));
  if (walled('/cart/batch/commit')) return { kind: 'stop', reason: 'bot-check', detail: 'the add was refused with a challenge' };
  const refusal = shut ? words(modal.querySelector('[data-review-error]')) : '';
  return refusal ? { kind: 'refused', message: refusal.slice(0, 300) } : { kind: 'sent' };
}

export const powerwerx: StoreMethod = {
  id: 'powerwerx', label: 'PowerWerx', badge: 'item', badgeHelp: 'Uses the Quick Entry page, one line at a time',
  origins: [`${HOME}/*`], hosts: ['powerwerx.com', 'www.powerwerx.com'], startUrl: CART, cartUrl: CART,
  requiredFields: ['sku', 'quantity'],
  missing: order => !order.sku?.trim() || powerwerxSku(order) ? [] : ['a single SKU with no spaces or commas'],
  steps: {
    // Its review opens in an animated window, which isn't safe to assume works behind other tabs.
    foreground: true,
    async resolveLine(order) {
      const sku = powerwerxSku(order);
      if (!sku) throw new LineProblem('PowerWerx needs a single SKU with no spaces or commas.');
      return { key: sku, addAs: sku };
    },
    async readCart(tab, keys) {
      await tab.goto(CART);
      return stopIf(await tab.run(powerwerxReadCart, keys));
    },
    async addLine(tab, target, quantity) {
      await tab.goto(QUICK_ENTRY);
      const answer = stopIf(await tab.run(powerwerxPasteAndAdd, target.addAs, quantity, 15_000));
      if (answer?.kind === 'refused') throw new LineProblem(answer.message);
    },
  },
};
