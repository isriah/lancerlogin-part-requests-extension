import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePage } from '../src/reader';
import { ld } from './fixtures/vendors';
import { VENDORS } from '../src/vendors';
import { AMAZON_BATTERIES, CTRE_UNAVAILABLE, POWERWERX_GROUPED, SDS_WHEEL, THRIFTY, powerwerxGroupedPage, sdsPage, thriftyPage } from './fixtures/vendor-options';

const vendor = (id: string) => VENDORS.find(v => v.id === id)!;
function read(id: string, url: string, html: string, title = 'Product') {
  vi.stubGlobal('location', new URL(url));
  document.title = title;
  document.documentElement.innerHTML = `<head><title>${title}</title></head><body>${html}</body>`;
  return capturePage(vendor(id));
}
const PICK = 'Select all product options on the store page, or enter the exact variant and price manually.';
afterEach(() => { vi.unstubAllGlobals(); });

describe('The Thrifty Bot (Warehouse theme): swatches change the variant in place', () => {
  const [blackHex, black5mm, redHex, red5mm] = THRIFTY.variants;
  const at = (v: typeof blackHex) => read('thrifty', `${THRIFTY.url}?variant=${v.id}`, thriftyPage(v));
  it.each([blackHex, redHex])('$color / $bore reads its SKU, the displayed price and both options', v => {
    expect(at(v)).toMatchObject({ kind: 'product', sku: v.sku, price: 34.99, currency: 'USD', description: `${THRIFTY.title} - ${v.color} / ${v.bore}`, issues: [] });
  });
  it('names a color even when its letters are inside the title ("Red" in "Vectored")', () => {
    expect(at(redHex).description).toBe('QTY 4 - 2 Inch Vectored Intake Wheel - Red / 1/2" Hex');
  });
  it.each([black5mm, red5mm])('$color / $bore has no SKU on the page, so none is sent, and the displayed price is kept', v => {
    const result = at(v);
    expect(result).toMatchObject({ sku: '', price: 34.99, description: `${THRIFTY.title} - ${v.color} / ${v.bore}` });
    expect(result.sku).not.toMatch(/TTB-0010/);
  });
});

describe('Swerve Drive Specialties: the price text changes, its content attribute does not', () => {
  it.each([[1, 40], [2, 78], [0, 21]] as const)('variant %i reads the displayed price, %d, not the loaded variant\'s', (chosen, price) => {
    const [id, title] = SDS_WHEEL.variants[chosen];
    expect(read('sds', `${SDS_WHEEL.url}?variant=${id}`, sdsPage(chosen, 0))).toMatchObject({ price, sku: '', description: `${SDS_WHEEL.title} - ${title}` });
  });
});

describe('CTRE (Dawn combined listing): a combination that makes no product', () => {
  it('asks for a choice, sends no SKU or price, and drops the " - Unavailable" mark', () => {
    const result = read('ctre', CTRE_UNAVAILABLE.url, CTRE_UNAVAILABLE.html);
    expect(result).toMatchObject({ kind: 'product', sku: '', price: null });
    expect(result.issues).toContain(PICK);
    expect(result.description).not.toMatch(/Unavailable/);
  });
});

describe('PowerWerx grouped product: versions picked by ticking a box', () => {
  it('with nothing ticked, asks for a choice and never takes a related product\'s SKU', () => {
    const result = read('powerwerx', POWERWERX_GROUPED.url, powerwerxGroupedPage([]));
    expect(result).toMatchObject({ sku: '', price: null, description: 'Assorted Color Powerpole Connectors Kit' });
    expect(result.issues).toContain(PICK);
  });
  it.each([['ACP-30', 13.99, '30 Amp, 12-14 GA'], ['ACP-15', 10.99, '15 Amp, 16-20 GA']] as const)('ticking %s reads that version', (sku, price, size) => {
    expect(read('powerwerx', POWERWERX_GROUPED.url, powerwerxGroupedPage([sku]))).toMatchObject({ sku, price, description: `Assorted Color Powerpole Connectors Kit - Size: ${size}`, issues: [] });
  });
  it('with two ticked, sends neither and says why', () => {
    const result = read('powerwerx', POWERWERX_GROUPED.url, powerwerxGroupedPage(['ACP-30', 'ACP-15']));
    expect(result).toMatchObject({ sku: '', price: null });
    expect(result.issues.join(' ')).toMatch(/Several versions are ticked/);
  });
});

describe('BambuLab cards', () => {
  // The chosen card's own entry in the ProductGroup carries the SKU; its offer's address is this page's and has no SKU of its own.
  it('keeps the SKU of the chosen variant when its offer matches the page', () => {
    const url = 'https://us.store.bambulab.com/products/p1s?id=732843418674327558';
    const html = `<h1 class="bbl-title-3">Bambu Lab P1S 3D Printer</h1><div class="property-card-item border-bbl-brand-green"><p class="bbl-body-1">P1S</p></div><div class="property-card-item border-bbl-grey-5"><p class="bbl-body-1">P1S AMS Combo</p></div>${ld({ '@type': 'ProductGroup', name: 'Bambu Lab P1S 3D Printer', hasVariant: [
      { '@type': 'Product', name: 'Bambu Lab P1S 3D Printer - P1S', sku: '732843418674327558', offers: { '@type': 'Offer', price: 349, priceCurrency: 'USD', url } },
      { '@type': 'Product', name: 'Bambu Lab P1S 3D Printer - P1S AMS Combo', sku: '732843418674327562', offers: { '@type': 'Offer', price: 479, priceCurrency: 'USD', url: 'https://us.store.bambulab.com/products/p1s?id=732843418674327562' } }] })}`;
    expect(read('bambu', url, html)).toMatchObject({ sku: '732843418674327558', price: 349, description: 'Bambu Lab P1S 3D Printer - P1S' });
  });
});

describe('Amazon inline twister', () => {
  it('adds the chosen size from the twister heading to the description', () => {
    expect(read('amazon', AMAZON_BATTERIES.url, AMAZON_BATTERIES.html)).toMatchObject({ sku: 'B01B8R6PF2', price: 25.99, description: 'Amazon Basics 100-Pack AA Alkaline Batteries, 1.5 Volt, 10-Year Shelf Life, Reliable - 100 Count (AA/LR6)' });
  });
});

describe('access checks seen on the stores', () => {
  it.each([
    ['harborfreight', 'https://www.harborfreight.com/9-mil-nitrile-powder-free-gloves-xx-large-50-pack-57159.html', 'Access to this page has been denied', '<h1>Access to this page has been denied</h1><p>Press &amp; Hold to confirm you are a human.</p>'],
    ['powerwerx', 'https://powerwerx.com/anderson-powerpole-colored-housings', 'Just a moment...', '<h1>powerwerx.com</h1><p>Performing security verification</p>'],
  ])('%s is reported as blocked, not read as a product', (id, url, title, html) => {
    expect(read(id, url, html, title)).toMatchObject({ kind: 'blocked', description: '' });
  });
});
