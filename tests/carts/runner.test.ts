import { describe, expect, it } from 'vitest';
import { buildStore, marksFor } from '../../src/carts/runner';
import { StoreStop } from '../../src/carts/store-method';
import { fakeStore, hereTab, options, order } from './helpers';

describe('building one store', () => {
  it('adds a line, reads it back, and marks it', async () => {
    const cart = new Map<string, number>(); const { store, steps, adds, reads } = fakeStore(cart);
    const result = await buildStore(store, steps, [order({ quantity: 3 })], hereTab, options);
    expect(adds).toEqual([['TEST-1', 3]]);
    expect(reads).toEqual([['TEST-1'], ['TEST-1']]);
    expect(result.items[0]).toMatchObject({ outcome: 'added', message: '', confirmed: true });
    expect(marksFor(result)).toEqual([{ orderId: 'order-1', quantity: 3 }]);
  });
  it('never doubles on a retry, because the pre-read sees the first add', async () => {
    const cart = new Map<string, number>(); const { store, steps, adds } = fakeStore(cart);
    await buildStore(store, steps, [order({ quantity: 3 })], hereTab, options);
    const second = await buildStore(store, steps, [order({ quantity: 3 })], hereTab, options);
    expect(adds).toHaveLength(1);
    expect(cart.get('TEST-1')).toBe(3);
    expect(second.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true });
    expect(second.items[0].message).toMatch(/Already in the cart: it holds 3, so nothing was added/);
  });
  it('only adds what is missing when a line was partly there', async () => {
    const cart = new Map([['TEST-1', 2]]); const { store, steps, adds } = fakeStore(cart);
    const result = await buildStore(store, steps, [order({ quantity: 5 })], hereTab, options);
    expect(adds).toEqual([['TEST-1', 3]]);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true });
    expect(result.items[0].message).toMatch(/it held 2, so 3 more were added to reach 5/);
  });
  it('adds nothing, and says so, when the cart holds more than requested', async () => {
    const cart = new Map([['TEST-1', 9]]); const { store, steps, adds } = fakeStore(cart);
    const result = await buildStore(store, steps, [order({ quantity: 5 })], hereTab, options);
    expect(adds).toEqual([]);
    expect(result.items[0].outcome).toBe('flagged');
    expect(result.items[0].message).toMatch(/already holds 9, more than the 5/);
  });
  it('two orders for one line add up, and a retry of both adds nothing', async () => {
    const cart = new Map<string, number>(); const { store, steps, adds } = fakeStore(cart);
    const both = [order({ id: 'a', quantity: 2 }), order({ id: 'b', quantity: 3 })];
    const first = await buildStore(store, steps, both, hereTab, options);
    expect(adds).toEqual([['TEST-1', 2], ['TEST-1', 3]]);
    expect(cart.get('TEST-1')).toBe(5);
    expect(first.items.map(i => i.outcome)).toEqual(['added', 'added']);
    await buildStore(store, steps, both, hereTab, options);
    expect(adds).toHaveLength(2);
    expect(cart.get('TEST-1')).toBe(5);
  });
  it('reports short stock, and marks nothing', async () => {
    const cart = new Map<string, number>();
    const { store, steps } = fakeStore(cart, key => { cart.set(key, 3); });
    const result = await buildStore(store, steps, [order({ quantity: 5 })], hereTab, options);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false });
    expect(result.items[0].message).toMatch(/Short stock: asked for 5, and the cart holds 3/);
    expect(marksFor(result)).toEqual([]);
  });
  it('reports a read-back above what was asked, and marks nothing', async () => {
    const cart = new Map<string, number>();
    const { store, steps } = fakeStore(cart, (key, quantity) => { cart.set(key, quantity * 2); });
    const result = await buildStore(store, steps, [order({ quantity: 2 })], hereTab, options);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false });
    expect(result.items[0].message).toMatch(/Quantity mismatch: the cart should hold 2, but it holds 4/);
    expect(marksFor(result)).toEqual([]);
  });
  it('reports a cart that went down, and marks nothing', async () => {
    const cart = new Map([['TEST-1', 2]]);
    const { store, steps } = fakeStore(cart, key => { cart.set(key, 1); });
    const result = await buildStore(store, steps, [order({ quantity: 5 })], hereTab, options);
    expect(result.items[0].message).toMatch(/Quantity mismatch/);
    expect(marksFor(result)).toEqual([]);
  });
  it('fails a line the store left unchanged, and carries on', async () => {
    const cart = new Map<string, number>();
    const { store, steps } = fakeStore(cart, key => { if (key === 'TEST-2') cart.set(key, 1); });
    const result = await buildStore(store, steps, [order({ quantity: 1 }), order({ id: 'b', sku: 'TEST-2', quantity: 1 })], hereTab, options);
    expect(result.items.map(i => i.outcome)).toEqual(['failed', 'added']);
    expect(marksFor(result)).toEqual([{ orderId: 'b', quantity: 1 }]);
  });
  it('never tries a line the store shows as out of stock, or cannot find', async () => {
    const cart = new Map<string, number>(); const { store, steps, adds } = fakeStore(cart);
    const result = await buildStore(store, steps, [order({ sku: 'SOLD-OUT' }), order({ id: 'b', sku: 'NO-SUCH' })], hereTab, options);
    expect(adds).toEqual([]);
    expect(result.items.map(i => i.outcome)).toEqual(['failed', 'failed']);
    expect(result.items[0].message).toMatch(/out of stock/);
  });
  it('flags a changed price, and still marks the confirmed line', async () => {
    const cart = new Map<string, number>(); const { store, steps } = fakeStore(cart, undefined, new Map([['TEST-1', 16.2]]));
    const result = await buildStore(store, steps, [order({ quantity: 1, unitPrice: 14.85 })], hereTab, options);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: true, message: 'Price changed: requested at $14.85, store shows $16.20.' });
  });
  it('a wall stops the store: the rest stay checklist items, unmarked, and nothing more is tried', async () => {
    const cart = new Map<string, number>(); const { store, steps, adds } = fakeStore(cart);
    const read = steps.readCart;
    steps.readCart = async (tab, keys) => { if (keys[0] === 'WALL') throw new StoreStop('login'); return read(tab, keys); };
    const result = await buildStore(store, steps, [order({ id: 'a' }), order({ id: 'b', sku: 'WALL' }), order({ id: 'c', sku: 'TEST-3' })], hereTab, options);
    expect(result.stopped?.reason).toBe('login');
    expect(result.items.map(i => i.outcome)).toEqual(['added', 'checklist', 'checklist']);
    expect(adds).toEqual([['TEST-1', 2]]);
    expect(marksFor(result).map(m => m.orderId)).toEqual(['a']);
  });
  it('an add that cannot be read back is flagged, unmarked, and stops the store', async () => {
    const cart = new Map<string, number>(); const { store, steps } = fakeStore(cart);
    const read = steps.readCart; let reads = 0;
    steps.readCart = async (tab, keys) => { if (++reads === 2) throw new StoreStop('bot-check'); return read(tab, keys); };
    const result = await buildStore(store, steps, [order(), order({ id: 'b', sku: 'TEST-2' })], hereTab, options);
    expect(result.items.map(i => i.outcome)).toEqual(['flagged', 'checklist']);
    expect(result.items[0].message).toMatch(/could not be read back/);
    expect(marksFor(result)).toEqual([]);
  });
  it('a stop before anything reached the store stays a plain checklist item', async () => {
    const cart = new Map<string, number>(); const { store, steps } = fakeStore(cart);
    steps.addLine = async () => { throw new StoreStop('unexpected', 'no paste control', true); };
    const result = await buildStore(store, steps, [order()], hereTab, options);
    expect(result.items[0]).toMatchObject({ outcome: 'checklist', message: '', confirmed: false });
  });
  it('the Stop button leaves everything not reached as a checklist item', async () => {
    const cart = new Map<string, number>(); const { store, steps, adds } = fakeStore(cart);
    let stop = false;
    const result = await buildStore(store, steps, [order({ id: 'a' }), order({ id: 'b', sku: 'TEST-2' })], hereTab, { pause: async () => { stop = true; }, shouldStop: () => stop });
    expect(adds).toHaveLength(1);
    expect(result.items[1]).toMatchObject({ outcome: 'checklist', message: 'The build was stopped before this item.' });
  });
  it('sends each mark as only the order and its quantity', async () => {
    const cart = new Map<string, number>(); const { store, steps } = fakeStore(cart);
    const result = await buildStore(store, steps, [order()], hereTab, options);
    expect(Object.keys(marksFor(result)[0]).sort()).toEqual(['orderId', 'quantity']);
  });
});
