// AndyMark is a Shopify store whose SKUs are not unique: the same SKU can sit on more than one product, and bundles repeat SKUs.
// So a SKU alone never picks an item here. The line must name the product by its link's handle, the answer must be that same product,
// and the SKU must match exactly one option of it (or the saved ?variant= must, and the SKU must still agree). Anything else is a LineProblem.
import { LineProblem, stopIf, type LineTarget, type PageStop, type StoreMethod } from '../store-method';
import type { CartOrder } from '../types';
import { createShopifyStore, shopifyLink, type ShopifyVariant } from './shopify';

type ProductAnswer = { kind: 'ok'; handle: string; variants: ShopifyVariant[] } | { kind: 'not-found' };

/** Injected. Like the shared product read, but also hands back the handle the store answered for, so a different product can't pass. */
export async function andymarkReadProduct(handle: string): Promise<ProductAnswer | PageStop> {
  let reply: Response;
  try { reply = await fetch(`/products/${encodeURIComponent(handle)}.js`, { credentials: 'same-origin', headers: { Accept: 'application/json' } }); }
  catch { return { kind: 'stop', reason: 'unexpected', detail: 'no answer about a product' }; }
  if (reply.status === 404) return { kind: 'not-found' };
  if ([401, 403, 429, 503].includes(reply.status)) return { kind: 'stop', reason: 'bot-check', detail: `the store refused with ${reply.status}` };
  if (!reply.ok || reply.redirected) return { kind: 'stop', reason: 'unexpected', detail: 'an unexpected answer about a product' };
  let body: { handle?: unknown; variants?: { id: unknown; sku: unknown; available: unknown }[] };
  try { body = await reply.json(); } catch { return { kind: 'stop', reason: 'unexpected', detail: 'a product answer that was not data' }; }
  if (!Array.isArray(body?.variants) || typeof body.handle !== 'string') return { kind: 'stop', reason: 'unexpected', detail: 'a product answer with no variants' };
  return { kind: 'ok', handle: body.handle, variants: body.variants.map(v => ({ id: String(v.id), sku: typeof v.sku === 'string' ? v.sku.trim() : '', available: v.available !== false })) };
}

const sameSku = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * One option of one product, or a LineProblem. The SKU is always required and must match exactly.
 * A saved ?variant= may settle a SKU the product repeats; without one, a repeated SKU is refused.
 */
export function chooseAndyMarkVariant(variants: ShopifyVariant[], variant: string | null, sku: string | null): ShopifyVariant {
  const wanted = sku?.trim() || '';
  if (!wanted) throw new LineProblem('AndyMark repeats SKUs across products, so this needs a SKU to confirm the item.');
  if (variant) {
    const chosen = variants.find(v => v.id === variant);
    if (!chosen) throw new LineProblem('The saved link points to an option this product no longer has.');
    if (!chosen.sku || !sameSku(wanted, chosen.sku)) throw new LineProblem(`The request says SKU ${wanted}, but the saved link's option is ${chosen.sku ? `SKU ${chosen.sku}` : 'listed with no SKU'}.`);
    return chosen;
  }
  const matches = variants.filter(v => v.sku && sameSku(wanted, v.sku));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new LineProblem(`More than one option on this product has SKU ${wanted}, and the saved link doesn't say which.`);
  throw new LineProblem(`No option on this product has SKU ${wanted}.`);
}

const base = createShopifyStore({ id: 'andymark', label: 'AndyMark', home: 'https://andymark.com', hosts: ['andymark.com', 'www.andymark.com'], origins: ['https://andymark.com/*'] });

export const andymark: StoreMethod = {
  ...base,
  requiredFields: ['sku', 'productUrl', 'quantity'],
  badgeHelp: 'Adds to the store\'s cart directly, one line at a time, checked by product and SKU',
  steps: {
    ...base.steps!,
    async resolveLine(order: CartOrder, tab): Promise<LineTarget> {
      const link = shopifyLink(order.productUrl);
      if (!link) throw new LineProblem('This needs a product link on AndyMark\'s site.');
      const product = stopIf(await tab.run(andymarkReadProduct, link.handle));
      if (product.kind === 'not-found') throw new LineProblem('The store no longer has this product page.');
      if (product.handle.toLowerCase() !== link.handle.toLowerCase()) throw new LineProblem('The store answered with a different product than the saved link.');
      const chosen = chooseAndyMarkVariant(product.variants, link.variant, order.sku);
      return { key: chosen.id, addAs: chosen.id, available: chosen.available };
    },
  },
  missing(order: CartOrder) { return [...(order.sku?.trim() ? [] : ['a SKU']), ...base.missing!(order)]; },
};
