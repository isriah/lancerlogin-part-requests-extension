// The rules that hold for every store. A store's own file can't get around these: the tab refuses the address before going there.
import type { StoreMethod } from './store-method';

/** Checkout, buy-now links and Shopify's permalinks, which skip the cart and go straight to checkout. */
const NEVER = /checkout|action=buy|\/cart\/\d+:\d+|\/pay(ment)?(\/|$|\?)|place-?order/i;
export function isForbiddenUrl(raw: string): boolean {
  try { const u = new URL(raw); return NEVER.test(`${u.pathname}${u.search}`); }
  catch { return true; }
}
export function isOnStore(store: Pick<StoreMethod, 'hosts'>, raw: string): boolean {
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password && store.hosts.includes(u.hostname.toLowerCase()); }
  catch { return false; }
}
export const allowedInTab = (store: Pick<StoreMethod, 'hosts'>, raw: string): boolean => isOnStore(store, raw) && !isForbiddenUrl(raw);
/** A quiet pause between one line and the next, so a store sees one person's pace. */
export const paceMs = (random = Math.random): number => 1200 + Math.floor(random() * 1000);
