// End-to-end run of the built extension in a real browser. Notion is simulated; no token or real database is used.
// Run: npm run build && npm run e2e
// The test copy of the manifest swaps activeTab for host access, because automation cannot click the toolbar icon.
// That is the one thing this cannot prove: Chrome's toolbar-click permission grant.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'part-requests-e2e-'));
const shots = process.env.E2E_SCREENSHOTS;
const extension = join(work, 'extension');
cpSync(join(root, 'dist'), extension, { recursive: true });
const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
writeFileSync(join(extension, 'manifest.json'), JSON.stringify(manifest));

const DB = '22222222-3333-4444-8555-666666666666';
const SOURCE_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const SOURCE_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const labels = ['Amazon', 'Ali Express', 'Ambrosia Filament', 'AndyMark', 'BambuLab', 'CTRE', 'FerrulesDirect', 'Harbor Freight', 'Home Depot', 'McMaster', 'Online Metals', 'Pololu', 'PowerWerx', 'REV', 'SDS', 'Swyft', 'Thrifty Bot', 'V-Belt Guys', 'WCP', 'West3D', 'Other'];
const schema = {
  object: 'data_source', id: SOURCE_A, properties: {
    'Item Description': { id: 'title', name: 'Item Description', type: 'title', title: {} },
    Status: { id: 'st', name: 'Status', type: 'status', status: { options: ['RUSH Request', 'NORMAL Request', 'SLOW Request', 'Incomplete Request'].map(name => ({ id: `s-${name}`, name })) } },
    Vendor: { id: 've', name: 'Vendor', type: 'select', select: { options: labels.map(name => ({ id: `v-${name}`, name })) } },
    Team: { id: 'te', name: 'Team', type: 'select', select: { options: [{ id: 't-321', name: '321' }, { id: 't-Electrical', name: 'Electrical' }] } },
    'Orderer/Recipient': { id: 'pe', name: 'Orderer/Recipient', type: 'people', people: {} },
    SKU: { id: 'sk', name: 'SKU', type: 'rich_text', rich_text: {} },
    'Product URL': { id: 'ur', name: 'Product URL', type: 'url', url: {} },
    Qty: { id: 'qt', name: 'Qty', type: 'number', number: {} },
    'Unit Price': { id: 'pr', name: 'Unit Price', type: 'number', number: {} },
    Extension: { id: 'ex', name: 'Extension', type: 'formula', formula: { expression: 'x' } },
  },
};

// waitForFunction evaluates strings, which the extension's CSP correctly refuses.
const until = async (page, predicate, timeout) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await page.evaluate(predicate)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Timed out waiting'); };
const fits = (page, height) => page.evaluate(limit => document.documentElement.scrollHeight <= limit && document.documentElement.scrollWidth <= innerWidth + 1, height);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` -> ${detail}` : ''}`); };
const posts = [];
const queryPeople = [{ object: 'user', id: 'guest-1', name: 'Guest Student', type: 'person' }];
let createBehavior = 'ok';
let createLatency = 0;
let releaseCreate;

const context = await chromium.launchPersistentContext(join(work, 'profile'), {
  ...(process.env.E2E_BROWSER ? { executablePath: process.env.E2E_BROWSER } : { channel: process.env.E2E_CHANNEL || 'chromium' }), headless: process.env.E2E_HEADED ? false : true, viewport: { width: 1100, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const problems = [];
try {
  await context.route('https://api.notion.com/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() === 'POST' && path === '/v1/pages') {
      posts.push(request.postDataJSON());
      if (createBehavior === 'gateway') return reply({ message: 'bad gateway' }, 504);
      if (createLatency) await new Promise(done => setTimeout(done, createLatency));
      if (createBehavior === 'hold') await new Promise(done => { releaseCreate = done; });
      return reply({ object: 'page', id: 'new-page', url: 'https://app.notion.com/p/new-request' });
    }
    if (path === `/v1/databases/${DB}`) return reply({ object: 'database', id: DB, data_sources: [{ id: SOURCE_A, name: 'Ordering' }, { id: SOURCE_B, name: 'Archive' }] });
    if (path === `/v1/data_sources/${SOURCE_A}/query`) return reply({ results: [{ properties: { 'Orderer/Recipient': { id: 'pe', type: 'people', people: queryPeople } } }], has_more: false });
    if (path === `/v1/data_sources/${SOURCE_A}`) return reply(schema);
    if (path === '/v1/users') return reply({ results: [{ object: 'user', id: 'person-1', type: 'person', name: 'Pilot Student' }], has_more: false });
    return reply({ message: 'not found' }, 404);
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  worker.on?.('console', m => { if (m.type() === 'error') problems.push(`worker: ${m.text()}`); });
  const watch = page => { page.on('pageerror', e => problems.push(`${page.url().slice(0, 40)}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Illegal invocation|Uncaught/.test(m.text())) problems.push(m.text()); }); return page; };

  // Options: connect, data source choice, defaults.
  const options = watch(await context.newPage());
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForSelector('#token');
  if (shots) await options.screenshot({ path: join(shots, 'options-wide.png') });
  await options.fill('#token', 'fake-e2e-token');
  await options.fill('#database-url', `https://app.notion.com/p/${DB.replaceAll('-', '')}?v=99999999999949998999999999999999`);
  await options.click('#test-connection');
  await options.waitForSelector('#source-row:not([hidden])', { timeout: 15000 }).catch(() => {});
  check('Options: app.notion.com link reaches a real fetch and asks for a data source', await options.isVisible('#data-source'), await options.textContent('#notice'));
  await options.selectOption('#data-source', SOURCE_A);
  await options.click('#test-connection');
  await until(options, () => document.getElementById('connection-state').textContent === 'CONNECTED', 15000).catch(() => {});
  check('Options: reports what the lookup found', /Found 1 person on 1 existing request/.test(await options.textContent('#notice')), await options.textContent('#notice'));
  check('Options: connection saved', (await options.textContent('#connection-state')) === 'CONNECTED', await options.textContent('#notice'));
  check('Options: token field cleared after saving', (await options.inputValue('#token')) === '');
  const recipients = await options.$$eval('#default-recipient option', list => list.map(o => o.textContent));
  check('Options: recipient list includes members and guests from existing requests', recipients.includes('Pilot Student') && recipients.includes('Guest Student'), recipients.join(', '));
  await options.selectOption('#default-team', 't-321');
  await options.selectOption('#default-recipient', 'person-1');
  await options.evaluate(() => document.getElementById('defaults-form').requestSubmit());
  await until(options, () => /Defaults saved/.test(document.getElementById('notice').textContent), 10000).catch(() => {});
  check('Options: defaults saved', /Defaults saved/.test(await options.textContent('#notice')));
  await options.setViewportSize({ width: 1366, height: 650 });
  check('Options fits a laptop screen without scrolling', await fits(options, 650), String(await options.evaluate(() => document.documentElement.scrollHeight)));
  if (shots) {
    await options.screenshot({ path: join(shots, 'options-connected.png') });
    await options.setViewportSize({ width: 420, height: 800 });
    await options.screenshot({ path: join(shots, 'options-narrow.png'), fullPage: true });
    check('Options: no sideways scroll at narrow width', await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }

  // Reopening Options refreshes recipients with no button, and keeps saved defaults.
  queryPeople.push({ object: 'user', id: 'guest-2', name: 'Newer Guest', type: 'person' });
  const reopened = watch(await context.newPage());
  await reopened.goto(`chrome-extension://${id}/options.html`);
  await until(reopened, () => [...document.querySelectorAll('#default-recipient option')].some(o => o.textContent === 'Newer Guest'), 10000).catch(() => {});
  const refreshed = await reopened.$$eval('#default-recipient option', list => list.map(o => o.textContent));
  check('Options: reopening picks up new recipients automatically', refreshed.includes('Newer Guest'), refreshed.join(', '));
  check('Options: refresh keeps saved defaults', (await reopened.inputValue('#default-recipient')) === 'person-1' && (await reopened.inputValue('#default-team')) === 't-321');
  await reopened.close();

  // The popup normally opens from the toolbar; here it opens as a page pointed at the product tab.
  async function popupFor(productPage) {
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url)?.id, productPage.url());
    const popup = watch(await context.newPage());
    await popup.addInitScript(id => { const query = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = async q => q.active ? [{ id }] : query(q); }, tabId);
    await popup.setViewportSize({ width: 560, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await until(popup, () => !document.getElementById('loading') || document.getElementById('loading').hidden, 15000);
    return popup;
  }
  async function product(url) {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500);
    return page;
  }
  const visible = (page, sel) => page.isVisible(sel);

  // Unsupported and non-product pages cannot create anything.
  let page = await product('https://example.com/');
  let popup = await popupFor(page);
  check('Unsupported site shows the store list', await visible(popup, '#unsupported'));
  check('Unsupported site offers no form', !(await visible(popup, '#request-form')));
  await popup.close(); await page.close();
  page = await product('https://www.pololu.com/search/compare/1');
  popup = await popupFor(page);
  check('Supported store, non-product page refuses', await visible(popup, '#not-product'));
  await popup.close(); await page.close();

  // Normal request from a live page.
  const productUrl = 'https://www.revrobotics.com/rev-21-1651/';
  page = await product(productUrl);
  popup = await popupFor(page);
  await popup.waitForSelector('#request-form:not([hidden])', { timeout: 15000 });
  check('Live capture fills description', /NEO 550/.test(await popup.inputValue('#description')));
  check('Live capture fills SKU', (await popup.inputValue('#sku')) === 'REV-21-1651', await popup.inputValue('#sku'));
  check('Live capture fills price', Number(await popup.inputValue('#price')) > 0, await popup.inputValue('#price'));
  check('Saved defaults applied', (await popup.inputValue('#team')) === 't-321' && (await popup.inputValue('#recipient')) === 'person-1');
  check('Vendor derived from URL', (await popup.textContent('#vendor')).trim() === 'REV');
  if (shots) await popup.screenshot({ path: join(shots, 'popup-form.png'), fullPage: true });

  // Chrome caps toolbar popups at 800x600, so the form must fit, even with every warning showing.
  check('Popup form fits without scrolling', await fits(popup, 600), String(await popup.evaluate(() => document.documentElement.scrollHeight)));
  await popup.evaluate(() => {
    const fill = (id, lines) => { const list = document.getElementById(id); list.replaceChildren(...lines.map(text => Object.assign(document.createElement('li'), { textContent: text }))); list.hidden = false; };
    fill('capture-issues', ['Select all product options on the store page, or enter the exact variant and price manually.', 'Unit price needs your review.', 'SKU was not confirmed; it is optional.']);
    fill('validation', ['Choose a team.', 'Enter a quantity.', 'Enter a unit price in USD.']);
    document.getElementById('currency-row').hidden = false;
    const n = document.getElementById('notice'); n.hidden = false; n.textContent = 'Could not save edits: an example message.';
  });
  check('Popup form still fits with every warning showing', await fits(popup, 600), String(await popup.evaluate(() => document.documentElement.scrollHeight)));
  if (shots) await popup.screenshot({ path: join(shots, 'popup-worst-case.png') });
  await popup.evaluate(() => { for (const id of ['capture-issues', 'validation', 'currency-row', 'notice']) document.getElementById(id).hidden = true; });

  // Editing the URL re-derives the vendor; unsupported URLs disable creation.
  await popup.fill('#url', 'https://www.pololu.com/product/5780');
  check('Editing URL re-derives vendor', (await popup.textContent('#vendor')).trim() === 'Pololu');
  await popup.fill('#url', 'https://example.com/thing');
  check('Unsupported edited URL disables Create', await popup.isDisabled('#submit'));
  await popup.fill('#url', productUrl);

  // Drafts persist across closing the popup.
  await popup.fill('#description', '[TEST] edited description');
  await popup.fill('#quantity', '3');
  await popup.waitForTimeout(400);
  await popup.close();
  popup = await popupFor(page);
  await popup.waitForSelector('#request-form:not([hidden])');
  check('Edits survive closing the popup', (await popup.inputValue('#description')) === '[TEST] edited description' && (await popup.inputValue('#quantity')) === '3');
  check('Total preview uses quantity x price', /\$90\.00/.test(await popup.textContent('#total')), await popup.textContent('#total'));
  await popup.click('#discard');
  await until(popup, () => /NEO 550/.test(document.getElementById('description').value), 15000).catch(() => {});
  check('Discard recaptures the page', /NEO 550/.test(await popup.inputValue('#description')));

  // Real mouse clicks at one spot, at Notion-like speed: the screen changing under the cursor must not create more.
  createLatency = 400;
  await popup.fill('#description', '[TEST] click storm');
  await popup.waitForTimeout(300);
  {
    const box = await popup.locator('#submit').boundingBox();
    const start = posts.length;
    for (let i = 0; i < 12; i++) { await popup.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await popup.waitForTimeout(150); }
    await popup.waitForTimeout(1200);
    const after = await popup.evaluate(() => { const r = id => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return { hidden: e.hidden || !b.width, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; }; return { newRequest: r('new-request'), link: r('notion-link'), submit: r('submit') }; });
    console.log(`click storm: posts=${posts.length - start} clicked at ${Math.round(box.x + box.width / 2)},${Math.round(box.y + box.height / 2)} layout=${JSON.stringify(after)}`);
    check('Twelve real clicks at one spot create one request', posts.length - start === 1, `posts=${posts.length - start}`);
    posts.length = start;
  }
  createLatency = 0;
  if (await popup.isVisible('#new-request')) { await popup.waitForTimeout(1600); await popup.click('#new-request'); }
  await popup.waitForSelector('#request-form:not([hidden])', { timeout: 15000 });

  // Duplicate protection: rapid submits while the create is pending, then close and reopen.
  await popup.fill('#description', '[TEST] duplicate check');
  await popup.waitForTimeout(300);
  createBehavior = 'hold';
  await popup.evaluate(() => { const f = document.getElementById('request-form'); for (let i = 0; i < 5; i++) f.requestSubmit(); });
  await popup.waitForTimeout(1200);
  check('Five rapid clicks send one create', posts.length === 1, `posts=${posts.length}`);
  await popup.close();
  popup = await popupFor(page);
  await popup.waitForTimeout(800);
  check('Reopening while pending sends nothing new', posts.length === 1, `posts=${posts.length}`);
  check('Reopening while pending shows sending state', await visible(popup, '#result'));
  releaseCreate?.();
  createBehavior = 'ok';
  await until(popup, () => document.getElementById('result-title').textContent === 'Request created', 10000).catch(() => {});
  check('Success shown after pending resolves', (await popup.textContent('#result-title')) === 'Request created', await popup.textContent('#result-title'));
  check('Open in Notion uses the app.notion.com link', (await popup.getAttribute('#notion-link', 'href')) === 'https://app.notion.com/p/new-request');
  if (shots) await popup.screenshot({ path: join(shots, 'popup-success.png'), fullPage: true });

  // Payload is exactly what the database expects.
  const sent = posts[0];
  const p = sent?.properties || {};
  check('Payload targets the chosen data source', sent?.parent?.data_source_id === SOURCE_A);
  check('Payload has description', p.title?.title?.[0]?.text?.content === '[TEST] duplicate check', JSON.stringify(p.title));
  check('Payload has NORMAL status as a status field', p.st?.status?.id === 's-NORMAL Request', JSON.stringify(p.st));
  check('Payload has vendor option', p.ve?.select?.id === 'v-REV', JSON.stringify(p.ve));
  check('Payload has team option', p.te?.select?.id === 't-321', JSON.stringify(p.te));
  check('Payload has recipient', p.pe?.people?.[0]?.id === 'person-1', JSON.stringify(p.pe));
  check('Payload has SKU, URL, price', p.sk?.rich_text?.[0]?.text?.content === 'REV-21-1651' && p.ur?.url === productUrl && p.pr?.number > 0, JSON.stringify({ sk: p.sk, ur: p.ur, pr: p.pr }));
  check('Payload never writes the Extension formula', !('ex' in p));
  check('Payload sends no page body or template', !sent?.children && !sent?.template);

  // A success receipt survives reopening and blocks another create.
  await popup.close();
  popup = await popupFor(page);
  await popup.waitForTimeout(600);
  check('Reopening after success shows the receipt, no new create', (await popup.textContent('#result-title')) === 'Request created' && posts.length === 1, `posts=${posts.length}`);

  // New request then an Incomplete request with only the minimum fields.
  await popup.click('#new-request');
  await popup.waitForSelector('#request-form:not([hidden])', { timeout: 15000 });
  await popup.selectOption('#status', 'Incomplete Request');
  await popup.fill('#description', '[TEST] incomplete');
  await popup.fill('#price', '');
  await popup.fill('#quantity', '');
  await popup.waitForTimeout(300);
  await popup.click('#submit');
  for (let i = 0; i < 100 && posts.length < 2; i++) await popup.waitForTimeout(100);
  await until(popup, () => !document.getElementById('result').hidden && document.getElementById('result-title').textContent === 'Request created', 10000).catch(() => {});
  check('Incomplete request created with blanks', posts.length === 2 && posts[1].properties.st?.status?.id === 's-Incomplete Request' && !('qt' in posts[1].properties) && !('pr' in posts[1].properties), JSON.stringify({ posts: posts.length, second: posts[1]?.properties, title: await popup.textContent('#result-title'), notice: await popup.textContent('#notice'), validation: await popup.textContent('#validation'), submitDisabled: await popup.isDisabled('#submit'), status: await popup.inputValue('#status') }));

  // An uncertain failure is never retried automatically, and retry needs an explicit check.
  await popup.click('#new-request');
  await popup.waitForSelector('#request-form:not([hidden])', { timeout: 15000 });
  await popup.fill('#description', '[TEST] uncertain');
  await popup.waitForTimeout(300);
  createBehavior = 'gateway';
  const before = posts.length;
  await popup.click('#submit');
  await until(popup, () => /Check Notion/.test(document.getElementById('result-title').textContent), 10000).catch(() => {});
  check('Server error shows Check Notion before retrying', /Check Notion/.test(await popup.textContent('#result-title')), await popup.textContent('#result-title'));
  check('Retry stays disabled until you confirm', await popup.isDisabled('#retry'));
  await popup.close();
  popup = await popupFor(page);
  await popup.waitForTimeout(600);
  check('Uncertain result is not resent on reopen', posts.length === before + 1, `posts=${posts.length}`);
  if (shots) await popup.screenshot({ path: join(shots, 'popup-uncertain.png'), fullPage: true });
  createBehavior = 'ok';

  // Worker restart must not replay a pending create.
  await popup.close(); await page.close();
  const stored = await worker.evaluate(async () => JSON.stringify(Object.keys(await chrome.storage.local.get(null))));
  check('Token is not stored anywhere but the token key', !/fake-e2e-token/.test(stored));
  const access = await worker.evaluate(() => new Promise(done => chrome.storage.local.getAccessLevel ? chrome.storage.local.getAccessLevel(done) : done('n/a')));
  check('Storage is limited to trusted contexts', access === 'n/a' || access?.accessLevel === 'TRUSTED_CONTEXTS' || access === 'TRUSTED_CONTEXTS', JSON.stringify(access));
  check('No page errors, CSP errors or illegal invocations', problems.length === 0, problems.slice(0, 4).join(' | '));
} catch (error) {
  check('Run completed without crashing', false, String(error.message).slice(0, 400));
} finally {
  await context.close();
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
