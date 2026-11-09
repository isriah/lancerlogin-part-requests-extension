// What the Carts screen starts with, and what can't be ticked. No browser APIs here.
import { FIELD_LABEL, type StoreMethod } from './store-method';
import { packKeyFor } from './packs';
import { storeForOrder, OTHER_STORE } from './registry';
import { roundUpTo } from './runner';
import type { CartOrder } from './types';

export interface OrderRow {
  order: CartOrder;
  store: StoreMethod;
  /** Why this can't be ticked, or null when it can. */
  blocked: string | null;
  /** How it starts, before anyone touches it. */
  startsTicked: boolean;
  /** Where this product's pack size is remembered, for a store that may sell it in packs. */
  packKey: string | null;
}
export interface StoreGroup { store: StoreMethod; rows: OrderRow[] }

export const startsTicked = (order: Pick<CartOrder, 'statusGroup'>): boolean => order.statusGroup === 'NORMAL' || order.statusGroup === 'RUSH';
const list = (items: string[]): string => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
const fold = (name: string) => name.trim().toLowerCase();

/** Why this order can't be added here, whatever its status. A row written by hand in Notion can be blank in any field. */
export function blockedReason(order: CartOrder, store: StoreMethod): string | null {
  if (order.vendor && order.urlVendor && fold(order.vendor) !== fold(order.urlVendor)) return `The Vendor says ${order.vendor}, but the product link goes to ${order.urlVendor}. Fix it in Notion.`;
  const needs: string[] = [];
  for (const field of store.requiredFields) {
    const value = order[field];
    if (value === null || value === '') needs.push(FIELD_LABEL[field]);
  }
  if (order.quantity !== null && !Number.isInteger(order.quantity)) needs.push('a whole-number quantity');
  needs.push(...store.missing?.(order) ?? []);
  if (!needs.length) return null;
  return `${store.label === OTHER_STORE ? 'This' : store.label} needs ${list(needs)}. Add ${needs.length > 1 ? 'them' : 'it'} in Notion.`;
}
export function rowFor(order: CartOrder): OrderRow {
  const store = storeForOrder(order);
  const blocked = blockedReason(order, store);
  // Already in someone's cart starts unticked, so it isn't bought twice by accident. It can still be ticked.
  return { order, store, blocked, startsTicked: !blocked && startsTicked(order) && !order.cartMarks?.length, packKey: packKeyFor(store, order) };
}
/** Orders grouped by store, stores by name with the unknown ones last, keeping each store's orders as the list gave them. */
export function groupOrders(orders: CartOrder[]): StoreGroup[] {
  const groups = new Map<string, StoreGroup>();
  for (const order of orders) {
    const row = rowFor(order);
    const group = groups.get(row.store.id);
    if (group) group.rows.push(row); else groups.set(row.store.id, { store: row.store, rows: [row] });
  }
  return [...groups.values()].sort((a, b) => Number(a.store.label === OTHER_STORE) - Number(b.store.label === OTHER_STORE) || a.store.label.localeCompare(b.store.label));
}
/** A tick is only ever honored for a row that can be ticked. */
export function isTicked(row: OrderRow, ticks: ReadonlyMap<string, boolean>): boolean {
  if (row.blocked) return false;
  return ticks.get(row.order.id) ?? row.startsTicked;
}
/** Unticks every row that can be ticked. One that can't is never ticked anyway. */
export function untickAll(groups: StoreGroup[], ticks: Map<string, boolean>): void {
  for (const group of groups) for (const row of group.rows) if (!row.blocked) ticks.set(row.order.id, false);
}
export interface LeftOutRow { order: CartOrder; store: StoreMethod; why: string }
/** Each row a build won't include, and in plain words why not. Nothing about a row is left to be guessed from its absence. */
export function leftOutOf(groups: StoreGroup[], ticks: ReadonlyMap<string, boolean>): LeftOutRow[] {
  const whyNot = (row: OrderRow): string => {
    if (row.blocked) return row.blocked;
    if (ticks.get(row.order.id) === false) return 'It was unticked.';
    if (row.order.cartMarks?.length) return 'It\'s already in someone\'s cart, so it started unticked.';
    return `${row.order.statusGroup} requests start unticked.`;
  };
  return groups.flatMap(group => group.rows.filter(row => !isTicked(row, ticks)).map(row => ({ order: row.order, store: row.store, why: whyNot(row) })));
}
/**
 * What the screen says about this row's pack size. `known`: an earlier build read it, and the estimate counts whole packs.
 * `unknown`: the store may sell it in packs, and no build has read it yet, so the estimate uses the requested quantity.
 */
export type PackNote = { kind: 'known'; soldIn: number } | { kind: 'unknown' } | null;
export function packNote(row: OrderRow, packs: ReadonlyMap<string, number>): PackNote {
  if (!row.packKey || row.blocked) return null;
  const soldIn = packs.get(row.packKey);
  if (soldIn === undefined) return { kind: 'unknown' };
  return soldIn > 1 ? { kind: 'known', soldIn } : null;
}
export interface SelectionSummary {
  ticked: number; total: number; stores: number; estimate: number; withoutPrice: number;
  /** Ticked items the estimate counts at a whole pack, from a pack size an earlier build read. */
  packRounded: number;
  /** Ticked items a build may still round up, because no build has read their pack size. */
  mayRound: number;
}
/**
 * The estimate. A pack size an earlier build read is used the way a build uses it: the ticked orders for one product are added up, then
 * rounded up to whole packs, and the extra is priced at that product's requested price.
 */
export function summarize(groups: StoreGroup[], ticks: ReadonlyMap<string, boolean>, packs: ReadonlyMap<string, number> = new Map()): SelectionSummary {
  let ticked = 0, total = 0, stores = 0, estimate = 0, withoutPrice = 0, packRounded = 0, mayRound = 0;
  const shared = new Map<string, { soldIn: number; asked: number; price: number | null; rows: number }>();
  for (const group of groups) {
    let any = false;
    for (const row of group.rows) {
      total++;
      if (!isTicked(row, ticks)) continue;
      ticked++; any = true;
      if (row.order.unitPrice === null || row.order.quantity === null) withoutPrice++;
      else estimate += row.order.unitPrice * row.order.quantity;
      const note = packNote(row, packs);
      if (note?.kind === 'unknown') mayRound++;
      if (note?.kind !== 'known' || row.order.quantity === null) continue;
      const line = shared.get(row.packKey!) ?? { soldIn: note.soldIn, asked: 0, price: null, rows: 0 };
      line.asked += row.order.quantity; line.rows++;
      line.price ??= row.order.unitPrice;
      shared.set(row.packKey!, line);
    }
    if (any) stores++;
  }
  for (const line of shared.values()) {
    const extra = roundUpTo(line.asked, line.soldIn) - line.asked;
    if (!extra) continue;
    packRounded += line.rows;
    if (line.price !== null) estimate += extra * line.price;
  }
  return { ticked, total, stores, estimate, withoutPrice, packRounded, mayRound };
}
