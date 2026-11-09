import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe,it,expect } from 'vitest';
import { apiBase,cleanDeviceLabel,normalizePin,normalizeSiteAddress,originPattern } from '../src/pairing';
describe('site address',()=>{
  it.each([
    ['team-site.example.test','https://team-site.example.test'],
    ['  https://team-site.example.test/  ','https://team-site.example.test'],
    ['https://team-site.example.test/api','https://team-site.example.test'],
    ['HTTPS://Team-Site.Example.Test/settings?x=1#y','https://team-site.example.test'],
    ['https://team-site.example.test:8443/','https://team-site.example.test:8443'],
  ])('reads %s',(input,origin)=>expect(normalizeSiteAddress(input)).toBe(origin));
  it.each(['','   ','http://team-site.example.test','ftp://team-site.example.test','https://user:pw@team-site.example.test','https://*.example.test','*.example.test','localhost','http://localhost:5194','file:///c:/x','javascript:alert(1)','not a site'])('refuses %j',input=>expect(()=>normalizeSiteAddress(input)).toThrow());
  it('allows local http only when the test manifest does, and never http elsewhere',()=>{
    expect(normalizeSiteAddress('http://localhost:5194/',true)).toBe('http://localhost:5194');
    expect(normalizeSiteAddress('http://127.0.0.1:5194',true)).toBe('http://127.0.0.1:5194');
    expect(()=>normalizeSiteAddress('http://team-site.example.test',true)).toThrow();
  });
  it('reaches Core through the Pages proxy under /api, and asks Chrome for that one origin',()=>{
    expect(apiBase('https://team-site.example.test')).toBe('https://team-site.example.test/api/public/part-requests');
    expect(originPattern('https://team-site.example.test')).toBe('https://team-site.example.test/*');
  });
});
describe('PIN',()=>{
  it.each(['K7M2-9QXP','K7M29QXP','k7m2-9qxp',' K7M2 9QXP ','**K7M2-9QXP**'])('reads %j',input=>expect(normalizePin(input)).toBe('K7M29QXP'));
  it.each(['','K7M2','K7M2-9QXPP','O7M2-9QXP','I7M2-9QXP','L7M2-9QXP','07M2-9QXP','17M2-9QXP'])('refuses %j',input=>expect(()=>normalizePin(input)).toThrow('8-character'));
  it('tidies a device label',()=>{expect(cleanDeviceLabel('  Shop   laptop ')).toBe('Shop laptop');expect(cleanDeviceLabel('x'.repeat(100))).toHaveLength(60);});
});
describe('what ships',()=>{
  const manifest=JSON.parse(readFileSync(resolve('public/manifest.json'),'utf8'));
  it('asks for no site until pairing, and only https then',()=>{
    expect(manifest.optional_host_permissions).toEqual(['https://*/*']);
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(JSON.stringify(manifest)).not.toMatch(/localhost|http:|notion\.com/);
    expect(manifest.content_security_policy.extension_pages).toContain("script-src 'self'");
  });
  it('has one version everywhere',()=>expect(manifest.version).toBe(JSON.parse(readFileSync(resolve('package.json'),'utf8')).version));
  it('has no Notion client, token or database setting left in the code or pages',()=>{
    const files=[...readdirSync('src',{recursive:true,encoding:'utf8'}).map(name=>join('src',name)).filter(name=>/[.](ts|css)$/.test(name)),'popup.html','options.html'];
    for(const file of files) expect(readFileSync(file,'utf8'),file).not.toMatch(/api\.notion\.com|Notion-Version|data_source|databaseUrl|import-people|notion_version/i);
  });
  it('fetches only from the service worker side: pages never call the network',()=>{
    for(const file of ['src/popup.ts','src/options.ts','src/ui.ts']) expect(readFileSync(file,'utf8'),file).not.toMatch(/\bfetch\(|XMLHttpRequest|PluginClient|deviceKey/);
  });
});
