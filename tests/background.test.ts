import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { configuration,record,response } from './helpers';
import type { Message } from '../src/types';
let values: Record<string,any>,listener: (m:Message,s:any,r:(v:any)=>void)=>boolean,chromeMock:any;
const sender={id:'extension-id',url:'chrome-extension://extension-id/popup.html'};
const call=(message:Message,origin=sender)=>new Promise<any>(resolve=>listener(message,origin,resolve));
beforeEach(async()=>{
  vi.resetModules();values={config:configuration(),token:'fixture-token'};
  chromeMock={storage:{local:{setAccessLevel:vi.fn(async()=>{}),get:vi.fn(async(key:string)=>structuredClone({[key]:values[key]})),set:vi.fn(async(data:Record<string,unknown>)=>Object.assign(values,structuredClone(data))),remove:vi.fn(async(keys:string|string[])=>{for(const key of [keys].flat())delete values[key];})}},runtime:{id:'extension-id',getURL:(p:string)=>`chrome-extension://extension-id/${p}`,onMessage:{addListener:(l:typeof listener)=>{listener=l;}}},tabs:{get:vi.fn(async()=>({id:42,url:record().draft.url}))},scripting:{executeScript:vi.fn(async()=>[{result:record().capture}])}};
  vi.stubGlobal('chrome',chromeMock);vi.stubGlobal('fetch',vi.fn(async()=>response({url:'https://www.notion.so/new-request'})));
  await import('../src/background');
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('service worker message flow',()=>{
  it('restricts token storage and rejects page-origin messages',async()=>{
    expect(chromeMock.storage.local.setAccessLevel).toHaveBeenCalledWith({accessLevel:'TRUSTED_CONTEXTS'});
    expect(await call({type:'settings'},{id:'extension-id',url:'https://www.revrobotics.com/rev-21-1651/'})).toMatchObject({ok:false});
    const settings=await call({type:'settings'});expect(settings.data.hasToken).toBe(true);expect(JSON.stringify(settings)).not.toContain('fixture-token');
  });
  it('captures only clicked tab and restores edited draft without reading the page again',async()=>{
    const first=await call({type:'capture',tabId:42});const draft=first.data.record;draft.draft.description='My edits';draft.updatedAt++;
    await call({type:'save-draft',record:draft});const second=await call({type:'capture',tabId:42});
    expect(second.data.record.draft.description).toBe('My edits');expect(chromeMock.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(chromeMock.scripting.executeScript.mock.calls)).not.toContain('fixture-token');
    expect(await call({type:'discard',key:draft.key})).toMatchObject({ok:true});expect(values[`draft:${draft.key}`]).toBeUndefined();
  });
  it('preserves the latest edit when messages arrive out of order',async()=>{
    const r=record();values[`draft:${r.key}`]=r;
    await Promise.all([call({type:'save-draft',record:{...r,updatedAt:3,draft:{...r.draft,description:'Latest'}}}),call({type:'save-draft',record:{...r,updatedAt:2,draft:{...r.draft,description:'Older'}}})]);
    expect(values[`draft:${r.key}`].draft.description).toBe('Latest');
  });
  it('creates once, clears the draft, and keeps a receipt after popup closure and worker restart',async()=>{
    const r=record();values[`draft:${r.key}`]=r;const message:Message={type:'submit',key:r.key,submissionId:r.submissionId};
    const results=await Promise.all([call(message),call(message)]);expect(results.every(r=>r.ok && r.data.state==='success')).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
    expect(values[`draft:${r.key}`]).toBeUndefined();
    vi.resetModules();await import('../src/background');
    expect((await call(message)).data.state).toBe('success');
    const reopened=await call({type:'capture',tabId:42});expect(reopened.data.submission.state).toBe('success');expect(fetch).toHaveBeenCalledTimes(1);expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('requires explicit confirmation before retrying an uncertain outcome',async()=>{
    const r=record();values[`draft:${r.key}`]=r;values[`submission:${r.submissionId}`]={id:r.submissionId,draftKey:r.key,state:'pending',updatedAt:Date.now()-60_000};
    expect((await call({type:'restart',key:r.key,acknowledgeUncertain:false})).ok).toBe(false);
    const result=await call({type:'restart',key:r.key,acknowledgeUncertain:true});expect(result.data.submissionId).not.toBe(r.submissionId);expect(result.data.draft).toEqual(r.draft);expect(fetch).not.toHaveBeenCalled();
  });
  it('does not clear pending work or allow submission from an unsupported edited URL',async()=>{
    const r=record();r.draft.url='https://unsupported.test';values[`draft:${r.key}`]=r;
    expect((await call({type:'submit',key:r.key,submissionId:r.submissionId})).ok).toBe(false);expect(fetch).not.toHaveBeenCalled();
    values[`submission:${r.submissionId}`]={state:'pending'};expect((await call({type:'discard',key:r.key})).ok).toBe(false);
  });
});
