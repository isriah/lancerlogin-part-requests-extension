// Home Depot is a checklist: nothing runs against the store, so these check what the person is given and what can't be ticked.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checklistResult, marksFor } from '../../src/carts/runner';
import { allowedInTab } from '../../src/carts/safety';
import { blockedReason } from '../../src/carts/selection';
import { homedepot, homedepotItem } from '../../src/carts/stores/homedepot';
import { VENDORS } from '../../src/vendors';
import { order } from './helpers';

const LINK = 'https://www.homedepot.com/p/Test-Washer-100-Pack/100000001';
const line = (extra = {}) => order({ vendor: 'Home Depot', urlVendor: 'Home Depot', sku: null, productUrl: LINK, quantity: 3, ...extra });

describe('Home Depot', () => {
  it('is labelled a checklist, and says so in words', () => {
    expect(homedepot).toMatchObject({ id: 'homedepot', label: 'Home Depot', badge: 'checklist' });
    expect(homedepot.badgeHelp).toMatch(/add yourself/);
  });
  it('leaves the store or delivery choice to the person', () => {
    expect(homedepot.badgeHelp).toMatch(/choose a store or delivery/);
  });
  it('automates nothing and asks Chrome for nothing', () => {
    expect(homedepot.steps).toBeUndefined();
    expect(homedepot.origins).toEqual([]);
    expect(homedepot.startUrl).toBeUndefined();
    const source = readFileSync(resolve('src/carts/stores/homedepot.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*\*.*\*\//g, '');
    expect(source).not.toMatch(/fetch\(|chrome\.|document\.|user-?agent/i);
  });
  it('matches the plugin\'s vendor label and hosts', () => {
    const vendor = VENDORS.find(v => v.id === 'homedepot')!;
    expect(homedepot.label).toBe(vendor.label);
    expect([...homedepot.hosts].sort()).toEqual([...vendor.hosts].sort());
  });
  it('links to the store\'s own cart page, never to checkout', () => {
    expect(homedepot.cartUrl).toBe('https://www.homedepot.com/cart');
    expect(allowedInTab(homedepot, homedepot.cartUrl!)).toBe(true);
  });
  it('reads the item number only from a link to one product', () => {
    expect(homedepotItem(LINK)).toBe('100000001');
    expect(homedepotItem(`${LINK}?MERCH=REC-_-x`)).toBe('100000001');
    expect(homedepotItem('https://homedepot.com/p/100000001/')).toBe('100000001');
    for (const other of [
      'https://www.homedepot.com/p/reviews/Test-Washer/100000001/4',
      'https://www.homedepot.com/p/questions/Test-Washer/100000001/1',
      'https://www.homedepot.com/b/Hardware-Fasteners/N-5yc1vZc2ck',
      'https://www.homedepot.com/cart',
      'https://www.homedepot.com/checkout/p/100000001',
      'https://www.homedepot.com.example.test/p/Test/100000001',
      'http://www.homedepot.com/p/Test/100000001',
      'not a link',
      '',
      null,
    ]) expect(homedepotItem(other), String(other)).toBeNull();
  });
  it('can be ticked with a product link and a quantity', () => {
    expect(blockedReason(line(), homedepot)).toBeNull();
  });
  it('needs no SKU, since nothing is added by SKU', () => {
    expect(blockedReason(line({ sku: null }), homedepot)).toBeNull();
  });
  it('refuses an order with no link, or a link that doesn\'t name one item', () => {
    expect(blockedReason(line({ productUrl: null }), homedepot)).toBe('Home Depot needs a product link. Add it in Notion.');
    expect(blockedReason(line({ productUrl: 'https://www.homedepot.com/b/Hardware/N-5yc1vZc2ck' }), homedepot)).toBe('Home Depot needs a product link on homedepot.com. Add it in Notion.');
  });
  it('refuses a missing or part quantity, and a link to another vendor', () => {
    expect(blockedReason(line({ quantity: null }), homedepot)).toMatch(/a quantity/);
    expect(blockedReason(line({ quantity: 1.5 }), homedepot)).toMatch(/whole-number/);
    expect(blockedReason(line({ urlVendor: 'REV' }), homedepot)).toMatch(/Fix it in Notion/);
  });
  it('hands the person the link and the quantity unchanged, and marks nothing', () => {
    const result = checklistResult(homedepot, [line({ id: 'a', quantity: 3 }), line({ id: 'b', quantity: 1, productUrl: `${LINK}2` })]);
    expect(result).toMatchObject({ storeId: 'homedepot', label: 'Home Depot', badge: 'checklist', cartUrl: 'https://www.homedepot.com/cart' });
    expect(result.items.map(item => [item.outcome, item.order.productUrl, item.order.quantity, item.confirmed])).toEqual([['checklist', LINK, 3, false], ['checklist', `${LINK}2`, 1, false]]);
    expect(marksFor(result)).toEqual([]);
  });
});
