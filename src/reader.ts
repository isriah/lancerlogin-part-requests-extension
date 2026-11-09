import type { AdapterConfig, CaptureResult } from './types';

/** Self-contained: Chrome serializes this function into the page's isolated world. */
export function capturePage(config: AdapterConfig): CaptureResult {
  const url = location.href;
  const out: CaptureResult = { vendor: config.label, url, description: '', sku: '', price: null, currency: '', variants: [], issues: [], kind: 'not-product' };
  const clean = (v: unknown): string => typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim() : '';
  const isInput = (el: Element): el is HTMLInputElement => el.tagName === 'INPUT';
  const isSelect = (el: Element): el is HTMLSelectElement => el.tagName === 'SELECT';
  const isVisible = (el: Element): boolean => {
    if (el.closest('[hidden], [aria-hidden="true"], del, s, strike, .price--compare, .a-text-price')) return false;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0' && !e.classList.contains('a-offscreen')) return false;
    }
    return true;
  };
  const read = (el: Element): string => clean(el.getAttribute('content') ?? (isInput(el) ? el.value : el.textContent));
  const first = (selectors: string[], hidden = false): string => {
    for (const s of selectors) for (const el of document.querySelectorAll(s)) {
      if ((hidden || isVisible(el)) && read(el)) return read(el);
    }
    return '';
  };
  const meta = (name: string): string => clean(document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute('content'));
  const money = (raw: unknown): number | null => {
    const text = clean(raw);
    if (!text || /\b(from|starting|as low|month|monthly|installment)\b|[/]|\d\s*[-–]\s*\D*\d/i.test(text)) return null;
    const matches = text.match(/\d[\d,]*(?:\.\d{1,2})?/g);
    if (!matches || matches.length !== 1) return null;
    if (/,\d{1,2}$/.test(matches[0]) && !matches[0].includes('.')) return null;
    const n = Number(matches[0].replaceAll(',', ''));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const bodyText = clean(document.body?.innerText || document.body?.textContent).slice(0, 8000);
  if (/^error page\b|robot check|verify (?:that )?you(?:'re| are) (?:a )?human|access denied|sorry, you have been blocked|checking your browser|enable javascript and cookies to continue/i.test(`${document.title} ${bodyText}`)) {
    out.kind = 'blocked'; out.issues.push('This page has an access check. Complete it yourself, then reopen the extension.'); return out;
  }
  if (!config.hosts.includes(location.hostname) || /\/(?:cart|checkout|search|account|login)(?:[/?#]|$)/i.test(location.pathname) || !new RegExp(config.productPath, 'i').test(location.pathname)) {
    out.issues.push('Open a specific product page from this store.'); return out;
  }
  if (config.id === 'mcmaster') {
    out.description = first(config.title);
    if (!out.description) { out.issues.push('Open the individual McMaster part-number link.'); return out; }
    out.kind = 'product';
    const detail = first(['[class*="productDetailHeaderSecondary"]']);
    const price = first(config.price);
    const quote = /^\$([\d,.]+)\s+(?:per|each)(?:\s+(pack of \d+))?\s*$/i.exec(price);
    out.sku = location.pathname.match(/\/(\d+[A-Z]\d+)/i)?.[1]?.toUpperCase() || '';
    out.price = quote ? money(quote[1]) : null;
    out.currency = quote ? 'USD' : '';
    out.description = [out.description, detail, quote?.[2]].filter(Boolean).join(' - ');
    if (!quote) out.issues.push('Confirm the price and selling unit on McMaster.');
    return out;
  }
  // WCP's product families expose independent purchasable parts as checkboxes.
  // A family price is not the selected part's price, and more than one is bulk capture.
  if (config.id === 'wcp' && document.querySelector('.product-custom-option[product-sku]')) {
    const checked = [...document.querySelectorAll<HTMLInputElement>('.product-custom-option[product-sku]:checked')];
    if (checked.length !== 1) { out.issues.push('Select exactly one part checkbox on WCP, then reopen the extension. Do not add it to the cart.'); return out; }
    const part = checked[0];
    out.kind = 'product';
    out.description = clean(part.labels?.[0]?.querySelector('span')?.textContent) || first(config.title);
    out.sku = clean(part.getAttribute('product-sku'));
    out.price = money(part.getAttribute('price'));
    out.currency = meta('og:price:currency') || first(['[itemprop="priceCurrency"]'], true);
    if (out.price === null) out.issues.push('Unit price needs your review.');
    if (out.currency !== 'USD') out.issues.push('Confirm the unit price in USD before submitting.');
    return out;
  }
  // Only parse published DOM metadata. Never access page globals, cookies, or application state.
  type Obj = Record<string, any>;
  const products: Obj[] = [];
  const groups: Obj[] = [];
  const walk = (v: unknown, depth = 0): void => {
    if (depth > 12 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.slice(0, 500).forEach(x => walk(x, depth + 1)); return; }
    const o = v as Obj;
    const types = [o['@type']].flat();
    if (types.some(t => t === 'Product' || t === 'https://schema.org/Product')) products.push(o);
    if (types.includes('ProductGroup')) groups.push(o);
    for (const key of ['@graph', 'mainEntity', 'hasVariant', 'itemListElement', 'item']) if (o[key]) walk(o[key], depth + 1);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const text = script.textContent || '';
    if (text.length > 1_000_000) continue;
    try { walk(JSON.parse(text)); } catch { /* Malformed third-party metadata must not break capture. */ }
  }
  const samePage = (value: unknown): boolean => {
    try { const u = new URL(clean(value), url); return !!clean(value) && u.origin === location.origin && u.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, ''); } catch { return false; }
  };
  const matches = products.filter(p => samePage(p.url) || samePage(p['@id']));
  const candidates = matches.length ? matches : products;
  const allSameProduct = candidates.length > 0 && candidates.every(p => clean(p.name).toLowerCase() === clean(candidates[0].name).toLowerCase());
  let product = candidates.length === 1 ? candidates[0] : allSameProduct ? candidates.find(p => p.offers) || candidates[0] : undefined;
  let bambuSelected = false;
  if (config.id === 'bambu' && groups.length === 1) {
    const names = [...new Set([...document.querySelectorAll('.property-card-item.border-bbl-brand-green p.bbl-body-1')].filter(isVisible).map(read))];
    const selected = names.length === 1 ? products.filter(p => clean(p.name).endsWith(` - ${names[0]}`)) : [];
    if (selected.length === 1) { product = selected[0]; bambuSelected = true; }
    else product = { name: groups[0].name }; // An unresolved group is editable, with no guessed variant price.
  }
  // Shopify themes may publish every variant of one product as a ProductGroup. That is one
  // product with options, not a multi-product page: use the selected variant, or none.
  let groupVariantExact = false;
  if (config.id !== 'bambu' && !product && groups.length === 1 && products.length > 1) {
    const members = [groups[0].hasVariant].flat();
    const groupName = clean(groups[0].name).toLowerCase();
    // Some themes also publish the base product beside the group, so same-named entries belong to it.
    if (groupName && products.every(p => members.includes(p) || clean(p.name).toLowerCase() === groupName)) {
      const selectedId = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('form[action*="/cart/add"] [name="id"],variant-selection [name="id"]')].map(e => clean(e.value)).find(v => /^\d+$/.test(v)) || new URL(url).searchParams.get('variant') || '';
      const selected = selectedId ? members.filter(p => new RegExp(`[?&]variant=${selectedId}(?:\\D|$)`).test(`${clean(p['@id'])} ${clean(p.url)}`)) : [];
      groupVariantExact = selected.length === 1;
      product = groupVariantExact ? selected[0] : { name: groups[0].name };
    }
  }
  if (products.length > 1 && !product) {
    out.issues.push('Several products were found. Open a page for one specific product.'); return out;
  }
  if (config.productMarker && !config.productMarker.some(s => document.querySelector(s)) && !product) {
    out.issues.push('Open a specific product page from this store.'); return out;
  }
  out.kind = 'product';
  out.description = bambuSelected ? clean(product?.name) : first(config.title) || clean(product?.name) || meta('og:title') || clean(document.title);
  const selectedElements = new Set<Element>();
  for (const selector of config.variants) for (const el of document.querySelectorAll(selector)) {
    if (/quantity|qty|sort|review|jdgm|address|shipping/i.test(`${el.id} ${el.className} ${el.getAttribute('name')} ${el.getAttribute('aria-label')}`)) continue;
    selectedElements.add(el);
  }
  let hasVariantControls = selectedElements.size > 0;
  let unselected = false;
  for (const el of selectedElements) {
    if (!isVisible(el) && !(isInput(el) && el.checked && [...el.labels || []].some(isVisible))) continue;
    let value = '';
    if (isSelect(el)) {
      const option = el.selectedOptions[0];
      if (/quantity|qty/i.test(`${el.name} ${el.id} ${el.getAttribute('aria-label')}`) || el.name === 'id') continue;
      value = clean(option?.textContent);
      if (!el.value || /^(choose|select|please select)\b/i.test(value)) { unselected = true; continue; }
      if (el.classList.contains('ymq-dropdown')) value = `${el.name.replace(/-[a-z\d]+$/i, '')}: ${value}`;
    } else if (isInput(el)) {
      value = clean(el.getAttribute('data-product-size')) || clean(el.labels?.[0]?.textContent) || clean(el.value);
    } else value = read(el);
    if (value && !/^(default title|default)$/i.test(value)) out.variants.push(value);
  }
  out.variants = [...new Set(out.variants)].filter(v => v.length < 200).slice(0, 12);
  let variant: Obj | undefined;
  let shopifyMultiple = false;
  if (config.profile === 'shopify') {
    const ids = [...document.querySelectorAll<HTMLSelectElement | HTMLInputElement>('form[action*="/cart/add"] [name="id"],variant-selection [name="id"],select.variant-selection__variants')];
    if (ids.some(e => isSelect(e) && (e.value === 'not-selected' || /^(choose|select)\b/i.test(clean(e.selectedOptions[0]?.textContent))))) unselected = true;
    hasVariantControls ||= ids.some(e => isSelect(e) && e.options.length > 1);
    const variantId = ids.map(e => clean(e.value)).find(v => v && v !== 'not-selected') || new URL(url).searchParams.get('variant') || '';
    for (const el of document.querySelectorAll('script[type="application/json"]')) {
      if ((el.textContent?.length ?? 0) > 1_000_000) continue;
      try {
        const data = JSON.parse(el.textContent || '');
        const vs: Obj[] | undefined = Array.isArray(data?.variants) ? data.variants : Array.isArray(data) && data[0]?.options && data[0]?.price !== undefined ? data : undefined;
        if (vs) {
          shopifyMultiple ||= vs.length > 1;
          const found = vs.find(v => String(v.id) === variantId);
          if (found) { variant = found; break; }
        }
      } catch { /* Ignore unrelated JSON. */ }
    }
    if (variant?.title && variant.title !== 'Default Title') out.variants.push(clean(variant.title));
  }
  hasVariantControls ||= shopifyMultiple;
  const domPriceText = first(config.price);
  const domPrice = money(domPriceText);
  const domSku = first(config.sku, config.profile === 'amazon').replace(/^(?:SKU|Item\s*#|Part\s*(?:Number|No\.?))\s*[:#]?\s*/i, '');
  const offers: Obj[] = product?.offers ? [product.offers].flat() : [];
  const offerMatches = offers.filter(o => clean(o['@type']) !== 'AggregateOffer' && (o.sku && clean(o.sku) === domSku || o.url && clean(o.url) === url));
  const offer = offerMatches.length === 1 ? offerMatches[0] : offers.length === 1 && offers[0]['@type'] !== 'AggregateOffer' ? offers[0] : undefined;
  const exactVariant = !!variant || offerMatches.length === 1 || bambuSelected || groupVariantExact;
  const metadataSafe = !hasVariantControls || exactVariant;
  // An explicit range or installment quote must not fall back to a metadata minimum.
  const unsafeDisplayedPrice = !!domPriceText && domPrice === null;
  out.price = unsafeDisplayedPrice ? null : domPrice ?? (variant && typeof variant.price === 'number' ? variant.price / 100 : metadataSafe ? money(offer?.price ?? (meta('product:price:amount') || meta('og:price:amount'))) : null);
  out.sku = domSku || clean(variant?.sku) || (metadataSafe ? clean(offer?.sku || product?.sku) : '');
  if (config.id === 'swyft') {
    const scope = document.querySelector('main h1')?.parentElement?.parentElement;
    out.sku = clean([...scope?.querySelectorAll('span') || []].find(e => /^SKU:\s*/.test(clean(e.textContent)))?.textContent).replace(/^SKU:\s*/, '');
  }
  if (config.id === 'onlinemetals') {
    const selected = document.querySelector<HTMLInputElement>('input[name="productLength"]:checked');
    out.sku = clean(selected?.getAttribute('data-variantcode'));
    if (!selected) { out.price = null; out.issues.push('Select a stock length, or enter the exact custom-cut description and quoted unit price manually.'); }
  }
  if (config.id === 'bambu' && groups.length && !bambuSelected) {
    out.price = null; out.sku = ''; out.issues.push('Confirm the selected printer or accessory variant and enter its price manually.');
  }
  if (config.id === 'west3d' && [...document.querySelectorAll<HTMLSelectElement>('select.ymq-dropdown')].some(e => !/^(no|none|)$/i.test(clean(e.value)))) {
    out.price = null; out.issues.push('Custom kit options can change the price. Enter the displayed configured unit price manually.');
  }
  // Home Depot's product metadata can disagree with the displayed price, so never fall back to it.
  // Under a dollar it shows cents, such as "14 ¢", which is 0.14. A per-piece amount, "(20¢ /piece)" or "20¢/piece", is never the selling price.
  let homeDepotDisplayed = false;
  if (config.id === 'homedepot') {
    const heading = document.querySelector('h1');
    const box = document.querySelector('#unit-case-price-includes') || [...document.querySelectorAll('[data-component^="price"]')].find(e => isVisible(e) && !!heading && !!(heading.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
    const quote = (domPriceText || clean(box?.textContent)).split(/\b(?:save|was)\b|\(/i)[0];
    const dollars = quote.match(/\$\s*\d[\d,]*(?:\s*\.\s*\d{2})?/g) || [];
    const cents = quote.match(/(?<![\d.,$])\d{1,3}\s*¢(?!\s*\/)/g) || [];
    const perPiece = /¢\s*\//.test(quote);
    const centsValue = cents.length === 1 ? Number(cents[0].replace(/\D/g, '')) : NaN;
    if (dollars.length === 1 && !cents.length) out.price = money(dollars[0].replace(/\s+/g, ''));
    else if (!dollars.length && !perPiece && centsValue < 100) out.price = centsValue / 100;
    else out.price = null;
    homeDepotDisplayed = out.price !== null;
  }
  if (config.profile === 'amazon' && !out.sku) out.sku = location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1] || '';
  if (config.id === 'mcmaster' && !out.sku) out.sku = location.pathname.match(/\/(\d+[A-Z]\d+)/i)?.[1] || '';
  if (config.id === 'pololu' && !out.sku) out.sku = location.pathname.match(/\/product\/(\d+)/)?.[1] || '';
  // An unselected control makes DOM prices unsafe too: they can be a default or range.
  if (unselected) { out.price = null; out.sku = ''; out.issues.push('Select all product options on the store page, or enter the exact variant and price manually.'); }
  const explicitCurrency = /\b(AUD|CAD|EUR|GBP|CNY|USD|JPY|INR)\b/i.exec(domPriceText)?.[1]?.toUpperCase();
  out.currency = explicitCurrency || (/CA\$|C\$/.test(domPriceText) ? 'CAD' : /AU\$|A\$/.test(domPriceText) ? 'AUD' : /€/.test(domPriceText) ? 'EUR' : /£/.test(domPriceText) ? 'GBP' : clean(offer?.priceCurrency) || meta('product:price:currency') || meta('og:price:currency') || first(['[itemprop="priceCurrency"]'], true));
  if (!out.currency && /\$/.test(domPriceText) && config.id !== 'aliexpress') out.currency = 'USD';
  if (homeDepotDisplayed) out.currency = 'USD';
  if ((out.price !== null || out.currency) && out.currency !== 'USD') out.issues.push(out.currency ? `Price is in ${out.currency}. Enter a USD price and confirm it before submitting.` : 'Currency could not be confirmed. Enter a USD price and confirm it before submitting.');
  out.variants = [...new Set(out.variants)].filter((v, _, all) => !all.some(other => other !== v && (other.split(' / ').includes(v) || other.endsWith(`: ${v}`))));
  const extras = out.variants.filter(v => !out.description.toLowerCase().includes(v.toLowerCase()));
  if (extras.length) out.description += ` - ${extras.join(' / ')}`;
  if (out.price === null) out.issues.push('Unit price needs your review.');
  if (!out.sku) out.issues.push('SKU was not confirmed; it is optional.');
  out.description = out.description.slice(0, 2000);
  out.sku = out.sku.slice(0, 2000);
  return out;
}
