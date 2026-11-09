// Pack sizes the last builds read, so the Carts screen's estimate can count whole packs before the next build. The Carts screen never asks a
// store for them: only a build, in the store's tab, reads a pack size. What's kept is the store, the product's handle and SKU, the pack size and
// when it was read. Nothing about who asked for it.
import type { StoreResult } from './runner';
import type { StoreMethod } from './store-method';
import type { CartOrder } from './types';

export const PACKS_KEY = 'cartsPackSizes';
/** The newest this many are kept. */
export const MAX_PACKS = 500;
export interface PackEntry { soldIn: number; seenMs: number }
export type PackMemory = Record<string, PackEntry>;

/** Where this order's pack size is kept, or null for a store that doesn't sell in packs, or an order that doesn't name the product. */
export function packKeyFor(store: Pick<StoreMethod, 'id' | 'packKey'>, order: CartOrder): string | null {
  const key = store.packKey?.(order);
  return key ? `${store.id}:${key}` : null;
}
const isEntry = (value: unknown): value is PackEntry => !!value && typeof value === 'object'
  && Number.isSafeInteger((value as PackEntry).soldIn) && (value as PackEntry).soldIn >= 1 && Number.isFinite((value as PackEntry).seenMs);
/** Whatever storage held, with anything malformed left out. */
export function cleanPacks(value: unknown): PackMemory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => typeof key === 'string' && key.length <= 300 && isEntry(entry)).map(([key, entry]) => [key, { soldIn: entry.soldIn, seenMs: entry.seenMs }]));
}
/** The memory with what this build read added. A line whose pack size couldn't be read leaves the earlier value alone. */
export function rememberPacks(memory: PackMemory, store: Pick<StoreMethod, 'id' | 'packKey'>, result: Pick<StoreResult, 'items'>, now: number): PackMemory {
  const next = { ...memory };
  for (const item of result.items) {
    const key = item.soldIn !== undefined ? packKeyFor(store, item.order) : null;
    if (key && Number.isSafeInteger(item.soldIn) && item.soldIn! >= 1) next[key] = { soldIn: item.soldIn!, seenMs: now };
  }
  const keys = Object.keys(next);
  if (keys.length <= MAX_PACKS) return next;
  return Object.fromEntries(keys.sort((a, b) => next[b].seenMs - next[a].seenMs).slice(0, MAX_PACKS).map(key => [key, next[key]]));
}
export const packSizes = (memory: PackMemory): Map<string, number> => new Map(Object.entries(memory).map(([key, entry]) => [key, entry.soldIn]));
