import { describe, expect, it } from 'vitest';
import { VARIANT_REASON, pageReasons } from '../src/express';
import { deviceOptions, record } from './helpers';

const NO_SKU = 'SKU was not confirmed; it is optional.';
const parts = (capture = {}, draft = {}) => { const r = record(); return [{ ...r.capture, ...capture }, { ...r.draft, quantity: 1, ...draft }] as const; };
const codes = (capture = {}, draft = {}, options: ReturnType<typeof deviceOptions> | undefined = deviceOptions()) => { const [c, d] = parts(capture, draft); return pageReasons(c, d, options).map(r => r.code); };

describe('what stops an Express send',()=>{
  it('nothing, when everything was read from the page',()=>{expect(codes()).toEqual([]);});
  it('not a missing SKU alone',()=>{expect(codes({sku:'',issues:[NO_SKU]},{sku:''})).toEqual([]);});
  it('a missing price, naming it once',()=>{expect(codes({price:null,currency:'',issues:['Unit price needs your review.']})).toEqual(['price']);});
  it('a price of zero',()=>{expect(codes({price:0})).toEqual(['price']);});
  it('an unselected option, using the approved wording and not also a price reason',()=>{
    const [c,d]=parts({price:null,issues:['Select all product options on the store page, or enter the exact variant and price manually.','Unit price needs your review.',NO_SKU]},{price:null});
    const reasons=pageReasons(c,d,deviceOptions());expect(reasons.map(r=>r.code)).toEqual(['variant']);expect(reasons[0].text).toBe(VARIANT_REASON);
  });
  it.each(['Select a stock length, or enter the exact custom-cut description and quoted unit price manually.','Confirm the selected printer or accessory variant and enter its price manually.','Custom kit options can change the price. Enter the displayed configured unit price manually.'])('the store-specific option notice: %s',issue=>{
    const [c,d]=parts({price:null,issues:[issue]},{price:null});const reasons=pageReasons(c,d,deviceOptions());expect(reasons.map(r=>r.code)).toEqual(['variant']);expect(reasons[0].text).toBe(issue);
  });
  it('another currency, showing what the page says',()=>{
    const [c,d]=parts({currency:'EUR',price:19.5,issues:['Price is in EUR. Enter a USD price and confirm it before submitting.']},{currencyConfirmed:false});
    const reasons=pageReasons(c,d,deviceOptions());expect(reasons.map(r=>r.code)).toEqual(['currency']);expect(reasons[0].text).toBe('The page shows EUR 19.50, not USD. Enter the USD price and confirm it.');
  });
  it('a currency that couldn\'t be confirmed',()=>{expect(codes({currency:'',issues:['Currency could not be confirmed. Enter a USD price and confirm it before submitting.']})).toEqual(['currency']);});
  it('any issue the reader raises that isn\'t the optional SKU',()=>{expect(codes({issues:['Confirm the price and selling unit on McMaster.',NO_SKU]})).toEqual(['issue']);});
  it('a missing description',()=>{expect(codes({description:' '})).toEqual(['description']);expect(codes({},{description:' '})).toEqual(['description']);});
  it('a page that isn\'t a product',()=>{expect(codes({kind:'not-product'})).toEqual(['issue']);});
  it('an unsupported URL',()=>{expect(codes({},{url:'https://amazon.com.evil.example.test/x'})).toEqual(['issue']);});
  it('no default team or person',()=>{expect(codes({},{team:''})).toEqual(['defaults']);expect(codes({},{recipient:''})).toEqual(['defaults']);});
  it('defaults no longer on the list, or no list at all',()=>{expect(codes({},{team:'gone'})).toEqual(['defaults']);expect(codes({},{recipient:'gone'})).toEqual(['defaults']);const [c,d]=parts();expect(pageReasons(c,d,undefined).map(r=>r.code)).toContain('defaults');});
  it('a quantity other than 1, or any other status',()=>{expect(codes({},{quantity:2})).toEqual(['issue']);expect(codes({},{status:'Incomplete Request'})).toEqual(['issue']);});
  it('every reason at once, all listed',()=>{
    expect(codes({price:null,currency:'EUR',issues:['Select all product options on the store page, or enter the exact variant and price manually.','Confirm the price and selling unit on McMaster.']},{team:'',recipient:''})).toEqual(['variant','currency','issue','defaults']);
  });
});
