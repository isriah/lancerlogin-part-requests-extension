// The interface every store implements. One store is one file in src/carts/stores/, plus one line in registry.ts. See docs/CARTS.md.
import type { CartOrder } from './types';

/**
 * Direct: the store's own add address or cart API, no page controls.
 * Item by item: the store's own order form, filled in and submitted one line at a time.
 * Checklist: nothing is automated. The person gets links and quantities.
 */
export type StoreBadge = 'direct' | 'item' | 'checklist';
export const BADGE_LABEL: Record<StoreBadge, string> = { direct: 'Direct', item: 'Item by item', checklist: 'Checklist' };
export type OrderField = 'sku' | 'productUrl' | 'quantity';
export const FIELD_LABEL: Record<OrderField, string> = { sku: 'a SKU', productUrl: 'a product link', quantity: 'a quantity' };

/** What the store's cart holds for one line. Only the lines asked for ever leave the store's tab. */
export interface CartLine { key: string; quantity: number; unitPrice?: number | null }
/** One order worked out to a line in this store. `key` is what readCart reports it under, such as a variant ID or a part number. */
export interface LineTarget {
  key: string;
  /** Sent to addLine. Usually the same as `key`. */
  addAs: string;
  /** The store's own answer, when it gave one before adding. False means the add isn't tried. */
  available?: boolean;
  /** Something the person should check, which doesn't stop the add. */
  note?: string;
}
export interface StoreTab {
  /** Goes to an address in this store and waits for it to load. Refuses checkout and anything off the store. Checks for walls after. */
  goto(url: string): Promise<void>;
  /** Runs a self-contained function in the store's tab. It has no access to anything outside its own body and arguments. */
  run<A extends unknown[], R>(func: (...args: A) => R | Promise<R>, ...args: A): Promise<Awaited<R>>;
  /** The same, for a function that submits a form: waits for the page it leads to, then checks for walls. */
  runThenLoad<A extends unknown[], R>(func: (...args: A) => R | Promise<R>, ...args: A): Promise<Awaited<R>>;
}
export interface StoreSteps {
  /** Needs the tab in front, for a store whose page won't work behind other tabs. */
  foreground?: boolean;
  /** Works one order out to a line. Throw LineProblem when this order can't be added, and the rest carry on. */
  resolveLine(order: CartOrder, tab: StoreTab): Promise<LineTarget>;
  /** Reads what the cart holds for these keys, and nothing else. A key with nothing in the cart is left out. */
  readCart(tab: StoreTab, keys: string[]): Promise<CartLine[]>;
  /** Asks the store to add one line, once. The runner decides what happened from readCart, not from this. */
  addLine(tab: StoreTab, target: LineTarget, quantity: number): Promise<void>;
}
export interface StoreMethod {
  id: string;
  /** The store's name on screen, matching the plugin's vendor label. */
  label: string;
  badge: StoreBadge;
  /** One short line for the store's heading. */
  badgeHelp: string;
  /** Chrome match patterns, such as https://www.example.com/*. Requested from a person's click. Empty for a checklist. */
  origins: string[];
  /** The hosts a product link can be on, and that the store's tab may be on. */
  hosts: string[];
  /** Where a build starts in the store's tab. */
  startUrl?: string;
  /** The store's own cart page, for the results. Never a link that goes to checkout. */
  cartUrl: string | null;
  /** What an order must have before it can be ticked. */
  requiredFields: OrderField[];
  /** Anything else this store needs, as phrases to follow "needs": "a part number". */
  missing?(order: CartOrder): string[];
  /** Absent means a checklist. */
  steps?: StoreSteps;
}

export type StopReason = 'login' | 'bot-check' | 'unexpected';
/** Stops this store. Its remaining items become checklist links. No attempt is made to get past whatever caused it. */
export class StoreStop extends Error {
  /** @param notSent certain that this stop came before anything reached the store, so nothing needs checking in the cart */
  constructor(public reason: StopReason, detail = '', public notSent = false) { super(detail || reason); }
}
/** This order can't be added. The store carries on with the next one. */
export class LineProblem extends Error {}
/** What an injected function hands back when the page isn't what it expected. */
export interface PageStop { kind: 'stop'; reason: StopReason; detail?: string; notSent?: boolean }
export function stopIf<T>(answer: T | PageStop): T {
  if (answer && typeof answer === 'object' && (answer as PageStop).kind === 'stop') throw new StoreStop((answer as PageStop).reason, (answer as PageStop).detail, (answer as PageStop).notSent);
  return answer as T;
}
