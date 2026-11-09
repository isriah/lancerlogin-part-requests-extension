// REV runs on BigCommerce. The add is the store's own /cart.php?action=add link in the tab, and the read-back is its storefront API. Never action=buy.
import { LineProblem, stopIf, type CartLine, type PageStop, type StoreMethod } from '../store-method';

const HOME = 'https://www.revrobotics.com';

/** Injected. Hands back only the lines asked for. SKUs compare in upper case. */
export async function revReadCart(keys: string[]): Promise<CartLine[] | PageStop> {
  let reply: Response;
  try { reply = await fetch('/api/storefront/carts', { credentials: 'same-origin', headers: { Accept: 'application/json' } }); }
  catch { return { kind: 'stop', reason: 'unexpected', detail: 'no answer from the cart' }; }
  if ([401, 403, 429, 503].includes(reply.status)) return { kind: 'stop', reason: 'bot-check', detail: `the cart refused with ${reply.status}` };
  if (!reply.ok) return { kind: 'stop', reason: 'unexpected', detail: 'an unexpected answer from the cart' };
  let carts: { lineItems?: { physicalItems?: unknown[]; digitalItems?: unknown[] } }[];
  try { carts = await reply.json(); } catch { return { kind: 'stop', reason: 'unexpected', detail: 'a cart answer that was not data' }; }
  if (!Array.isArray(carts)) return { kind: 'stop', reason: 'unexpected', detail: 'a cart answer in another shape' };
  const lines = new Map<string, CartLine>();
  for (const cart of carts) {
    for (const item of [...(cart.lineItems?.physicalItems ?? []), ...(cart.lineItems?.digitalItems ?? [])] as { sku?: unknown; quantity?: unknown; salePrice?: unknown }[]) {
      const key = typeof item.sku === 'string' ? item.sku.trim().toUpperCase() : '';
      if (!keys.includes(key) || typeof item.quantity !== 'number') continue;
      const line = lines.get(key);
      if (line) line.quantity += item.quantity; else lines.set(key, { key, quantity: item.quantity, unitPrice: typeof item.salePrice === 'number' ? item.salePrice : null });
    }
  }
  return [...lines.values()];
}
/** Injected after an add. The store's own message when it refused, such as "not available for purchase". */
export function revAddMessage(): string {
  const box = document.querySelector('.alertBox--error, .alertBox--info, .alertBox');
  return box && !/alertBox--success/.test(box.className) ? (box.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) : '';
}
export const addLink = (sku: string, quantity: number): string => `${HOME}/cart.php?action=add&sku=${encodeURIComponent(sku)}&qty=${quantity}`;

export const rev: StoreMethod = {
  id: 'rev', label: 'REV', badge: 'direct', badgeHelp: 'Adds with the store\'s own add link, one line at a time',
  origins: [`${HOME}/*`], hosts: ['www.revrobotics.com', 'revrobotics.com'], startUrl: `${HOME}/cart.php`, cartUrl: `${HOME}/cart.php`,
  requiredFields: ['sku', 'quantity'],
  steps: {
    async resolveLine(order) {
      const sku = order.sku?.trim();
      if (!sku) throw new LineProblem('REV needs a SKU.');
      return { key: sku.toUpperCase(), addAs: sku };
    },
    async readCart(tab, keys) { return stopIf(await tab.run(revReadCart, keys)); },
    async addLine(tab, target, quantity) {
      await tab.goto(addLink(target.addAs, quantity));
      const message = await tab.run(revAddMessage);
      if (message) throw new LineProblem(message);
    },
  },
};
