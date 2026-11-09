import type { AdapterConfig, CaptureResult } from './types';
import { capturePage } from './reader';

export interface VendorAdapter {
  config: AdapterConfig;
  matches(url: string): boolean;
  extract(): CaptureResult;
}
const shopify = {
  productPath: '/products/[^/?#]+', profile: 'shopify' as const,
  productMarker: ['form[action*="/cart/add"]', '.product__info-container', '.product-meta', '.product-single', '#product-price'],
  title: ['.product-single__title', '.product__title h1', '.product-meta__title', '.product-title', 'main h1', 'h1'],
  price: ['[id^="ProductPrice"]', '.product__info-container .price__sale .price-item--sale', '.product__info-container .price__regular .price-item--regular', '.product-meta__price-list .price', '.product-single__price', '.product__price .price__current', '#product-price .price-item--sale', '#product-price .price-item--regular', '.product-price .money', '.product-form__info-list .price-list .price'],
  sku: ['[id^="ProductSKU"]', '.product-meta__sku-number', '[data-product-sku]', '.product__sku', '.product-single__sku', '[itemprop="sku"]'],
  variants: ['form[action*="/cart/add"] select:not([name="id"]):not([name="quantity"])', 'variant-selects select', 'variant-radios input:checked', 'form[action*="/cart/add"] input[type="radio"]:checked', '.single-option-selector', '.product-options input[type="radio"]:checked', '.swatch input[type="radio"]:checked', '.swatches__form--input:checked', '.options-selection__option-value-input:checked'],
};
const bc = {
  productPath: '/[^/]+/?$', profile: 'bigcommerce' as const,
  title: ['.productView-title', '[itemprop="name"]', 'main h1'],
  price: ['.productView-price [data-product-price-without-tax]', '.productView-price [data-product-price-with-tax]'],
  sku: ['[data-product-sku]', '[itemprop="sku"]'],
  // The reader reads BigCommerce options from the add-to-cart form itself, so a missing choice is noticed too.
  variants: [],
  productMarker: ['.productView', 'form[data-cart-item-add]'],
};
function entry(id: string, label: string, host: string, base: Omit<AdapterConfig, 'id' | 'label' | 'hosts'>, overrides: Partial<AdapterConfig> = {}): AdapterConfig {
  return { id, label, hosts: [host, `www.${host}`, `m.${host}`, `mobile.${host}`], ...base, ...overrides };
}
export const VENDORS: AdapterConfig[] = [
  entry('amazon', 'Amazon', 'amazon.com', {
    profile: 'amazon', productPath: '/(?:dp|gp/product)/[A-Z0-9]{10}',
    title: ['#productTitle'], price: ['#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen', '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen', '#priceblock_ourprice', '#priceblock_dealprice', '#apex_desktop .priceToPay .a-offscreen'],
    // The inline twister names each chosen dimension in its heading, such as "Size: 48 Count (Pack of 1)".
    sku: ['#ASIN'], variants: ['#twister .selection', '#twister_feature_div .selection', '[id^="inline-twister-expanded-dimension-text-"]'],
    productMarker: ['#productTitle'],
  }),
  entry('aliexpress', 'Ali Express', 'aliexpress.com', {
    profile: 'aliexpress', productPath: '/item/\\d+\\.html',
    title: ['[data-pl="product-title"] h1', 'h1[data-pl="product-title"]', 'h1'],
    price: ['[class*="price--current"]', '[class*="product-price-current"]'],
    sku: [], variants: ['[class*="sku-item--title"]', '[class*="sku-property-text"] [class*="selected"]'],
  }, { hosts: ['aliexpress.com', 'www.aliexpress.com', 'm.aliexpress.com', 'mobile.aliexpress.com', 'aliexpress.us', 'www.aliexpress.us', 'm.aliexpress.us'] }),
  entry('ambrosia', 'Ambrosia Filament', 'ambrosiafilament.com', shopify),
  entry('andymark', 'AndyMark', 'andymark.com', shopify, { title: ['.product__title', '.product-title', 'h1'] }),
  entry('bambu', 'BambuLab', 'us.store.bambulab.com', shopify, { hosts: ['us.store.bambulab.com', 'www.us.store.bambulab.com'], title: ['h1.bbl-title-3', 'h1', '.product-title'], price: ['[class*="product-price"] [class*="price-now"]', ...shopify.price] }),
  entry('ctre', 'CTRE', 'store.ctr-electronics.com', shopify, { hosts: ['store.ctr-electronics.com', 'www.store.ctr-electronics.com'] }),
  entry('ferrules', 'FerrulesDirect', 'ferrulesdirect.com', shopify),
  entry('harborfreight', 'Harbor Freight', 'harborfreight.com', {
    profile: 'catalog', productPath: '/[^/]+-\\d+\\.html',
    title: ['[data-testid="product-title"]', '.product-name h1', 'h1'],
    price: ['[data-testid="product-price"]', '.product-info-price .price-wrapper .price'],
    sku: ['[itemprop="sku"]', '[class*="product__sku"]', '.product.attribute.sku .value'], variants: [],
  }),
  entry('homedepot', 'Home Depot', 'homedepot.com', {
    profile: 'catalog', productPath: '/p/(?:[^/]+/)?\\d+',
    title: ['h1.product-details__title', 'h1'], price: ['[data-testid="price-format__main-price"]', '.price-format__main-price'],
    sku: ['[itemprop="sku"]'], variants: ['[data-testid="product-overview"] [aria-checked="true"]', '[data-testid="product-overview"] select'],
  }),
  entry('mcmaster', 'McMaster', 'mcmaster.com', {
    profile: 'catalog', productPath: '/\\d+[A-Z]\\d+(?:/|$)',
    title: ['h1[class*="productDetailHeaderPrimary"]'], price: ['[class*="_price_"]'], sku: [], variants: [], productMarker: ['h1[class*="productDetailHeaderPrimary"]'],
  }),
  entry('onlinemetals', 'Online Metals', 'onlinemetals.com', {
    profile: 'catalog', productPath: '/(?:[^/]+/)*p(?:id)?/[^/]+',
    title: ['.product-details h1', 'h1'], price: ['#selectedVariantPdpPriceValue'],
    sku: ['.product-code', '[itemprop="sku"]'], variants: ['input[name="productLength"]:checked', '.product-options select'],
  }),
  entry('pololu', 'Pololu', 'pololu.com', {
    profile: 'catalog', productPath: '/product/\\d+', title: ['h1'],
    price: ['#product-price', '.product-price'], sku: ['[itemprop="sku"]'], variants: [],
  }),
  entry('powerwerx', 'PowerWerx', 'powerwerx.com', {
    profile: 'catalog', productPath: '/[^/]+/?$', title: ['.product-name h1', 'h1'],
    price: ['.product-price span', '.product-price'], sku: ['.sku .value', '[itemprop="sku"]'],
    variants: ['.attributes select', '.attributes input[type="radio"]:checked'], productMarker: ['.product-essential', '.product-details-page', '[itemtype$="/Product"]'],
  }),
  entry('rev', 'REV', 'revrobotics.com', bc),
  entry('sds', 'SDS', 'swervedrivespecialties.com', shopify),
  entry('swyft', 'Swyft', 'swyftrobotics.com', shopify, { profile: 'catalog', productPath: '/(?:products?|motion|structure|electrical|materials|machines|kits)/[^/?#]+', title: ['main h1'], price: ['main .space-y-6 .font-price'], sku: [], variants: ['main .space-y-6 .space-y-4 button[aria-pressed="true"]'], productMarker: ['main .space-y-6 .font-price'] }),
  entry('thrifty', 'Thrifty Bot', 'thethriftybot.com', shopify),
  entry('vbelts', 'V-Belt Guys', 'vbeltguys.com', shopify),
  entry('wcp', 'WCP', 'wcproducts.com', shopify, { title: ['.tt-title', '.product-single__title', '.product-title', 'h1'] }),
  entry('west3d', 'West3D', 'west3d.com', shopify),
];
export function vendorForUrl(raw: string): AdapterConfig | undefined {
  try {
    const u = new URL(raw);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) return;
    return VENDORS.find(v => v.hosts.includes(u.hostname.toLowerCase()));
  } catch { return; }
}
export const adapters: VendorAdapter[] = VENDORS.map(config => ({
  config,
  matches: url => vendorForUrl(url)?.id === config.id,
  extract: () => capturePage(config),
}));
