// Reduced copies of real revrobotics.com product markup, taken 2026-11-09. BigCommerce keeps the address when an option is
// chosen and rewrites [data-product-sku] and the price in place, so each fixture takes what the live page showed for a choice.
import { ld } from './vendors';

interface Choice { value: string; id: string; label: string; productId?: string }
interface Group { kind: 'set-radio' | 'product-list'; name: string; required: boolean; choices: Choice[] }

const radio = (group: Group, attribute: string, c: Choice, checked: boolean) => group.kind === 'product-list'
  ? `<input class="form-radio" type="radio" name="attribute[${attribute}]" value="${c.value}" id="${c.id}"${c.productId ? ` data-product-id="${c.productId}"` : ''}${checked ? ' checked' : ''}>
      <label${c.value === '0' ? '' : ` data-product-attribute-value="${c.value}"`} class="form-label" for="${c.id}">${c.label}</label>`
  : `<input class="form-radio" type="radio" id="${c.id}" name="attribute[${attribute}]" value="${c.value}"${checked ? ' checked' : ''} required>
      <label data-product-attribute-value="${c.value}" class="form-label" for="${c.id}">${c.label}</label>`;
const field = (group: Group, attribute: string, chosen: string | undefined) => `<div class="form-field" data-product-attribute="${group.kind}">
    <label class="form-label form-label--alternate form-label--inlineSmall">
        ${group.name}:
        ${group.required ? '<small class="_required" title="Required">*</small>' : '<span data-option-value></span>'}
    </label>
    ${group.choices.map(c => radio(group, attribute, c, c.value === chosen)).join('\n    ')}
</div>`;

interface Page { url: string; title: string; productId: string; groups: [string, Group][]; range: string }
function page(p: Page, chosen: (string | undefined)[], shows: { sku: string; price: string }): string {
  return `<div class="productView">
  <div class="productView-details"><section data-also-bought-parent-scope><div class="productView-product">
    <div class="productView-titleWrapper"><h1 class="productView-title">${p.title}</h1></div>
    <div class="productView-price">
      <div class="price-section price-section--withoutTax non-sale-price--withoutTax" style="display: none;"><span data-product-non-sale-price-without-tax class="price price--non-sale"></span></div>
      <div class="price-section price-section--withoutTax"><span class="price-label"></span><span data-product-price-without-tax class="price price--withoutTax price--main">${shows.price}</span></div>
    </div></div>
    <dl class="productView-info">
      <dt class="productView-info-name productView-info-name--sku sku-label"${shows.sku ? '' : ' style="display: none;"'}>SKU:</dt>
      <dd class="productView-info-value productView-info-value--sku" data-product-sku>${shows.sku}</dd>
    </dl>
    <div class="productView-options">
      <form class="form form--addToCart" method="post" action="https://www.revrobotics.com/cart.php" enctype="multipart/form-data" data-cart-item-add>
        <input type="hidden" name="action" value="add">
        <input type="hidden" name="product_id" value="${p.productId}"/>
        <div class="papathemes-productView-optionsGrid"><div data-product-option-change>
          ${p.groups.map(([attribute, group], i) => field(group, attribute, chosen[i])).join('\n')}
        </div></div>
        <div class="productView-qtyAddWrapper"><input class="form-input form-input--incrementTotal" id="qty[]" name="qty[]" type="tel" value="1"></div>
      </form>
    </div>
  </section></div>
</div>
${ld({ '@context': 'https://schema.org/', '@type': 'Product', '@id': p.url, name: p.title, sku: Number(p.productId), url: p.url, offers: { '@type': 'Offer', priceCurrency: 'USD', price: p.range.split(' - ')[0].slice(1), url: p.url } })}`;
}

export const HEX: Page = {
  url: 'https://www.revrobotics.com/5mm-Hex-Shafts/', title: '5mm Hex Shafts', productId: '723', range: '$12.50 - $23.25',
  groups: [['324', { kind: 'set-radio', name: 'Type', required: true, choices: [
    { value: '1243', id: 'attribute_radio_324_1243', label: '(REV-41-1347-PK4) 5mm x 75mm Hex Shaft - 4 Pack' },
    { value: '1245', id: 'attribute_radio_324_1245', label: '(REV-41-1348-PK4) 5mm x 90mm Hex Shaft - 4 Pack' },
    { value: '1244', id: 'attribute_radio_324_1244', label: '(REV-41-1349-PK4) 5mm x 135mm Hex Shaft - 4 Pack' },
    { value: '1246', id: 'attribute_radio_324_1246', label: '(REV-41-1362-PK4) 5mm x 400mm Hex Shaft - 4 Pack' },
  ] }]],
};
export const SERVO: Page = {
  url: 'https://www.revrobotics.com/Smart-servo-v2', title: 'Smart Robot Servos V2', productId: '894', range: '$32.50',
  groups: [
    ['475', { kind: 'set-radio', name: 'Type', required: true, choices: [
      { value: '2442', id: 'attribute_radio_475_2442', label: 'Smart Robot Servo V2 - Balanced (REV-41-3334)' },
      { value: '2443', id: 'attribute_radio_475_2443', label: 'Smart Robot Servo V2 - UltraSpeed (REV-41-3336)' },
    ] }],
    ['476', { kind: 'product-list', name: 'Add Accessories', required: false, choices: [
      { value: '0', id: 'attribute_productlist_0_476', label: 'None' },
      { value: '2444', id: 'attribute_productlist_476_2444', label: 'Aluminum Double Servo Arm (REV-41-1820)', productId: '466' },
      { value: '2445', id: 'attribute_productlist_476_2445', label: 'Aluminum Servo Horn V2 (REV-41-1828)', productId: '561' },
      { value: '2446', id: 'attribute_productlist_476_2446', label: 'Aluminum Servo Shaft Adapter (REV-41-1558)', productId: '300' },
    ] }],
  ],
};
export const MAXPLANETARY: Page = {
  url: 'https://www.revrobotics.com/maxplanetary-system-kit/', title: 'MAXPlanetary System Kit', productId: '626', range: '$36.00',
  groups: [
    ['440', { kind: 'set-radio', name: 'Select Base Kit', required: true, choices: [{ value: '1751', id: 'attribute_radio_440_1751', label: 'MAXPlanetary Base Kit (REV-25-2109)' }] }],
    ['365', { kind: 'product-list', name: 'Select Gear Ratio', required: false, choices: [
      { value: '0', id: 'attribute_productlist_0_365', label: 'None' },
      { value: '2575', id: 'attribute_productlist_365_2575', label: '2:1 Cartridge (REV-21-2140)', productId: '923' },
      { value: '1422', id: 'attribute_productlist_365_1422', label: '4:1 Cartridge (REV-21-2102)', productId: '618' },
      { value: '1419', id: 'attribute_productlist_365_1419', label: '9:1 Bundle (3:1 Cartridge, 3:1 Cartridge)', productId: '630' },
    ] }],
    ['502', { kind: 'product-list', name: 'Add Brake', required: false, choices: [
      { value: '0', id: 'attribute_productlist_0_502', label: 'None' },
      { value: '2566', id: 'attribute_productlist_502_2566', label: 'MAXPlanetary 1:1 Brake Cartridge (REV-21-2131)', productId: '922' },
    ] }],
  ],
};
export const revPage = page;
