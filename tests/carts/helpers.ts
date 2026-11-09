import type { CartOrder } from '../../src/carts/types';
import { LineProblem, stopIf, type CartLine, type StoreMethod, type StoreSteps, type StoreTab } from '../../src/carts/store-method';

export function order(extra: Partial<CartOrder> = {}): CartOrder {
  return {
    id: 'order-1', url: 'https://app.notion.com/p/order-1', description: 'Test bracket', vendor: 'REV', urlVendor: 'REV', sku: 'TEST-1', productUrl: 'https://www.revrobotics.com/test-1/',
    quantity: 2, unitPrice: 10, status: 'NORMAL Request', statusGroup: 'NORMAL', teams: ['Test Team One'], requesters: ['Test Student A'], cartMarks: [], ...extra,
  };
}
/** A tab that runs an injected function here, in jsdom. Navigation isn't simulated. */
export const hereTab: StoreTab = {
  async goto() { /* Nothing loads in a unit test. */ },
  async run(func, ...args) { return await func(...args) as never; },
  async runThenLoad(func, ...args) { return await func(...args) as never; },
};
/** A fake store, whose cart is a map. `onAdd` says what the store really does with an add. */
export function fakeStore(cart: Map<string, number>, onAdd?: (key: string, quantity: number) => void | never, prices: Map<string, number> = new Map()): { store: StoreMethod; steps: StoreSteps; adds: [string, number][]; reads: string[][] } {
  const adds: [string, number][] = [], reads: string[][] = [];
  const steps: StoreSteps = {
    async resolveLine(o) {
      if (o.sku === 'NO-SUCH') throw new LineProblem('No option has that SKU.');
      return { key: o.sku!, addAs: o.sku!, ...(o.sku === 'SOLD-OUT' ? { available: false } : {}) };
    },
    async readCart(_tab, keys) {
      reads.push(keys);
      const lines: CartLine[] = [];
      for (const key of keys) if (cart.has(key)) lines.push({ key, quantity: cart.get(key)!, unitPrice: prices.get(key) ?? null });
      return lines;
    },
    async addLine(_tab, target, quantity) {
      adds.push([target.addAs, quantity]);
      if (onAdd) onAdd(target.addAs, quantity); else cart.set(target.addAs, (cart.get(target.addAs) ?? 0) + quantity);
    },
  };
  const store: StoreMethod = { id: 'fake', label: 'Fake', badge: 'direct', badgeHelp: '', origins: ['https://fake.example.test/*'], hosts: ['fake.example.test'], cartUrl: 'https://fake.example.test/cart', requiredFields: ['sku', 'quantity'], steps };
  return { store, steps, adds, reads };
}
export const options = { pause: async () => undefined, settle: async () => undefined, shouldStop: () => false };
export { stopIf };
