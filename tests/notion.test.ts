import { describe,it,expect,vi } from 'vitest';
const EXAMPLE_DATABASE_URL = 'https://www.notion.so/11111111222243338444555555555555?v=99999999999949998999999999999999';
import { mapSchema, notionId, validateDraft, pagePayload, NotionClient, NOTION_VERSION } from '../src/notion';
import { configuration, draft, source, databaseId, dataSourceId, response } from './helpers';
describe('Notion destination and schema',()=>{
  it('uses the database ID, never the view ID',async()=>{
    expect(notionId(EXAMPLE_DATABASE_URL)).toBe(databaseId);
    const transport=vi.fn().mockResolvedValueOnce(response({data_sources:[{id:dataSourceId,name:'Ordering'}]})).mockResolvedValueOnce(response(source()));
    const client=new NotionClient('fixture-token',transport);
    expect((await client.connect(EXAMPLE_DATABASE_URL)).dataSourceId).toBe(dataSourceId);
    expect(transport.mock.calls.map(c=>c[0])).toEqual([`https://api.notion.com/v1/databases/${databaseId}`,`https://api.notion.com/v1/data_sources/${dataSourceId}`]);
    expect(transport.mock.calls[0][1].headers['Notion-Version']).toBe(NOTION_VERSION);
  });
  it('retains property IDs across renames',()=>{
    const old=configuration().schema,s=source();s.properties.Renamed=s.properties['Item Description'];delete s.properties['Item Description'];
    expect(mapSchema(s,databaseId,old).properties.description.id).toBe(old.properties.description.id);
  });
  it('rejects incompatible fields, missing vendors and statuses without mutation',()=>{
    const s=source(); s.properties.Qty.type='rich_text';expect(()=>mapSchema(s,databaseId)).toThrow('Qty');
    const v=source();v.properties.Vendor.select.options.shift();expect(()=>mapSchema(v,databaseId)).toThrow('Amazon');
    const x=source();x.properties.Status.status.options=[];expect(()=>mapSchema(x,databaseId)).toThrow('NORMAL');
  });
  it('requires explicit choice when there are multiple data sources',async()=>{
    const fetch=vi.fn().mockResolvedValue(response({data_sources:[{id:'a',name:'A'},{id:'b',name:'B'}]}));
    await expect(new NotionClient('fixture',fetch).connect(EXAMPLE_DATABASE_URL)).rejects.toMatchObject({code:'data_source',details:[{id:'a',name:'A'},{id:'b',name:'B'}]});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['https://notion.so.evil.test/11111111222243338444555555555555','https://notion.com.evil.test/p/11111111222243338444555555555555','https://evilnotion.com/p/11111111222243338444555555555555','https://example.com/?v=11111111222243338444555555555555'])('rejects misleading destination %s',url=>expect(()=>notionId(url)).toThrow());
  it.each(['https://app.notion.com/p/11111111222243338444555555555555?v=99999999999949998999999999999999','https://www.notion.so/11111111222243338444555555555555?v=99999999999949998999999999999999','https://example-team.notion.site/11111111222243338444555555555555'])('reads the database ID from %s, ignoring the view',url=>expect(notionId(url)).toBe('11111111-2222-4333-8444-555555555555'));
});
describe('review validation and payload',()=>{
  it('normal request requires all fields except SKU; incomplete accepts only description and URL',()=>{
    expect(validateDraft(draft(),configuration())).toEqual([]);
    const incomplete={...draft(),status:'Incomplete Request' as const,team:'',recipient:'',quantity:null,price:null};
    expect(validateDraft(incomplete,configuration())).toEqual([]);
    expect(validateDraft({...incomplete,status:'NORMAL Request'},configuration())).toHaveLength(4);
  });
  it.each([{quantity:0},{quantity:-1},{quantity:NaN},{price:-1},{price:Infinity},{price:1,currencyConfirmed:false},{recipient:'unknown'},{team:'unknown'},{url:'https://example.com'}])('rejects invalid supplied values %j',change=>expect(validateDraft({...draft(),status:'Incomplete Request',...change},configuration()).length).toBeGreaterThan(0));
  it('derives edited URL vendor, preserves selection and sends properties only',()=>{
    const c=configuration(),d={...draft(),url:'https://andymark.com/products/robits-hex-shafts?variant=123#selected'};
    const payload=pagePayload(d,c);expect(payload.parent).toEqual({type:'data_source_id',data_source_id:dataSourceId});
    expect(payload.properties[c.schema.properties.vendor.id]).toEqual({select:{id:'vendor-3'}});
    expect(payload.properties[c.schema.properties.url.id]).toEqual({url:d.url});
    expect(payload).not.toHaveProperty('children');expect(payload).not.toHaveProperty('template');expect(payload.properties).not.toHaveProperty(c.schema.properties.total.id);
    expect(JSON.stringify(payload)).not.toContain('other');
  });
  it('supports existing status/select and team/multi_select types',()=>{
    const c=configuration();c.schema.properties.team.type='multi_select';c.schema.properties.status.type='select';
    const p=pagePayload(draft(),c).properties;expect(p[c.schema.properties.team.id]).toEqual({multi_select:[{id:'team1'}]});expect(p[c.schema.properties.status.id]).toEqual({select:{id:'normal'}});
  });
});
describe('recipients from existing requests',()=>{
  const row=(...people:unknown[])=>({properties:{Renamed:{id:configuration().schema.properties.recipient.id,type:'people',people},Other:{id:'x',type:'title',title:[]}}});
  const run=(fetch:typeof globalThis.fetch,pages?:number)=>new NotionClient('fixture',fetch).recipientsFromRequests(configuration().schema,pages);
  it('collects guests across pages, once each, and never bots',async()=>{
    const fetch=vi.fn()
      .mockResolvedValueOnce(response({results:[row({id:'guest',name:'Guest Student',type:'person'}),row({id:'guest',name:'Guest Student'},{id:'bot',type:'bot'}),row()],has_more:true,next_cursor:'next'}))
      .mockResolvedValueOnce(response({results:[row({id:'other',name:'Other Guest'})],has_more:false}));
    expect(await run(fetch)).toEqual({requests:4,people:[{id:'guest',name:'Guest Student'},{id:'other',name:'Other Guest'}]});
    expect(fetch.mock.calls[0][0]).toBe(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`);
    expect(fetch.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({page_size:100,start_cursor:'next'});
  });
  it('matches the property when Notion encodes its ID differently',async()=>{
    const c=configuration();c.schema.properties.recipient.id='a:b';
    const fetch=vi.fn().mockResolvedValue(response({results:[{properties:{Who:{id:'a%3Ab',type:'people',people:[{id:'g',name:'Guest'}]}}}],has_more:false}));
    expect((await new NotionClient('fixture',fetch).recipientsFromRequests(c.schema)).people).toEqual([{id:'g',name:'Guest'}]);
  });
  it('looks up a name Notion left out, and keeps the person if the lookup fails',async()=>{
    const fetch=vi.fn()
      .mockResolvedValueOnce(response({results:[row({id:'a'},{id:'b'})],has_more:false}))
      .mockResolvedValueOnce(response({id:'a',name:'Named Later'}))
      .mockResolvedValueOnce(response({message:'no'},404));
    expect((await run(fetch)).people).toEqual([{id:'a',name:'Named Later'},{id:'b',name:'Unnamed Notion user'}]);
  });
  it('stops at the page limit',async()=>{
    const fetch=vi.fn().mockImplementation(async()=>response({results:[],has_more:true,next_cursor:'again'}));
    await run(fetch,3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('never retries or treats a read failure as an uncertain create',async()=>{
    const fetch=vi.fn().mockResolvedValue(response({message:'down'},503));
    await expect(run(fetch)).rejects.toMatchObject({uncertain:false});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
describe('guest recipients and API failures',()=>{
  it('imports guests from the mapped people property, independent of /users results',async()=>{
    const c=configuration(),fetch=vi.fn().mockResolvedValueOnce(response({results:[{id:'bot',type:'bot'},{id:'member',type:'person',name:'Member',person:{email:'not-returned@example.com'}}],has_more:false})).mockResolvedValueOnce(response({id:databaseId,parent:{data_source_id:dataSourceId},properties:{Renamed:{id:c.schema.properties.recipient.id,type:'people',people:[{id:'guest'}]}}})).mockResolvedValueOnce(response({id:'guest',name:'Guest Student',type:'person'}));
    const client=new NotionClient('fixture',fetch);expect(await client.members()).toEqual([{id:'member',name:'Member'}]);
    expect(await client.peopleFromPage(EXAMPLE_DATABASE_URL,c.schema)).toEqual([{id:'guest',name:'Guest Student'}]);
  });
  it('rejects recipient import from another database',async()=>{
    const fetch=vi.fn().mockResolvedValue(response({parent:{data_source_id:'other'},properties:{}}));
    await expect(new NotionClient('fixture',fetch).peopleFromPage(EXAMPLE_DATABASE_URL,configuration().schema)).rejects.toThrow('configured ordering database');
  });
  it.each([401,403,404,400,429,409,500,503])('classifies HTTP %i and never retries POST',async status=>{
    const fetch=vi.fn().mockResolvedValue(response({},status,{'Retry-After':'3'}));
    await expect(new NotionClient('fixture',fetch).create(draft(),configuration())).rejects.toMatchObject({code:`notion_${status}`,uncertain:status>=500||status===409});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('treats timeout, broken JSON and missing page link as uncertain',async()=>{
    for(const fetch of [vi.fn().mockRejectedValue(new Error('network')),vi.fn().mockResolvedValue(new Response('{bad')),vi.fn().mockResolvedValue(response({url:'javascript:bad'}))]){
      await expect(new NotionClient('fixture',fetch).create(draft(),configuration())).rejects.toMatchObject({uncertain:true});expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it('returns a confirmed Notion link',async()=>{
    const fetch=vi.fn().mockResolvedValue(response({url:'https://www.notion.so/new-request'}));
    expect(await new NotionClient('fixture',fetch).create(draft(),configuration())).toBe('https://www.notion.so/new-request');
    expect(fetch.mock.calls[0][1]).toMatchObject({method:'POST',credentials:'omit',redirect:'error'});
  });
  it('calls the browser fetch without a receiver, as Chrome requires',async()=>{
    vi.stubGlobal('fetch',function(this:unknown){
      if(this!==undefined&&this!==globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(response({url:'https://www.notion.so/new-request'}));
    });
    try {
      expect(await new NotionClient('fixture').create(draft(),configuration())).toBe('https://www.notion.so/new-request');
    } finally { vi.unstubAllGlobals(); }
  });
  it('accepts a created page link on app.notion.com',async()=>{
    const fetch=vi.fn().mockResolvedValue(response({url:'https://app.notion.com/p/new-request'}));
    expect(await new NotionClient('fixture',fetch).create(draft(),configuration())).toBe('https://app.notion.com/p/new-request');
  });
  it('treats a created page link on another host as uncertain',async()=>{
    const fetch=vi.fn().mockResolvedValue(response({url:'https://notion.com.evil.test/p/new-request'}));
    await expect(new NotionClient('fixture',fetch).create(draft(),configuration())).rejects.toMatchObject({uncertain:true});
  });
});
