// Swerve Drive Specialties is a Shopify store whose variants have no SKUs, so createShopifyStore (which matches by saved ?variant= or SKU) can't
// do it all. This resolves from the saved link's ?variant=, else an exact match of a variant's title in the saved description, else a unique
// SKU. Anything that isn't exactly one match is a LineProblem. Reading the cart and adding are shopify.ts's, unchanged.
import { isOnStore } from '../safety';
import { LineProblem, stopIf, type LineTarget, type PageStop, type StoreMethod } from '../store-method';
import type { CartOrder } from '../types';
import { shopifyAddLine, shopifyLink, shopifyReadCart } from './shopify';

export interface SdsVariant { id: string; title: string; sku: string; available: boolean }
type ProductAnswer = { kind: 'ok'; variants: SdsVariant[] } | { kind: 'not-found' };

/** Injected. Reads only each variant's ID, title, SKU and whether it's available. */
export async function sdsReadProduct(handle: string): Promise<ProductAnswer | PageStop> {
  let reply: Response;
  try { reply = await fetch(`/products/${encodeURIComponent(handle)}.js`, { credentials: 'same-origin', headers: { Accept: 'application/json' } }); }
  catch { return { kind: 'stop', reason: 'unexpected', detail: 'no answer about a product' }; }
  if (reply.status === 404) return { kind: 'not-found' };
  if ([401, 403, 429, 503].includes(reply.status)) return { kind: 'stop', reason: 'bot-check', detail: `the store refused with ${reply.status}` };
  if (!reply.ok || reply.redirected) return { kind: 'stop', reason: 'unexpected', detail: 'an unexpected answer about a product' };
  let body: { variants?: { id: unknown; title: unknown; sku: unknown; available: unknown }[] };
  try { body = await reply.json(); } catch { return { kind: 'stop', reason: 'unexpected', detail: 'a product answer that was not data' }; }
  if (!Array.isArray(body?.variants)) return { kind: 'stop', reason: 'unexpected', detail: 'a product answer with no variants' };
  return { kind: 'ok', variants: body.variants.map(v => ({ id: String(v.id), title: typeof v.title === 'string' ? v.title : '', sku: typeof v.sku === 'string' ? v.sku.trim() : '', available: v.available !== false })) };
}

/** Case, spacing and the spaces around "/" don't matter. Everything else does. */
const fold = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim();
const alnum = /[\p{L}\p{N}]/u;
/** True when the variant's whole title appears in the text, not as part of a longer word or number. */
export function titleIn(title: string, text: string): boolean {
  const wanted = fold(title), haystack = fold(text);
  if (!wanted || /^default title$/.test(wanted)) return false;
  for (let at = haystack.indexOf(wanted); at !== -1; at = haystack.indexOf(wanted, at + 1)) {
    const before = haystack[at - 1], after = haystack[at + wanted.length];
    if (!(before && alnum.test(before)) && !(after && alnum.test(after))) return true;
  }
  return false;
}

/** Saved link's variant first, else an exact SKU, else a variant title found in the description, else a product with one variant. */
export function chooseSdsVariant(variants: SdsVariant[], variant: string | null, sku: string | null, description: string | null): { chosen: SdsVariant; note?: string } {
  const wanted = sku?.trim().toLowerCase() || '';
  const text = description ?? '';
  const named = variants.filter(v => titleIn(v.title, text));
  if (variant) {
    const found = variants.filter(v => v.id === variant);
    if (found.length !== 1) throw new LineProblem('The saved link points to an option this product no longer has.');
    const chosen = found[0];
    if (wanted && chosen.sku && chosen.sku.toLowerCase() !== wanted) throw new LineProblem(`The request says SKU ${sku!.trim()}, but the saved link's option is SKU ${chosen.sku}.`);
    // A description that names a different option than the link does is a conflict, not a tie to break.
    if (named.length && !named.some(v => v.id === chosen.id)) throw new LineProblem(`The saved link's option is "${chosen.title}", but the description names "${named[0].title}".`);
    return { chosen };
  }
  if (wanted) {
    const matches = variants.filter(v => v.sku && v.sku.toLowerCase() === wanted);
    if (matches.length === 1) return { chosen: matches[0] };
    if (matches.length > 1) throw new LineProblem(`More than one option on this product has SKU ${sku!.trim()}.`);
  }
  if (named.length === 1) return { chosen: named[0] };
  if (named.length > 1) throw new LineProblem('The description fits more than one option of this product, and the saved link doesn\'t say which.');
  if (variants.length === 1) return { chosen: variants[0] };
  throw new LineProblem('This product has several options, and the saved link and description don\'t say which one.');
}

const hosts = ['www.swervedrivespecialties.com', 'swervedrivespecialties.com'];
const cartUrl = 'https://www.swervedrivespecialties.com/cart';
export const sds: StoreMethod = {
  id: 'sds', label: 'SDS', badge: 'direct', badgeHelp: 'Adds to the store\'s cart directly, one line at a time',
  origins: ['https://www.swervedrivespecialties.com/*', 'https://swervedrivespecialties.com/*'], hosts, startUrl: cartUrl, cartUrl, requiredFields: ['productUrl', 'quantity'],
  missing(order: CartOrder) {
    if (order.productUrl && !(isOnStore({ hosts }, order.productUrl) && shopifyLink(order.productUrl))) return ['a product link on SDS\'s site'];
    return [];
  },
  steps: {
    async resolveLine(order, tab): Promise<LineTarget> {
      const link = shopifyLink(order.productUrl);
      if (!link) throw new LineProblem('This needs a product link on SDS\'s site.');
      const product = stopIf(await tab.run(sdsReadProduct, link.handle));
      if (product.kind === 'not-found') throw new LineProblem('The store no longer has this product page.');
      const { chosen, note } = chooseSdsVariant(product.variants, link.variant, order.sku, order.description);
      return { key: chosen.id, addAs: chosen.id, available: chosen.available, ...(note ? { note } : {}) };
    },
    async readCart(tab, keys) { return stopIf(await tab.run(shopifyReadCart, keys)); },
    async addLine(tab, target, quantity) {
      const answer = stopIf(await tab.run(shopifyAddLine, target.addAs, quantity));
      if (answer.kind === 'refused') throw new LineProblem(answer.message);
    },
  },
};
