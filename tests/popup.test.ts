import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { configuration,record } from './helpers';
import type { Message, Submission } from '../src/types';
let send: ReturnType<typeof vi.fn>,r=record(),result: Submission | undefined;
const input=(id:string)=>document.getElementById(id) as HTMLInputElement;
const change=(id:string,value:string)=>{input(id).value=value;input(id).dispatchEvent(new Event('input',{bubbles:true}));};
const submit=()=>document.getElementById('request-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
beforeEach(async()=>{
  vi.resetModules();vi.useFakeTimers();r=record();result=undefined;
  document.body.innerHTML=readFileSync(resolve('popup.html'),'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  send=vi.fn(async(m:Message)=>({ok:true,data:m.type==='settings'?{config:configuration()}:m.type==='capture'?{record:structuredClone(r),submission:result}:m.type==='submit'?{id:r.submissionId,state:'success',draftKey:r.key,pageUrl:'https://www.notion.so/new',updatedAt:Date.now()}:true}));
  vi.stubGlobal('chrome',{runtime:{id:'extension',sendMessage:send,openOptionsPage:vi.fn()},tabs:{query:vi.fn(async()=>[{id:42}])}});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function open(){await import('../src/popup');await vi.waitFor(()=>expect(input('request-form').hidden).toBe(false));}
describe('popup review and recovery',()=>{
  it('renders safe text, computes totals and derives vendor from edited URL',async()=>{
    r.draft.description='<img src=x onerror=alert(1)>';r.capture.issues=['<script>bad</script>'];await open();
    expect(input('description').value).toContain('<img');expect(document.querySelector('#capture-issues script')).toBeNull();
    expect(document.getElementById('total')!.textContent).toBe('$60.00');change('quantity','2.5');change('price','1.18');expect(document.getElementById('total')!.textContent).toBe('$2.95');
    change('url','https://andymark.com/products/shaft?variant=123');expect(document.getElementById('vendor')!.textContent).toBe('AndyMark');
    change('url','https://amazon.com.evil.test');expect(input('submit').disabled).toBe(true);
  });
  it('sends each edit immediately, even while a previous save awaits its response',async()=>{
    await open();send.mockImplementation((m:Message)=>m.type==='save-draft'?new Promise(()=>{}):Promise.resolve({ok:true,data:true}));
    change('description','One');change('description','Two');expect(send.mock.calls.filter(([m])=>m.type==='save-draft')).toHaveLength(2);
  });
  it('requires USD confirmation when a foreign price was too ambiguous to capture',async()=>{
    r.capture.currency='EUR';r.capture.price=null;r.draft.price=null;r.draft.currencyConfirmed=false;await open();
    expect(input('currency-row').hidden).toBe(false);change('price','10');submit();
    expect(document.getElementById('validation')!.textContent).toContain('USD');expect(send.mock.calls.filter(([m])=>m.type==='submit')).toHaveLength(0);
  });
  it('prevents repeated clicks and shows a confirmed receipt',async()=>{
    await open();submit();submit();await vi.waitFor(()=>expect(document.getElementById('result-title')!.textContent).toBe('Request created'));
    expect(send.mock.calls.filter(([m])=>m.type==='submit')).toHaveLength(1);expect((document.getElementById('notion-link') as HTMLAnchorElement).href).toBe('https://www.notion.so/new');expect(input('request-form').hidden).toBe(true);
  });
  it('reopening a pending request never sends another create',async()=>{
    result={id:r.submissionId,draftKey:r.key,state:'pending',updatedAt:Date.now()-60_000};await open();
    expect(document.getElementById('result-title')!.textContent).toBe('Check Notion before retrying');expect(input('retry').disabled).toBe(true);expect(input('submit').disabled).toBe(true);expect(send.mock.calls.filter(([m])=>m.type==='submit')).toHaveLength(0);
    input('checked-notion').checked=true;input('checked-notion').dispatchEvent(new Event('change'));expect(input('retry').disabled).toBe(false);
  });
});
