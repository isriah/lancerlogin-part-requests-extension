// Reduced copies of real product markup with option choices, taken 2026-11-09 from the live pages named below. Each fixture takes what the
// page showed for a choice, so a test can rebuild the page as it looked after a student picked something.
import { ld } from './vendors';

// The Thrifty Bot, Warehouse theme. Choosing a swatch rewrites the price, the hidden SKU line and the form's variant select in place, and
// adds ?variant= to the address. The theme publishes the product as { product: { variants } }, and its offers' addresses are relative.
export interface ThriftyVariant { id: string; color: string; bore: string; sku: string; cents: number }
export const THRIFTY = {
  url: 'https://www.thethriftybot.com/products/qty-4-2-inch-vectored-intake-wheel',
  title: 'QTY 4 - 2 Inch Vectored Intake Wheel',
  variants: [
    { id: '46774184968491', color: 'Black', bore: '1/2" Hex', sku: 'TTB-0010-BLACK', cents: 3499 },
    { id: '51322149470507', color: 'Black', bore: '5mm Hex', sku: '', cents: 3499 },
    { id: '46774185034027', color: 'Red', bore: '1/2" Hex', sku: 'TTB-0010-RED', cents: 3499 },
    { id: '51322149667115', color: 'Red', bore: '5mm Hex', sku: '', cents: 3499 },
  ] as ThriftyVariant[],
};
const esc = (s: string) => s.replaceAll('"', '&quot;');
export function thriftyPage(chosen: ThriftyVariant): string {
  const swatch = (group: number, n: number, value: string, kind: 'color' | 'block', checked: boolean) => `<div class="${kind}-swatch">
 <input class="${kind}-swatch__radio product-form__single-selector" type="radio" name="template--20040120631595__main-8493576093995-${group}" id="template--20040120631595__main-8493576093995-${group}-${n}" value="${esc(value)}"${checked ? ' checked=""' : ''} data-option-position="${group}">
 <label class="${kind}-swatch__item" for="template--20040120631595__main-8493576093995-${group}-${n}"${kind === 'color' ? ` style="background-color: ${value.toLowerCase()}"` : ''} title="${esc(value)}">
 <span class="${kind === 'color' ? 'visually-hidden' : 'block-swatch__item-text'}">${value}</span></label>
 </div>`;
  const data = { product: { id: 8493576093995, title: THRIFTY.title, handle: 'qty-4-2-inch-vectored-intake-wheel', price: 3499, variants: THRIFTY.variants.map(v => ({ id: Number(v.id), title: `${v.color} / ${v.bore}`, sku: v.sku || null, price: v.cents, options: [v.color, v.bore], option1: v.color, option2: v.bore })) }, selected_variant_id: Number(chosen.id) };
  return `<form method="post" action="/cart/add" id="product_form_template--20040120631595__main8493576093995" class="product-form" enctype="multipart/form-data"><input type="hidden" name="form_type" value="product"><div class="product-meta"><h1 class="product-meta__title heading h1">${THRIFTY.title}</h1><div class="product-meta__reference"><a class="product-meta__vendor link link--accented" href="/collections/vendors?q=The%20Thrifty%20Bot">The Thrifty Bot</a><span class="product-meta__sku"${chosen.sku ? '' : ' style="display: none"'}>SKU: <span class="product-meta__sku-number">${chosen.sku}</span>
 </span></div></div>
<hr class="card__separator"><div class="product-form__variants"><div class="product-form__option" data-selector-type="color"><span class="product-form__option-name text--strong">Color: <span class="product-form__selected-value">${chosen.color}</span></span>
 <div class="color-swatch-list color-swatch-list--large">${['Black', 'Red'].map((c, i) => swatch(1, i + 1, c, 'color', c === chosen.color)).join('')}</div></div><div class="product-form__option" data-selector-type="block"><span class="product-form__option-name text--strong">Bore Size: <span class="product-form__selected-value">${chosen.bore}</span></span>
 <div class="block-swatch-list">${['1/2" Hex', '5mm Hex'].map((b, i) => swatch(2, i + 1, b, 'block', b === chosen.bore)).join('')}</div></div>
 <div class="no-js product-form__option"><label class="product-form__option-name text--strong" for="product-select-8493576093995">Variant</label> <div class="select-wrapper select-wrapper--primary"> <select id="product-select-8493576093995" name="id">${THRIFTY.variants.map(v => `<option value="${v.id}" data-sku="${v.sku}"${v.id === chosen.id ? ' selected="selected"' : ''}>${esc(`${v.color} / ${v.bore}`)} - $${(v.cents / 100).toFixed(2)}</option>`).join('')}</select> </div> </div></div><div class="product-form__info-list"> <div class="product-form__info-item"> <span class="product-form__info-title text--strong">Price:</span> <div class="product-form__info-content" role="region" aria-live="polite"> <div class="price-list"><span class="price"> <span class="visually-hidden">Sale price</span>$${(chosen.cents / 100).toFixed(2)}</span></div></div></div></div></form>
<script type="application/json" data-product-json="">${JSON.stringify(data)}</script>
${ld({ '@context': 'https://schema.org', '@type': 'Product', productID: 8493576093995, name: THRIFTY.title, offers: THRIFTY.variants.map(v => ({ '@type': 'Offer', name: `${v.color} / ${v.bore}`, price: v.cents / 100, priceCurrency: 'USD', ...(v.sku ? { sku: v.sku } : {}), url: `/products/qty-4-2-inch-vectored-intake-wheel?variant=${v.id}` })) })}`;
}

// Swerve Drive Specialties, an older theme. Choosing an option rewrites the price's text, but its `content` attribute keeps the price of
// the variant the page was loaded with. Its variants have no SKU.
export const SDS_WHEEL = {
  url: 'https://www.swervedrivespecialties.com/products/wheel-colson-4od-x-2w-mk5',
  title: 'Wheel, Colson, 4"OD x 2"W (MK5)',
  variants: [['52196628463917', 'Wheel Only', 2100], ['52196628496685', 'Wheel Kit', 4000], ['52196628529453', 'Wheel Kit + Quick-Change Kit', 7800]] as [string, string, number][],
};
export function sdsPage(chosen: number, loadedWith = 0): string {
  const [id, , cents] = SDS_WHEEL.variants[chosen];
  const data = { id: 10308916216109, title: SDS_WHEEL.title, handle: 'wheel-colson-4od-x-2w-mk5', variants: SDS_WHEEL.variants.map(([vid, title, c]) => ({ id: Number(vid), title, option1: title, sku: '', price: c, options: [title] })) };
  return `<div class="product-single__meta"><h1 class="product-single__title" itemprop="name">${esc(SDS_WHEEL.title)}</h1>
<div itemprop="offers" itemscope itemtype="http://schema.org/Offer"><meta itemprop="priceCurrency" content="USD"> <link itemprop="availability" href="http://schema.org/InStock"> <p class="product-single__prices"> <span class="visually-hidden">Regular price</span> <span id="ProductPrice" class="product-single__price" itemprop="price" content="${(SDS_WHEEL.variants[loadedWith][2] / 100).toFixed(1)}">$${(cents / 100).toFixed(2)}</span> </p>
<form method="post" action="/cart/add" id="product_form_10308916216109" class="product-form" enctype="multipart/form-data"><input type="hidden" name="form_type" value="product"> <div class="selector-wrapper"><label for="ProductSelect-option-0">Include</label><select class="single-option-selector" data-option="option1" id="ProductSelect-product-template-option-0">${SDS_WHEEL.variants.map(([, title], i) => `<option value="${esc(title)}"${i === chosen ? ' selected' : ''}>${title}</option>`).join('')}</select></div><select name="id" id="ProductSelect-product-template" class="product-single__variants" style="display: none;">${SDS_WHEEL.variants.map(([vid, title, c]) => `<option${vid === id ? ' selected="selected"' : ''} data-sku="" value="${vid}">${title} - $${(c / 100).toFixed(2)} USD</option>`).join('')}</select> <div class="product-single__quantity"> <label for="Quantity">Quantity</label> <input type="number" id="Quantity" name="quantity" value="1" min="1"> </div></form></div></div>
<script type="application/json" id="ProductJson-product-template">${JSON.stringify(data)}</script>`;
}

// CTR Electronics, Dawn with a combined listing: each tooth count is its own product. A tooth count and bore that make no product leave the
// form's variant id empty, the price and SKU blank, and mark the option " - Unavailable".
export const CTRE_UNAVAILABLE = {
  url: 'https://store.ctr-electronics.com/products/15t-steel-spur-gear-32-dp-8mm-splinexs-bore',
  html: `<section id="ProductInfo-template--17482899849389__main" class="product__info-container product__column-sticky"><div class="product__title"> <h1>WCP 15T Steel Spur Gear (32 DP, 8mm SplineXS Bore)</h1></div><p class="product__sku" id="Sku-template--17482899849389__main" role="status"> <span class="visually-hidden">SKU:</span></p><div id="price-template--17482899849389__main" role="status"> </div>
<div><form method="post" action="/cart/add" id="product-form-installment-template--17482899849389__main" class="installment caption-large" enctype="multipart/form-data"><input type="hidden" name="form_type" value="product"><input type="hidden" name="id" value=""></form></div>
<variant-selects id="variant-selects-template--17482899849389__main" data-section="template--17482899849389__main"><div class="product-form__input product-form__input--dropdown"> <label class="form__label" for="Option-template--17482899849389__main-0"> Tooth Count </label> <div class="select"><select id="Option-template--17482899849389__main-0" class="select__select" name="options[Tooth Count]" form="product-form-template--17482899849389__main"> <option value="15T" data-product-url="/products/15t-steel-spur-gear-32-dp-8mm-splinexs-bore"> 15T </option><option value="100T" selected="selected" data-product-url="/products/wcp-32dp-steel-spur-gear"> 100T </option></select></div></div>
<div class="product-form__input product-form__input--dropdown"> <label class="form__label" for="Option-template--17482899849389__main-1"> Bore </label> <div class="select"><select id="Option-template--17482899849389__main-1" class="select__select" name="options[Bore]" form="product-form-template--17482899849389__main"> <option value="3/8&quot; Hex"> 3/8" Hex </option><option value="8mm Spline XS" selected="selected"> 8mm Spline XS - Unavailable </option></select></div></div></variant-selects>
<product-form class="product-form"><form method="post" action="/cart/add" id="product-form-template--17482899849389__main" class="form" enctype="multipart/form-data" novalidate="novalidate"><input type="hidden" name="form_type" value="product"><input type="hidden" name="id" value="" class="product-variant-id"></form></product-form></section>`,
};

// PowerWerx, a grouped product: each version is its own product with its own SKU and price, chosen by ticking its box. Further down,
// related products have their own ".sku .value" and prices, which the page's SKU and price fields would otherwise pick up.
export const POWERWERX_GROUPED = { url: 'https://powerwerx.com/powerpole-connectors-assorted-colors' };
const powerwerxRow = (id: string, size: string, sku: string, price: string, ticked: boolean) => `<div class="product-variant-line _variantWrapper" data-id="${id}"><div class="specAttr _assocProdNav" data-name="Size" data-value="${size}">${size}</div><div class="sku _sku _assocProdNav" id="sku-${id}" data-sku="${sku}"><a href="/assorted-color-powerpole-kit-${sku === 'ACP-30' ? 30 : 15}-amp" id="assocPdpAnchor${id}" class="groupedAssocProdPdpAnchor" data-prodid="${id}" data-name="Assorted Color Powerpole Connectors Kit (Size: ${size})" data-sku="${sku}" data-price="${price}">${sku}</a></div><div class="availability _assocProdNav"><div class="stock"><span class="label">Availability: </span><span class="value _availability">In Stock</span></div></div><div class="_productPrice _assocProdNav"><div class="prices"><div class="product-price"><span class="price-value-${id}" data-price="${price}"> <span class="priceSuperscript">$</span>${price} </span></div></div></div><div class="add-to-cart"><div class="add-to-cart-panel" data-prodid="${id}"><span class="checkbox-multi-use"> <span class="single-chk-box">&nbsp;</span> <input type="checkbox" name="groupedPdpCb" class="qtycb"${ticked ? ' checked' : ''}> </span><div class="cart-qty-custom-select"><input type="text" class="qty-input" value="1"><div class="OptionSelectBox CartQtySelect"><div class="jq-selectMenu cartQtyWrapper">${ticked ? 1 : 0}</div></div></div></div></div></div>`;
export function powerwerxGroupedPage(ticked: ('ACP-30' | 'ACP-15')[]): string {
  return `<div class="product-essential"><div class="product-name"><h1>Assorted Color Powerpole Connectors Kit</h1></div><div class="overview"><div class="product-price"><span>$10.99</span></div>
${powerwerxRow('1085', '30 Amp, 12-14 GA', 'ACP-30', '13.99', ticked.includes('ACP-30'))}${powerwerxRow('1086', '15 Amp, 16-20 GA', 'ACP-15', '10.99', ticked.includes('ACP-15'))}</div></div>
<div class="related-products-grid"><div class="item-box"><div class="add-info"><div class="prices"><span class="price actual-price"> <span class="priceAsLowAs">As Low As</span> <span class="priceSuperscript">$</span>9.99 </span></div><div class="sku"><span class="label">SKU: </span><span class="value">RT-1</span></div></div></div></div>`;
}

// Amazon's inline twister. A choice opens another ASIN; the heading names the chosen value, which the title may not.
export const AMAZON_BATTERIES = {
  url: 'https://www.amazon.com/dp/B01B8R6PF2?th=1',
  html: `<span id="productTitle" class="a-size-large product-title-word-break">Amazon Basics 100-Pack AA Alkaline Batteries, 1.5 Volt, 10-Year Shelf Life, Reliable</span>
<input type="hidden" id="ASIN" name="ASIN" value="B01B8R6PF2">
<div id="corePriceDisplay_desktop_feature_div"><div class="a-section aok-align-center priceToPay"><span class="a-price"><span class="a-offscreen">$25.99</span><span aria-hidden="true">$25.99</span></span></div></div>
<div id="inline-twister-row-size_name" class="a-section a-spacing-none inline-twister-row"> <div id="inline-twister-expander-header-size_name" aria-label="Selected Size is 100 Count (AA/LR6). Tap to collapse." class="a-section a-spacing-none dimension-heading"> <div id="inline-twister-dim-title-size_name" class="a-section a-spacing-none dimension-text"> <div class="a-section a-spacing-none a-padding-none inline-twister-dim-title-value-truncate-expanded"> <span class="a-size-base a-color-secondary"> Size: </span> <span id="inline-twister-expanded-dimension-text-size_name" class="a-size-base a-color-base inline-twister-dim-title-value a-text-bold"> 100 Count (AA/LR6) </span> </div> </div> </div>
<ul class="a-unordered-list a-nostyle a-button-list dimension-values-list" role="radiogroup"><li data-asin="B00MNV8E0C" class="swatch-list-item-text inline-twister-swatch"><span class="a-button a-button-toggle"><span class="a-button-inner"><input role="radio" aria-checked="false" class="a-button-input" type="submit"><span class="a-button-text" aria-hidden="true"><span class="swatch-title-text"> 48 Count (Pack of 1) </span><span class="a-price a-text-price"><span aria-hidden="true">$15.29</span></span></span></span></span></li><li data-asin="B01B8R6PF2" class="swatch-list-item-text inline-twister-swatch"><span class="a-button a-button-toggle a-button-selected"><span class="a-button-inner"><input role="radio" aria-checked="true" class="a-button-input" type="submit"><span class="a-button-text" aria-hidden="true"><span class="swatch-title-text"> 100 Count (AA/LR6) </span><span class="a-price a-text-price"><span aria-hidden="true">$25.99</span></span></span></span></span></li></ul></div>`,
};
