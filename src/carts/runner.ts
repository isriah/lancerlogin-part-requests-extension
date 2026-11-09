// Works through one store's ticked orders, one line at a time, in that store's tab. The rules that matter live here, not in the stores:
// a pre-read before every add so a retry never doubles, a read-back after every add, a stop that leaves the rest as checklist links, and a final
// read once the store's own cart page has had time to run, because that page can change a quantity after the read-back.
import { allowedInTab } from './safety';
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
  /** The store changed this line after the build read it. For the results only: nothing here ever goes back to the store. */
  storeChanged?: { asked: number; holds: number };
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
  /** The store's own note for the results. */
  resultNote?: string;
  /** Lines were sent, but the final read of the cart couldn't run, so the results are from before the cart page settled. */
  finalCheckNote?: string;
}
export interface BuildOptions {
  /** Waits between lines. Tests pass their own. */
  pause(): Promise<void>;
  /** Waits on the cart page before the final read. Tests pass their own. */
  settle(): Promise<void>;
  shouldStop(): boolean;
  onProgress?(done: number, total: number): void;
  onFinalCheck?(): void;
}
const money = (value: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
export const stopMessage = (label: string, reason: StopReason): string => ({
  login: `${label} asked for a sign-in, so this stopped there. Sign in on the store's site, then build again, or add these yourself.`,
  'bot-check': `${label} showed a CAPTCHA or bot check, so this stopped there and did not try to get past it. Add these yourself on the store's site.`,
  unexpected: `${label} showed a page this didn't expect, so this stopped there. Add these yourself on the store's site.`,
}[reason]);
const lineIn = (lines: CartLine[], key: string): CartLine | undefined => lines.find(line => line.key === key);
const finalCheckNote = (label: string, reason?: StopReason): string => {
  const why = reason ? `, because ${label} ${{ login: 'asked for a sign-in', 'bot-check': 'showed a CAPTCHA or bot check', unexpected: 'showed a page this didn\'t expect' }[reason]}` : '';
  return `The final check of this cart couldn't run${why}. These results are from before the store's cart page settled, so check the cart before ordering.`;
};
/** One line of the cart, as this build left it. Two orders for one part share one of these. */
interface HandledLine {
  /** What the last read of this line said. */
  seen: number;
  /** All this build's orders for the line, added up. */
  asked: number;
  /** A read-back saw the line go up. */
  landed: boolean;
  items: number[];
  /** The items whose own add was sent. */
  sent: Set<number>;
}
/** The final read: lets the store's cart page run, reads the lines this build handled, and flags any that moved. It only ever reads. */
async function recheckLines(store: StoreMethod, read: (keys: string[]) => Promise<CartLine[]>, readLoadsCart: () => boolean, lines: Map<string, HandledLine>, result: StoreResult, tab: StoreTab, options: BuildOptions): Promise<void> {
  let settled: CartLine[];
  try {
    if (!store.cartUrl || !allowedInTab(store, store.cartUrl)) throw new Error('no safe cart page');
    // A store whose own read loads the cart page has just done so, and will again for this read, so one more load would only add a wait.
    if (!readLoadsCart()) await tab.goto(store.cartUrl);
    await options.settle();
    settled = await read([...lines.keys()]);
  } catch (error) {
    result.finalCheckNote = finalCheckNote(store.label, error instanceof StoreStop ? error.reason : undefined);
    return;
  }
  for (const [key, line] of lines) {
    const holds = lineIn(settled, key)?.quantity ?? 0;
    if (holds === line.seen) continue;
    const asked = `you asked for ${line.asked}${line.items.length > 1 ? ` across ${line.items.length} orders` : ''}`;
    const changed = `The ${line.landed ? `store changed this to ${holds} after it was added` : `cart changed to ${holds} during this build`}; ${asked}. Check the cart before ordering.`;
    for (const index of line.items) {
      const item = result.items[index];
      // Notes on a confirmed add still hold. Anything else described the number that just moved.
      const kept = item.confirmed && line.sent.has(index) ? item.message : '';
      result.items[index] = { order: item.order, outcome: 'flagged', message: kept ? `${changed} ${kept}` : changed, confirmed: false, storeChanged: { asked: line.asked, holds } };
    }
  }
}

export const checklistResult = (store: StoreMethod, orders: CartOrder[], extra: Partial<StoreResult> = {}): StoreResult => ({
  storeId: store.id, label: store.label, badge: extra.noAccess ? 'checklist' : store.badge, cartUrl: store.cartUrl,
  items: orders.map(order => ({ order, outcome: 'checklist', message: '', confirmed: false })), ...(store.resultNote ? { resultNote: store.resultNote } : {}), ...extra,
});

/** Runs the store's steps, then the final read. Only a StoreStop or the person's Stop ends the lines early. Everything not reached becomes a checklist item. */
export async function buildStore(store: StoreMethod, steps: StoreSteps, orders: CartOrder[], realTab: StoreTab, options: BuildOptions): Promise<StoreResult> {
  const result = checklistResult(store, orders);
  /** How much of each line this run has accounted for. Two orders for one part add up instead of hiding each other. */
  const accounted = new Map<string, number>();
  const lines = new Map<string, HandledLine>();
  let anySent = false;
  // The store's own steps go through this, so the final read can tell a store whose read loads the cart page from one that reads whatever is showing.
  let reading = false, readLoadedCart = false;
  const tab: StoreTab = {
    goto(url) { readLoadedCart = reading && url === store.cartUrl; return realTab.goto(url); },
    run(func, ...args) { return realTab.run(func, ...args); },
    runThenLoad(func, ...args) { readLoadedCart = false; return realTab.runThenLoad(func, ...args); },
  };
  const read = async (keys: string[]): Promise<CartLine[]> => {
    reading = true;
    try { return await steps.readCart(tab, keys); }
    finally { reading = false; }
  };
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
      const before = lineIn(await read([target.key]), target.key)?.quantity ?? 0;
      const handled = lines.get(target.key) ?? { seen: before, asked: 0, landed: false, items: [], sent: new Set<number>() };
      lines.set(target.key, handled);
      handled.seen = before;
      handled.asked += requested;
      handled.items.push(index);
      const had = accounted.get(target.key) ?? 0;
      const want = had + requested;
      const need = want - before;
      if (need <= 0) {
        // Adds accumulate, so this is what keeps a second click from doubling anything.
        accounted.set(target.key, want);
        if (before === want) put(index, 'flagged', `Already in the cart: it holds ${before}, so nothing was added.`, true);
        else put(index, 'flagged', `The cart already holds ${before}, more than the ${want} you asked for. Nothing was added, and the quantity wasn't changed. Check the cart before ordering.`, true);
        continue;
      }
      let refusal = '';
      sent = true;
      handled.sent.add(index);
      try { await steps.addLine(tab, target, need); }
      catch (error) {
        if (!(error instanceof LineProblem)) throw error;
        refusal = error.message;
      }
      await options.pause();
      const line = lineIn(await read([target.key]), target.key);
      sent = false;
      anySent = true;
      const after = line?.quantity ?? 0;
      handled.seen = after;
      if (after > before) handled.landed = true;
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
      if (sent && !error.notSent) { anySent = true; put(index, 'flagged', 'This was sent to the store, but the cart could not be read back. Check the cart before adding it yourself.'); }
      break;
    }
  }
  options.onProgress?.(orders.length, orders.length);
  if (result.stopped) {
    // A wall ends this store's pages for good, so the final read isn't tried.
    if (anySent) result.finalCheckNote = finalCheckNote(store.label, result.stopped.reason);
  } else if (anySent) {
    options.onFinalCheck?.();
    await recheckLines(store, read, () => readLoadedCart, lines, result, tab, options);
  }
  return result;
}
/** Marks only what the final read left confirmed. Nothing else about the cart goes to the plugin: an order's ID and its quantity. */
export const marksFor = (result: StoreResult): MarkInput[] => result.items.filter(item => item.confirmed && item.order.quantity !== null).map(item => ({ orderId: item.order.id, quantity: item.order.quantity! }));
