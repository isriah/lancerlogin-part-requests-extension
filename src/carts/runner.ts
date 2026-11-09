// Works through one store's ticked orders, one line at a time, in that store's tab. The rules that matter live here, not in the stores:
// a pre-read before every add so a retry never doubles, a read-back after every add, and a stop that leaves the rest as checklist links.
import { LineProblem, StoreStop, type CartLine, type LineTarget, type StopReason, type StoreBadge, type StoreMethod, type StoreSteps, type StoreTab } from './store-method';
import type { CartOrder, MarkInput } from './types';

export type ItemOutcome = 'added' | 'flagged' | 'failed' | 'checklist';
export interface ItemResult {
  order: CartOrder;
  outcome: ItemOutcome;
  /** What the person should know. Empty for a plain add or a plain checklist item. */
  message: string;
  /** The cart was read back and holds the requested quantity, so the plugin may record a mark. */
  confirmed: boolean;
}
export interface StoreResult {
  storeId: string;
  label: string;
  badge: StoreBadge;
  cartUrl: string | null;
  items: ItemResult[];
  stopped?: { reason: StopReason; message: string };
  /** No access was granted, so nothing was tried. */
  noAccess?: boolean;
}
export interface BuildOptions {
  /** Waits between lines. Tests pass their own. */
  pause(): Promise<void>;
  shouldStop(): boolean;
  onProgress?(done: number, total: number): void;
}
const money = (value: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
export const stopMessage = (label: string, reason: StopReason): string => ({
  login: `${label} asked for a sign-in, so this stopped there. Sign in on the store's site, then build again, or add these yourself.`,
  'bot-check': `${label} showed a CAPTCHA or bot check, so this stopped there and did not try to get past it. Add these yourself on the store's site.`,
  unexpected: `${label} showed a page this didn't expect, so this stopped there. Add these yourself on the store's site.`,
}[reason]);
const lineIn = (lines: CartLine[], key: string): CartLine | undefined => lines.find(line => line.key === key);

export const checklistResult = (store: StoreMethod, orders: CartOrder[], extra: Partial<StoreResult> = {}): StoreResult => ({
  storeId: store.id, label: store.label, badge: extra.noAccess ? 'checklist' : store.badge, cartUrl: store.cartUrl,
  items: orders.map(order => ({ order, outcome: 'checklist', message: '', confirmed: false })), ...extra,
});

/** Runs the store's steps. Only a StoreStop or the person's Stop ends it early. Everything not reached becomes a checklist item. */
export async function buildStore(store: StoreMethod, steps: StoreSteps, orders: CartOrder[], tab: StoreTab, options: BuildOptions): Promise<StoreResult> {
  const result = checklistResult(store, orders);
  /** How much of each line this run has accounted for. Two orders for one part add up instead of hiding each other. */
  const accounted = new Map<string, number>();
  const put = (index: number, outcome: ItemOutcome, message: string, confirmed = false) => { result.items[index] = { order: orders[index], outcome, message, confirmed }; };
  for (let index = 0; index < orders.length; index++) {
    const order = orders[index];
    options.onProgress?.(index, orders.length);
    if (options.shouldStop()) {
      for (let rest = index; rest < orders.length; rest++) put(rest, 'checklist', 'The build was stopped before this item.');
      break;
    }
    if (index > 0) await options.pause();
    let sent = false;
    try {
      const requested = order.quantity!;
      let target: LineTarget;
      try { target = await steps.resolveLine(order, tab); }
      catch (error) {
        if (error instanceof LineProblem) { put(index, 'failed', error.message); continue; }
        throw error;
      }
      if (target.available === false) { put(index, 'failed', 'The store shows this as out of stock.'); continue; }
      const before = lineIn(await steps.readCart(tab, [target.key]), target.key)?.quantity ?? 0;
      const had = accounted.get(target.key) ?? 0;
      const want = had + requested;
      const need = want - before;
      if (need <= 0) {
        // Adds accumulate, so this is what keeps a second click from doubling anything.
        accounted.set(target.key, want);
        if (before === want) put(index, 'flagged', `Already in the cart: it holds ${before}, so nothing was added.`, true);
        else put(index, 'flagged', `The cart already holds ${before}, more than the ${want} requested. Nothing was added. Check the cart.`, true);
        continue;
      }
      let refusal = '';
      sent = true;
      try { await steps.addLine(tab, target, need); }
      catch (error) {
        if (!(error instanceof LineProblem)) throw error;
        refusal = error.message;
      }
      await options.pause();
      const line = lineIn(await steps.readCart(tab, [target.key]), target.key);
      sent = false;
      const after = line?.quantity ?? 0;
      if (after === want) {
        accounted.set(target.key, want);
        const notes: string[] = [];
        if (before > had) notes.push(`Already in the cart: it held ${before}, so ${need} more ${need === 1 ? 'was' : 'were'} added to reach ${want}.`);
        if (target.note) notes.push(target.note);
        if (order.unitPrice !== null && typeof line?.unitPrice === 'number' && Math.abs(line.unitPrice - order.unitPrice) >= 0.005) notes.push(`Price changed: requested at ${money(order.unitPrice)}, store shows ${money(line.unitPrice)}.`);
        put(index, notes.length ? 'flagged' : 'added', notes.join(' '), true);
      } else if (after === before) {
        accounted.set(target.key, before);
        put(index, 'failed', refusal || 'The store did not add this. The cart is unchanged.');
      } else if (after > before && after < want) {
        accounted.set(target.key, after);
        put(index, 'flagged', `Short stock: asked for ${requested}, and the cart holds ${after}. The store capped it.${refusal ? ` ${refusal}` : ''}`);
      } else {
        accounted.set(target.key, after);
        put(index, 'flagged', `Quantity mismatch: the cart should hold ${want}, but it holds ${after} (it held ${before}). Check the cart.`);
      }
    } catch (error) {
      if (!(error instanceof StoreStop)) throw error;
      result.stopped = { reason: error.reason, message: stopMessage(store.label, error.reason) };
      // An add may have landed with no way to read it back. A retry reads first so it's safe, but the person should look.
      if (sent && !error.notSent) put(index, 'flagged', 'This was sent to the store, but the cart could not be read back. Check the cart before adding it yourself.');
      break;
    }
  }
  options.onProgress?.(orders.length, orders.length);
  return result;
}
/** Marks only what a read-back confirmed. Nothing else about the cart goes to the plugin: an order's ID and its quantity. */
export const marksFor = (result: StoreResult): MarkInput[] => result.items.filter(item => item.confirmed && item.order.quantity !== null).map(item => ({ orderId: item.order.id, quantity: item.order.quantity! }));
