import { describe,it,expect,vi } from 'vitest';
import { PluginClient,safePageUrl,wireDraft } from '../src/client';
import { validateDraft } from '../src/validate';
import { API,DEVICE_KEY,SITE,SUBMISSION_ID,deviceOptions,draft,response } from './helpers';
const client=(reply:Response|Error)=>{const fetch=vi.fn(async()=>{if(reply instanceof Error)throw reply;return reply;});return {fetch,api:new PluginClient(SITE,DEVICE_KEY,fetch as unknown as typeof globalThis.fetch)};};
const created={submissionId:SUBMISSION_ID,state:'created',pageUrl:'https://app.notion.com/p/new-request',repeats:[]};
describe('calling the device API',()=>{
  it('sends the bearer key to the site\'s /api route, with no cookies and no redirects',async()=>{
    const {fetch,api}=client(response(created,201));await api.create(SUBMISSION_ID,draft());
    const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe(`${API}/requests`);
    expect(init).toMatchObject({method:'POST',credentials:'omit',redirect:'error',headers:{Authorization:`Bearer ${DEVICE_KEY}`}});
    expect(JSON.parse(init.body as string)).toEqual({submissionId:SUBMISSION_ID,draft:draft()});
  });
  it('sends exactly the draft fields the plugin accepts',async()=>{
    const extra={...draft(),vendor:'REV',stray:1} as ReturnType<typeof draft>;
    expect(Object.keys(wireDraft(extra)).sort()).toEqual(['currencyConfirmed','description','price','quantity','recipient','sku','status','team','url']);
  });
  it('calls the browser fetch without a receiver, as Chrome requires',async()=>{
    vi.stubGlobal('fetch',function(this:unknown){
      if(this!==undefined&&this!==globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(response(created,201));
    });
    try {
      expect(await new PluginClient(SITE,DEVICE_KEY).create(SUBMISSION_ID,draft())).toMatchObject({kind:'created'});
    } finally { vi.unstubAllGlobals(); }
  });
  it('pairs without a key and refuses an answer that is not a device key',async()=>{
    const good=client(response({deviceKey:DEVICE_KEY,memberName:'Test Student A'},201));
    expect(await new PluginClient(SITE,undefined,good.fetch as unknown as typeof fetch).pair('K7M29QXP','Shop laptop')).toEqual({deviceKey:DEVICE_KEY,memberName:'Test Student A'});
    expect((good.fetch.mock.calls[0] as unknown as [string,RequestInit])[1].headers).not.toHaveProperty('Authorization');
    const bad=client(new Response('<html>not the plugin</html>',{status:200}));
    await expect(new PluginClient(SITE,undefined,bad.fetch as unknown as typeof fetch).pair('K7M29QXP','')).rejects.toMatchObject({code:'not_a_site'});
  });
  it.each([['pin_refused',401],['pin_malformed',400],['device_limit',409],['pairing_paused',429]])('reports the pairing refusal %s',async(code,status)=>{
    const {fetch}=client(response({error:`message for ${code}`,code},status as number));
    await expect(new PluginClient(SITE,undefined,fetch as unknown as typeof globalThis.fetch).pair('K7M29QXP','')).rejects.toMatchObject({code,message:`message for ${code}`});
  });
  it('reads teams and recipients, tolerating junk rows',async()=>{
    const {api}=client(response({memberName:'Test Student A',teams:[{id:'t',name:'T'},null,{name:'no id'}],recipients:[{id:'p',name:'P'}],defaultRecipientId:'p',statuses:[],vendors:[],recipientsUpdatedMs:null}));
    expect(await api.options()).toEqual({memberName:'Test Student A',teams:[{id:'t',name:'T'}],recipients:[{id:'p',name:'P'}],defaultRecipientId:'p',recipientsUpdatedMs:null,minimumExtensionVersion:null,updateUrl:null,databaseLink:null});
  });
  const options=(extra:Record<string,unknown>)=>client(response({memberName:'x',teams:[],recipients:[],...extra})).api.options();
  it('keeps the minimum version, update link and database link when they are what they should be',async()=>{
    expect(await options({minimumExtensionVersion:'0.10.0',updateUrl:'https://github.com/isriah/lancerlogin-part-requests-extension/releases',databaseLink:'https://www.notion.so/11111111222243338444555555555555'})).toMatchObject({minimumExtensionVersion:'0.10.0',updateUrl:'https://github.com/isriah/lancerlogin-part-requests-extension/releases',databaseLink:'https://www.notion.so/11111111222243338444555555555555'});
  });
  it.each([
    ['minimumExtensionVersion','latest'],['minimumExtensionVersion',5],
    ['updateUrl','http://downloads.example.test/x'],['updateUrl','javascript:alert(1)'],['updateUrl','https://user:pass@downloads.example.test/x'],
    ['databaseLink','https://notion.so.evil.example.test/x'],['databaseLink','https://evilnotion.so/x'],['databaseLink','http://www.notion.so/x'],['databaseLink','javascript:alert(1)'],
  ])('drops a bad %s: %j',async(field,value)=>{expect((await options({[field]:value}))[field as 'databaseLink']).toBeNull();});
  it('self-revoke posts the key with no body, and is true only for a confirmed answer',async()=>{
    const good=client(response({revoked:true}));expect(await good.api.revokeSelf()).toBe(true);
    const [url,init]=good.fetch.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe(`${API}/devices/self/revoke`);expect(init).toMatchObject({method:'POST',credentials:'omit',redirect:'error',headers:{Authorization:`Bearer ${DEVICE_KEY}`}});expect(init.body).toBeUndefined();
    for(const reply of [response({code:'rate_limited',error:'Wait.'},429),response({code:'update_maintenance'},503),response({},200),new Response('<html>',{status:200})]) expect(await client(reply).api.revokeSelf()).toBe(false);
    await expect(client(new Error('offline')).api.revokeSelf()).rejects.toMatchObject({code:'network'});
    await expect(client(response({code:'pair_again',error:'x'},401)).api.revokeSelf()).rejects.toMatchObject({code:'pair_again'});
  });
  it('turns 401 on any keyed call into pair_again',async()=>{
    for(const call of [(a:PluginClient)=>a.options(),(a:PluginClient)=>a.check('https://www.revrobotics.com/x/',''),(a:PluginClient)=>a.saveRecipient('p'),(a:PluginClient)=>a.create(SUBMISSION_ID,draft()),(a:PluginClient)=>a.recorded(SUBMISSION_ID)]){
      await expect(call(client(response({error:'No longer paired.',code:'pair_again'},401)).api)).rejects.toMatchObject({code:'pair_again',notRecorded:true,message:'No longer paired.'});
    }
  });
  it('keeps who and when from the repeat check, and only Notion links',async()=>{
    const {api}=client(response({repeats:[{memberName:'Test Student B',createdMs:5,pageUrl:'https://www.notion.so/x',state:'created'},{memberName:'Test Student C',createdMs:6,pageUrl:'https://evil.test/x',state:'created'},{nope:1}]}));
    expect(await api.check('https://www.revrobotics.com/x/','')).toEqual([{memberName:'Test Student B',createdMs:5,pageUrl:'https://www.notion.so/x',state:'created'},{memberName:'Test Student C',createdMs:6,pageUrl:null,state:'created'}]);
  });
});
describe('every result of POST /requests',()=>{
  const outcome=(reply:Response|Error)=>client(reply).api.create(SUBMISSION_ID,draft());
  it('201 and 200 replay are created',async()=>{
    expect(await outcome(response(created,201))).toMatchObject({kind:'created',pageUrl:created.pageUrl});
    expect(await outcome(response({...created,replayed:true},200))).toMatchObject({kind:'created'});
  });
  it('202 pending and uncertain',async()=>{
    expect(await outcome(response({state:'pending'},202))).toEqual({kind:'pending'});
    expect(await outcome(response({state:'uncertain',error:'Check it.',code:'notion_uncertain'},202))).toEqual({kind:'uncertain',message:'Check it.'});
  });
  it('502 failed',async()=>{expect(await outcome(response({state:'failed',error:'Refused.',code:'notion_400'},502))).toEqual({kind:'failed',message:'Refused.',code:'notion_400'});});
  it('400 validation joins its errors and records nothing',async()=>{expect(await outcome(response({code:'validation',error:'x',errors:['One.','Two.']},400))).toMatchObject({kind:'refused',code:'validation',message:'One. Two.'});});
  it('409 is a conflict, which may mean a request exists',async()=>{expect(await outcome(response({code:'submission_conflict',error:'x'},409))).toMatchObject({kind:'conflict'});});
  it('429 records nothing and carries the wait',async()=>{expect(await outcome(response({code:'rate_limited',error:'Wait.',retryAfterSeconds:120},429,{'Retry-After':'120'}))).toEqual({kind:'refused',code:'rate_limited',message:'Wait.',retryAfterSeconds:120});});
  it.each(['notion_not_connected','notion_schema_changed','credentials_unavailable','credentials_unreadable'])('503 %s needs an Admin and is not retried',async code=>{expect(await outcome(response({code,error:'Ask an Admin.'},503))).toMatchObject({kind:'refused',code,message:'Ask an Admin.'});});
  it('503 update_maintenance gives the wait',async()=>{
    expect(await outcome(response({code:'update_maintenance',error:'x'},503,{'Retry-After':'30'}))).toEqual({kind:'maintenance',retryAfterSeconds:30});
    expect(await outcome(response({code:'update_maintenance',error:'x'},503))).toEqual({kind:'maintenance',retryAfterSeconds:30});
  });
  it('a network failure, a 500, a broken body and an unexpected 200 are all no answer',async()=>{
    for(const reply of [new Error('network'),response({error:'boom'},500),new Response('<html>',{status:502}),new Response('{bad',{status:200}),response({},200)]) expect(await outcome(reply)).toMatchObject({kind:'no-answer'});
  });
  it('a created result without a Notion link is uncertain, not success',async()=>{
    for(const pageUrl of ['javascript:bad','https://notion.com.evil.test/p/x',null]) expect(await outcome(response({state:'created',pageUrl},201))).toMatchObject({kind:'uncertain'});
  });
  it('accepts page links on notion.so and notion.com only',()=>{
    expect(safePageUrl('https://app.notion.com/p/x')).toBe('https://app.notion.com/p/x');
    expect(safePageUrl('https://www.notion.so/x')).toBe('https://www.notion.so/x');
    expect(safePageUrl('http://www.notion.so/x')).toBeNull();
    expect(safePageUrl('https://evilnotion.com/x')).toBeNull();
  });
  it('reading a result distinguishes no record from a recorded state',async()=>{
    expect(await client(response({code:'not_found',error:'x'},404)).api.recorded(SUBMISSION_ID)).toBeUndefined();
    expect(await client(response({state:'created',pageUrl:created.pageUrl,replayed:true})).api.recorded(SUBMISSION_ID)).toMatchObject({kind:'created'});
  });
});
describe('review validation',()=>{
  it('normal request requires all fields except SKU; incomplete accepts only description and URL',()=>{
    expect(validateDraft(draft(),deviceOptions())).toEqual([]);
    const incomplete={...draft(),status:'Incomplete Request' as const,team:'',recipient:'',quantity:null,price:null};
    expect(validateDraft(incomplete,deviceOptions())).toEqual([]);
    expect(validateDraft({...incomplete,status:'NORMAL Request'},deviceOptions())).toHaveLength(4);
  });
  it.each([{quantity:0},{quantity:-1},{quantity:NaN},{quantity:2_000_000_000},{price:-1},{price:Infinity},{price:1,currencyConfirmed:false},{recipient:'unknown'},{team:'unknown'},{url:'https://example.com'}])('rejects invalid supplied values %j',change=>expect(validateDraft({...draft(),status:'Incomplete Request',...change},deviceOptions()).length).toBeGreaterThan(0));
  it('leaves list checks to the server until the lists are known',()=>expect(validateDraft({...draft(),team:'saved',recipient:'saved'},undefined)).toEqual([]));
});
