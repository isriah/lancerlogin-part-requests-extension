import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePage } from '../src/reader';
import { VENDORS } from '../src/vendors';
import { HEX, MAXPLANETARY, SERVO, revPage } from './fixtures/rev-options';
import { ld } from './fixtures/vendors';

const rev = VENDORS.find(v => v.id === 'rev')!;
function read(url: string, html: string) {
  vi.stubGlobal('location', new URL(url));
  document.documentElement.innerHTML = `<head><title>Product</title></head><body>${html}</body>`;
  return capturePage(rev);
}
const PICK = 'Select all product options on the store page, or enter the exact variant and price manually.';
afterEach(() => { vi.unstubAllGlobals(); });

describe('REV 5mm Hex Shafts: one option group', () => {
  it('with nothing chosen, asks for an option and sends no base SKU or price', () => {
    const result = read(HEX.url, revPage(HEX, [], { sku: '', price: '$12.50 - $23.25' }));
    expect(result).toMatchObject({ kind: 'product', description: '5mm Hex Shafts', sku: '', price: null, variants: [] });
    expect(result.issues).toContain(PICK);
    expect(result.sku).not.toBe('723');
  });
  it.each([
    ['1243', 'REV-41-1347-PK4', '$12.50', 12.5, '5mm x 75mm Hex Shaft - 4 Pack'],
    ['1245', 'REV-41-1348-PK4', '$14.75', 14.75, '5mm x 90mm Hex Shaft - 4 Pack'],
    ['1244', 'REV-41-1349-PK4', '$17.50', 17.5, '5mm x 135mm Hex Shaft - 4 Pack'],
    ['1246', 'REV-41-1362-PK4', '$23.25', 23.25, '5mm x 400mm Hex Shaft - 4 Pack'],
  ])('option %s reads the page\'s SKU %s and price %s', (value, sku, shown, price, name) => {
    const result = read(HEX.url, revPage(HEX, [value], { sku, price: shown }));
    expect(result).toMatchObject({ kind: 'product', sku, price, currency: 'USD', description: `5mm Hex Shafts - ${name}`, variants: [name], issues: [] });
  });
  it('takes the SKU from the chosen option when the page shows none yet, and still no range as a price', () => {
    expect(read(HEX.url, revPage(HEX, ['1245'], { sku: '', price: '$14.75' }))).toMatchObject({ sku: 'REV-41-1348-PK4', price: 14.75, description: '5mm Hex Shafts - 5mm x 90mm Hex Shaft - 4 Pack' });
    expect(read(HEX.url, revPage(HEX, ['1245'], { sku: '', price: '$12.50 - $23.25' }))).toMatchObject({ sku: 'REV-41-1348-PK4', price: null });
  });
  it('when the page still shows the previous option\'s SKU and price, keeps the chosen SKU and leaves the price for review', () => {
    const result = read(HEX.url, revPage(HEX, ['1244'], { sku: 'REV-41-1348-PK4', price: '$14.75' }));
    expect(result).toMatchObject({ sku: 'REV-41-1349-PK4', price: null, description: '5mm Hex Shafts - 5mm x 135mm Hex Shaft - 4 Pack' });
    expect(result.issues.join(' ')).toMatch(/still updating/);
  });
});

describe('REV Smart Robot Servos V2: a variant group and an add-on list', () => {
  it('with no type chosen, asks for one, even though the add-on list says None', () => {
    expect(read(SERVO.url, revPage(SERVO, [undefined, '0'], { sku: '', price: '$32.50' }))).toMatchObject({ sku: '', price: null, issues: expect.arrayContaining([PICK]) });
  });
  it('an add-on alone is not enough', () => {
    expect(read(SERVO.url, revPage(SERVO, [undefined, '2445'], { sku: '', price: '$40.25' }))).toMatchObject({ sku: '', price: null, issues: expect.arrayContaining([PICK]) });
  });
  it.each([
    ['2442', '2445', 'REV-41-3334', '$40.25', 40.25, 'Smart Robot Servo V2 - Balanced / Aluminum Servo Horn V2 (REV-41-1828)'],
    ['2443', '2446', 'REV-41-3336', '$41.25', 41.25, 'Smart Robot Servo V2 - UltraSpeed / Aluminum Servo Shaft Adapter (REV-41-1558)'],
    ['2443', '0', 'REV-41-3336', '$32.50', 32.5, 'Smart Robot Servo V2 - UltraSpeed'],
  ])('type %s with add-on %s includes every chosen option', (type, addOn, sku, shown, price, options) => {
    expect(read(SERVO.url, revPage(SERVO, [type, addOn], { sku, price: shown }))).toMatchObject({ sku, price, description: `Smart Robot Servos V2 - ${options}`, issues: [] });
  });
});

describe('REV MAXPlanetary System Kit: three option groups', () => {
  it('reads the default base kit, with every None left out', () => {
    expect(read(MAXPLANETARY.url, revPage(MAXPLANETARY, ['1751', '0', '0'], { sku: 'REV-25-2109', price: '$36.00' }))).toMatchObject({ sku: 'REV-25-2109', price: 36, description: 'MAXPlanetary System Kit - MAXPlanetary Base Kit', issues: [] });
  });
  it('includes a gear ratio and a brake with the live total', () => {
    const result = read(MAXPLANETARY.url, revPage(MAXPLANETARY, ['1751', '1419', '2566'], { sku: 'REV-25-2109', price: '$206.00' }));
    expect(result).toMatchObject({ sku: 'REV-25-2109', price: 206, issues: [] });
    expect(result.description).toBe('MAXPlanetary System Kit - MAXPlanetary Base Kit / 9:1 Bundle (3:1 Cartridge, 3:1 Cartridge) / MAXPlanetary 1:1 Brake Cartridge (REV-21-2131)');
  });
});

describe('other BigCommerce option fields', () => {
  const select = (chosen: string) => `<div class="productView"><h1 class="productView-title">Test Wheel</h1><div class="productView-price"><span data-product-price-without-tax>${chosen ? '$9.00' : '$8.00 - $10.00'}</span></div><dd data-product-sku></dd>
    <form data-cart-item-add><input type="hidden" name="product_id" value="77"><div data-product-option-change>
      <div class="form-field" data-product-attribute="set-select"><label class="form-label form-label--alternate">Diameter: <small>*</small></label>
        <select class="form-select" name="attribute[9]" required><option value="">Choose Options</option><option value="1"${chosen === '1' ? ' selected' : ''}>3 in (TEST-3IN)</option><option value="2"${chosen === '2' ? ' selected' : ''}>4 in (TEST-4IN)</option></select></div>
      <div class="form-field" data-product-attribute="input-text"><label class="form-label form-label--alternate">Engraving:</label><input class="form-input" name="attribute[10]" value="Team 0000"></div>
    </div></form></div>`;
  it('a dropdown left on Choose Options asks for a choice', () => {
    expect(read('https://www.revrobotics.com/test-wheel/', select(''))).toMatchObject({ sku: '', price: null, issues: expect.arrayContaining([PICK]) });
  });
  it('a chosen dropdown and typed text both reach the description', () => {
    expect(read('https://www.revrobotics.com/test-wheel/', select('2'))).toMatchObject({ sku: 'TEST-4IN', price: 9, description: 'Test Wheel - 4 in / Engraving: Team 0000' });
  });
  it('never sends the internal product number as a SKU', () => {
    const html = `<div class="productView"><h1 class="productView-title">Plain Part</h1><div class="productView-price"><span data-product-price-without-tax>$4.50</span></div><dd data-product-sku></dd><form data-cart-item-add><input type="hidden" name="product_id" value="555"></form></div>${ld({ '@type': 'Product', name: 'Plain Part', sku: 555, offers: { '@type': 'Offer', price: '4.5', priceCurrency: 'USD' } })}`;
    expect(read('https://www.revrobotics.com/plain-part/', html)).toMatchObject({ sku: '', price: 4.5, description: 'Plain Part' });
  });
});
