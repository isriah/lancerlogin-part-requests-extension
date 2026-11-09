// Real product pages with option choices, for npm run live:options. Each case lists steps; a step is a list of picks made the way a
// student would make them, and [] is the page as it loads. After each step the runner reopens the popup on the same tab and compares
// the extension's SKU, price and description with what the page itself shows, read by the case's `shows` function.
//
// `shows` runs inside the store page, so it must be self-contained. It returns one of:
//   { complete: true, sku, price, chosen: [text...] }  the page shows a full selection; price is a number or null when it shows none
//   { complete: false, note?: regex source }           the page has no complete selection: the extension must leave SKU and price
//                                                      blank and say so (by default with "Select all product options")
//   { notProduct: true }                               the extension must refuse the page, as WCP does without exactly one part
// `busy` names a store's loading cover, which is waited out before each pick.
// A pick is { click: selector, name? }, { click: [[selector, nth], [selector, nth]] } for a chain, or { select: [selector, option text prefix] }.
// Only product pages are read. Nothing is added to a cart.

/** BigCommerce (REV): the theme rewrites the SKU and price in place. */
function bigcommerce() {
  const t = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const form = document.querySelector('.productView form[data-cart-item-add]');
  const fields = [...form.querySelectorAll('[data-product-attribute]')];
  if (fields.some(f => f.querySelector('[required]') && !f.querySelector('input:checked') && !f.querySelector('select')?.value)) return { complete: false };
  const label = input => t([...form.querySelectorAll('label[for]')].find(l => l.htmlFor === input.id));
  const chosen = [...form.querySelectorAll('[data-product-attribute] input:checked')].map(label).filter(x => x && !/^None$/i.test(x));
  const skuOf = x => /\(([A-Z][A-Z\d]*-[A-Z\d][A-Z\d-]*)\)/.exec(x)?.[1];
  const variantSkus = fields.filter(f => /^(set-radio|set-rectangle|set-select|swatch)$/.test(f.dataset.productAttribute)).flatMap(f => [...f.querySelectorAll('input:checked')].map(label)).map(skuOf).filter(Boolean);
  const priceText = t(document.querySelector('.productView-price [data-product-price-without-tax]'));
  return {
    complete: true,
    sku: t(document.querySelector('.productView [data-product-sku]')) || (variantSkus.length === 1 ? variantSkus[0] : ''),
    price: /^\$[\d,]+\.\d{2}$/.test(priceText) ? Number(priceText.slice(1).replaceAll(',', '')) : null,
    // A variant's own "(SKU)" goes to the SKU field, not the description.
    chosen: chosen.map(x => x.replace(/\s*\([A-Z][A-Z\d]*-[A-Z\d][A-Z\d-]*\)\s*/, ' ').trim()),
  };
}

/**
 * Shopify: the variant the page's add-to-cart form will buy, looked up in the store's own public product JSON. The price is the one the
 * page displays (`priceSelector`), so a stale price on the page shows up too. A form with no variant id means the page itself has no
 * complete, available selection.
 */
async function shopify(priceSelector) {
  const t = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const id = [...document.querySelectorAll('form[action*="/cart/add"] [name="id"], variant-selection [name="id"]')].map(e => e.value).find(v => /^\d+$/.test(v)) || '';
  if (!id) return { complete: false };
  const handle = location.pathname.match(/\/products\/([^/?#]+)/)[1];
  const product = await (await fetch(`/products/${handle}.js`, { credentials: 'omit' })).json();
  const v = product.variants.find(x => String(x.id) === id);
  if (!v) return { complete: false };
  const shown = [...document.querySelectorAll(priceSelector)].find(e => e.offsetParent && /\$\s*\d/.test(t(e)));
  const m = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(t(shown));
  return { complete: true, variantId: id, sku: v.sku || '', price: m ? Number(m[1].replaceAll(',', '')) : null, listed: v.price / 100, chosen: v.options.filter(o => o && !/^default title$/i.test(o)) };
}

function swyft() {
  const t = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const scope = document.querySelector('main h1')?.parentElement?.parentElement;
  const sku = t([...scope.querySelectorAll('span')].find(e => /^SKU:\s*/.test(t(e)))).replace(/^SKU:\s*/, '');
  const pressed = [...document.querySelectorAll('main .space-y-6 .space-y-4 button[aria-pressed="true"]')].map(t);
  const m = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(t(document.querySelector('main .space-y-6 .font-price')));
  return { complete: true, sku, price: m ? Number(m[1].replaceAll(',', '')) : null, chosen: pressed };
}

function bambu() {
  const t = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const cards = [...document.querySelectorAll('.property-card-item')].filter(e => e.offsetParent);
  // The chosen card is the one without the grey border.
  const chosen = cards.filter(c => !c.className.includes('border-bbl-grey-5'));
  if (chosen.length !== 1) return { complete: false, note: 'Confirm the selected printer' };
  const name = t(chosen[0].querySelector('p.bbl-body-1'));
  const m = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(t(chosen[0]));
  const id = new URL(location.href).searchParams.get('id');
  return { complete: true, sku: id || undefined, price: m ? Number(m[1].replaceAll(',', '')) : null, chosen: [name] };
}

function onlineMetals() {
  const t = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const length = document.querySelector('input[name="productLength"]:checked');
  if (!length) return { complete: false, note: 'Select a stock length' };
  const m = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(t(document.querySelector('#selectedVariantPdpPriceValue')));
  return { complete: true, sku: length.getAttribute('data-variantcode'), price: m ? Number(m[1].replaceAll(',', '')) : null, chosen: [length.getAttribute('data-product-size')] };
}

function wcp() {
  const checked = [...document.querySelectorAll('.product-custom-option[product-sku]:checked')];
  if (checked.length !== 1) return { notProduct: true };
  const part = checked[0];
  return { complete: true, sku: part.getAttribute('product-sku'), price: Number(part.getAttribute('price')), chosen: [(part.labels?.[0]?.querySelector('span')?.textContent || '').replace(/\s+/g, ' ').trim()] };
}

/** PowerWerx grouped products list several versions, each with its own SKU and price; the student picks one by its quantity box. */
function powerwerxGrouped() {
  const rows = [...document.querySelectorAll('.product-variant-line._variantWrapper')].filter(r => r.querySelector('input.qtycb')?.checked);
  if (rows.length > 1) return { complete: false, note: 'Several versions are ticked' };
  if (rows.length !== 1) return { complete: false };
  const a = rows[0].querySelector('a.groupedAssocProdPdpAnchor');
  return { complete: true, sku: a.dataset.sku, price: Number(a.dataset.price), chosen: [/\(([^()]+)\)$/.exec(a.dataset.name.trim())?.[1] || a.dataset.name] };
}

function aliexpress() {
  const t = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const titles = [...document.querySelectorAll('[class*="sku-item--title"]')].map(t).filter(Boolean);
  const m = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(t(document.querySelector('[class*="price-default--current"], [class*="price--current"], [class*="product-price-current"]')));
  // Ali Express publishes no SKU the extension can confirm, so it is always left blank.
  return { complete: true, sku: '', price: m ? Number(m[1].replaceAll(',', '')) : null, chosen: titles.map(x => x.replace(/^[^:]+:\s*/, '')) };
}

function amazon() {
  const t = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const asin = document.querySelector('#ASIN')?.value || location.pathname.match(/\/dp\/([A-Z0-9]{10})/)?.[1];
  const priceEl = document.querySelector('#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen, #corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen');
  const m = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(t(priceEl));
  const chosen = [...document.querySelectorAll('[id^="inline-twister-expanded-dimension-text-"], #twister .selection')].map(t).filter(Boolean);
  return { complete: true, sku: asin, price: m ? Number(m[1].replaceAll(',', '')) : null, chosen };
}

const shopifyCase = (vendor, url, priceSelector, steps, ready = 'form[action*="/cart/add"]') => ({ vendor, url, ready, shows: shopify, arg: priceSelector, steps });
const label = forSuffix => ({ click: `label[for$="${forSuffix}"]` });
const amOption = value => ({ click: `label:has(> input.options-selection__option-value-input[value="${value}"])` });

export const CASES = [
  // REV (BigCommerce): the address stays the same and the SKU and price change in place.
  { vendor: 'rev', url: 'https://www.revrobotics.com/5mm-Hex-Shafts/', ready: '.productView form[data-cart-item-add]', shows: bigcommerce, bigcommerce: true,
    steps: [[], [[0, 0]], [[0, 1]], [[0, 3]], [[0, 2]]] },
  { vendor: 'rev', url: 'https://www.revrobotics.com/Smart-servo-v2', ready: '.productView form[data-cart-item-add]', shows: bigcommerce, bigcommerce: true,
    steps: [[], [[0, 0], [1, 2]], [[0, 1], [1, 3]], [[1, 0]]] },
  { vendor: 'rev', url: 'https://www.revrobotics.com/maxplanetary-system-kit/', ready: '.productView form[data-cart-item-add]', shows: bigcommerce, bigcommerce: true,
    steps: [[], [[1, 3]], [[1, 6], [4, 1]]] },

  // Ambrosia (Shopify, swatch radios; the address gains ?variant=).
  shopifyCase('ambrosia', 'https://ambrosiafilament.com/products/ambrosia-asa-filament-of-the-gods-2kg-5kg-large-spool-premium-3d-printing-filament-house-asa', '.product__price, [id^="ProductPrice"], .price',
    [[], [label('main-Size-1')], [label('main-Color-0')], [label('main-Size-0'), label('main-Color-1')]]),
  shopifyCase('ambrosia', 'https://ambrosiafilament.com/products/ambrosia-pet-gf-glass-filled-pet-filament-of-the-gods-1kg-spool', '.product__price, [id^="ProductPrice"], .price',
    [[], [label('main-Color-2')], [label('main-Color-0')]]),

  // AndyMark (Shopify, Empire theme): nothing is chosen on load, and a choice that leaves another group open is still incomplete.
  shopifyCase('andymark', 'https://andymark.com/products/1-x-1-peanut-extrusion-different-lengths', '.product__price .price__current',
    [[], [amOption('11.25 in.')], [amOption('Black')], [amOption('Silver')], [amOption('36 in.'), amOption('Red')]]),
  shopifyCase('andymark', 'https://andymark.com/products/robits-adjustable-struts', '.product__price .price__current',
    [[], [amOption('Long')], [amOption('Small')]]),

  // CTRE (Shopify, Dawn): a plain dropdown, and a combined listing where each choice opens another product's page.
  shopifyCase('ctre', 'https://store.ctr-electronics.com/products/wcp-timing-belts-5mm-htd-9mm-width', '.product__info-container .price__sale .price-item--sale, .product__info-container .price__regular .price-item--regular',
    [[], [{ select: ['select[name="options[Belt Size]"]', '45t'] }], [{ select: ['select[name="options[Belt Size]"]', '30t'] }]]),
  shopifyCase('ctre', 'https://store.ctr-electronics.com/products/wcp-32dp-steel-spur-gear', '.product__info-container .price__sale .price-item--sale, .product__info-container .price__regular .price-item--regular',
    [[], [{ select: ['select[name="options[Tooth Count]"]', '20T'] }], [{ select: ['select[name="options[Bore]"]', '8mm Key'] }], [{ select: ['select[name="options[Bore]"]', '8mm Spline XS'] }]]),

  // SDS (Shopify, older theme with a select per option group). Its variants have no SKU.
  shopifyCase('sds', 'https://www.swervedrivespecialties.com/products/mk5n-swerve-module', '#ProductPrice-product-template, .product-single__price',
    [[], [{ select: ['#ProductSelect-product-template-option-1', 'Billet'] }], [{ select: ['#ProductSelect-product-template-option-0', 'NEO'] }, { select: ['#ProductSelect-product-template-option-2', 'Preassembled'] }]]),
  shopifyCase('sds', 'https://www.swervedrivespecialties.com/products/wheel-colson-4od-x-2w-mk5', '#ProductPrice-product-template, .product-single__price',
    [[], [{ select: ['#ProductSelect-product-template-option-0', 'Wheel Kit'] }], [{ select: ['#ProductSelect-product-template-option-0', 'Wheel Kit + Quick'] }]]),

  // Thrifty Bot (Shopify, Warehouse theme): color and block swatches. Some variants have no SKU.
  shopifyCase('thrifty', 'https://www.thethriftybot.com/products/qty-4-2-inch-vectored-intake-wheel', '.product-form__info-list .price-list .price',
    [[], [label('-1-3')], [label('-2-3')], [label('-1-1'), label('-2-1')]]),
  shopifyCase('thrifty', 'https://www.thethriftybot.com/products/kraken-spline-pulleys', '.product-form__info-list .price-list .price',
    [[], [label('-1-2')], [label('-1-5')]]),

  // West3D (Shopify, Warehouse theme with option ids as values).
  shopifyCase('west3d', 'https://west3d.com/products/voron-trident-r2-bottom-deck-and-rear-panels', '.product-form__info-list .price-list .price, .price-list .price',
    [[], [label('main-option1-2')], [label('main-option2-4')], [label('main-option1-4'), label('main-option2-2')]]),
  shopifyCase('west3d', 'https://west3d.com/products/snapmaker-phaetus-liber-high-flow-hotend-for-u1-1-pack-or-4-pack', '.product-form__info-list .price-list .price, .price-list .price',
    [[], [label('main-option1-2')], [label('main-option1-1')]]),

  // Swyft (headless Shopify): pressed buttons, and the address gains ?variant=.
  { vendor: 'swyft', url: 'https://www.swyftrobotics.com/motion/swyft-servos', ready: 'main .space-y-6 .font-price', shows: swyft,
    steps: [[], [{ click: 'main button:has-text("Servo Programmer USB Dongle")' }], [{ click: 'main button:has-text("Torque V1.1")' }]] },

  // BambuLab (Shopify Hydrogen): cards, and the address gains ?id=.
  { vendor: 'bambu', url: 'https://us.store.bambulab.com/products/p1s', ready: '.property-card-item', shows: bambu,
    steps: [[], [{ click: [['.property-card-item:visible', 0]] }], [{ click: [['.property-card-item:visible', 1]] }]] },

  // WCP: independent parts as checkboxes; exactly one must be checked.
  { vendor: 'wcp', url: 'https://wcproducts.com/products/25-sprockets', ready: '.product-custom-option[product-sku]', shows: wcp,
    steps: [[], [{ click: 'label[for="options_1001_2"]' }], [{ click: 'label[for="options_1003_3"]' }], [{ click: 'label[for="options_1001_2"]' }]] },

  // Online Metals: stock lengths change the SKU and price in place; a custom cut has no stock length. After one choice the page keeps a
  // loading cover over the lengths in an automated profile, so each choice is made on a freshly loaded page.
  ...['selectedVariant17854_24_0', 'selectedVariant17854_36_0', 'custom-cut-17854'].map((id, i) => ({
    vendor: 'onlinemetals', url: 'https://www.onlinemetals.com/en/buy/aluminum/0-5-x-0-5-x-0-062-aluminum-angle-6063-t52/pid/17854', ready: 'input[name="productLength"]', busy: '.pre-loader-bg', shows: onlineMetals,
    steps: [...(i ? [] : [[]]), [{ click: `label[for="${id}"]` }]],
  })),

  // PowerWerx: a grouped product lists versions, each with its own SKU and price.
  { vendor: 'powerwerx', url: 'https://powerwerx.com/powerpole-connectors-assorted-colors', ready: '._variantWrapper', shows: powerwerxGrouped,
    steps: [[], [{ click: [['._variantWrapper', 1], ['.single-chk-box', 0]] }], [{ click: [['._variantWrapper', 0], ['.single-chk-box', 0]] }], [{ click: [['._variantWrapper', 1], ['.single-chk-box', 0]] }]] },

  // Ali Express: properties change the price in place. The address stays the same.
  { vendor: 'aliexpress', url: 'https://www.aliexpress.us/item/3256802967050384.html', ready: '[class*="sku-item--property"]', shows: aliexpress,
    steps: [[], [{ click: [['[class*="sku-item--property"]', 0], ['[class*="sku-item--image"], [class*="sku-item--text"]', 3]] }], [{ click: [['[class*="sku-item--property"]', 0], ['[class*="sku-item--image"], [class*="sku-item--text"]', 8]] }]] },

  // Amazon: a size choice opens another ASIN.
  { vendor: 'amazon', url: 'https://www.amazon.com/dp/B00MNV8E0C', ready: '#productTitle', shows: amazon,
    steps: [[], [{ click: '#inline-twister-row-size_name li[data-asin="B01B8R6PF2"] .a-button-text, #inline-twister-row-size_name li[data-asin="B01B8R6PF2"] button, #inline-twister-row-size_name [data-asin="B01B8R6PF2"]', name: '100 Count (AA/LR6)' }]] },

  // These pages' option choices each open another product page. Automated profiles are usually stopped by their bot checks.
  // Here they are only loaded, to record whether the store lets an automated profile in at all.
  { vendor: 'harborfreight', url: 'https://www.harborfreight.com/9-mil-nitrile-powder-free-gloves-xx-large-50-pack-57159.html', ready: '[data-testid="product-title"], .product-name h1', wallOnly: true },
  { vendor: 'homedepot', url: 'https://www.homedepot.com/p/Everbilt-1-4-in-20-Zinc-Plated-Hex-Nut-801736/204647886', ready: 'h1.product-details__title', wallOnly: true },
];
