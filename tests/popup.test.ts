import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { SITE,deviceOptions,record } from './helpers';
import type { Message, Repeat, SettingsView, Submission } from '../src/types';
let send: ReturnType<typeof vi.fn>,r=record(),result: Submission | undefined,view:SettingsView,repeats:Repeat[];
const input=(id:string)=>document.getElementById(id) as HTMLInputElement;
const text=(id:string)=>document.getElementById(id)!.textContent;
const change=(id:string,value:string)=>{input(id).value=value;input(id).dispatchEvent(new Event('input',{bubbles:true}));};
const submit=()=>document.getElementById('request-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
const paired=():SettingsView=>({pairing:'paired',origin:SITE,memberName:'Test Student A',options:deviceOptions(),defaultTeam:'team1'});
beforeEach(async()=>{
  vi.resetModules();vi.useFakeTimers();r=record();result=undefined;view=paired();repeats=[];
  document.body.innerHTML=readFileSync(resolve('popup.html'),'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  send=vi.fn(async(m:Message)=>({ok:true,data:m.type==='settings'||m.type==='refresh-options'?view:m.type==='capture'?{record:structuredClone(r),submission:result}:m.type==='check-repeats'?{repeats}:m.type==='submit'?{id:r.submissionId,state:'success',draftKey:r.key,pageUrl:'https://www.notion.so/new',updatedAt:Date.now()}:m.type==='submission'?null:true}));
  vi.stubGlobal('chrome',{runtime:{id:'extension',sendMessage:send,openOptionsPage:vi.fn()},tabs:{query:vi.fn(async()=>[{id:42}])}});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function open(){await import('../src/popup');await vi.waitFor(()=>expect(input('request-form').hidden).toBe(false));}
describe('popup review and recovery',()=>{
  it('renders safe text, computes totals and derives vendor from edited URL',async()=>{
    r.draft.description='<img src=x onerror=alert(1)>';r.capture.issues=['<script>bad</script>'];await open();
    expect(input('description').value).toContain('<img');expect(document.querySelector('#capture-issues script')).toBeNull();
    expect(text('total')).toBe('$60.00');change('quantity','2.5');change('price','1.18');expect(text('total')).toBe('$2.95');
    change('url','https://andymark.com/products/shaft?variant=123');expect(text('vendor')).toBe('AndyMark');
    change('url','https://amazon.com.evil.test');expect(input('submit').disabled).toBe(true);
  });
  it('sends each edit immediately, even while a previous save awaits its response',async()=>{
    await open();send.mockImplementation((m:Message)=>m.type==='save-draft'?new Promise(()=>{}):Promise.resolve({ok:true,data:true}));
    change('description','One');change('description','Two');expect(send.mock.calls.filter(([m])=>m.type==='save-draft')).toHaveLength(2);
  });
  it('requires USD confirmation when a foreign price was too ambiguous to capture',async()=>{
    r.capture.currency='EUR';r.capture.price=null;r.draft.price=null;r.draft.currencyConfirmed=false;await open();
    expect(input('currency-row').hidden).toBe(false);change('price','10');submit();
    expect(text('validation')).toContain('USD');expect(send.mock.calls.filter(([m])=>m.type==='submit')).toHaveLength(0);
  });
  it('prevents repeated clicks and shows a confirmed receipt',async()=>{
    await open();submit();submit();await vi.waitFor(()=>expect(text('result-title')).toBe('Request created'));
    expect(send.mock.calls.filter(([m])=>m.type==='submit')).toHaveLength(1);expect((document.getElementById('notion-link') as HTMLAnchorElement).href).toBe('https://www.notion.so/new');expect(input('request-form').hidden).toBe(true);
  });
  it('reopening a pending request never sends another create',async()=>{
    result={id:r.submissionId,draftKey:r.key,state:'pending',updatedAt:Date.now()-60_000};await open();
    expect(text('result-title')).toBe('Check Notion before retrying');expect(input('retry').disabled).toBe(true);expect(input('submit').disabled).toBe(true);expect(send.mock.calls.filter(([m])=>m.type==='submit')).toHaveLength(0);
    input('checked-notion').checked=true;input('checked-notion').dispatchEvent(new Event('change'));expect(input('retry').disabled).toBe(false);
  });
});
describe('pairing in the popup',()=>{
  it('prompts when unpaired, keeps the captured draft and blocks sending',async()=>{
    view={pairing:'unpaired',defaultTeam:''};r.draft.team='';r.draft.recipient='';await open();
    expect(input('setup').hidden).toBe(false);expect(text('setup-message')).toContain('/ordering-pin');
    expect(input('description').value).toBe(r.draft.description);expect(input('submit').disabled).toBe(true);
    expect(send.mock.calls.some(([m])=>m.type==='refresh-options'||m.type==='check-repeats')).toBe(false);
  });
  it('prompts to pair again when expired and keeps a saved team and person selectable',async()=>{
    view={pairing:'expired',origin:SITE,defaultTeam:''};await open();
    expect(text('setup-title')).toBe('Pair this device again');expect(text('setup-message')).toContain('drafts are kept');
    expect(input('team').value).toBe('team1');expect(input('recipient').value).toBe('person1');expect(input('submit').disabled).toBe(true);
  });
  it('hides the prompt when paired',async()=>{await open();expect(input('setup').hidden).toBe(true);});
  it('turns into the pair-again prompt when a send finds the device revoked, keeping the edits',async()=>{
    await open();change('description','Edited');
    send.mockImplementation(async(m:Message)=>{
      if(m.type==='submit'){view={...view,pairing:'expired'};return {ok:false,error:'This device is no longer paired.',code:'pair_again'};}
      return {ok:true,data:m.type==='settings'?view:m.type==='submission'?null:true};
    });
    submit();await vi.waitFor(()=>expect(input('setup').hidden).toBe(false));
    expect(text('notice')).toContain('no longer paired');expect(input('description').value).toBe('Edited');expect(input('request-form').hidden).toBe(false);expect(input('submit').disabled).toBe(true);
  });
  it('fills teams and people from the plugin\'s lists',async()=>{
    await open();await vi.waitFor(()=>expect(send.mock.calls.some(([m])=>m.type==='refresh-options')).toBe(true));
    expect([...input('team').querySelectorAll('option')].map(o=>o.textContent)).toEqual(['Choose team','Robotics']);
    expect(input('recipient').value).toBe('person1');
  });
});
describe('repeat warning',()=>{
  it('shows who and when without blocking',async()=>{
    repeats=[{memberName:'Test Student B',createdMs:Date.UTC(2026,10,1,12),pageUrl:'https://www.notion.so/older',state:'created'}];await open();
    await vi.waitFor(()=>expect(input('repeat-warning').hidden).toBe(false));
    expect(text('repeat-names')).toContain('Test Student B on ');expect(text('repeat-names')).toContain('Nov');
    expect((document.getElementById('repeat-link') as HTMLAnchorElement).href).toBe('https://www.notion.so/older');expect(input('submit').disabled).toBe(false);
    submit();await vi.waitFor(()=>expect(text('result-title')).toBe('Request created'));expect(input('repeat-warning').hidden).toBe(true);
  });
  it('stays hidden with no repeats, or when the check fails',async()=>{
    await open();await vi.waitFor(()=>expect(send.mock.calls.some(([m])=>m.type==='check-repeats')).toBe(true));expect(input('repeat-warning').hidden).toBe(true);
    send.mockImplementation(async()=>({ok:false,error:'down',code:'network'}));
    input('url').dispatchEvent(new Event('change',{bubbles:true}));await vi.advanceTimersByTimeAsync(1);expect(input('repeat-warning').hidden).toBe(true);expect(input('submit').disabled).toBe(false);
  });
  it('checks again when the URL or SKU changes',async()=>{
    await open();await vi.waitFor(()=>expect(send.mock.calls.filter(([m])=>m.type==='check-repeats')).toHaveLength(1));
    input('sku').value='NEW';input('sku').dispatchEvent(new Event('change',{bubbles:true}));
    await vi.waitFor(()=>expect(send.mock.calls.filter(([m])=>m.type==='check-repeats')).toHaveLength(2));
    expect(send.mock.calls.filter(([m])=>m.type==='check-repeats')[1][0].sku).toBe('NEW');
  });
});
