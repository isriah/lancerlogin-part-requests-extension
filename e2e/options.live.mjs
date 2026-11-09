// A live check that the toolbar capture follows the option chosen on a real REV product page, through the built extension, in a
// throwaway browser profile that is deleted afterwards. It only reads product pages: requests to the cart, checkout or sign-in are
// refused, and it never presses Add to Cart. It waits for a page's own browser check to finish by itself, and stops at any
// challenge that asks for a person. Nothing is sent anywhere: the extension stays unpaired, which still captures.
// Run: npm run build && npm run live:options. E2E_SCREENSHOTS=<folder> saves built-options-live-*.png.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'part-requests-options-live-'));
const shots = process.env.E2E_SCREENSHOTS;
const channel = process.env.E2E_CHANNEL || 'msedge';
const manifest = JSON.parse(readFileSync(join(root, 'dist', 'manifest.json'), 'utf8'));
const extension = join(work, 'extension');
cpSync(join(root, 'dist'), extension, { recursive: true });
writeFileSync(join(extension, 'manifest.json'), JSON.stringify({ ...manifest, host_permissions: ['https://www.revrobotics.com/*'] }));
const NEVER = /\/cart\.php|\/remote\/v1\/cart|\/checkout|\/login\.php|\/account\.php|\/cart(\/|$|\?)/i;

// Each step picks one option by its group and position on the page, as a student would click it. [] is the page as it loads.
const CASES = [
  { url: 'https://www.revrobotics.com/5mm-Hex-Shafts/', steps: [[], [[0, 0]], [[0, 1]], [[0, 3]], [[0, 2]]] },
  { url: 'https://www.revrobotics.com/Smart-servo-v2', steps: [[], [[0, 0], [1, 2]], [[0, 1], [1, 3]], [[1, 0]]] },
  { url: 'https://www.revrobotics.com/maxplanetary-system-kit/', steps: [[], [[1, 3]], [[1, 6], [4, 1]]] },
];
const rows = [], walls = [], refused = [];
const context = await chromium.launchPersistentContext(join(work, 'profile'), {
  channel, headless: false, viewport: { width: 1366, height: 860 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check'],
});
try {
  await context.route('**/*', route => { const url = route.request().url(); if (NEVER.test(new URL(url).pathname)) { refused.push(url.split('?')[0]); return route.abort(); } return route.fallback(); });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const helper = await context.newPage();
  await helper.goto(`chrome-extension://${id}/options.html`);
  async function popupFor(productPage) {
    const tabId = await helper.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url)?.id, productPage.url());
    const popup = await context.newPage();
    await popup.addInitScript(tab => { const query = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = async q => q.active ? [{ id: tab }] : query(q); }, tabId);
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForSelector('#request-form:not([hidden]), #not-product:not([hidden])', { timeout: 20000 });
    const read = await popup.evaluate(() => ({ description: document.getElementById('description').value, sku: document.getElementById('sku').value, price: document.getElementById('price').value, issues: document.getElementById('capture-issues').textContent.replace(/\s+/g, ' ').trim() }));
    await popup.close();
    return read;
  }
  // What the store page itself shows for the current choice.
  const pageShows = page => page.evaluate(() => {
    const form = document.querySelector('.productView form[data-cart-item-add]');
    const label = input => [...form.querySelectorAll('label[for]')].find(l => l.htmlFor === input.id)?.textContent.replace(/\s+/g, ' ').trim();
    return { sku: document.querySelector('.productView [data-product-sku]')?.textContent.trim() || '', price: document.querySelector('.productView-price [data-product-price-without-tax]')?.textContent.trim() || '', chosen: [...form.querySelectorAll('[data-product-attribute] input:checked')].map(label) };
  });
  for (const c of CASES) {
    const page = await context.newPage();
    await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // A browser check that finishes by itself is waited for. One that wants a person ends this product.
    try { await page.waitForSelector('.productView form[data-cart-item-add]', { timeout: 45000 }); }
    catch { walls.push(`${c.url}: ${await page.title()}`); await page.close(); continue; }
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
    for (const [n, step] of c.steps.entries()) {
      const picked = [];
      for (const [group, index] of step) {
        const field = page.locator('.productView form[data-cart-item-add] [data-product-attribute]').nth(group);
        const label = field.locator('label[for]').nth(index);
        picked.push((await label.textContent()).replace(/\s+/g, ' ').trim());
        const settled = page.waitForResponse(r => /\/remote\/v1\/product-attributes\//.test(r.url()), { timeout: 15000 }).catch(() => undefined);
        await label.click();
        await settled;
      }
      await page.waitForTimeout(1200);
      const shows = await pageShows(page);
      const got = await popupFor(page);
      if (shots) await page.screenshot({ path: join(shots, `built-options-live-${rows.length + 1}.png`) });
      const pagePrice = /^\$[\d,]+\.\d{2}$/.test(shows.price) ? Number(shows.price.slice(1).replaceAll(',', '')) : null;
      const labelSku = shows.chosen.map(t => /\(([A-Z][A-Z\d]*-[A-Z\d][A-Z\d-]*)\)/.exec(t || '')?.[1]).filter(Boolean);
      const required = await page.evaluate(() => [...document.querySelectorAll('.productView form[data-cart-item-add] [data-product-attribute]')].some(f => f.querySelector('[required]') && !f.querySelector('input:checked')));
      const ok = required
        ? got.sku === '' && got.price === '' && /Select all product options/.test(got.issues)
        : got.sku === (shows.sku || (labelSku.length === 1 ? labelSku[0] : '')) && (got.price === '' ? pagePrice === null : Number(got.price) === pagePrice) && shows.chosen.filter(t => t && !/^None$/i.test(t)).every(t => got.description.includes(t.replace(/\s*\([A-Z][A-Z\d]*-[A-Z\d][A-Z\d-]*\)\s*/, ' ').trim().split(' ').slice(0, 3).join(' ')));
      rows.push({ ok, url: c.url, step: n ? picked.join(' + ') : 'nothing (as loaded)', shows, got });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.url.replace('https://www.revrobotics.com', '')}  [${rows.at(-1).step}]\n      page: SKU "${shows.sku}", price "${shows.price}", chosen ${JSON.stringify(shows.chosen)}\n      extension: SKU "${got.sku}", price "${got.price}", description "${got.description}"${got.issues ? `, notes "${got.issues}"` : ''}`);
    }
    await page.close();
  }
} finally {
  await context.close().catch(() => undefined);
  rmSync(work, { recursive: true, force: true });
}
console.log(`\n${rows.filter(r => r.ok).length}/${rows.length} combinations matched the page.${walls.length ? ` Stopped at: ${walls.join('; ')}` : ''}${refused.length ? ` Refused: ${[...new Set(refused)].join(', ')}` : ''}`);
if (walls.length || rows.some(r => !r.ok) || !rows.length) process.exitCode = 1;
