import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePage } from '../src/reader';
import { VENDORS, adapters, vendorForUrl } from '../src/vendors';
import { fixtures, ld, product } from './fixtures/vendors';

function load(id: string, html?: string, url?: string) {
  const f = fixtures.find(f => f.id === id)!;
  vi.stubGlobal('location', new URL(url || f.url));
  document.documentElement.innerHTML = `<head><title>Product</title></head><body>${html ?? f.html}</body>`;
  return () => capturePage(VENDORS.find(v => v.id === id)!);
}
afterEach(() => { vi.unstubAllGlobals(); });
describe('20 vendor DOM fixtures', () => {
  for (const f of fixtures) it(`${f.id}: selected item, exact price, SKU and URL`, () => {
    const result = load(f.id)();
    expect(result).toMatchObject({ kind:'product',description:f.description,sku:f.sku,price:f.price,currency:f.currency || 'USD',url:f.url });
    expect(result.vendor).toBe(VENDORS.find(v => v.id === f.id)!.label);
  });
  it('covers every registered vendor once', () => expect(fixtures.map(f=>f.id).sort()).toEqual(adapters.map(a=>a.config.id).sort()));
});
describe('conservative capture', () => {
  it('does not use range minimum, default SKU or canonical URL for AndyMark', () => {
    const run=load('andymark','<h1>Robits Hex Shafts</h1><form action="/cart/add"><select name="id" class="variant-selection__variants"><option value="not-selected">Choose variant</option><option value="1">2 in.</option></select></form><div class="product__price"><span class="price__current">$5.30 - $11.00</span></div>'+product('Robits Hex Shafts','default-sku',5.3));
    expect(run()).toMatchObject({kind:'product',sku:'',price:null});
  });
  it.each(['From $5.00','$5.00 - $12.00','$3.00/month','$3.00 per month','$5.00 or $1.00 installments'])('rejects ambiguous quote %s', price => {
    expect(load('rev',`<div class="productView"><h1>Motor</h1><div class="productView-price"><span data-product-price-without-tax>${price}</span></div></div>`+product('Motor','M1',5))().price).toBeNull();
  });
  it('leaves an aggregate offer blank', () => {
    expect(load('pololu','<h1>Sensor</h1>'+ld({'@type':'Product',name:'Sensor',offers:{'@type':'AggregateOffer',lowPrice:5,highPrice:10}}))().price).toBeNull();
  });
  it('flags foreign currency without conversion', () => {
    expect(load('aliexpress','<h1>Bracket</h1><span class="price--current-x">€8.50</span>')()).toMatchObject({price:8.5,currency:'EUR',issues:expect.arrayContaining([expect.stringContaining('USD')])});
  });
  it('does not assume a custom West3D kit uses the base price', () => {
    const f=fixtures.find(f=>f.id==='west3d')!;
    expect(load('west3d',f.html.replace('<option selected>No</option>','<option selected>Yes</option>'))()).toMatchObject({price:null,description:expect.stringContaining('Remove Raspberry Pi: Yes')});
  });
  it('rejects multiple products and bot challenges', () => {
    expect(load('pololu',product('A','A',1)+product('B','B',2))().kind).toBe('not-product');
    expect(load('amazon','<h1>Robot Check</h1>')().kind).toBe('blocked');
  });
  it('does not infer WCP part from a family page or multiple checks', () => {
    const f=fixtures.find(f=>f.id==='wcp')!;
    expect(load('wcp',f.html.replace(' checked',''))().kind).toBe('not-product');
    expect(load('wcp',f.html+'<input class="product-custom-option" type="checkbox" product-sku="two" checked>')().kind).toBe('not-product');
  });
  it('recaptures dynamic selected lengths and prices', () => {
    const run=load('onlinemetals'); expect(run().price).toBe(3.15);
    document.querySelector('input')!.setAttribute('data-product-size','24"');
    document.querySelector('input')!.setAttribute('data-variantcode','17854_24_0_DV');
    document.querySelector('#selectedVariantPdpPriceValue')!.textContent='$6.30 ea.';
    expect(run()).toMatchObject({price:6.3,sku:'17854_24_0_DV',description:expect.stringContaining('24"')});
  });
  it('keeps missing price editable and preserves selection URL', () => {
    const result=load('amazon','<h1 id="productTitle">Cable &lt;script&gt;alert(1)&lt;/script&gt;</h1>','https://www.amazon.com/dp/B0FQNPK1SQ?th=1&psc=1#blue')();
    expect(result.price).toBeNull(); expect(result.description).toContain('<script>'); expect(result.url).toContain('?th=1&psc=1#blue');
  });
  it.each(['https://www.revrobotics.com/brushless/','https://powerwerx.com/connectors','https://andymark.com/products/missing','https://www.mcmaster.com/products/91290a115/'])('does not treat category or missing detail as a product: %s', url => {
    const vendor=vendorForUrl(url)!; expect(load(vendor.id,'<h1>Browse products</h1>',url)().kind).toBe('not-product');
  });
});
describe('ProductGroup variant metadata', () => {
  const url='https://west3d.com/products/ldo-trident-kit';
  const variant=(id:string,name:string,sku:string,price:string)=>({'@type':'Product','@id':`/products/ldo-trident-kit?variant=${id}#variant`,name:`Kit - ${name}`,sku,offers:{'@type':'Offer',price,priceCurrency:'USD'}});
  const group={'@type':'ProductGroup',name:'Kit',hasVariant:[variant('111','250mm Black','BLACK','1199.00'),variant('222','300mm Blue','BLUE','1399.00')]};
  const page=(id:string,extra='')=>`<main><h1>Kit</h1><form action="/cart/add"><input type="hidden" name="id" value="${id}"></form></main>${ld(group)}${extra}`;
  it('uses the selected variant instead of reporting several products',()=>{
    expect(load('west3d',page('222'),url)()).toMatchObject({kind:'product',description:'Kit',sku:'BLUE',price:1399,currency:'USD'});
  });
  it('allows the base product published beside the group',()=>{
    expect(load('west3d',page('111',ld({'@type':'Product',name:'Kit',offers:{'@type':'AggregateOffer',lowPrice:'1199'}})),url)()).toMatchObject({kind:'product',sku:'BLACK',price:1199});
  });
  it('leaves price blank when the selected variant cannot be matched',()=>{
    expect(load('west3d',page('999'),url)()).toMatchObject({kind:'product',description:'Kit',sku:'',price:null});
  });
  it('still refuses a page listing unrelated products',()=>{
    expect(load('west3d',`<main><h1>Kit</h1></main>${ld(group)}${ld({'@type':'Product',name:'Other thing'})}`,url)()).toMatchObject({kind:'not-product'});
  });
});
describe('Home Depot displayed price', () => {
  const url='https://www.homedepot.com/p/screws/204282804';
  const meta=product('Screws 15-Pack','613302',1.18);
  const page=(price:string)=>`<h1>Screws 15-Pack</h1><div data-component="price:Price:v6"><div id="unit-case-price-includes"><div>Contains 15 pieces</div>${price}</div></div>${meta}`;
  it('uses the displayed price over stale metadata',()=>{
    expect(load('homedepot',page('<div><span>$</span><span>2</span><span>.</span><span>97</span></div><div>(20¢ /piece)</div>'),url)()).toMatchObject({kind:'product',sku:'613302',price:2.97,currency:'USD'});
  });
  it('ignores the amount after Save or Was',()=>{
    expect(load('homedepot',page('$2.97 Save $1.00 Was $3.97'),url)()).toMatchObject({price:2.97});
  });
  it('leaves a price range blank',()=>{
    expect(load('homedepot',page('$2.97 - $5.00'),url)()).toMatchObject({price:null});
  });
  it('leaves price blank rather than trusting metadata when nothing is displayed',()=>{
    expect(load('homedepot',`<h1>Screws 15-Pack</h1>${meta}`,url)()).toMatchObject({kind:'product',price:null});
  });
});
describe('error pages', () => {
  it('treats a store error page as blocked rather than a product',()=>{
    const run=load('homedepot','<h1>Something went wrong</h1>');document.title='Error Page';
    expect(run()).toMatchObject({kind:'blocked'});
  });
});
describe('host allowlist', () => {
  it('accepts the US AliExpress storefront',()=>expect(vendorForUrl('https://www.aliexpress.us/item/3256813388481271.html')?.label).toBe('Ali Express'));
  it.each(['https://aliexpress.us.evil.test/item/1.html','https://amazon.com.evil.test/dp/B0FQNPK1SQ','https://evilamazon.com','https://amazon.com@evil.test','https://amazon.com:8443','javascript:alert(1)','https://store.bambulab.com','https://eu.store.bambulab.com','https://ctr-electronics.com','https://example.com'])('rejects %s', url=>expect(vendorForUrl(url)).toBeUndefined());
  for(const v of VENDORS) it(`${v.label} matches its explicit hosts only`,()=>{ for(const h of v.hosts) expect(vendorForUrl(`https://${h}/`)?.label).toBe(v.label); });
});
