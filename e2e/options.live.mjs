// A live check that the toolbar capture follows the option chosen on real product pages, through the built extension, in a throwaway
// browser profile that is deleted afterwards. The products and their choices are in e2e/options.cases.mjs. It only reads product pages:
// requests to carts, checkout or sign-in are refused, and it never presses Add to Cart. It waits for a page's own browser check to finish
// by itself, and stops at any challenge that asks for a person; that store is reported as blocked, not tested. Nothing is sent anywhere:
// the extension stays unpaired, which still captures.
// Run from PowerShell: npm run build; npm run live:options. LIVE_ONLY=rev,thrifty runs just those vendors.
// E2E_SCREENSHOTS=<folder> saves built-options-live-*.png. LIVE_STRICT=1 also fails on a blocked store.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CASES } from './options.cases.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'part-requests-options-live-'));
const shots = process.env.E2E_SCREENSHOTS;
const channel = process.env.E2E_CHANNEL || 'msedge';
const only = (process.env.LIVE_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const cases = CASES.filter(c => !only.length || only.includes(c.vendor));
const manifest = JSON.parse(readFileSync(join(root, 'dist', 'manifest.json'), 'utf8'));
const extension = join(work, 'extension');
cpSync(join(root, 'dist'), extension, { recursive: true });
writeFileSync(join(extension, 'manifest.json'), JSON.stringify({ ...manifest, host_permissions: [...new Set(cases.map(c => `${new URL(c.url).origin}/*`))] }));
const NEVER = /\/cart(\.php|\/|$|\?)|\/remote\/v1\/cart|checkout|\/login|\/account|\/signin|\/ap\/signin|\/gp\/buy|addtocart|add-to-cart|\/cart\/add|place-?order/i;
const WALL = /just a moment|check if you are a robot|access to this page has been denied|robot check|verify (?:that )?you(?:'re| are) (?:a )?human|^error page|sorry, you have been blocked|slide to verify|press (?:&|and) hold/i;
const PICK = /Select all product options/;

const rows = [], walls = [], refused = [], notes = [];
const context = await chromium.launchPersistentContext(join(work, 'profile'), {
  channel, headless: false, viewport: { width: 1366, height: 860 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check'],
});
try {
  await context.route('**/*', route => {
    const url = route.request().url();
    const path = new URL(url).pathname;
    if (NEVER.test(path)) { refused.push(url.split('?')[0]); return route.abort(); }
    return route.fallback();
  });
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
    const read = await popup.evaluate(() => {
      const shown = el => !!el && !el.hidden;
      if (shown(document.getElementById('not-product')) && !shown(document.getElementById('request-form'))) return { notProduct: true, text: document.getElementById('not-product').textContent.replace(/\s+/g, ' ').trim() };
      return { description: document.getElementById('description').value, sku: document.getElementById('sku').value, price: document.getElementById('price').value, issues: document.getElementById('capture-issues').textContent.replace(/\s+/g, ' ').trim() };
    });
    await popup.close();
    return read;
  }
  async function settle(page) {
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
  }
  async function pick(page, c, action) {
    if (c.bigcommerce) {
      // [group, index]: the index-th label of the group-th option field in the product's own form.
      const [group, index] = action;
      const field = page.locator('.productView form[data-cart-item-add] [data-product-attribute]').nth(group);
      const label = field.locator('label[for]').nth(index);
      const text = (await label.textContent()).replace(/\s+/g, ' ').trim();
      const settled = page.waitForResponse(r => /\/remote\/v1\/product-attributes\//.test(r.url()), { timeout: 15000 }).catch(() => undefined);
      await label.click();
      await settled;
      await page.waitForTimeout(1200);
      return text;
    }
    if (action.select) {
      const [selector, prefix] = action.select;
      const select = page.locator(selector).first();
      const options = await select.locator('option').allTextContents();
      const index = options.findIndex(o => o.replace(/\s+/g, ' ').trim().startsWith(prefix));
      if (index < 0) throw new Error(`No option starting "${prefix}" in ${selector}: ${options.join(' | ')}`);
      await select.selectOption({ index });
      await settle(page);
      return prefix;
    }
    if (c.busy) await page.locator(c.busy).first().waitFor({ state: 'hidden', timeout: 30000 }).catch(() => undefined);
    let target;
    if (Array.isArray(action.click)) for (const [selector, nth] of action.click) target = (target ?? page).locator(selector).nth(nth);
    else target = page.locator(action.click).first();
    // A swatch's label often has no text, so its input's value names the choice.
    const text = action.name || ((await target.textContent({ timeout: 10000 }).catch(() => '') || '').replace(/\s+/g, ' ').trim()
      || await target.evaluate(el => el.control?.value || el.querySelector('input')?.value || el.getAttribute('title') || '').catch(() => '')).slice(0, 60);
    await target.click({ timeout: 15000 });
    await settle(page);
    return text || JSON.stringify(action.click);
  }
  // Some checks, such as Ali Express's, are drawn in a frame over the product.
  const wallOn = async page => {
    const texts = await Promise.all(page.frames().map(f => f.locator('body').innerText({ timeout: 3000 }).catch(() => '')));
    return WALL.test(`${await page.title().catch(() => '')} ${texts.map(t => t.slice(0, 3000)).join(' ')}`);
  };
  // Whole words only: "Red" is not named by "Vectored".
  const words = text => text.toLowerCase().replace(/[^a-z\d.]+/g, ' ').trim();
  for (const c of cases) {
    const page = await context.newPage();
    const where = `${c.vendor} ${c.url.replace(/^https:\/\/(www\.)?/, '')}`;
    try {
      await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // A browser check that finishes by itself is waited for. One that wants a person ends this product.
      try { await page.waitForSelector(c.ready, { state: 'attached', timeout: 45000 }); }
      catch { walls.push(`${where}: ${(await wallOn(page)) ? 'bot check' : 'product page did not appear'} ("${(await page.title()).slice(0, 60)}")`); console.log(`BLOCKED  ${walls.at(-1)}`); continue; }
      await settle(page);
      if (await wallOn(page)) { walls.push(`${where}: bot check over the product`); console.log(`BLOCKED  ${walls.at(-1)}`); continue; }
      if (c.wallOnly) { notes.push(`${where}: reachable; its option choices open other product pages`); console.log(`REACHED  ${where}`); continue; }
      for (const [n, step] of c.steps.entries()) {
        const picked = [];
        for (const action of step) picked.push(await pick(page, c, action));
        if (await wallOn(page)) { walls.push(`${where}: bot check after a choice`); console.log(`BLOCKED  ${walls.at(-1)}`); break; }
        const shows = await page.evaluate(c.shows, c.arg);
        const got = await popupFor(page);
        if (shots) await page.screenshot({ path: join(shots, `built-options-live-${rows.length + 1}.png`) });
        let ok, why = '';
        if (shows.notProduct) ok = !!got.notProduct;
        else if (got.notProduct) { ok = false; why = 'the extension refused the page'; }
        else if (!shows.complete) ok = got.sku === '' && got.price === '' && new RegExp(shows.note || PICK.source).test(got.issues);
        else {
          const skuOk = shows.sku === undefined || got.sku === shows.sku;
          const priceOk = got.price === '' ? shows.price === null : Number(got.price) === shows.price;
          const missing = (shows.chosen || []).filter(x => x && !` ${words(got.description)} `.includes(` ${words(x)} `));
          ok = skuOk && priceOk && !missing.length;
          why = [!skuOk && 'SKU', !priceOk && 'price', missing.length && `description lacks ${JSON.stringify(missing)}`].filter(Boolean).join(', ');
        }
        rows.push({ ok, vendor: c.vendor, url: page.url(), step: step.length ? picked.join(' + ') : 'nothing (as loaded)', shows, got });
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${where}  [${rows.at(-1).step}]${why ? `  (${why})` : ''}\n      page: ${JSON.stringify(shows)}\n      extension: ${JSON.stringify(got)}`);
      }
    } catch (error) {
      rows.push({ ok: false, vendor: c.vendor, url: c.url, step: 'error', shows: null, got: String(error).slice(0, 300) });
      console.log(`FAIL  ${where}: ${String(error).split('\n')[0].slice(0, 300)}`);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
} finally {
  await context.close().catch(() => undefined);
  rmSync(work, { recursive: true, force: true });
}
const byVendor = [...new Set(rows.map(r => r.vendor))].map(v => { const mine = rows.filter(r => r.vendor === v); return `${v} ${mine.filter(r => r.ok).length}/${mine.length}`; });
console.log(`\n${rows.filter(r => r.ok).length}/${rows.length} combinations matched the page. ${byVendor.join(', ')}`);
if (walls.length) console.log(`Blocked by a bot check, not tested: ${walls.join('; ')}`);
if (notes.length) console.log(`Notes: ${notes.join('; ')}`);
if (refused.length) console.log(`Refused: ${[...new Set(refused)].join(', ')}`);
if (rows.some(r => !r.ok) || !rows.length || process.env.LIVE_STRICT && walls.length) process.exitCode = 1;
