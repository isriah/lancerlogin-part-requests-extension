// BambuLab is unsupported in Carts: a checklist like a store with no method. The toolbar's capture from its product pages is separate, and stays.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allStoreOrigins, originsToGiveBack, storeForOrder, storeNamed, STORES } from '../../src/carts/registry';
import { checklistResult, marksFor } from '../../src/carts/runner';
import { groupOrders, rowFor } from '../../src/carts/selection';
import { bambu } from '../../src/carts/stores/bambu';
import { vendorForUrl } from '../../src/vendors';
import { order } from './helpers';

const HOME = 'https://us.store.bambulab.com';
const line = (extra = {}) => order({ vendor: 'BambuLab', urlVendor: 'BambuLab', sku: '40475106771080', productUrl: `${HOME}/products/pla-basic-filament?id=40475106771080`, quantity: 2, description: 'Test filament', ...extra });

describe('BambuLab in Carts', () => {
  it('is a checklist: no steps, no start page, no access asked for', () => {
    expect(bambu).toMatchObject({ label: 'BambuLab', badge: 'checklist', origins: [], cartUrl: `${HOME}/cart` });
    expect(bambu.steps).toBeUndefined();
    expect(bambu.startUrl).toBeUndefined();
    expect(STORES).toContain(bambu);
  });
  it('Carts never asks Chrome for its site, and takes back what an earlier version was given', () => {
    expect(allStoreOrigins().filter(origin => /bambulab/.test(origin))).toEqual([]);
    expect(originsToGiveBack()).toContain(`${HOME}/*`);
    expect(originsToGiveBack()).toEqual(expect.arrayContaining(allStoreOrigins()));
  });
  it('an order groups under BambuLab, by its vendor or its link, ticked as usual', () => {
    expect(storeNamed('BambuLab')).toBe(bambu);
    expect(storeForOrder(line({ vendor: null, urlVendor: null }))).toBe(bambu);
    expect(rowFor(line())).toMatchObject({ blocked: null, startsTicked: true });
    const groups = groupOrders([line(), line({ id: 'order-2' })]);
    expect(groups.map(group => group.store.label)).toEqual(['BambuLab']);
    expect(groups[0].rows).toHaveLength(2);
  });
  it('needs a link and a quantity, like any checklist store, and blocks without them', () => {
    expect(rowFor(line({ productUrl: null })).blocked).toMatch(/BambuLab needs a product link/);
    expect(rowFor(line({ quantity: null })).blocked).toMatch(/BambuLab needs a quantity/);
  });
  it('its results are items to add yourself, with the cart button\'s address, and no marks', () => {
    const result = checklistResult(bambu, [line()]);
    expect(result).toMatchObject({ label: 'BambuLab', badge: 'checklist', cartUrl: `${HOME}/cart` });
    expect(result.items).toEqual([{ order: line(), outcome: 'checklist', message: '', confirmed: false }]);
    expect(marksFor(result)).toEqual([]);
  });
  it('its file holds no page code', () => {
    expect(readFileSync(resolve('src/carts/stores/bambu.ts'), 'utf8')).not.toMatch(/document\.|tab\.|fetch\(|steps/);
  });
});
describe('saving a request from BambuLab\'s site, which Carts doesn\'t change', () => {
  it('the vendor list still knows its product pages', () => {
    expect(vendorForUrl(`${HOME}/products/p1s`)).toMatchObject({ id: 'bambu', label: 'BambuLab' });
    expect(vi.isMockFunction(vendorForUrl)).toBe(false);
  });
});
