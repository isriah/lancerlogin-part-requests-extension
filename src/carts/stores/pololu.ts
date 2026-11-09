// Pololu's cart page has a Quick add form: lines like "2136,2". Adds accumulate. Never the BIG Order Form, which overwrites quantities.
import { LineProblem, stopIf, type CartLine, type PageStop, type StoreMethod } from '../store-method';
import type { CartOrder } from '../types';

const HOME = 'https://www.pololu.com';

/** The product number: from the link, or a SKU that is only a number. `conflict` when the two disagree. */
export function pololuNumber(order: Pick<CartOrder, 'productUrl' | 'sku'>): { number: string | null; conflict: boolean } {
  let fromLink: string | null = null;
  try { fromLink = order.productUrl ? /\/product\/(\d+)/.exec(new URL(order.productUrl).pathname)?.[1] ?? null : null; } catch { /* No number from this. */ }
  const fromSku = /^#?(\d+)$/.exec(order.sku?.trim() ?? '')?.[1] ?? null;
  return { number: fromLink ?? fromSku, conflict: !!fromLink && !!fromSku && fromLink !== fromSku };
}
/** Injected on the cart page. Hands back only the lines asked for. */
export function pololuReadCart(keys: string[]): CartLine[] | PageStop {
  if (!document.querySelector('textarea[name="quick_add"]')) return { kind: 'stop', reason: 'unexpected', detail: 'a cart page without Quick add' };
  const lines = new Map<string, CartLine>();
  for (const row of document.querySelectorAll('tr.cart-product')) {
    const key = /\/product\/(\d+)/.exec(row.querySelector('a[href*="/product/"]')?.getAttribute('href') ?? '')?.[1];
    if (!key || !keys.includes(key)) continue;
    const quantity = Number((row.querySelector('input[name$="[quantity]"]') as HTMLInputElement | null)?.value);
    if (!Number.isFinite(quantity)) return { kind: 'stop', reason: 'unexpected', detail: 'a cart line with no quantity' };
    const price = Number(/\$\s*([\d,]+(?:\.\d+)?)/.exec(row.querySelector('td.price')?.textContent ?? '')?.[1]?.replaceAll(',', ''));
    const line = lines.get(key);
    if (line) line.quantity += quantity; else lines.set(key, { key, quantity, unitPrice: Number.isFinite(price) && price > 0 ? price : null });
  }
  return [...lines.values()];
}
/** Injected on the cart page. Fills the one Quick add box and presses its own button, whose form only updates the cart. */
export function pololuSubmitQuickAdd(number: string, quantity: number): { kind: 'sent' } | PageStop {
  const box = document.querySelector('textarea[name="quick_add"]') as HTMLTextAreaElement | null;
  const form = box?.form;
  if (!box || !form || form.getAttribute('action') !== '/cart/update') return { kind: 'stop', reason: 'unexpected', detail: 'a Quick add form in another shape', notSent: true };
  const button = [...form.elements].find(node => (node as HTMLButtonElement).type === 'submit') as HTMLButtonElement | undefined;
  if (!button) return { kind: 'stop', reason: 'unexpected', detail: 'a Quick add form with no button', notSent: true };
  box.value = `${number},${quantity}`;
  button.click();
  return { kind: 'sent' };
}

export const pololu: StoreMethod = {
  id: 'pololu', label: 'Pololu', badge: 'item', badgeHelp: 'Uses the cart page\'s Quick add, one line at a time',
  origins: [`${HOME}/*`], hosts: ['www.pololu.com', 'pololu.com'], startUrl: `${HOME}/cart`, cartUrl: `${HOME}/cart`,
  requiredFields: ['quantity'],
  missing: order => pololuNumber(order).number ? [] : ['a product number, in the link or the SKU'],
  steps: {
    async resolveLine(order) {
      const { number, conflict } = pololuNumber(order);
      if (conflict) throw new LineProblem(`The link and the SKU give different Pololu product numbers (SKU ${order.sku}).`);
      if (!number) throw new LineProblem('Pololu needs a product number.');
      return { key: number, addAs: number };
    },
    async readCart(tab, keys) { return stopIf(await tab.run(pololuReadCart, keys)); },
    async addLine(tab, target, quantity) { stopIf(await tab.runThenLoad(pololuSubmitQuickAdd, target.addAs, quantity)); },
  },
};
