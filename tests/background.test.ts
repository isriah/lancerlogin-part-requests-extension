import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { API,DEVICE_KEY,SITE,deviceOptions,record,response } from './helpers';
import type { Message } from '../src/types';
let values: Record<string,any>,listener: (m:Message,s:any,r:(v:any)=>void)=>boolean,chromeMock:any,hasPermission:boolean;
const sender={id:'extension-id',url:'chrome-extension://extension-id/popup.html'};
const call=(message:Message,origin=sender)=>new Promise<any>(resolve=>listener(message,origin,resolve));
const created=(extra={})=>response({state:'created',pageUrl:'https://www.notion.so/new-request',repeats:[],...extra},201);
const fetchMock=()=>fetch as unknown as ReturnType<typeof vi.fn>;
const bodyOf=(n:number)=>JSON.parse(fetchMock().mock.calls[n][1].body);
const site={origin:SITE,memberName:'Test Student A',deviceLabel:'Shop laptop',pairedAt:1};
function send(...replies:(Response|Error)[]){let n=0;vi.stubGlobal('fetch',vi.fn(async()=>{const reply=replies[Math.min(n++,replies.length-1)];if(reply instanceof Error)throw reply;return reply.clone();}));}
beforeEach(async()=>{
  vi.resetModules();hasPermission=true;values={site,deviceKey:DEVICE_KEY,options:deviceOptions(),defaultTeam:'team1'};
  chromeMock={storage:{local:{setAccessLevel:vi.fn(async()=>{}),get:vi.fn(async(key:string|null)=>structuredClone(key===null?values:{[key]:values[key]})),set:vi.fn(async(data:Record<string,unknown>)=>Object.assign(values,structuredClone(data))),remove:vi.fn(async(keys:string|string[])=>{for(const key of [keys].flat())delete values[key];})}},permissions:{contains:vi.fn(async()=>hasPermission),remove:vi.fn(async()=>true)},runtime:{id:'extension-id',getManifest:()=>({optional_host_permissions:['https://*/*']}),getURL:(p:string)=>`chrome-extension://extension-id/${p}`,onMessage:{addListener:(l:typeof listener)=>{listener=l;}}},tabs:{get:vi.fn(async()=>({id:42,url:record().draft.url}))},scripting:{executeScript:vi.fn(async()=>[{result:record().capture}])}};
  vi.stubGlobal('chrome',chromeMock);send(created());
  await import('../src/background');
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('service worker message flow',()=>{
  it('restricts key storage and rejects page-origin messages',async()=>{
    expect(chromeMock.storage.local.setAccessLevel).toHaveBeenCalledWith({accessLevel:'TRUSTED_CONTEXTS'});
    expect(await call({type:'settings'},{id:'extension-id',url:'https://www.revrobotics.com/rev-21-1651/'})).toMatchObject({ok:false});
    const settings=await call({type:'settings'});expect(settings.data.pairing).toBe('paired');expect(JSON.stringify(settings)).not.toContain(DEVICE_KEY);
  });
  it('captures only clicked tab and restores an edited draft while the page shows the same option',async()=>{
    const first=await call({type:'capture',tabId:42});const draft=first.data.record;draft.draft.description='My edits';draft.updatedAt++;
    expect(draft.draft.team).toBe('team1');expect(draft.draft.recipient).toBe('person1');
    await call({type:'save-draft',record:draft});const second=await call({type:'capture',tabId:42});
    expect(second.data.record.draft.description).toBe('My edits');expect(second.data.record.submissionId).toBe(draft.submissionId);
    expect(chromeMock.scripting.executeScript).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(chromeMock.scripting.executeScript.mock.calls)).not.toContain(DEVICE_KEY);
    expect(await call({type:'discard',key:draft.key})).toMatchObject({ok:true});expect(values[`draft:${draft.key}`]).toBeUndefined();
  });
  // REV and other BigCommerce stores change the option in place: the address, and so the draft's key, stays the same.
  const reselect=(extra:Record<string,unknown>)=>{chromeMock.scripting.executeScript=vi.fn(async()=>[{result:{...record().capture,...extra}}]);};
  it('reads the page again when the option on it changed, so an untouched draft follows the selection',async()=>{
    reselect({description:'5mm Hex Shafts',sku:'',price:null,variants:[],issues:['Select all product options on the store page, or enter the exact variant and price manually.']});
    const first=(await call({type:'capture',tabId:42})).data.record;expect(first.draft.sku).toBe('');
    reselect({description:'5mm Hex Shafts - 5mm x 90mm Hex Shaft - 4 Pack',sku:'REV-41-1348-PK4',price:14.75,variants:['5mm x 90mm Hex Shaft - 4 Pack'],issues:[]});
    const second=(await call({type:'capture',tabId:42})).data.record;
    expect(second.draft).toMatchObject({description:'5mm Hex Shafts - 5mm x 90mm Hex Shaft - 4 Pack',sku:'REV-41-1348-PK4',price:14.75,quantity:1});
    expect(second.submissionId).not.toBe(first.submissionId);expect(second.edited).toBeUndefined();expect(values[`draft:${first.key}`].draft.sku).toBe('REV-41-1348-PK4');
    const third=(await call({type:'capture',tabId:42})).data.record;expect(third.submissionId).toBe(second.submissionId);
  });
  it('replaces the option fields of an edited draft when the option changed, keeps the rest, and says so',async()=>{
    reselect({description:'5mm Hex Shafts - 5mm x 90mm Hex Shaft - 4 Pack',sku:'REV-41-1348-PK4',price:14.75,variants:['5mm x 90mm Hex Shaft - 4 Pack']});
    const first=(await call({type:'capture',tabId:42})).data.record;
    await call({type:'save-draft',record:{...first,updatedAt:first.updatedAt+1,draft:{...first.draft,quantity:3,status:'Incomplete Request',description:'typed'}}});
    reselect({description:'5mm Hex Shafts - 5mm x 135mm Hex Shaft - 4 Pack',sku:'REV-41-1349-PK4',price:17.5,variants:['5mm x 135mm Hex Shaft - 4 Pack']});
    const second=(await call({type:'capture',tabId:42})).data.record;
    expect(second.draft).toMatchObject({description:'5mm Hex Shafts - 5mm x 135mm Hex Shaft - 4 Pack',sku:'REV-41-1349-PK4',price:17.5,quantity:3,status:'Incomplete Request',team:'team1'});
    expect(second.edited).toBe(true);expect(second.capture.issues[0]).toMatch(/option chosen on the store page changed/);
  });
  // WCP lists parts as checkboxes on one address. Ticking a second part, or none, leaves no single part to request.
  it('shows the page\'s request for one choice instead of a draft for a part no longer chosen, and keeps that draft',async()=>{
    reselect({description:'10t Steel Double Hub Sprocket',sku:'WCP-1019',price:9.99,variants:[],issues:[]});
    const first=(await call({type:'capture',tabId:42})).data.record;
    await call({type:'save-draft',record:{...first,updatedAt:first.updatedAt+1,draft:{...first.draft,quantity:4}}});
    reselect({kind:'not-product',needsChoice:true,description:'',sku:'',price:null,variants:[],issues:['Select exactly one part checkbox on WCP, then reopen the extension. Do not add it to the cart.']});
    const second=(await call({type:'capture',tabId:42})).data;
    expect(second.record).toBeUndefined();expect(second.capture).toMatchObject({kind:'not-product',needsChoice:true});
    expect(values[`draft:${first.key}`].draft.quantity).toBe(4);
    reselect({description:'10t Steel Double Hub Sprocket',sku:'WCP-1019',price:9.99,variants:[],issues:[]});
    const third=(await call({type:'capture',tabId:42})).data.record;expect(third.submissionId).toBe(first.submissionId);expect(third.draft.quantity).toBe(4);
    // A page that isn't readable for another reason, such as one still loading, keeps showing the draft.
    reselect({kind:'not-product',description:'',sku:'',price:null,variants:[],issues:['Open a specific product page from this store.']});
    expect((await call({type:'capture',tabId:42})).data.record.submissionId).toBe(first.submissionId);
  });
  it('captures and keeps drafts while unpaired, and refuses to send',async()=>{
    delete values.site;delete values.deviceKey;delete values.options;delete values.defaultTeam;
    const first=await call({type:'capture',tabId:42});expect(first.ok).toBe(true);expect(first.data.record.draft.team).toBe('');
    expect(await call({type:'submit',key:first.data.record.key,submissionId:first.data.record.submissionId})).toMatchObject({ok:false,code:'pair_again'});
    expect(fetch).not.toHaveBeenCalled();expect(values[`draft:${first.data.record.key}`]).toBeDefined();
  });
  it('preserves the latest edit when messages arrive out of order',async()=>{
    const r=record();values[`draft:${r.key}`]=r;
    await Promise.all([call({type:'save-draft',record:{...r,updatedAt:3,draft:{...r.draft,description:'Latest'}}}),call({type:'save-draft',record:{...r,updatedAt:2,draft:{...r.draft,description:'Older'}}})]);
    expect(values[`draft:${r.key}`].draft.description).toBe('Latest');
  });
  it('creates once with the submission ID, clears the draft, and keeps a receipt after popup closure and worker restart',async()=>{
    const r=record();values[`draft:${r.key}`]=r;const message:Message={type:'submit',key:r.key,submissionId:r.submissionId};
    const results=await Promise.all([call(message),call(message)]);expect(results[0].data.state).toBe('success');expect(results.filter(x=>x.ok).every(x=>x.data.state==='success')).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetchMock().mock.calls[0][0]).toBe(`${API}/requests`);expect(fetchMock().mock.calls[0][1].headers.Authorization).toBe(`Bearer ${DEVICE_KEY}`);
    expect(bodyOf(0)).toEqual({submissionId:r.submissionId,draft:r.draft});
    expect(values[`draft:${r.key}`]).toBeUndefined();
    vi.resetModules();await import('../src/background');
    expect((await call(message)).data.state).toBe('success');
    const reopened=await call({type:'capture',tabId:42});expect(reopened.data.submission.state).toBe('success');expect(fetch).toHaveBeenCalledTimes(1);expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('requires explicit confirmation before retrying an uncertain outcome',async()=>{
    const r=record();values[`draft:${r.key}`]=r;values[`submission:${r.submissionId}`]={id:r.submissionId,draftKey:r.key,state:'uncertain',recorded:true,updatedAt:Date.now()-60_000};
    expect((await call({type:'restart',key:r.key,acknowledgeUncertain:false})).ok).toBe(false);
    const result=await call({type:'restart',key:r.key,acknowledgeUncertain:true});expect(result.data.submissionId).not.toBe(r.submissionId);expect(result.data.draft).toEqual(r.draft);expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps the same ID for a retry when the server never stated a result',async()=>{
    const r=record();values[`draft:${r.key}`]=r;values[`submission:${r.submissionId}`]={id:r.submissionId,draftKey:r.key,state:'uncertain',recorded:false,updatedAt:Date.now()};
    expect((await call({type:'restart',key:r.key,acknowledgeUncertain:false})).ok).toBe(false);
    const result=await call({type:'restart',key:r.key,acknowledgeUncertain:true});expect(result.data.submissionId).toBe(r.submissionId);expect(values[`submission:${r.submissionId}`]).toBeUndefined();expect(fetch).not.toHaveBeenCalled();
  });
  it('does not clear pending work or allow submission from an unsupported edited URL',async()=>{
    const r=record();r.draft.url='https://unsupported.test';values[`draft:${r.key}`]=r;
    expect((await call({type:'submit',key:r.key,submissionId:r.submissionId})).ok).toBe(false);expect(fetch).not.toHaveBeenCalled();
    values[`submission:${r.submissionId}`]={state:'pending'};expect((await call({type:'discard',key:r.key})).ok).toBe(false);
  });
});
describe('sending through the plugin',()=>{
  const start=()=>{const r=record();values[`draft:${r.key}`]=r;return {r,message:{type:'submit',key:r.key,submissionId:r.submissionId} as Message};};
  const maintenance=(seconds='30')=>response({code:'update_maintenance',error:'Updating.'},503,{'Retry-After':seconds});
  it('waits out maintenance and resends the same ID, reporting that the site is updating',async()=>{
    vi.useFakeTimers();const {r,message}=start();send(maintenance('30'),maintenance('30'),created());
    const result=call(message);
    await vi.advanceTimersByTimeAsync(1000);expect(fetch).toHaveBeenCalledTimes(1);expect(values[`submission:${r.submissionId}`].message).toContain('updating');
    await vi.advanceTimersByTimeAsync(30_000);expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);expect((await result).data.state).toBe('success');expect(fetch).toHaveBeenCalledTimes(3);
    expect(new Set([0,1,2].map(n=>bodyOf(n).submissionId))).toEqual(new Set([r.submissionId]));
  });
  it('gives up on maintenance after a limited number of tries, keeping the draft and the ID',async()=>{
    vi.useFakeTimers();const {r,message}=start();send(maintenance('1'));
    const result=call(message);await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toMatchObject({ok:false,code:'update_maintenance'});expect(fetch).toHaveBeenCalledTimes(5);
    expect(values[`submission:${r.submissionId}`]).toBeUndefined();expect(values[`draft:${r.key}`].submissionId).toBe(r.submissionId);
  });
  it('caps a very long Retry-After',async()=>{
    vi.useFakeTimers();const {message}=start();send(maintenance('99999'),created());
    const result=call(message);await vi.advanceTimersByTimeAsync(120_500);expect((await result).data.state).toBe('success');
  });
  it('never resends an uncertain or unanswered result',async()=>{
    for(const reply of [response({state:'uncertain',error:'Check.'},202),response({error:'boom'},500),new Error('offline')]){
      const {message}=start();send(reply);
      const result=await call(message);expect(result.data.state).toBe('uncertain');expect(fetch).toHaveBeenCalledTimes(1);
      values={site,deviceKey:DEVICE_KEY,options:deviceOptions()};
    }
  });
  it('a recorded uncertain answer uses up the ID; no answer does not',async()=>{
    let {r,message}=start();send(response({state:'uncertain',error:'Check.'},202));
    expect((await call(message)).data.recorded).toBe(true);
    values={site,deviceKey:DEVICE_KEY,options:deviceOptions()};({r,message}=start());send(new Error('offline'));
    expect((await call(message)).data.recorded).toBe(false);expect(r.submissionId).toBeTruthy();
  });
  it('asks about a request still running instead of sending it again',async()=>{
    vi.useFakeTimers();const {r,message}=start();send(response({state:'pending'},202),response({state:'pending'},202),response({state:'created',pageUrl:'https://www.notion.so/new-request',replayed:true}));
    const result=call(message);await vi.advanceTimersByTimeAsync(4100);expect((await result).data.state).toBe('success');
    expect(fetchMock().mock.calls.map(c=>c[1].method)).toEqual(['POST','GET','GET']);expect(fetchMock().mock.calls[1][0]).toBe(`${API}/requests/${r.submissionId}`);
  });
  it('reads the recorded result of a request left behind by a stopped worker, without resending it',async()=>{
    const {r}=start();values[`submission:${r.submissionId}`]={id:r.submissionId,draftKey:r.key,state:'pending',updatedAt:Date.now()-60_000};
    send(response({state:'created',pageUrl:'https://www.notion.so/found',replayed:true}));
    const reopened=await call({type:'capture',tabId:42});expect(reopened.data.submission).toMatchObject({state:'success',pageUrl:'https://www.notion.so/found'});
    expect(fetchMock().mock.calls.map(c=>c[1].method)).toEqual(['GET']);expect(values[`draft:${r.key}`]).toBeUndefined();expect(values[`receipt:${r.key}`]).toBeDefined();
  });
  it('a request the site never recorded can be sent again with the same ID, by choice',async()=>{
    const {r}=start();values[`submission:${r.submissionId}`]={id:r.submissionId,draftKey:r.key,state:'uncertain',recorded:false,updatedAt:Date.now()};
    send(response({code:'not_found',error:'x'},404));
    expect((await call({type:'submission',id:r.submissionId})).data).toMatchObject({state:'failed',recorded:false});
    expect((await call({type:'restart',key:r.key,acknowledgeUncertain:false})).data.submissionId).toBe(r.submissionId);
  });
  it.each([[response({code:'notion_not_connected',error:'Ask an Admin.'},503),'notion_not_connected'],[response({code:'rate_limited',error:'Wait.'},429),'rate_limited'],[response({code:'validation',error:'Bad.',errors:['Bad.']},400),'validation']])('a refusal records nothing and leaves the draft open',async(reply,code)=>{
    const {r,message}=start();send(reply);
    expect(await call(message)).toMatchObject({ok:false,code});
    expect(values[`submission:${r.submissionId}`]).toBeUndefined();expect(values[`draft:${r.key}`]).toBeDefined();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('a revoked device is told to pair again, forgets the key, and keeps the draft',async()=>{
    const {r,message}=start();send(response({code:'pair_again',error:'This device is no longer paired.'},401));
    expect(await call(message)).toMatchObject({ok:false,code:'pair_again',error:'This device is no longer paired.'});
    expect(values.deviceKey).toBeUndefined();expect(values.site.expired).toBe(true);expect(values[`draft:${r.key}`]).toBeDefined();expect(values[`submission:${r.submissionId}`]).toBeUndefined();
    expect((await call({type:'settings'})).data.pairing).toBe('expired');
  });
  it('explains when Chrome no longer has permission for the site',async()=>{
    const {message}=start();hasPermission=false;
    expect(await call(message)).toMatchObject({ok:false,code:'permission_missing'});expect(fetch).not.toHaveBeenCalled();
  });
  it('saves a first chosen person as the default, once',async()=>{
    const {message}=start();values.options.defaultRecipientId=null;
    send(created(),response({defaultRecipientId:'person1'}));
    await call(message);
    expect(fetchMock().mock.calls.map(c=>c[0])).toEqual([`${API}/requests`,`${API}/recipient`]);expect(bodyOf(1)).toEqual({notionUserId:'person1'});expect(values.options.defaultRecipientId).toBe('person1');
  });
  it('checks for repeats, and only for supported stores',async()=>{
    send(response({repeats:[{memberName:'Test Student B',createdMs:9,pageUrl:null,state:'created'}]}));
    expect((await call({type:'check-repeats',url:'https://www.revrobotics.com/rev-21-1651/',sku:'REV-21-1651'})).data.repeats[0].memberName).toBe('Test Student B');
    expect(bodyOf(0)).toEqual({url:'https://www.revrobotics.com/rev-21-1651/',sku:'REV-21-1651'});
    expect((await call({type:'check-repeats',url:'https://example.com/x',sku:''})).data.repeats).toEqual([]);expect(fetch).toHaveBeenCalledTimes(1);
  });
});
describe('pairing and defaults',()=>{
  const fresh=()=>{delete values.site;delete values.deviceKey;delete values.options;delete values.defaultTeam;};
  const pair=(extra={})=>call({type:'pair',origin:SITE,pin:'K7M2-9QXP',deviceLabel:'Shop laptop',...extra});
  it('exchanges the PIN, stores the key privately and answers without it',async()=>{
    fresh();send(response({deviceKey:DEVICE_KEY,memberName:'Test Student A'},201),response(deviceOptions()));
    const result=await pair();
    expect(result.data).toMatchObject({pairing:'paired',origin:SITE,memberName:'Test Student A',deviceLabel:'Shop laptop'});expect(JSON.stringify(result)).not.toContain(DEVICE_KEY);
    expect(values.deviceKey).toBe(DEVICE_KEY);expect(fetchMock().mock.calls[0][0]).toBe(`${API}/pair`);expect(bodyOf(0)).toEqual({pin:'K7M29QXP',deviceLabel:'Shop laptop'});
  });
  it('refuses to pair without Chrome\'s permission and sends nothing',async()=>{
    fresh();hasPermission=false;
    expect(await pair()).toMatchObject({ok:false,code:'permission_denied'});expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses http in a production build',async()=>{
    fresh();expect((await pair({origin:'http://localhost:5194'})).error).toContain('https');expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps access after a wrong PIN, which proves the address, and drops it for a wrong site',async()=>{
    fresh();send(response({code:'pin_refused',error:'That PIN does not work.'},401));
    expect(await pair()).toMatchObject({ok:false,code:'pin_refused'});expect(chromeMock.permissions.remove).not.toHaveBeenCalled();
    send(new Response('<html>some other site</html>',{status:200}));
    expect(await pair()).toMatchObject({ok:false,code:'not_a_site'});expect(chromeMock.permissions.remove).toHaveBeenCalledWith({origins:[`${SITE}/*`]});
    expect(values.deviceKey).toBeUndefined();
  });
  it('after no answer, says the PIN may be used up, and says so again when that same PIN is refused',async()=>{
    fresh();send(new Error('timed out'));
    const lost=await pair();
    expect(lost).toMatchObject({ok:false,code:'pin_uncertain'});expect(lost.error).toContain('Your PIN may already be used up');expect(lost.error).toContain('/ordering-pin');
    expect(JSON.stringify(values)).not.toContain('K7M29QXP');
    send(response({code:'pin_refused',error:'That PIN does not work.'},401));
    const again=await pair();
    expect(again).toMatchObject({ok:false,code:'pin_refused',error:'That PIN didn\'t work. It was probably used up when the site didn\'t answer last time. Run /ordering-pin in Discord to get a new PIN, then enter that one.'});
    // A different PIN refused is just a wrong PIN.
    expect(await pair({pin:'Q7M2-9QXP'})).toMatchObject({ok:false,code:'pin_refused',error:'That PIN does not work.'});
    send(response({deviceKey:DEVICE_KEY,memberName:'Test Student A'},201),response(deviceOptions()));
    expect((await pair({pin:'Q7M2-9QXP'})).data.pairing).toBe('paired');expect(values.pinNoAnswer).toBeUndefined();
  });
  it('pairing elsewhere drops the old site\'s access and lists',async()=>{
    send(response({deviceKey:DEVICE_KEY,memberName:'Test Student A'},201),response(deviceOptions()));
    await pair({origin:'https://other-site.example.test'});
    expect(chromeMock.permissions.remove).toHaveBeenCalledWith({origins:[`${SITE}/*`]});expect(values.site.origin).toBe('https://other-site.example.test');
  });
  it('saves the chosen person with the site and the team locally',async()=>{
    send(response({defaultRecipientId:'person1'}));
    const result=await call({type:'save-defaults',defaultTeam:'team1',defaultRecipient:'person1'});
    expect(result.data.defaultTeam).toBe('team1');expect(fetchMock().mock.calls[0][0]).toBe(`${API}/recipient`);expect(bodyOf(0)).toEqual({notionUserId:'person1'});
    expect((await call({type:'save-defaults',defaultTeam:'nope',defaultRecipient:'person1'})).ok).toBe(false);
  });
  it('refreshes the lists, and a revoked key turns into pair again with the lists kept',async()=>{
    send(response({...deviceOptions(),teams:[{id:'new',name:'New Team'}]}));
    expect((await call({type:'refresh-options'})).data.options.teams).toEqual([{id:'new',name:'New Team'}]);
    send(response({code:'pair_again',error:'No longer paired.'},401));
    expect(await call({type:'refresh-options'})).toMatchObject({ok:false,code:'pair_again'});
    const settings=await call({type:'settings'});expect(settings.data.pairing).toBe('expired');expect(settings.data.options).toBeDefined();
  });
  it('unpair tells the site first, then forgets the key and the site\'s access, and keeps drafts and receipts',async()=>{
    const r=record();values[`draft:${r.key}`]=r;values[`receipt:x`]={submissionId:'y'};
    let keyDuringCall:unknown,removedDuringCall:unknown;
    vi.stubGlobal('fetch',vi.fn(async()=>{keyDuringCall=values.deviceKey;removedDuringCall=chromeMock.permissions.remove.mock.calls.length;return response({revoked:true});}));
    const result=await call({type:'unpair'});
    expect(fetchMock().mock.calls[0][0]).toBe(`${API}/devices/self/revoke`);expect(fetchMock().mock.calls[0][1].headers.Authorization).toBe(`Bearer ${DEVICE_KEY}`);
    expect(keyDuringCall).toBe(DEVICE_KEY);expect(removedDuringCall).toBe(0);
    expect(result.data.revokedOnSite).toBe(true);
    expect(result.data.pairing).toBe('unpaired');expect(values.deviceKey).toBeUndefined();expect(values.site).toBeUndefined();
    expect(values[`draft:${r.key}`]).toBeDefined();expect(values['receipt:x']).toBeDefined();
    expect(chromeMock.permissions.remove).toHaveBeenCalledWith({origins:[`${SITE}/*`]});expect(JSON.stringify(result)).not.toContain(DEVICE_KEY);
  });
  it.each<[string,Response|Error]>([
    ['offline',new Error('offline')],['an expired key',response({code:'pair_again',error:'x'},401)],['the rate limit',response({code:'rate_limited',error:'x'},429)],
    ['maintenance',response({code:'update_maintenance',error:'x'},503,{'Retry-After':'30'})],['a server error',response({error:'x'},500)],
  ])('unpair still happens on this computer after %s, and says the site did not confirm it',async(_,reply)=>{
    send(reply);
    const result=await call({type:'unpair'});
    expect(result.ok).toBe(true);expect(result.data.revokedOnSite).toBe(false);expect(result.data.pairing).toBe('unpaired');
    expect(fetch).toHaveBeenCalledTimes(1);expect(values.deviceKey).toBeUndefined();expect(values.site).toBeUndefined();expect(chromeMock.permissions.remove).toHaveBeenCalledWith({origins:[`${SITE}/*`]});
  });
  it('unpair makes no call when Chrome has no permission for the site, or nothing is paired',async()=>{
    hasPermission=false;
    expect((await call({type:'unpair'})).data).toMatchObject({revokedOnSite:false,pairing:'unpaired'});
    expect(fetch).not.toHaveBeenCalled();expect(values.deviceKey).toBeUndefined();
    expect((await call({type:'unpair'})).data).toMatchObject({revokedOnSite:false,pairing:'unpaired'});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('a refresh saves the plugin\'s version, update link and database link for the pages',async()=>{
    send(response({...deviceOptions(),minimumExtensionVersion:'0.3.0',updateUrl:'https://downloads.example.test/releases',databaseLink:'https://www.notion.so/abc'}));
    expect((await call({type:'refresh-options'})).data.options).toMatchObject({minimumExtensionVersion:'0.3.0',updateUrl:'https://downloads.example.test/releases',databaseLink:'https://www.notion.so/abc'});
    expect(values.options.databaseLink).toBe('https://www.notion.so/abc');
  });
});
describe('Express addition',()=>{
  const key='42:https://www.revrobotics.com/rev-21-1651/';
  const url='https://www.revrobotics.com/rev-21-1651/';
  type Route=(path:string,init:any)=>Response|Error|undefined;
  let posts:any[],checks:number,route:Route;
  const plain=(path:string,init:any):Response=>{
    if(path.endsWith('/options'))return response({memberName:'Test Student A',teams:deviceOptions().teams,recipients:deviceOptions().recipients,defaultRecipientId:'person1'});
    if(path.endsWith('/check')){checks++;return response({repeats:[]});}
    if(path.endsWith('/requests')){posts.push(JSON.parse(init.body));return created();}
    return response({error:'Not found',code:'not_found'},404);
  };
  const open=(auto=true)=>call({type:'capture',tabId:42,auto});
  const idle=async()=>{for(let i=0;i<8;i++)await new Promise(done=>setTimeout(done));};
  beforeEach(()=>{
    posts=[];checks=0;route=()=>undefined;values.expressEnabled=true;values.brandAttemptAt=Date.now();
    vi.stubGlobal('fetch',vi.fn(async(path:string,init:any)=>{const reply=route(path,init)??plain(path,init);if(reply instanceof Error)throw reply;return reply.clone();}));
  });
  const capture=(extra={})=>{chromeMock.scripting.executeScript=vi.fn(async()=>[{result:{...record().capture,...extra}}]);};
  it('is off by default, so a toolbar click only shows the form',async()=>{
    delete values.expressEnabled;expect((await call({type:'settings'})).data.expressEnabled).toBe(false);
    const reply=await open();expect(reply.data.submission).toBeUndefined();expect(reply.data.record.express).toBeUndefined();await idle();expect(posts).toHaveLength(0);expect(checks).toBe(0);
  });
  it('sends once, as NORMAL quantity 1, with the draft\'s own submission ID, when everything holds',async()=>{
    const reply=await open();const id=reply.data.record.submissionId;await vi.waitFor(()=>expect(values[`receipt:${key}`]).toBeDefined());
    expect(posts).toHaveLength(1);expect(posts[0].submissionId).toBe(id);expect(posts[0].draft).toMatchObject({status:'NORMAL Request',quantity:1,team:'team1',recipient:'person1',price:30,currencyConfirmed:true,url});
    expect(checks).toBe(1);expect(values[`submission:${id}`]).toMatchObject({state:'success',express:true,facts:{store:'REV',team:'Robotics',recipient:'Test Student A',quantity:1,price:30}});
  });
  it('shows the receipt on reopening, with no second send',async()=>{
    await open();await vi.waitFor(()=>expect(values[`receipt:${key}`]).toBeDefined());
    const again=await open();expect(again.data.submission.state).toBe('success');expect(again.data.record).toBeUndefined();await idle();expect(posts).toHaveLength(1);expect(checks).toBe(1);
  });
  it('sends one request however fast the popup reopens',async()=>{
    const replies=await Promise.all([open(),open(),open(),open()]);await vi.waitFor(()=>expect(values[`receipt:${key}`]).toBeDefined());await idle();
    expect(posts).toHaveLength(1);expect(new Set(replies.filter(r=>r.data.submission).map(r=>r.data.submission.id)).size).toBe(1);
  });
  it('keeps going when the popup goes away: the send belongs to the worker',async()=>{
    let finish!:(r:Response)=>void;const answer=new Promise<Response>(done=>{finish=done;});
    vi.stubGlobal('fetch',vi.fn(async(path:string,init:any)=>{if(path.endsWith('/requests')){posts.push(JSON.parse(init.body));return answer;}return plain(path,init).clone();}));
    const reply=await open();expect(reply.data.submission).toMatchObject({state:'pending',express:true});
    const during=await open();expect(during.data.submission.state).toBe('pending');expect(posts).toHaveLength(1);
    finish(created());await vi.waitFor(()=>expect(values[`receipt:${key}`]).toBeDefined());expect(posts).toHaveLength(1);
  });
  it.each([
    ['a missing price','price',{price:null,currency:'',issues:['Unit price needs your review.']}],
    ['an unselected option','variant',{price:null,issues:['Select all product options on the store page, or enter the exact variant and price manually.','Unit price needs your review.']}],
    ['another currency','currency',{currency:'EUR',issues:['Price is in EUR. Enter a USD price and confirm it before submitting.']}],
    ['any other reader issue','issue',{issues:['Confirm the price and selling unit on McMaster.']}],
    ['no description','description',{description:'  '}],
  ])('falls back to the form for %s',async(_name,code,extra)=>{
    capture(extra);const reply=await open();await idle();
    expect(reply.data.submission).toBeUndefined();expect(reply.data.record.express.state).toBe('fallback');expect(reply.data.record.express.reasons.map((r:any)=>r.code)).toContain(code);expect(posts).toHaveLength(0);
  });
  it('a missing optional SKU alone doesn\'t stop it',async()=>{
    capture({sku:'',issues:['SKU was not confirmed; it is optional.']});await open();await vi.waitFor(()=>expect(posts).toHaveLength(1));
  });
  it('blanks a foreign price rather than leave it in a USD field',async()=>{
    capture({currency:'EUR',price:19.5,issues:['Price is in EUR. Enter a USD price and confirm it before submitting.']});
    const reply=await open();expect(reply.data.record.draft.price).toBeNull();expect(reply.data.record.express.reasons[0].text).toContain('EUR 19.50');
  });
  it.each([
    ['no default team',()=>{delete values.defaultTeam;}],
    ['no default person',()=>{const plainRoute=plain;route=(path,init)=>path.endsWith('/options')?response({memberName:'A',teams:deviceOptions().teams,recipients:deviceOptions().recipients,defaultRecipientId:null}):plainRoute(path,init);}],
    ['a default team no longer on the list',()=>{values.defaultTeam='gone';}],
    ['a default person no longer on the list',()=>{route=(path,init)=>path.endsWith('/options')?response({memberName:'A',teams:deviceOptions().teams,recipients:[{id:'other',name:'Other'}],defaultRecipientId:'person1'}):plain(path,init);}],
  ])('falls back to the form with %s',async(_name,arrange)=>{
    arrange();const reply=await open();await idle();expect(reply.data.record.express.reasons.map((r:any)=>r.code)).toContain('defaults');expect(posts).toHaveLength(0);
  });
  it('falls back when /check finds a repeat, naming it',async()=>{
    route=path=>path.endsWith('/check')?response({repeats:[{memberName:'Test Student B',createdMs:1,pageUrl:'https://www.notion.so/earlier',state:'created'}]}):undefined;
    const reply=await open();await idle();const reason=reply.data.record.express.reasons.find((r:any)=>r.code==='repeat');
    expect(reason.repeats[0]).toMatchObject({memberName:'Test Student B',pageUrl:'https://www.notion.so/earlier'});expect(posts).toHaveLength(0);
  });
  it('falls back when /check can\'t be reached',async()=>{
    route=path=>path.endsWith('/check')?new TypeError('offline'):undefined;
    const reply=await open();await idle();expect(reply.data.record.express.reasons.map((r:any)=>r.code)).toEqual(['check-failed']);expect(posts).toHaveLength(0);
  });
  it('falls back when /options can\'t be reached, without asking /check',async()=>{
    route=path=>path.endsWith('/options')?new TypeError('offline'):undefined;
    const reply=await open();await idle();expect(reply.data.record.express.state).toBe('fallback');expect(checks).toBe(0);expect(posts).toHaveLength(0);
  });
  it('a revoked key found while deciding sends nothing and forgets the key',async()=>{
    route=path=>path.endsWith('/options')?response({error:'This device is no longer paired.',code:'pair_again'},401):undefined;
    const reply=await open();await idle();expect(reply.data.submission).toBeUndefined();expect(posts).toHaveLength(0);expect(values.deviceKey).toBeUndefined();expect(values[`draft:${key}`]).toBeDefined();
  });
  it('falls back when this page was already sent from another tab',async()=>{
    values[`receipt:7:${url}`]={submissionId:'x'};const reply=await open();await idle();expect(reply.data.record.express.reasons.map((r:any)=>r.code)).toContain('already-sent');expect(posts).toHaveLength(0);
  });
  it('falls back when another tab\'s send of this page is uncertain, but not when it failed',async()=>{
    values['submission:y']={id:'y',draftKey:`7:${url}`,state:'failed',updatedAt:1};await open();await vi.waitFor(()=>expect(values[`receipt:${key}`]).toBeDefined());expect(posts).toHaveLength(1);
    delete values[`receipt:${key}`];posts.length=0;for(const k of Object.keys(values))if(k.startsWith('submission:')&&k!=='submission:y')delete values[k];
    values['submission:y'].state='uncertain';const reply=await open();await idle();expect(reply.data.record.express.reasons.map((r:any)=>r.code)).toContain('already-sent');expect(posts).toHaveLength(0);
  });
  it('looks again after a fallback, with the same ID: selecting the option and reopening sends it',async()=>{
    capture({price:null,issues:['Select all product options on the store page, or enter the exact variant and price manually.']});
    const first=await open();capture();const second=await open();await vi.waitFor(()=>expect(posts).toHaveLength(1));
    expect(second.data.record.submissionId).toBe(first.data.record.submissionId);expect(posts[0].submissionId).toBe(first.data.record.submissionId);expect(posts[0].draft.price).toBe(30);
  });
  it('never sends a draft a student has edited',async()=>{
    capture({price:null,issues:['Unit price needs your review.']});const first=(await open()).data.record;
    await call({type:'save-draft',record:{...first,updatedAt:first.updatedAt+1,draft:{...first.draft,price:12}}});expect(values[`draft:${key}`].edited).toBe(true);
    capture();const again=await open();await idle();expect(again.data.record.draft.price).toBe(12);expect(posts).toHaveLength(0);
  });
  it('a save with nothing changed doesn\'t count as an edit',async()=>{
    capture({price:null,issues:['Unit price needs your review.']});const first=(await open()).data.record;
    await call({type:'save-draft',record:{...first,updatedAt:first.updatedAt+1}});expect(values[`draft:${key}`].edited).toBeUndefined();
  });
  it('New request and Discard mean the form: they read the page but never send, even on reopening',async()=>{
    await open();await vi.waitFor(()=>expect(values[`receipt:${key}`]).toBeDefined());
    await call({type:'discard',key});const fresh=await open(false);expect(fresh.data.record.express.state).toBe('manual');
    const reopened=await open();await idle();expect(reopened.data.record.submissionId).toBe(fresh.data.record.submissionId);expect(posts).toHaveLength(1);
  });
  it('does nothing while the device is expired or unpaired',async()=>{
    values.site={...site,expired:true};const reply=await open();await idle();expect(reply.data.submission).toBeUndefined();expect(posts).toHaveLength(0);expect(checks).toBe(0);
  });
  it('an uncertain send is never resent: not by reopening, and not after the student confirms and returns to the form',async()=>{
    route=path=>path.endsWith('/requests')?(posts.push({uncertain:true}),response({state:'uncertain',error:'Notion may or may not have it.'},202)):undefined;
    const first=await open();const id=first.data.record.submissionId;await vi.waitFor(()=>expect(values[`submission:${id}`].state).toBe('uncertain'));
    for(let i=0;i<3;i++){const again=await open();expect(again.data.submission.state).toBe('uncertain');}await idle();expect(posts).toHaveLength(1);
    await call({type:'restart',key,acknowledgeUncertain:true});route=()=>undefined;
    const reopened=await open();await idle();expect(reopened.data.submission).toBeUndefined();expect(reopened.data.record.express.state).toBe('manual');expect(posts).toHaveLength(1);
  });
  it('a send with no answer is never resent, and is only read back',async()=>{
    route=path=>path.endsWith('/requests')?(posts.push({lost:true}),new TypeError('offline')):undefined;
    const first=await open();const id=first.data.record.submissionId;await vi.waitFor(()=>expect(values[`submission:${id}`]?.state).toBe('uncertain'));
    route=(path,init)=>path.endsWith('/requests')?(posts.push({resent:true}),created()):path.includes(`/requests/${id}`)?response({state:'uncertain',error:'Still unknown.'},202):plain(path,init);
    await open();await open();await idle();expect(posts).toEqual([{lost:true}]);
  });
  it('a recorded refusal returns to the form with the error and a new ID, and doesn\'t send again',async()=>{
    route=path=>path.endsWith('/requests')?(posts.push({}),response({state:'failed',error:'Notion refused this request.',code:'notion_400'},502)):undefined;
    const first=await open();await vi.waitFor(()=>expect(values[`draft:${key}`].express.reasons.length).toBe(1));
    const again=await open();await idle();expect(again.data.submission).toBeUndefined();expect(again.data.record.submissionId).not.toBe(first.data.record.submissionId);
    expect(again.data.record.express.reasons[0]).toMatchObject({code:'send-failed',text:'Notion refused this request.'});expect(posts).toHaveLength(1);
  });
  it('a refusal with nothing recorded returns to the form, keeping the ID, and doesn\'t send again',async()=>{
    route=path=>path.endsWith('/requests')?(posts.push({}),response({error:'Slow down.',code:'rate_limited'},429)):undefined;
    const first=await open();await vi.waitFor(()=>expect(values[`draft:${key}`].express.reasons.length).toBe(1));
    const again=await open();await idle();expect(again.data.record.submissionId).toBe(first.data.record.submissionId);expect(again.data.record.express.reasons[0].text).toBe('Slow down.');expect(posts).toHaveLength(1);
  });
  it('a worker that stopped after deciding but before recording leaves the form, not a second chance to send',async()=>{
    const r=record();values[`draft:${key}`]={...r,express:{state:'attempted',reasons:[]}};
    const reply=await open();await idle();expect(reply.data.submission).toBeUndefined();expect(posts).toHaveLength(0);
  });
  it('a Create request click marks the draft, so it isn\'t picked up by itself if that send fails',async()=>{
    const r=record();values[`draft:${key}`]=r;route=path=>path.endsWith('/requests')?(posts.push({}),response({error:'Slow down.',code:'rate_limited'},429)):undefined;
    await call({type:'submit',key,submissionId:r.submissionId});route=()=>undefined;posts.length=0;
    const reply=await open();await idle();expect(reply.data.record.express.state).toBe('manual');expect(posts).toHaveLength(0);
  });
  it('the switch needs a paired device, and Unpair turns it off',async()=>{
    expect((await call({type:'set-express',enabled:false})).data.expressEnabled).toBe(false);
    expect((await call({type:'set-express',enabled:true})).data.expressEnabled).toBe(true);
    await call({type:'unpair'});expect(values.expressEnabled).toBeUndefined();
    expect(await call({type:'set-express',enabled:true})).toMatchObject({ok:false});
  });
});
describe('team colors',()=>{
  const good={settings:{primaryColor:'#0b3d91',secondaryColor:'#f58220',organizationName:'Test Robotics Team A'}};
  const brand={primary:'#111111',secondary:'#222222',organizationName:'Old Name',checkedAt:5};
  let statusCalls:any[],status:()=>Response|Error;
  beforeEach(()=>{
    statusCalls=[];status=()=>response(good);
    vi.stubGlobal('fetch',vi.fn(async(path:string,init:any)=>{
      if(path===`${SITE}/api/setup/status`){statusCalls.push(init);const answer=status();if(answer instanceof Error)throw answer;return answer.clone();}
      if(path.endsWith('/pair'))return response({deviceKey:DEVICE_KEY,memberName:'Test Student A'},201);
      return response({memberName:'Test Student A',teams:[],recipients:[],defaultRecipientId:null});
    }));
  });
  const pair=()=>call({type:'pair',origin:SITE,pin:'K7M2-9QXP',deviceLabel:'x'});
  it('reads them at pairing, without the device key or cookies, and reports them',async()=>{
    values.brandAttemptAt=Date.now();const reply=await pair();
    expect(statusCalls).toHaveLength(1);expect(statusCalls[0].headers).toBeUndefined();expect(statusCalls[0].credentials).toBe('omit');expect(statusCalls[0].redirect).toBe('error');
    expect(reply.data.brand).toMatchObject({primary:'#0b3d91',secondary:'#f58220',organizationName:'Test Robotics Team A'});
  });
  it('asks at most once a day, whether or not the last try worked',async()=>{
    status=()=>new TypeError('offline');await call({type:'refresh-options'});await call({type:'refresh-options'});expect(statusCalls).toHaveLength(1);
    values.brandAttemptAt=Date.now()-23*3600_000;await call({type:'refresh-options'});expect(statusCalls).toHaveLength(1);
    values.brandAttemptAt=Date.now()-24*3600_000-1;status=()=>response(good);const reply=await call({type:'refresh-options'});expect(statusCalls).toHaveLength(2);expect(reply.data.brand.primary).toBe('#0b3d91');
  });
  it.each([
    ['a color that is not 6 digits',{settings:{...good.settings,primaryColor:'#abc'}}],
    ['a named color',{settings:{...good.settings,secondaryColor:'red'}}],
    ['a CSS injection',{settings:{...good.settings,primaryColor:'#000000;background:url(https://evil.example.test/)'}}],
    ['a color that is not text',{settings:{...good.settings,primaryColor:0}}],
    ['a missing color',{settings:{organizationName:'x',primaryColor:'#000000'}}],
    ['a name that is too long',{settings:{...good.settings,organizationName:'x'.repeat(101)}}],
    ['an empty name',{settings:{...good.settings,organizationName:'   '}}],
    ['a name with control characters',{settings:{...good.settings,organizationName:'a\nb'}}],
    ['no settings',{}],
    ['a list',[1]],
  ])('keeps the last good colors after %s',async(_name,body)=>{
    values.brand=brand;status=()=>response(body);const reply=await call({type:'refresh-options'});expect(statusCalls).toHaveLength(1);expect(reply.data.brand).toEqual(brand);
  });
  it.each([['a network failure',()=>new TypeError('offline')],['an error status',()=>response(good,500)],['a page that is not JSON',()=>new Response('<h1>Hi</h1>')]])('keeps the last good colors after %s',async(_name,answer)=>{
    values.brand=brand;status=answer as ()=>Response|Error;expect((await call({type:'refresh-options'})).data.brand).toEqual(brand);
  });
  it('is refused nothing else by a color failure: the lists still load',async()=>{
    status=()=>new TypeError('offline');expect((await call({type:'refresh-options'})).ok).toBe(true);
  });
  it('doesn\'t ask without Chrome\'s permission for the site',async()=>{hasPermission=false;await call({type:'settings'});await call({type:'refresh-options'});expect(statusCalls).toHaveLength(0);});
  it('clears them on Unpair, and pairing with another site drops the old ones',async()=>{
    values.brand=brand;values.brandAttemptAt=1;await call({type:'unpair'});expect(values.brand).toBeUndefined();expect(values.brandAttemptAt).toBeUndefined();expect((await call({type:'settings'})).data.brand).toBeUndefined();
    values.site=site;values.deviceKey=DEVICE_KEY;values.brand=brand;status=()=>new TypeError('offline');
    await call({type:'pair',origin:'https://other-team.example.test',pin:'K7M2-9QXP',deviceLabel:'x'});expect(values.brand).toBeUndefined();
  });
  it('a read still running when Unpair happens can\'t bring them back',async()=>{
    let finish!:(r:Response)=>void;status=()=>response(good);
    vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.endsWith('/status'))return new Promise<Response>(done=>{finish=done;});if(path.endsWith('/revoke'))return response({revoked:true});return response({memberName:'A',teams:[],recipients:[],defaultRecipientId:null});}));
    const refresh=call({type:'refresh-options'});await vi.waitFor(()=>expect(finish).toBeDefined());await call({type:'unpair'});finish(response(good));await refresh;expect(values.brand).toBeUndefined();
  });
  it('keeps the theme, starting dark, and refuses anything else',async()=>{
    expect((await call({type:'settings'})).data.theme).toBe('dark');expect((await call({type:'set-theme',theme:'light'})).data.theme).toBe('light');
    expect(await call({type:'set-theme',theme:'blue' as any})).toMatchObject({ok:false});expect(values.theme).toBe('light');
  });
});
