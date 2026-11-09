// Ali Express ships as a checklist, so these check it can't automate anything and that it hands the person the right links. No real store is contacted.
import { describe, expect, it } from 'vitest';
import { checklistResult } from '../../src/carts/runner';
import { allowedInTab, isForbiddenUrl } from '../../src/carts/safety';
import { blockedReason } from '../../src/carts/selection';
import { aliexpress, isAliexpressListing } from '../../src/carts/stores/aliexpress';
import { VENDORS, vendorForUrl } from '../../src/vendors';
import { order } from './helpers';

const LISTING = 'https://www.aliexpress.us/item/1000000000000000.html';
const aliOrder = (extra = {}) => order({ vendor: 'Ali Express', urlVendor: 'Ali Express', sku: null, productUrl: LISTING, ...extra });

describe('Ali Express', () => {
  it('is labelled a checklist, and can\'t touch the store', () => {
    expect(aliexpress.badge).toBe('checklist');
    expect(aliexpress.steps).toBeUndefined();
    expect(aliexpress.startUrl).toBeUndefined();
    expect(aliexpress.origins).toEqual([]);
    expect(aliexpress.badgeHelp).toMatch(/add yourself/);
    expect(aliexpress.badgeHelp).toMatch(/length, pack size and currency/);
  });
  it('matches the vendor list: same label and the same hosts, including aliexpress.us', () => {
    const vendor = VENDORS.find(v => v.id === 'aliexpress')!;
    expect(aliexpress.id).toBe('aliexpress');
    expect(aliexpress.label).toBe(vendor.label);
    expect(aliexpress.hosts).toEqual(vendor.hosts);
    expect(aliexpress.hosts).toContain('aliexpress.us');
    expect(vendorForUrl(LISTING)?.label).toBe(aliexpress.label);
  });
  it('its cart link is the cart, on the store, and never checkout', () => {
    expect(allowedInTab(aliexpress, aliexpress.cartUrl!)).toBe(true);
    expect(isForbiddenUrl(aliexpress.cartUrl!)).toBe(false);
  });
  it('accepts a link to one listing, on either site', () => {
    expect(isAliexpressListing(LISTING)).toBe(true);
    expect(isAliexpressListing('https://www.aliexpress.com/item/1000000000000000.html?sku_id=1')).toBe(true);
    expect(blockedReason(aliOrder(), aliexpress)).toBeNull();
  });
  it('blocks a link that doesn\'t say which item, or isn\'t the store\'s', () => {
    for (const link of ['https://www.aliexpress.us/w/wholesale-test.html', 'https://www.aliexpress.us/store/1', 'https://aliexpress.example.test/item/1.html', 'http://www.aliexpress.us/item/1.html', 'not a link']) {
      expect(isAliexpressListing(link), link).toBe(false);
      expect(blockedReason(aliOrder({ productUrl: link }), aliexpress), link).toMatch(/a link to one Ali Express listing/);
    }
  });
  it('needs a link and a quantity, and no SKU', () => {
    expect(blockedReason(aliOrder({ productUrl: null }), aliexpress)).toMatch(/a product link/);
    expect(blockedReason(aliOrder({ quantity: null }), aliexpress)).toMatch(/a quantity/);
  });
  it('a build gives the person the item as a checklist line, and confirms nothing, so nothing gets marked', () => {
    const result = checklistResult(aliexpress, [aliOrder()]);
    expect(result.badge).toBe('checklist');
    expect(result.items).toMatchObject([{ outcome: 'checklist', confirmed: false }]);
  });
});
