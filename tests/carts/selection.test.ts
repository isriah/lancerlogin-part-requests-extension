import { describe, expect, it } from 'vitest';
import { allStoreOrigins, STORES, storeForOrder, storeNamed } from '../../src/carts/registry';
import { groupOrders, isTicked, rowFor, summarize, untickAll } from '../../src/carts/selection';
import { isForbiddenUrl, allowedInTab, paceMs } from '../../src/carts/safety';
import { BADGE_LABEL } from '../../src/carts/store-method';
import { order } from './helpers';

const none = new Map<string, boolean>();
describe('what starts ticked', () => {
  it.each([['NORMAL', true], ['RUSH', true], ['SLOW', false], ['INCOMPLETE', false]] as const)('%s starts %s', (statusGroup, on) => {
    expect(isTicked(rowFor(order({ statusGroup })), none)).toBe(on);
  });
  it("an item already in someone's cart starts unticked, and a person can still tick it", () => {
    const mark = { memberName: 'Test Student B', deviceLabel: 'Home laptop', quantity: 1, markedMs: 1, expiresMs: 2, ownDevice: false };
    const row = rowFor(order({ id: 'm', statusGroup: 'NORMAL', cartMarks: [mark] }));
    expect(row.blocked).toBeNull();
    expect(isTicked(row, none)).toBe(false);
    expect(isTicked(row, new Map([['m', true]]))).toBe(true);
  });
  it('a person can tick SLOW and Incomplete, and untick the rest', () => {
    const slow = rowFor(order({ id: 's', statusGroup: 'SLOW' }));
    expect(isTicked(slow, new Map([['s', true]]))).toBe(true);
    const normal = rowFor(order({ id: 'n' }));
    expect(isTicked(normal, new Map([['n', false]]))).toBe(false);
  });
  it('an Incomplete item missing what its store needs is flagged and can never be ticked', () => {
    const row = rowFor(order({ id: 'i', statusGroup: 'INCOMPLETE', sku: null, quantity: null }));
    expect(row.blocked).toBe('REV needs a SKU and a quantity. Add them in Notion.');
    expect(isTicked(row, new Map([['i', true]]))).toBe(false);
  });
  it('an Incomplete item with everything can be ticked', () => {
    const row = rowFor(order({ id: 'i', statusGroup: 'INCOMPLETE' }));
    expect(row.blocked).toBeNull();
    expect(isTicked(row, none)).toBe(false);
    expect(isTicked(row, new Map([['i', true]]))).toBe(true);
  });
  it('a NORMAL row written by hand with blanks is blocked too', () => {
    expect(rowFor(order({ quantity: null })).blocked).toMatch(/needs a quantity/);
    expect(isTicked(rowFor(order({ quantity: null })), none)).toBe(false);
  });
  it('a quantity that is not whole is blocked', () => {
    expect(rowFor(order({ quantity: 1.5 })).blocked).toMatch(/whole-number/);
  });
  it('a Vendor that disagrees with the link is blocked, under the link\'s store', () => {
    const row = rowFor(order({ vendor: 'REV', urlVendor: 'Pololu', productUrl: 'https://www.pololu.com/product/2136' }));
    expect(row.store.id).toBe('pololu');
    expect(row.blocked).toMatch(/Vendor says REV.*link goes to Pololu/);
  });
});
describe('what each store needs', () => {
  it('WCP needs a product link on its own site', () => {
    expect(rowFor(order({ vendor: 'WCP', urlVendor: 'WCP', productUrl: 'https://wcproducts.com/products/test-part?variant=1', sku: null })).blocked).toBeNull();
    expect(rowFor(order({ vendor: 'WCP', urlVendor: null, productUrl: null, sku: 'X' })).blocked).toMatch(/WCP needs a product link/);
    expect(rowFor(order({ vendor: 'WCP', urlVendor: 'WCP', productUrl: 'https://wcproducts.com/collections/all' })).blocked).toMatch(/product link on WCP/);
  });
  it('Pololu needs a product number, in the link or the SKU', () => {
    expect(rowFor(order({ vendor: 'Pololu', urlVendor: 'Pololu', productUrl: 'https://www.pololu.com/product/2136', sku: null })).blocked).toBeNull();
    expect(rowFor(order({ vendor: 'Pololu', urlVendor: null, productUrl: null, sku: '#2136' })).blocked).toBeNull();
    expect(rowFor(order({ vendor: 'Pololu', urlVendor: null, productUrl: null, sku: null })).blocked).toMatch(/product number/);
  });
  it('McMaster needs a part number, in the link or the SKU', () => {
    expect(rowFor(order({ vendor: 'McMaster', urlVendor: 'McMaster', productUrl: 'https://www.mcmaster.com/91251A537/', sku: null })).blocked).toBeNull();
    expect(rowFor(order({ vendor: 'McMaster', urlVendor: null, productUrl: null, sku: '91251a537' })).blocked).toBeNull();
    expect(rowFor(order({ vendor: 'McMaster', urlVendor: null, productUrl: null, sku: 'screws' })).blocked).toMatch(/part number/);
  });
});
describe('grouping and fallback', () => {
  it('groups by store, by name, with unknown stores last', () => {
    const groups = groupOrders([order({ id: '1' }), order({ id: '2', vendor: null, urlVendor: null, productUrl: 'https://not-a-store.example.test/x' }), order({ id: '3', vendor: 'Bolt Barn', urlVendor: null, productUrl: 'https://bolt-barn.example.test/1' }), order({ id: '4', sku: 'TEST-2' })]);
    expect(groups.map(g => g.store.label)).toEqual(['Bolt Barn', 'REV', 'Other store']);
    expect(groups[1].rows.map(r => r.order.id)).toEqual(['1', '4']);
  });
  it('a store with no method yet is a checklist, needing only a link and a quantity', () => {
    const store = storeNamed('Bolt Barn');
    expect(store.badge).toBe('checklist');
    expect(store.steps).toBeUndefined();
    expect(store.origins).toEqual([]);
    expect(storeNamed('Never Heard Of It').badge).toBe('checklist');
    expect(storeNamed(null).label).toBe('Other store');
    expect(rowFor(order({ vendor: 'Bolt Barn', urlVendor: null, productUrl: null, sku: null })).blocked).toMatch(/Bolt Barn needs a product link/);
  });
  it('finds the store from the link when the plugin named none', () => {
    expect(storeForOrder(order({ vendor: null, urlVendor: null, productUrl: 'https://www.pololu.com/product/1' })).id).toBe('pololu');
  });
  it('sums what is ticked', () => {
    const groups = groupOrders([order({ id: '1', quantity: 2, unitPrice: 10 }), order({ id: '2', sku: 'B', statusGroup: 'SLOW', quantity: 1, unitPrice: 5 }), order({ id: '3', sku: 'C', quantity: 3, unitPrice: null })]);
    expect(summarize(groups, none)).toEqual({ ticked: 2, total: 3, stores: 1, estimate: 20, withoutPrice: 1 });
  });
});
describe('the registry', () => {
  it('every automated store has identity, a badge, origins, required fields and steps', () => {
    for (const store of STORES.filter(item => item.badge !== 'checklist')) {
      expect(store.id).toMatch(/^[a-z0-9-]+$/);
      expect(store.label).toBeTruthy();
      expect(BADGE_LABEL[store.badge]).toBeTruthy();
      expect(store.origins.length).toBeGreaterThan(0);
      for (const origin of store.origins) expect(origin).toMatch(/^https:\/\/[^*]+\/\*$/);
      expect(store.requiredFields.length).toBeGreaterThan(0);
      expect(store.steps).toBeDefined();
      expect(allowedInTab(store, store.startUrl!)).toBe(true);
      expect(allowedInTab(store, store.cartUrl!)).toBe(true);
    }
  });
  it('a checklist store asks for no access, opens no tab and has no steps', () => {
    for (const store of STORES.filter(item => item.badge === 'checklist')) {
      expect(store.origins).toEqual([]);
      expect(store.startUrl).toBeUndefined();
      expect(store.steps).toBeUndefined();
    }
  });
  it('every store has the method its evidence supports', () => {
    expect(Object.fromEntries(STORES.map(s => [s.id, s.badge]))).toEqual({
      aliexpress: 'item', amazon: 'item', ambrosia: 'direct', andymark: 'direct', bambu: 'item', ctre: 'direct', ferrules: 'direct', harborfreight: 'item', homedepot: 'item',
      mcmaster: 'item', onlinemetals: 'item', pololu: 'item', powerwerx: 'item', rev: 'direct', sds: 'direct', swyft: 'item', thrifty: 'direct', vbelts: 'direct', wcp: 'direct', west3d: 'direct',
    });
    expect(allStoreOrigins()).toHaveLength(22);
  });
});
describe('addresses a store tab refuses', () => {
  it.each(['https://www.revrobotics.com/cart.php?action=buy&sku=X', 'https://wcproducts.com/cart/123:2', 'https://wcproducts.com/checkout', 'https://wcproducts.com/checkouts/abc', 'https://www.pololu.com/checkout', 'not a url'])('%s', url => {
    expect(isForbiddenUrl(url)).toBe(true);
  });
  it.each(['https://www.revrobotics.com/cart.php?action=add&sku=X&qty=2', 'https://wcproducts.com/cart', 'https://www.pololu.com/cart', 'https://www.mcmaster.com/orders/'])('allows %s', url => {
    expect(isForbiddenUrl(url)).toBe(false);
  });
  it.each(['https://www.amazon.com/gp/buy', 'https://www.amazon.com/gp/buy/', 'https://www.amazon.com/gp/buy/spc/handlers/display.html', 'https://www.amazon.com/gp/buy?x=1', 'https://www.amazon.com/GP/BUY/thing'])('refuses Amazon\'s %s', url => {
    expect(isForbiddenUrl(url)).toBe(true);
  });
  it.each(['https://www.amazon.com/gp/buyagain', 'https://www.amazon.com/gp/cart/view.html', 'https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B000000000&Quantity.1=2'])('leaves Amazon\'s %s alone', url => {
    expect(isForbiddenUrl(url)).toBe(false);
  });
  it('allows Harbor Freight\'s cart page at exactly its address', () => {
    expect(isForbiddenUrl('https://www.harborfreight.com/checkout/cart')).toBe(false);
    expect(allowedInTab({ hosts: ['www.harborfreight.com'] }, 'https://www.harborfreight.com/checkout/cart')).toBe(true);
  });
  it.each([
    'https://www.harborfreight.com/checkout/cart/',
    'https://www.harborfreight.com/checkout/cart?next=/checkout/shipping',
    'https://www.harborfreight.com/checkout/cart?',
    'https://www.harborfreight.com/checkout/cart#top',
    'https://www.harborfreight.com/checkout',
    'https://www.harborfreight.com/checkout/',
    'https://www.harborfreight.com/checkout/shipping',
    'https://www.harborfreight.com/checkout/cart/add',
    'https://www.harborfreight.com/CHECKOUT/cart',
    'http://www.harborfreight.com/checkout/cart',
    'https://harborfreight.com/checkout/cart',
    'https://user:pw@www.harborfreight.com/checkout/cart',
    'https://www.harborfreight.com.example.test/checkout/cart',
    'https://wcproducts.com/checkout/cart',
  ])('still refuses %s', url => {
    expect(isForbiddenUrl(url)).toBe(true);
  });
  it('refuses another site, even a lookalike', () => {
    const store = { hosts: ['wcproducts.com'] };
    expect(allowedInTab(store, 'https://wcproducts.com.example.test/cart')).toBe(false);
    expect(allowedInTab(store, 'http://wcproducts.com/cart')).toBe(false);
    expect(allowedInTab(store, 'https://user:pw@wcproducts.com/cart')).toBe(false);
  });
  it('keeps a modest pace between lines', () => {
    expect(paceMs(() => 0)).toBeGreaterThanOrEqual(1000);
    expect(paceMs(() => 0.999)).toBeLessThan(3000);
  });
});

describe('Untick all', () => {
  const orders = [
    order({ id: 'normal', statusGroup: 'NORMAL' }),
    order({ id: 'rush', statusGroup: 'RUSH' }),
    order({ id: 'slow', statusGroup: 'SLOW' }),
    order({ id: 'blocked', statusGroup: 'NORMAL', quantity: null }),
  ];
  const ticked = (groups: ReturnType<typeof groupOrders>, ticks: Map<string, boolean>) => groups.flatMap(group => group.rows).filter(row => isTicked(row, ticks)).map(row => row.order.id);

  it('unticks every row, including what started ticked and what someone ticked', () => {
    const groups = groupOrders(orders), ticks = new Map([['slow', true]]);
    expect(ticked(groups, ticks)).toEqual(['normal', 'rush', 'slow']);
    untickAll(groups, ticks);
    expect(ticked(groups, ticks)).toEqual([]);
    expect(summarize(groups, ticks)).toMatchObject({ ticked: 0, total: 4, stores: 0, estimate: 0 });
  });
  it('leaves a row that can\'t be ticked out of it', () => {
    const groups = groupOrders(orders), ticks = new Map<string, boolean>();
    untickAll(groups, ticks);
    expect(ticks.has('blocked')).toBe(false);
  });
  it('rows can be ticked again afterward', () => {
    const groups = groupOrders(orders), ticks = new Map<string, boolean>();
    untickAll(groups, ticks);
    ticks.set('rush', true);
    expect(ticked(groups, ticks)).toEqual(['rush']);
  });
  it('has nothing to do with no orders', () => {
    const ticks = new Map<string, boolean>();
    untickAll([], ticks);
    expect(ticks.size).toBe(0);
  });
});
