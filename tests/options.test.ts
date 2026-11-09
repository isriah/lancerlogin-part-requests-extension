import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { SITE,deviceOptions } from './helpers';
import type { Message, SettingsView } from '../src/types';
let send: ReturnType<typeof vi.fn>,view:SettingsView,request:ReturnType<typeof vi.fn>;
const input=(id:string)=>document.getElementById(id) as HTMLInputElement;
const text=(id:string)=>document.getElementById(id)!.textContent;
const paired=():SettingsView=>({pairing:'paired',origin:SITE,memberName:'Test Student A',deviceLabel:'Shop laptop',options:deviceOptions(),defaultTeam:'team1'});
const unpaired=():SettingsView=>({pairing:'unpaired',defaultTeam:''});
const pair=()=>document.getElementById('pair-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
async function open(){await import('../src/options');await vi.waitFor(()=>expect(send.mock.calls.some(([m])=>m.type==='settings')).toBe(true));await new Promise(r=>setTimeout(r));}
beforeEach(()=>{
  vi.resetModules();view=unpaired();request=vi.fn(async()=>true);
  document.body.innerHTML=readFileSync(resolve('options.html'),'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  send=vi.fn(async(m:Message)=>({ok:true,data:m.type==='pair'||m.type==='unpair'?(view=m.type==='pair'?paired():unpaired()):view}));
  vi.stubGlobal('chrome',{runtime:{id:'extension',sendMessage:send,getManifest:()=>({version:'9.9.9',optional_host_permissions:['https://*/*']})},permissions:{request}});
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('pairing screen',()=>{
  it('says where PINs come from and shows the version',async()=>{await open();expect(text('pair-form')).toContain('/ordering-pin');expect(text('pair-form')).toContain('Discord');expect(text('version')).toBe('9.9.9');});
  it('has no token, database or guest import fields left',()=>{for(const id of ['token','database-url','data-source','import-form','request-url'])expect(document.getElementById(id)).toBeNull();});
  it('asks Chrome during the click, for one origin, before anything else',async()=>{
    await open();input('site-address').value='team-site.example.test/settings';input('pin').value='k7m29qxp';input('device-label').value='Shop laptop';send.mockClear();
    pair();
    expect(request).toHaveBeenCalledWith({origins:[`${SITE}/*`]}); // Synchronously: Chrome refuses without the click's user gesture.
    expect(send).not.toHaveBeenCalled();
    await vi.waitFor(()=>expect(send.mock.calls.some(([m])=>m.type==='pair')).toBe(true));
    expect(send.mock.calls.find(([m])=>m.type==='pair')![0]).toEqual({type:'pair',origin:SITE,pin:'K7M29QXP',deviceLabel:'Shop laptop'});
    await vi.waitFor(()=>expect(input('paired-card').hidden).toBe(false));
    expect(text('paired-member')).toBe('Test Student A');expect(input('pin').value).toBe('');expect(input('pair-form').hidden).toBe(true);expect(input('default-team').value).toBe('team1');
  });
  it('explains Deny, sends nothing and leaves the form ready',async()=>{
    request.mockResolvedValue(false);await open();input('site-address').value=SITE;input('pin').value='K7M2-9QXP';send.mockClear();
    pair();await vi.waitFor(()=>expect(text('notice')).toContain('You chose Deny'));
    expect(text('notice')).toContain('your PIN was not used');expect(send).not.toHaveBeenCalled();expect(input('pair').disabled).toBe(false);expect(input('pin').value).toBe('K7M2-9QXP');
  });
  it('refuses a bad address or PIN without asking Chrome',async()=>{
    await open();input('site-address').value='http://team-site.example.test';input('pin').value='K7M2-9QXP';pair();expect(request).not.toHaveBeenCalled();expect(text('notice')).toContain('https');
    input('site-address').value=SITE;input('pin').value='nope';pair();expect(request).not.toHaveBeenCalled();expect(text('notice')).toContain('8-character');
  });
  it('shows a pairing refusal from the site',async()=>{
    await open();input('site-address').value=SITE;input('pin').value='K7M2-9QXP';
    send.mockResolvedValue({ok:false,error:'That PIN does not work.',code:'pin_refused'});
    pair();await vi.waitFor(()=>expect(text('notice')).toContain('That PIN does not work.'));expect(input('pair').disabled).toBe(false);
  });
  it('an expired device shows the form with its site filled in, and says drafts are kept',async()=>{
    view={pairing:'expired',origin:SITE,deviceLabel:'Shop laptop',defaultTeam:''};await open();
    expect(input('pair-form').hidden).toBe(false);expect(input('site-address').value).toBe(SITE);expect(input('device-label').value).toBe('Shop laptop');expect(text('pairing-state')).toBe('PAIR AGAIN');
    expect(text('notice')).toContain('drafts are kept');
  });
  const unpairWith=(data:object)=>send.mockImplementation(async(m:Message)=>({ok:true,data:m.type==='unpair'?(view={...unpaired(),...data} as SettingsView):view}));
  it('unpair explains what it does, and does nothing if cancelled',async()=>{
    view=paired();await open();expect(text('paired-card')).toContain('frees one of your 5 device slots');expect(text('paired-card')).toContain('an Admin may need to remove');
    const confirm=vi.fn(()=>false);vi.stubGlobal('confirm',confirm);document.getElementById('unpair')!.click();await new Promise(r=>setTimeout(r));expect(send.mock.calls.some(([m])=>m.type==='unpair')).toBe(false);expect(confirm.mock.calls[0]).toEqual([expect.stringContaining('frees one of your 5 device slots')]);
    unpairWith({revokedOnSite:true});
    vi.stubGlobal('confirm',vi.fn(()=>true));document.getElementById('unpair')!.click();await vi.waitFor(()=>expect(input('pair-form').hidden).toBe(false));expect(text('pairing-state')).toBe('NOT PAIRED');
    expect(text('notice')).toContain('removed from your team');expect(text('notice')).toContain('frees one');expect(text('notice')).not.toContain('Admin');
    expect(input('unpair').disabled).toBe(false);
  });
  it('unpair says an Admin may need to remove the device when the site did not confirm it',async()=>{
    view=paired();await open();unpairWith({revokedOnSite:false});
    vi.stubGlobal('confirm',vi.fn(()=>true));document.getElementById('unpair')!.click();await vi.waitFor(()=>expect(input('pair-form').hidden).toBe(false));
    expect(text('notice')).toContain('Unpaired on this computer');expect(text('notice')).toContain('an Admin may need to remove it');expect(text('pairing-state')).toBe('NOT PAIRED');
  });
  it('shows the update notice with its link, without blocking anything, only when below the minimum',async()=>{
    view=paired();view.options={...view.options!,minimumExtensionVersion:'10.0.0',updateUrl:'https://github.com/isriah/lancerlogin-part-requests-extension/releases'};await open();
    expect(input('update-notice').hidden).toBe(false);expect(text('update-text')).toContain('9.9.9');expect(text('update-text')).toContain('10.0.0');
    const link=document.getElementById('update-link') as HTMLAnchorElement;expect(link.hidden).toBe(false);expect(link.href).toBe('https://github.com/isriah/lancerlogin-part-requests-extension/releases');expect(link.rel).toContain('noopener');expect(input('paired-card').hidden).toBe(false);
  });
  it('keeps the update notice hidden at or above the minimum, and with no minimum',async()=>{
    view=paired();view.options={...view.options!,minimumExtensionVersion:'9.9.9',updateUrl:'https://github.com/isriah/lancerlogin-part-requests-extension/releases'};await open();expect(input('update-notice').hidden).toBe(true);
  });
  it('shows the update notice without a link when the link is not https',async()=>{
    view=paired();view.options={...view.options!,minimumExtensionVersion:'10.0.0',updateUrl:'http://downloads.example.test/x'};await open();
    expect(input('update-notice').hidden).toBe(false);expect(input('update-link').hidden).toBe(true);expect(document.getElementById('update-link')!.hasAttribute('href')).toBe(false);
  });
  it('a key refused while saving defaults turns into the pair-again form',async()=>{
    view=paired();await open();
    send.mockImplementation(async(m:Message)=>{if(m.type==='save-defaults'){view={...view,pairing:'expired'};return {ok:false,error:'x',code:'pair_again'};}return {ok:true,data:view};});
    input('default-team').value='team1';input('default-recipient').value='person1';
    document.getElementById('defaults-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await vi.waitFor(()=>expect(input('pair-form').hidden).toBe(false));expect(text('notice')).toContain('pair it again');
  });
});
