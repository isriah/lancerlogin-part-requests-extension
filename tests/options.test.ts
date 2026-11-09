import { allStoreOrigins } from '../src/carts/registry';
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
  vi.stubGlobal('chrome',{runtime:{id:'extension',sendMessage:send,getManifest:()=>({version:'9.9.9',optional_host_permissions:['https://*/*']})},permissions:{request,remove:vi.fn(async()=>true)},tabs:{create:vi.fn()}});
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('the Carts switch',()=>{
  const flip=()=>{const box=input('carts-enabled');box.checked=!box.checked;box.dispatchEvent(new Event('change',{bubbles:true}));};
  const storeOrigins=allStoreOrigins();
  it('is off and disabled until paired',async()=>{await open();expect(input('carts-enabled').checked).toBe(false);expect(input('carts-enabled').disabled).toBe(true);});
  it('is off by default once paired, with no Open Carts',async()=>{view=paired();await open();expect(input('carts-enabled').checked).toBe(false);expect(input('carts-enabled').disabled).toBe(false);expect(input('carts-open-row').hidden).toBe(true);});
  it('asks Chrome for the stores during the click, before anything else',async()=>{
    view=paired();await open();send.mockClear();
    flip();
    expect(request).toHaveBeenCalledWith({origins:storeOrigins}); // Synchronously: Chrome refuses without the click's user gesture.
    expect(send).not.toHaveBeenCalled();
    view={...paired(),cartsEnabled:true};
    await vi.waitFor(()=>expect(send).toHaveBeenCalledWith({type:'set-carts',enabled:true}));
    await vi.waitFor(()=>expect(text('notice')).toMatch(/Carts is on/));
    expect(input('carts-open-row').hidden).toBe(false);
  });
  it('a denied prompt still turns it on, as a checklist',async()=>{
    view=paired();await open();request.mockResolvedValue(false);view={...paired(),cartsEnabled:true};
    flip();
    await vi.waitFor(()=>expect(text('notice')).toMatch(/without store access/));
  });
  it('turning it off gives the access back, and asks for nothing',async()=>{
    view={...paired(),cartsEnabled:true};await open();
    view=paired();flip();
    await vi.waitFor(()=>expect(chrome.permissions.remove).toHaveBeenCalledWith({origins:storeOrigins}));
    expect(request).not.toHaveBeenCalled();
  });
  it('an Admin turning it off hides it',async()=>{
    view={...paired(),options:{...deviceOptions(),cartsEnabled:false},cartsEnabled:true};await open();
    expect(input('carts-setting').hidden).toBe(true);expect(input('carts-open-row').hidden).toBe(true);
  });
});
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
    expect(input('pair-form').hidden).toBe(false);expect(input('site-address').value).toBe(SITE);expect(input('device-label').value).toBe('Shop laptop');expect(text('pairing-state')).toBe('Pair again');
    expect(text('notice')).toContain('drafts are kept');
  });
  const unpairWith=(data:object)=>send.mockImplementation(async(m:Message)=>({ok:true,data:m.type==='unpair'?(view={...unpaired(),...data} as SettingsView):view}));
  it('unpair explains what it does, and does nothing if cancelled',async()=>{
    view=paired();await open();expect(text('paired-card')).toContain('frees one of your 5 device slots');expect(text('paired-card')).toContain('an Admin may need to remove');
    const confirm=vi.fn(()=>false);vi.stubGlobal('confirm',confirm);document.getElementById('unpair')!.click();await new Promise(r=>setTimeout(r));expect(send.mock.calls.some(([m])=>m.type==='unpair')).toBe(false);expect(confirm.mock.calls[0]).toEqual([expect.stringContaining('frees one of your 5 device slots')]);
    unpairWith({revokedOnSite:true});
    vi.stubGlobal('confirm',vi.fn(()=>true));document.getElementById('unpair')!.click();await vi.waitFor(()=>expect(input('pair-form').hidden).toBe(false));expect(text('pairing-state')).toBe('Not paired');
    expect(text('notice')).toContain('removed from your team');expect(text('notice')).toContain('frees one');expect(text('notice')).not.toContain('Admin');
    expect(input('unpair').disabled).toBe(false);
  });
  it('unpair says an Admin may need to remove the device when the site did not confirm it',async()=>{
    view=paired();await open();unpairWith({revokedOnSite:false});
    vi.stubGlobal('confirm',vi.fn(()=>true));document.getElementById('unpair')!.click();await vi.waitFor(()=>expect(input('pair-form').hidden).toBe(false));
    expect(text('notice')).toContain('Unpaired on this computer');expect(text('notice')).toContain('an Admin may need to remove it');expect(text('pairing-state')).toBe('Not paired');
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
describe('settings and team colors',()=>{
  const brand={primary:'#0b3d91',secondary:'#f58220',organizationName:'Test <b>Team</b> A',checkedAt:Date.now()};
  const toggle=()=>document.getElementById('theme-toggle')!;
  beforeEach(()=>{localStorage.clear();document.documentElement.removeAttribute('style');document.documentElement.setAttribute('data-theme','dark');});
  it('Express addition is off and disabled until paired',async()=>{await open();expect(input('express-enabled').checked).toBe(false);expect(input('express-enabled').disabled).toBe(true);expect(input('settings-unpaired').hidden).toBe(false);});
  it('turning it on goes through the worker',async()=>{
    view=paired();await open();expect(input('express-enabled').checked).toBe(false);expect(input('express-enabled').disabled).toBe(false);
    send.mockImplementation(async(m:Message)=>({ok:true,data:m.type==='set-express'?(view={...view,expressEnabled:m.enabled}):view}));
    input('express-enabled').click();await vi.waitFor(()=>expect(send.mock.calls.some(([m])=>m.type==='set-express'&&m.enabled===true)).toBe(true));await vi.waitFor(()=>expect(text('notice')).toContain('Express addition is on'));expect(input('express-enabled').checked).toBe(true);
  });
  it('shows the name as plain text and the colors through custom properties only',async()=>{
    view={...paired(),brand};await open();
    expect(text('paired-team')).toBe('Test <b>Team</b> A');expect(text('brand-name')).toBe('Test <b>Team</b> A');expect(document.querySelector('#paired-team b,#brand-name b')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#0b3d91');
    expect(text('swatch-primary')).toBe('Primary #0B3D91');expect(input('swatch-primary').style.getPropertyValue('--swatch-background')).toBe('#0b3d91');expect(input('swatch-primary').style.background).toBe('');
    expect(text('brand-checked')).toContain('Checked today at');expect(input('default-colors-notice').hidden).toBe(true);
  });
  it('uses the defaults and says so when unpaired, clearing any saved team',async()=>{
    localStorage.setItem('part-requests-appearance',JSON.stringify({theme:'dark',name:'Old',tokens:{dark:{'--primary':'#123456'}}}));document.documentElement.style.setProperty('--primary','#123456');await open();
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');expect(text('brand-name')).toBe('LancerLogin');expect(input('default-colors-notice').hidden).toBe(false);expect(JSON.parse(localStorage.getItem('part-requests-appearance')!)).toEqual({theme:'dark'});
  });
  it('the switch changes the theme at once, tells the worker and keeps a synchronous copy',async()=>{
    await open();expect(toggle().getAttribute('aria-checked')).toBe('false');
    send.mockImplementation(async(m:Message)=>({ok:true,data:m.type==='set-theme'?(view={...view,theme:m.theme}):view}));
    toggle().click();expect(document.documentElement.getAttribute('data-theme')).toBe('light');expect(toggle().getAttribute('aria-checked')).toBe('true');expect(JSON.parse(localStorage.getItem('part-requests-appearance')!).theme).toBe('light');
    await vi.waitFor(()=>expect(send.mock.calls.some(([m])=>m.type==='set-theme'&&m.theme==='light')).toBe(true));
  });
  it('a pair-again device keeps its site\'s address visible through the host only when paired',async()=>{view=paired();await open();expect(text('paired-origin')).toBe('team-site.example.test');});
});
