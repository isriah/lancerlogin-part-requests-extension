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
  chromeMock={storage:{local:{setAccessLevel:vi.fn(async()=>{}),get:vi.fn(async(key:string)=>structuredClone({[key]:values[key]})),set:vi.fn(async(data:Record<string,unknown>)=>Object.assign(values,structuredClone(data))),remove:vi.fn(async(keys:string|string[])=>{for(const key of [keys].flat())delete values[key];})}},permissions:{contains:vi.fn(async()=>hasPermission),remove:vi.fn(async()=>true)},runtime:{id:'extension-id',getManifest:()=>({optional_host_permissions:['https://*/*']}),getURL:(p:string)=>`chrome-extension://extension-id/${p}`,onMessage:{addListener:(l:typeof listener)=>{listener=l;}}},tabs:{get:vi.fn(async()=>({id:42,url:record().draft.url}))},scripting:{executeScript:vi.fn(async()=>[{result:record().capture}])}};
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
  it('captures only clicked tab and restores edited draft without reading the page again',async()=>{
    const first=await call({type:'capture',tabId:42});const draft=first.data.record;draft.draft.description='My edits';draft.updatedAt++;
    expect(draft.draft.team).toBe('team1');expect(draft.draft.recipient).toBe('person1');
    await call({type:'save-draft',record:draft});const second=await call({type:'capture',tabId:42});
    expect(second.data.record.draft.description).toBe('My edits');expect(chromeMock.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(chromeMock.scripting.executeScript.mock.calls)).not.toContain(DEVICE_KEY);
    expect(await call({type:'discard',key:draft.key})).toMatchObject({ok:true});expect(values[`draft:${draft.key}`]).toBeUndefined();
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
  it('unpair forgets the key and the site\'s access, and keeps drafts and receipts',async()=>{
    const r=record();values[`draft:${r.key}`]=r;values[`receipt:x`]={submissionId:'y'};
    const result=await call({type:'unpair'});
    expect(result.data.pairing).toBe('unpaired');expect(values.deviceKey).toBeUndefined();expect(values.site).toBeUndefined();
    expect(values[`draft:${r.key}`]).toBeDefined();expect(values['receipt:x']).toBeDefined();
    expect(chromeMock.permissions.remove).toHaveBeenCalledWith({origins:[`${SITE}/*`]});expect(fetch).not.toHaveBeenCalled();
  });
});
