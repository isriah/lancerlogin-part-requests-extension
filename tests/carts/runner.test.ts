import { describe, expect, it } from 'vitest';
import { buildStore, marksFor } from '../../src/carts/runner';
import { StoreStop, type StoreTab } from '../../src/carts/store-method';
import { fakeStore, hereTab, options, order } from './helpers';

describe('building one store', () => {
  it('adds a line, reads it back, and marks it', async () => {
    const cart = new Map<string, number>(); const { store, steps, adds, reads } = fakeStore(cart);
    const result = await buildStore(store, steps, [order({ quantity: 3 })], hereTab, options);
    expect(adds).toEqual([['TEST-1', 3]]);
    expect(reads).toEqual([['TEST-1'], ['TEST-1'], ['TEST-1']]);
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
  it('adds nothing, says so, and marks nothing when the cart holds more than requested', async () => {
    const cart = new Map([['TEST-1', 9]]); const { store, steps, adds } = fakeStore(cart);
    const result = await buildStore(store, steps, [order({ quantity: 5 })], hereTab, options);
    expect(adds).toEqual([]);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false });
    expect(result.items[0].message).toMatch(/already holds 9, more than the 5/);
    expect(marksFor(result)).toEqual([]);
  });
  it('a retry of two orders for one line marks both, because together they account for the cart', async () => {
    const cart = new Map([['TEST-1', 5]]); const { store, steps, adds } = fakeStore(cart);
    const result = await buildStore(store, steps, [order({ id: 'a', quantity: 2 }), order({ id: 'b', quantity: 3 })], hereTab, options);
    expect(adds).toEqual([]);
    expect(result.items.map(item => item.message)).toEqual(['Already in the cart: it holds 5, so nothing was added.', 'Already in the cart: it holds 5, so nothing was added.']);
    expect(marksFor(result).map(mark => mark.orderId)).toEqual(['a', 'b']);
  });
  it('two orders for one line that together are still under the cart mark neither', async () => {
    const cart = new Map([['TEST-1', 9]]); const { store, steps } = fakeStore(cart);
    const result = await buildStore(store, steps, [order({ id: 'a', quantity: 2 }), order({ id: 'b', quantity: 3 })], hereTab, options);
    expect(result.items.map(item => item.confirmed)).toEqual([false, false]);
    expect(marksFor(result)).toEqual([]);
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
    const result = await buildStore(store, steps, [order({ id: 'a' }), order({ id: 'b', sku: 'TEST-2' })], hereTab, { ...options, pause: async () => { stop = true; }, shouldStop: () => stop });
    expect(adds).toHaveLength(1);
    expect(result.items[1]).toMatchObject({ outcome: 'checklist', message: 'The build was stopped before this item.' });
  });
  it('sends each mark as only the order and its quantity', async () => {
    const cart = new Map<string, number>(); const { store, steps } = fakeStore(cart);
    const result = await buildStore(store, steps, [order()], hereTab, options);
    expect(Object.keys(marksFor(result)[0]).sort()).toEqual(['orderId', 'quantity']);
  });
});

describe('the final read, once the cart page has settled', () => {
  /** A tab that logs every address, and a store whose cart page does `onPage` to the cart once it has loaded and settled. */
  function settling(cart: Map<string, number>, onPage: () => void = () => undefined) {
    const events: string[] = [];
    const fake = fakeStore(cart);
    const { steps } = fake;
    const read = steps.readCart, add = steps.addLine;
    steps.readCart = async (tab, keys) => { events.push(`read ${keys.join()}`); return read(tab, keys); };
    steps.addLine = async (tab, target, quantity) => { events.push(`add ${quantity}`); return add(tab, target, quantity); };
    const tab: StoreTab = { ...hereTab, async goto(url) { events.push(`goto ${url}`); } };
    const settle = { ...options, settle: async () => { events.push('settle'); onPage(); } };
    return { ...fake, events, tab, settle };
  }
  const CART = 'https://fake.example.test/cart';

  it('flags a line the store raised, names both numbers, adds nothing more and marks nothing', async () => {
    const cart = new Map<string, number>();
    const { store, steps, adds, events, tab, settle } = settling(cart, () => cart.set('TEST-1', 25));
    const result = await buildStore(store, steps, [order({ quantity: 1 })], tab, settle);
    expect(result.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, storeChanged: { asked: 1, holds: 25 } });
    expect(result.items[0].message).toBe('The store changed this to 25 after it was added; you asked for 1. Check the cart before ordering.');
    expect(marksFor(result)).toEqual([]);
    expect(adds).toEqual([['TEST-1', 1]]);
    expect(cart.get('TEST-1')).toBe(25);
    expect(events).toEqual(['read TEST-1', 'add 1', 'read TEST-1', `goto ${CART}`, 'settle', 'read TEST-1']);
  });
  it('flags a line the store lowered or removed', async () => {
    const lowered = new Map<string, number>();
    const low = settling(lowered, () => lowered.set('TEST-1', 2));
    const first = await buildStore(low.store, low.steps, [order({ quantity: 5 })], low.tab, low.settle);
    expect(first.items[0].message).toMatch(/changed this to 2 after it was added; you asked for 5/);
    expect(marksFor(first)).toEqual([]);
    const removed = new Map<string, number>();
    const gone = settling(removed, () => removed.delete('TEST-1'));
    const second = await buildStore(gone.store, gone.steps, [order({ quantity: 5 })], gone.tab, gone.settle);
    expect(second.items[0]).toMatchObject({ outcome: 'flagged', confirmed: false, storeChanged: { asked: 5, holds: 0 } });
    expect(gone.adds).toHaveLength(1);
  });
  it('changes nothing about a line that held, and still marks it', async () => {
    const cart = new Map<string, number>();
    const { store, steps, tab, settle } = settling(cart);
    const result = await buildStore(store, steps, [order({ quantity: 3 })], tab, settle);
    expect(result.items[0]).toEqual({ order: expect.anything(), outcome: 'added', message: '', confirmed: true });
    expect(result.finalCheckNote).toBeUndefined();
    expect(marksFor(result)).toEqual([{ orderId: 'order-1', quantity: 3 }]);
  });
  it('a wall during the final read keeps the earlier result, adds a note, and tries no more', async () => {
    const cart = new Map<string, number>();
    const { store, steps, adds, tab, settle } = settling(cart);
    const wall: StoreTab = { ...tab, async goto() { throw new StoreStop('bot-check'); } };
    const result = await buildStore(store, steps, [order({ quantity: 2 })], wall, settle);
    expect(result.items[0]).toMatchObject({ outcome: 'added', confirmed: true });
    expect(result.stopped).toBeUndefined();
    expect(result.finalCheckNote).toMatch(/final check of this cart couldn't run, because Fake showed a CAPTCHA or bot check/);
    expect(marksFor(result)).toEqual([{ orderId: 'order-1', quantity: 2 }]);
    expect(adds).toHaveLength(1);
  });
  it('a read that fails during the final check is handled the same, whatever the error', async () => {
    const cart = new Map<string, number>();
    const { store, steps, events, tab, settle } = settling(cart);
    const read = steps.readCart; let reads = 0;
    steps.readCart = async (t, keys) => { if (++reads === 3) throw new Error('Chrome lost the tab'); return read(t, keys); };
    const result = await buildStore(store, steps, [order()], tab, settle);
    expect(result.items[0].outcome).toBe('added');
    expect(result.finalCheckNote).toMatch(/couldn't run\. These results/);
    expect(events.filter(event => event.startsWith('add'))).toHaveLength(1);
  });
  it('refuses a cart page the tab may not visit, and says so', async () => {
    const cart = new Map<string, number>();
    const { store, steps, events, tab, settle } = settling(cart);
    const result = await buildStore({ ...store, cartUrl: 'https://fake.example.test/checkout' }, steps, [order()], tab, settle);
    expect(events.some(event => event.startsWith('goto'))).toBe(false);
    expect(result.finalCheckNote).toMatch(/couldn't run/);
    expect(result.items[0].outcome).toBe('added');
  });
  it('does not run when nothing was sent', async () => {
    const cart = new Map([['TEST-1', 2]]);
    const { store, steps, events, tab, settle } = settling(cart);
    const result = await buildStore(store, steps, [order({ quantity: 2 })], tab, settle);
    expect(events).toEqual(['read TEST-1']);
    expect(result.finalCheckNote).toBeUndefined();
    const none = await buildStore(store, steps, [order({ sku: 'SOLD-OUT' })], tab, settle);
    expect(events).toEqual(['read TEST-1']);
    expect(none.finalCheckNote).toBeUndefined();
  });
  it('after a wall during the lines it does not go back to the store, and says the check did not run', async () => {
    const cart = new Map<string, number>();
    const { store, steps, events, tab, settle } = settling(cart);
    const read = steps.readCart;
    steps.readCart = async (t, keys) => { if (keys[0] === 'WALL') throw new StoreStop('login'); return read(t, keys); };
    const result = await buildStore(store, steps, [order({ id: 'a' }), order({ id: 'b', sku: 'WALL' })], tab, settle);
    expect(events).not.toContain('settle');
    expect(events.some(event => event.startsWith('goto'))).toBe(false);
    expect(result.finalCheckNote).toMatch(/because Fake asked for a sign-in/);
    expect(marksFor(result).map(m => m.orderId)).toEqual(['a']);
  });
  it('still runs after the Stop button, for what was already sent', async () => {
    const cart = new Map<string, number>();
    let stop = false;
    const { store, steps, events, tab, settle } = settling(cart, () => cart.set('TEST-1', 9));
    const result = await buildStore(store, steps, [order({ id: 'a' }), order({ id: 'b', sku: 'TEST-2' })], tab, { ...settle, pause: async () => { stop = true; }, shouldStop: () => stop });
    expect(events).toContain('settle');
    expect(events.filter(event => event.startsWith('add'))).toHaveLength(1);
    expect(result.items.map(item => item.outcome)).toEqual(['flagged', 'checklist']);
  });
  it('rereads only the lines this build handled, all in one read, after all of them', async () => {
    const cart = new Map([['OTHER', 4]]);
    const { store, steps, events, reads, tab, settle } = settling(cart);
    await buildStore(store, steps, [order({ id: 'a' }), order({ id: 'b', sku: 'TEST-2' })], tab, settle);
    expect(reads.at(-1)).toEqual(['TEST-1', 'TEST-2']);
    expect(events.at(-3)).toBe(`goto ${CART}`);
    expect(events.filter(event => event === 'settle')).toHaveLength(1);
  });
  it('flags every order sharing a changed line, and leaves the others alone', async () => {
    const cart = new Map<string, number>();
    const { store, steps, tab, settle } = settling(cart, () => cart.set('TEST-1', 25));
    const result = await buildStore(store, steps, [order({ id: 'a', quantity: 1 }), order({ id: 'b', quantity: 2 }), order({ id: 'c', sku: 'TEST-2', quantity: 1 })], tab, settle);
    expect(result.items.map(item => item.outcome)).toEqual(['flagged', 'flagged', 'added']);
    expect(result.items[0].message).toMatch(/changed this to 25 after it was added; you asked for 3 across 2 orders/);
    expect(marksFor(result).map(m => m.orderId)).toEqual(['c']);
  });
  it('keeps a confirmed add\'s own notes, but not a number that has since moved', async () => {
    const priced = new Map<string, number>();
    const one = fakeStore(priced, undefined, new Map([['TEST-1', 16.2]]));
    const raised = await buildStore(one.store, one.steps, [order({ quantity: 1, unitPrice: 14.85 })], hereTab, { ...options, settle: async () => { priced.set('TEST-1', 25); } });
    expect(raised.items[0].message).toMatch(/you asked for 1\. Check the cart before ordering\. Price changed/);
    const capped = new Map<string, number>();
    const two = fakeStore(capped, key => { capped.set(key, 3); });
    const moved = await buildStore(two.store, two.steps, [order({ quantity: 5 })], hereTab, { ...options, settle: async () => { capped.set('TEST-1', 25); } });
    expect(moved.items[0].message).not.toMatch(/Short stock/);
    expect(moved.items[0].message).toMatch(/changed this to 25/);
  });
  it('a line already held, whose add was never sent, is worded as a change during the build', async () => {
    const cart = new Map([['TEST-1', 2]]);
    const { store, steps, tab, settle } = settling(cart, () => cart.set('TEST-1', 25));
    const result = await buildStore(store, steps, [order({ id: 'a', quantity: 2 }), order({ id: 'b', sku: 'TEST-2', quantity: 1 })], tab, settle);
    expect(result.items[0].message).toBe('The cart changed to 25 during this build; you asked for 2. Check the cart before ordering.');
    expect(result.items[0].confirmed).toBe(false);
  });
  it('a store whose own read loads the cart page gets one wait and no extra load', async () => {
    const cart = new Map<string, number>();
    const { store, steps, events, tab, settle } = settling(cart);
    const read = steps.readCart;
    steps.readCart = async (t, keys) => { await t.goto(CART); return read(t, keys); };
    await buildStore(store, steps, [order()], tab, settle);
    expect(events).toEqual([`goto ${CART}`, 'read TEST-1', 'add 2', `goto ${CART}`, 'read TEST-1', 'settle', `goto ${CART}`, 'read TEST-1']);
  });
  it('that store still gets its own load when another page came after its last read', async () => {
    const cart = new Map<string, number>();
    const { store, steps, events, tab, settle } = settling(cart);
    const read = steps.readCart, resolve = steps.resolveLine;
    steps.readCart = async (t, keys) => { await t.goto(CART); return read(t, keys); };
    steps.resolveLine = async (o, t) => { if (o.sku === 'NO-SUCH') await t.goto('https://fake.example.test/p/gone'); return resolve(o, t); };
    await buildStore(store, steps, [order(), order({ id: 'b', sku: 'NO-SUCH' })], tab, settle);
    expect(events.slice(events.indexOf('goto https://fake.example.test/p/gone'))).toEqual(['goto https://fake.example.test/p/gone', `goto ${CART}`, 'settle', `goto ${CART}`, 'read TEST-1']);
  });
  it('a store whose read only looks at the page showing still gets a fresh load, even after an add that loaded a page', async () => {
    const cart = new Map<string, number>();
    const { store, steps, events, tab, settle } = settling(cart);
    steps.addLine = async (t, target, quantity) => { await t.runThenLoad(() => undefined); cart.set(target.addAs, quantity); };
    await buildStore(store, steps, [order()], tab, settle);
    expect(events.slice(-3)).toEqual([`goto ${CART}`, 'settle', 'read TEST-1']);
  });
  it('words a cart that already holds more than was asked for plainly, and leaves it alone', async () => {
    const cart = new Map([['TEST-1', 25]]);
    const { store, steps, adds, events, tab, settle } = settling(cart);
    const result = await buildStore(store, steps, [order({ quantity: 1 })], tab, settle);
    expect(result.items[0].message).toBe('The cart already holds 25, more than the 1 you asked for. Nothing was added, and the quantity wasn\'t changed. Check the cart before ordering.');
    expect(adds).toEqual([]);
    expect(events).toEqual(['read TEST-1']);
    expect(cart.get('TEST-1')).toBe(25);
  });
});
