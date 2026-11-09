// A reusable Shopify store: find the variant, read /cart.js, add one line with /cart/add.js, read /cart.js again. Adds accumulate and short
// stock can silently cap, which is why the runner always reads back. Never /cart/<id>:<qty>, which skips the cart and goes to checkout.
import { isOnStore } from '../safety';
import { LineProblem, stopIf, type CartLine, type LineTarget, type PageStop, type StoreMethod } from '../store-method';
import type { CartOrder } from '../types';

export interface ShopifyVariant { id: string; sku: string; available: boolean }
type ProductAnswer = { kind: 'ok'; variants: ShopifyVariant[] } | { kind: 'not-found' };

/** Injected. Reads only each variant's ID, SKU and whether it's available. */
export async function shopifyReadProduct(handle: string): Promise<ProductAnswer | PageStop> {
  let reply: Response;
  try { reply = await fetch(`/products/${encodeURIComponent(handle)}.js`, { credentials: 'same-origin', headers: { Accept: 'application/json' } }); }
  catch { return { kind: 'stop', reason: 'unexpected', detail: 'no answer about a product' }; }
  if (reply.status === 404) return { kind: 'not-found' };
  if ([401, 403, 429, 503].includes(reply.status)) return { kind: 'stop', reason: 'bot-check', detail: `the store refused with ${reply.status}` };
  if (!reply.ok || reply.redirected) return { kind: 'stop', reason: 'unexpected', detail: 'an unexpected answer about a product' };
  let body: { variants?: { id: unknown; sku: unknown; available: unknown }[] };
  try { body = await reply.json(); } catch { return { kind: 'stop', reason: 'unexpected', detail: 'a product answer that was not data' }; }
  if (!Array.isArray(body?.variants)) return { kind: 'stop', reason: 'unexpected', detail: 'a product answer with no variants' };
  return { kind: 'ok', variants: body.variants.map(v => ({ id: String(v.id), sku: typeof v.sku === 'string' ? v.sku.trim() : '', available: v.available !== false })) };
}
/** Injected. Hands back only the lines asked for, whatever else is in the cart. */
export async function shopifyReadCart(keys: string[]): Promise<CartLine[] | PageStop> {
  let reply: Response;
  try { reply = await fetch('/cart.js', { credentials: 'same-origin', headers: { Accept: 'application/json' } }); }
  catch { return { kind: 'stop', reason: 'unexpected', detail: 'no answer from the cart' }; }
  if ([401, 403, 429, 503].includes(reply.status)) return { kind: 'stop', reason: 'bot-check', detail: `the cart refused with ${reply.status}` };
  if (!reply.ok || reply.redirected) return { kind: 'stop', reason: 'unexpected', detail: 'an unexpected answer from the cart' };
  let body: { items?: { variant_id: unknown; quantity: unknown; price?: unknown }[] };
  try { body = await reply.json(); } catch { return { kind: 'stop', reason: 'unexpected', detail: 'a cart answer that was not data' }; }
  if (!Array.isArray(body?.items)) return { kind: 'stop', reason: 'unexpected', detail: 'a cart answer with no items' };
  const lines = new Map<string, CartLine>();
  for (const item of body.items) {
    const key = String(item.variant_id);
    if (!keys.includes(key) || typeof item.quantity !== 'number') continue;
    const line = lines.get(key);
    if (line) line.quantity += item.quantity; else lines.set(key, { key, quantity: item.quantity, unitPrice: typeof item.price === 'number' ? item.price / 100 : null });
  }
  return [...lines.values()];
}
/** Injected. Exactly one line, once. A 422 is the store's own refusal, such as sold out, and its message is plain text for the person. */
export async function shopifyAddLine(id: string, quantity: number): Promise<{ kind: 'sent' } | { kind: 'refused'; message: string } | PageStop> {
  let reply: Response;
  try {
    reply = await fetch('/cart/add.js', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ items: [{ id: Number(id), quantity }] }) });
  } catch { return { kind: 'sent' }; } // It may have landed. The read-back decides.
  if ([401, 403, 429, 503].includes(reply.status)) return { kind: 'stop', reason: 'bot-check', detail: `the add refused with ${reply.status}` };
  if (reply.redirected) return { kind: 'stop', reason: 'unexpected', detail: 'the add went to another page' };
  if (reply.ok) return { kind: 'sent' };
  let message = '';
  try { const body = await reply.json(); message = String(body?.description ?? body?.message ?? '').slice(0, 300); } catch { /* A generic message follows. */ }
  return { kind: 'refused', message: message || 'The store refused this item.' };
}

export function shopifyLink(raw: string | null): { handle: string; variant: string | null } | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const handle = /\/products\/([^/?#]+)/.exec(url.pathname)?.[1];
    if (!handle) return null;
    const variant = url.searchParams.get('variant');
    return { handle: decodeURIComponent(handle), variant: variant && /^\d+$/.test(variant) ? variant : null };
  } catch { return null; }
}
const sameSku = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
/** The saved variant first, confirmed against the SKU. Otherwise an exact SKU match. Otherwise only a product with one variant. */
export function chooseVariant(variants: ShopifyVariant[], variant: string | null, sku: string | null): { chosen: ShopifyVariant; note?: string } {
  const wanted = sku?.trim() || '';
  const unconfirmed = 'The store lists no SKU for this item, so the SKU could not be confirmed. Check it in the cart.';
  if (variant) {
    const chosen = variants.find(v => v.id === variant);
    if (!chosen) throw new LineProblem('The saved link points to an option this product no longer has.');
    if (wanted && chosen.sku && !sameSku(wanted, chosen.sku)) throw new LineProblem(`The request says SKU ${wanted}, but the saved link's option is SKU ${chosen.sku}.`);
    return wanted && !chosen.sku ? { chosen, note: unconfirmed } : { chosen };
  }
  if (wanted) {
    const matches = variants.filter(v => v.sku && sameSku(wanted, v.sku));
    if (matches.length === 1) return { chosen: matches[0] };
    if (matches.length > 1) throw new LineProblem(`More than one option on this product has SKU ${wanted}.`);
    if (variants.length === 1 && !variants[0].sku) return { chosen: variants[0], note: unconfirmed };
    throw new LineProblem(`No option on this product has SKU ${wanted}.`);
  }
  if (variants.length === 1) return { chosen: variants[0] };
  throw new LineProblem('This product has several options, and the saved link and SKU don\'t say which one.');
}

export function createShopifyStore(config: { id: string; label: string; hosts: string[]; home: string; origins: string[] }): StoreMethod {
  const cartUrl = `${config.home}/cart`;
  const store: StoreMethod = {
    id: config.id, label: config.label, badge: 'direct', badgeHelp: 'Adds to the store\'s cart directly, one line at a time',
    origins: config.origins, hosts: config.hosts, startUrl: cartUrl, cartUrl, requiredFields: ['productUrl', 'quantity'],
    missing(order: CartOrder) {
      if (order.productUrl && !(isOnStore(store, order.productUrl) && shopifyLink(order.productUrl))) return [`a product link on ${config.label}'s site`];
      return [];
    },
    steps: {
      async resolveLine(order, tab): Promise<LineTarget> {
        const link = shopifyLink(order.productUrl);
        if (!link) throw new LineProblem(`This needs a product link on ${config.label}'s site.`);
        const product = stopIf(await tab.run(shopifyReadProduct, link.handle));
        if (product.kind === 'not-found') throw new LineProblem('The store no longer has this product page.');
        const { chosen, note } = chooseVariant(product.variants, link.variant, order.sku);
        return { key: chosen.id, addAs: chosen.id, available: chosen.available, ...(note ? { note } : {}) };
      },
      async readCart(tab, keys) { return stopIf(await tab.run(shopifyReadCart, keys)); },
      async addLine(tab, target, quantity) {
        const answer = stopIf(await tab.run(shopifyAddLine, target.addAs, quantity));
        if (answer.kind === 'refused') throw new LineProblem(answer.message);
      },
    },
  };
  return store;
}
