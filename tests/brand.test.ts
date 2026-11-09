import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY, brandTokens, contrast, contrastReport, isHexColor, parseBranding } from '../src/brand';
import { applyAppearance } from '../src/appearance';

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
const THEMES = ['dark', 'light'] as const;
const boot = readFileSync(resolve('public/appearance-boot.js'), 'utf8');
const runBoot = () => new Function(boot)();

describe('contrast math',()=>{
  it('matches known values',()=>{
    expect(contrast('#000000','#ffffff')).toBeCloseTo(21,5);expect(contrast('#ffffff','#ffffff')).toBeCloseTo(1,5);
    expect(contrast('#767676','#ffffff')).toBeCloseTo(4.54,2);expect(contrast('#b80100','#ffffff')).toBeGreaterThan(6.5);
  });
  it.each(THEMES)('meets every promised ratio for a grid of 4,096 primary colors, in %s',theme=>{
    const steps=[0,17,34,51,68,85,102,119,136,153,170,187,204,221,238,255];
    for(const r of steps)for(const g of steps)for(const b of steps){
      const color=hex(r,g,b);
      for(const row of contrastReport(color,color,theme))if(row.ratio<row.minimum)throw new Error(`${color} ${theme}: ${row.name} ${row.ratio}`);
    }
  });
  it.each([['#0b3d91','#f58220'],['#ffd100','#00594c'],['#b80100','#eeb822'],['#000000','#ffffff'],['#ffffff','#000000'],['#7f7f7f','#808080'],['#191c1f','#24282d'],['#f1f3f4','#16211d']])('meets them for %s and %s in both themes',(primary,secondary)=>{
    for(const theme of THEMES)for(const row of contrastReport(primary,secondary,theme))expect(row.ratio,`${theme} ${row.name}`).toBeGreaterThanOrEqual(row.minimum);
  });
  it('leaves readable colors alone and moves only what needs it',()=>{
    expect(brandTokens('#b80100','#eeb822','light')['--accent-text']).toBe('#b80100');
    expect(brandTokens('#0b3d91','#f58220','dark')['--accent-text']).not.toBe('#0b3d91');
    expect(brandTokens('#ffd100','#00594c','light')['--on-primary']).toBe('#111714');
    expect(brandTokens('#0b3d91','#f58220','dark')['--on-primary']).toBe('#ffffff');
  });
  it('every token is a plain color',()=>{
    for(const theme of THEMES)for(const value of Object.values(brandTokens('#0b3d91','#f58220',theme)))expect(isHexColor(value)).toBe(true);
  });
  it.each(THEMES)('the stylesheet\'s %s defaults are what the calculation gives',theme=>{
    const css=readFileSync(resolve('src/styles.css'),'utf8');
    const block=new RegExp(`html\\[data-theme="${theme}"\\] \\{ --primary: ([^}]*)\\}`).exec(css)![0];
    for(const [name,value] of Object.entries(brandTokens(DEFAULT_PRIMARY,DEFAULT_SECONDARY,theme)))expect(block).toContain(`${name}: ${value};`);
  });
  it('status tones stay fixed: no pill or tone rule uses a team color',()=>{
    const css=readFileSync(resolve('src/styles.css'),'utf8');
    for(const line of css.split('\n').filter(l=>/^\.(ui-status|x-tone)/.test(l)))expect(line).not.toMatch(/--(primary|secondary|accent-text|on-primary|on-secondary)/);
  });
});
describe('what counts as a valid answer',()=>{
  const settings={primaryColor:'#0B3D91',secondaryColor:'#f58220',organizationName:' Test Team '};
  it('takes valid colors, in either case, and a trimmed name',()=>{expect(parseBranding({settings})).toEqual({primary:'#0B3D91',secondary:'#f58220',organizationName:'Test Team'});});
  it.each(['#abc','#12345g','red','rgb(0,0,0)','#0000000',' #000000','#000000\n','#000000;x:y','url(x)','var(--x)',null,0,undefined,{},['#000000']])('refuses the color %j',color=>{
    expect(parseBranding({settings:{...settings,primaryColor:color}})).toBeNull();expect(parseBranding({settings:{...settings,secondaryColor:color}})).toBeNull();
  });
  it.each(['','   ','x'.repeat(101),'a\u0000b','a\nb',null,5,{}])('refuses the name %j',name=>{expect(parseBranding({settings:{...settings,organizationName:name}})).toBeNull();});
  it.each([null,undefined,'x',5,[],{},{settings:null},{settings:'x'}])('refuses the answer %j',body=>{expect(parseBranding(body)).toBeNull();});
});
describe('the copy that stops a flash',()=>{
  beforeEach(()=>{localStorage.clear();document.documentElement.removeAttribute('style');document.documentElement.setAttribute('data-theme','dark');document.body.innerHTML='<strong id="brand-name">LancerLogin</strong>';});
  const brand={primary:'#0b3d91',secondary:'#f58220',organizationName:'Test Team A',checkedAt:1};
  it('a later page starts with the saved theme, colors and name, before any script of its own',()=>{
    applyAppearance({brand,theme:'light'});
    document.documentElement.removeAttribute('style');document.documentElement.setAttribute('data-theme','dark');document.body.innerHTML='<strong id="brand-name">LancerLogin</strong>';
    runBoot();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#0b3d91');expect(document.documentElement.style.getPropertyValue('--on-primary')).toBe('#ffffff');expect(document.getElementById('brand-name')!.textContent).toBe('Test Team A');
  });
  it('starts dark with nothing saved, or with something unreadable',()=>{
    runBoot();expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    localStorage.setItem('part-requests-appearance','{not json');runBoot();expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.getElementById('brand-name')!.textContent).toBe('LancerLogin');
  });
  it('refuses a saved value that is not a plain color, and names no other property',()=>{
    localStorage.setItem('part-requests-appearance',JSON.stringify({theme:'dark',name:'<b>x</b>',tokens:{dark:{'--primary':'url(https://evil.example.test/)','--secondary':'#123456','--anything':'#123456'}}}));runBoot();
    const style=document.documentElement.style;expect(style.getPropertyValue('--primary')).toBe('');expect(style.getPropertyValue('--secondary')).toBe('#123456');expect(style.getPropertyValue('--anything')).toBe('');
    expect(document.querySelector('#brand-name b')).toBeNull();
  });
  it('unpaired removes the team\'s colors and name',()=>{
    applyAppearance({brand,theme:'dark'});applyAppearance({theme:'dark'});
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');expect(document.getElementById('brand-name')!.textContent).toBe('LancerLogin');expect(JSON.parse(localStorage.getItem('part-requests-appearance')!)).toEqual({theme:'dark'});
  });
});
describe('nothing loads from anywhere else',()=>{
  const manifest=JSON.parse(readFileSync(resolve('public/manifest.json'),'utf8'));
  it('the CSP limits fonts to the extension',()=>{expect(manifest.content_security_policy.extension_pages).toContain("font-src 'self'");expect(manifest.content_security_policy.extension_pages).toContain("script-src 'self'");});
  it('the stylesheets name no remote address, and bundle only the four faces',()=>{
    const css=readFileSync(resolve('src/styles.css'),'utf8')+readFileSync(resolve('src/fonts.css'),'utf8');
    expect(css).not.toMatch(/https?:\/\//);expect(css).not.toMatch(/data:/);
    expect(readFileSync(resolve('src/fonts.css'),'utf8').match(/@font-face/g)).toHaveLength(4);
  });
  it('the pages have no inline scripts or styles, which the CSP would refuse',()=>{
    for(const page of ['popup.html','options.html']){
      const html=readFileSync(resolve(page),'utf8');
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);expect(html).not.toMatch(/\sstyle=/);expect(html).not.toMatch(/\son[a-z]+=/);
    }
  });
  it('the font licenses ship with the extension',()=>{
    const notices=readFileSync(resolve('public/THIRD_PARTY_NOTICES.txt'),'utf8');
    for(const text of ['Roboto','Bebas Neue','SIL OPEN FONT LICENSE Version 1.1','The Roboto Project Authors','The Bebas Neue Project Authors'])expect(notices).toContain(text);
  });
});
