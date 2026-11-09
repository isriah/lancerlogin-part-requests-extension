// End-to-end run of Carts in the built extension, in a real browser, with a simulated plugin API and synthetic copies of the four stores routed
// at their real addresses. No request leaves the computer. Run: npm run build && npm run e2e:carts. E2E_SCREENSHOTS=<folder> saves built-carts-*.png.
//
// On Windows with Edge (the default there) Chrome's real permission prompt shows, so the window is headed and press-prompt-button.ps1 presses Allow
// or Deny through UI Automation. Don't use the mouse during that part. Elsewhere, or with E2E_PROMPT=stub, the prompt is simulated, which proves less.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createStores } from './carts/synthetic-stores.mjs';

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const work = mkdtempSync(join(tmpdir(), 'part-requests-carts-e2e-'));
const shots = process.env.E2E_SCREENSHOTS;
const channel = process.env.E2E_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium');
const realPrompt = process.env.E2E_PROMPT !== 'stub' && process.platform === 'win32' && channel === 'msedge';
const SITE = 'https://team-site.example.test';
const STORE_ORIGINS = ['https://www.homedepot.com/*', 'https://www.aliexpress.us/*', 'https://www.aliexpress.com/*', 'https://www.amazon.com/*', 'https://ambrosiafilament.com/*', 'https://andymark.com/*', 'https://us.store.bambulab.com/*', 'https://store.ctr-electronics.com/*', 'https://www.ferrulesdirect.com/*', 'https://www.harborfreight.com/*', 'https://www.mcmaster.com/*', 'https://www.onlinemetals.com/*', 'https://www.pololu.com/*', 'https://powerwerx.com/*', 'https://www.revrobotics.com/*', 'https://www.swervedrivespecialties.com/*', 'https://swervedrivespecialties.com/*', 'https://swyftrobotics.com/*', 'https://www.thethriftybot.com/*', 'https://www.vbeltguys.com/*', 'https://wcproducts.com/*', 'https://west3d.com/*'];
const NOTICE = 'No AI places your orders. This extension doesn\'t use AI. It only helps add items to a store\'s cart, after you click Build carts. You review the cart and place every order yourself on the store\'s own site.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ` -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };
const sleep = ms => new Promise(done => setTimeout(done, ms));

const productionManifest = JSON.parse(readFileSync(join(root, 'dist', 'manifest.json'), 'utf8'));
check('Manifest: version 0.6.0', productionManifest.version === '0.6.0');
check('Manifest: no cookie, web-request or always-on host access', !/cookies|webRequest|declarativeNet/.test(JSON.stringify(productionManifest)) && !productionManifest.host_permissions);
const extension = join(work, 'extension');
cpSync(join(root, 'dist'), extension, { recursive: true });
// The test copy changes one thing: the simulated site is listed, so pairing needs no prompt. Store access is left to the real flow unless the prompt is stubbed.
writeFileSync(join(extension, 'manifest.json'), JSON.stringify({ ...productionManifest, host_permissions: [`${SITE}/*`] }));

// The simulated plugin, following the "Carts" part of its README.
const DEVICE_KEY = 'e2eFakeDeviceKey00000000000000000000000000x'.slice(0, 43);
const NOTION = 'https://app.notion.com/p/synthetic';
const api = {
  cartsEnabled: true, orders: [], marks: [], marksCalls: [], marksAt: [], ordersCalls: [], script: [], marksScript: [], revoked: false, cookies: [], bodies: [],
  list: {},
};
const order = (id, extra) => ({ id, url: `${NOTION}-${id}`, description: `Test item ${id}`, vendor: null, urlVendor: null, sku: null, productUrl: null, quantity: 1, unitPrice: 10, status: 'NORMAL Request', statusGroup: 'NORMAL', teams: ['Test Team One'], requesters: ['Test Student A'], cartMarks: [], ...extra });
const wcpOrder = (id, extra) => order(id, { vendor: 'WCP', urlVendor: 'WCP', productUrl: 'https://wcproducts.com/products/test-hex-shaft?variant=1001', sku: 'WCP-1001', quantity: 4, unitPrice: 6.3, description: 'Test hex shaft, 4 in.', ...extra });
const revOrder = (id, extra) => order(id, { vendor: 'REV', urlVendor: 'REV', productUrl: 'https://www.revrobotics.com/test-motor/', sku: 'TEST-3001', quantity: 1, unitPrice: 30, description: 'Test brushless motor', ...extra });
const amOrder = (id, extra) => order(id, { vendor: 'AndyMark', urlVendor: 'AndyMark', productUrl: 'https://andymark.com/products/test-screw', sku: 'AM-TEST-25', quantity: 1, unitPrice: 0.05, description: 'Test small screw', ...extra });
const polOrder = (id, extra) => order(id, { vendor: 'Pololu', urlVendor: 'Pololu', productUrl: 'https://www.pololu.com/product/2136', quantity: 2, unitPrice: 15.95, description: 'Test motor driver', ...extra });
const mcmOrder = (id, extra) => order(id, { vendor: 'McMaster', urlVendor: 'McMaster', productUrl: 'https://www.mcmaster.com/91251A537/', quantity: 2, unitPrice: 21.4, description: 'Test socket head screws, pack of 50', ...extra });
const fullList = () => [
  mcmOrder('m1'), wcpOrder('w1'), wcpOrder('w2', { description: 'Test compliant wheel, 4 in.', sku: 'WCP-2001', productUrl: 'https://wcproducts.com/products/test-wheel', status: 'SLOW Request', statusGroup: 'SLOW', quantity: 2, unitPrice: 9.5, requesters: ['Test Student C'] }),
  revOrder('r1', { status: 'RUSH Request', statusGroup: 'RUSH', requesters: ['Test Student D'] }),
  revOrder('r4', { description: 'Test item in another cart', sku: 'TEST-3004', cartMarks: [{ memberName: 'Test Student B', deviceLabel: 'Workshop laptop', quantity: 1, markedMs: Date.now() - 86400000, expiresMs: Date.now() + 86400000, ownDevice: false }] }),
  revOrder('r2', { description: 'Test incomplete with no SKU', sku: null, quantity: null, unitPrice: null, status: 'Incomplete Request', statusGroup: 'INCOMPLETE' }),
  revOrder('r3', { description: 'Test incomplete with everything', sku: 'TEST-3003', status: 'Incomplete Request', statusGroup: 'INCOMPLETE', quantity: 1 }),
  polOrder('p1', { unitPrice: 14.85 }),
  order('h1', { vendor: 'Bolt Barn', productUrl: 'https://bolt-barn.example.test/p/test/100', quantity: 3, unitPrice: 2.97, description: 'Test machine screws, 15 pack' }),
  order('o1', { vendor: null, productUrl: 'https://not-a-store.example.test/thing', quantity: 1, unitPrice: 18, description: 'Test sheet from nowhere known' }),
];
async function plugin(route) {
  const request = route.request();
  const url = new URL(request.url());
  const reply = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  const cookie = request.headers().cookie; if (cookie) api.cookies.push(cookie);
  if (request.postData()) api.bodies.push(request.postData());
  if (url.pathname === '/api/setup/status') return reply({ settings: { primaryColor: '#0b3d91', secondaryColor: '#f58220', organizationName: 'Test Robotics Team A' } });
  const name = url.pathname.slice('/api/public/part-requests'.length);
  if (name === '/pair') return reply({ deviceKey: DEVICE_KEY, memberName: 'Test Student A' }, 201);
  if (name === '/devices/self/revoke') { api.revoked = true; return reply({ revoked: true }); }
  if (api.revoked) return reply({ error: 'This device is no longer paired.', code: 'pair_again' }, 401);
  if (name === '/options') return reply({ memberName: 'Test Student A', teams: [{ id: 't', name: 'Test Team One' }], recipients: [{ id: 'p', name: 'Test Student A' }], defaultRecipientId: 'p', statuses: [], vendors: [], recipientsUpdatedMs: 1, minimumExtensionVersion: '0.3.0', updateUrl: null, databaseLink: null, cartsEnabled: api.cartsEnabled });
  if (name === '/orders') {
    api.ordersCalls.push(url.search);
    const scripted = api.script.shift();
    if (scripted) return reply(scripted.body, scripted.status ?? 200, scripted.headers ?? {});
    if (!api.cartsEnabled) return reply({ error: 'An Admin turned Carts off for this team.', code: 'carts_disabled' }, 403);
    return reply({ orders: api.orders, fetchedMs: Date.now(), stale: false, refreshing: false, refreshError: null, truncated: false, skippedRows: 0, statuses: [], ...api.list });
  }
  if (name === '/orders/marks') {
    const body = request.postDataJSON();
    api.marksCalls.push(body);
    api.marksAt.push({ at: Date.now(), orderIds: body.marks.map(mark => mark.orderId) });
    const scripted = api.marksScript.shift();
    if (scripted) return reply(scripted.body, scripted.status, scripted.headers ?? {});
    if (!api.cartsEnabled) return reply({ error: 'An Admin turned Carts off for this team.', code: 'carts_disabled' }, 403);
    api.marks.push(...body.marks);
    return reply({ marked: body.marks.length, markedMs: Date.now(), expiresMs: Date.now() + 1000 }, 201);
  }
  return reply({ error: 'Not found' }, 404);
}
// waitForFunction evaluates strings, which the extension's CSP correctly refuses.
const until = async (page, predicate, timeout = 15000, arg) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await page.evaluate(predicate, arg).catch(() => false)) return true; await sleep(100); } return false; };
const shot = async (page, name, fullPage = true) => { if (!shots) return; await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: join(shots, `built-carts-${name}.png`), fullPage }); };

const profile = join(work, 'profile');
const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.E2E_BROWSER ? { executablePath: process.env.E2E_BROWSER } : { channel }), headless: !realPrompt && !process.env.E2E_HEADED, viewport: { width: 1366, height: 860 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check'],
});
function pressPrompt(button) {
  const listed = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${profile.replaceAll("'", "''")}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1).ProcessId`], { encoding: 'utf8' }).trim();
  if (!/^\d+$/.test(listed)) return `no browser process found for the test profile (${listed})`;
  const pressed = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'press-prompt-button.ps1'), '-RootPid', listed, '-Button', button], { encoding: 'utf8' });
  return pressed.stdout.trim() || pressed.stderr.trim();
}
const problems = [], remote = [], outsiders = [];
const stores = createStores();
try {
  await context.route(`${SITE}/**`, plugin);
  await stores.install(context);
  const allowedHosts = /^(https:\/\/team-site\.example\.test|https:\/\/wcproducts\.com|https:\/\/andymark\.com|https:\/\/www\.revrobotics\.com|https:\/\/www\.pololu\.com|https:\/\/www\.mcmaster\.com|https:\/\/www\.homedepot\.com|https:\/\/www\.aliexpress\.us|chrome-extension:|data:|about:|chrome:|edge:)/;
  // Anything else would really leave the computer, so it never gets that far.
  await context.route('**/*', route => {
    const url = route.request().url();
    if (allowedHosts.test(url)) return route.fallback();
    outsiders.push(url);
    return route.abort();
  });
  context.on('request', request => {
    let from = '';
    try { from = request.frame().url(); } catch { /* The service worker has no frame, and it is allowed to call the site. */ }
    const url = request.url();
    if (from.startsWith('chrome-extension://') && !url.startsWith('chrome-extension://') && !url.startsWith('data:')) remote.push(url);
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const watch = page => { page.on('pageerror', e => problems.push(`${page.url().slice(0, 50)}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Illegal invocation|Uncaught/.test(m.text())) problems.push(m.text()); }); return page; };
  const options = watch(await context.newPage());
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForSelector('#pair-form:not([hidden])');

  // ---- The switch.
  check('Options: the Carts switch is off and disabled until paired', !(await options.isChecked('#carts-enabled')) && await options.isDisabled('#carts-enabled'));
  await options.fill('#site-address', SITE); await options.fill('#pin', 'K7M2-9QXP'); await options.fill('#device-label', 'Test laptop');
  await options.click('#pair');
  await options.waitForSelector('#paired-card:not([hidden])', { timeout: 15000 });
  check('Options: Carts is off by default after pairing', !(await options.isChecked('#carts-enabled')) && !(await options.isDisabled('#carts-enabled')));
  check('Options: no Open Carts button while it\'s off', !(await options.isVisible('#carts-open')));
  const access = page => page.evaluate(origins => Promise.all(origins.map(origin => chrome.permissions.contains({ origins: [origin] }))), STORE_ORIGINS);
  check('No store access before the switch', (await access(options)).every(granted => !granted));

  const openCarts = async () => { const page = watch(await context.newPage()); await page.goto(`chrome-extension://${id}/carts.html`); return page; };
  let carts = await openCarts();
  await until(carts, () => !document.getElementById('state').hidden);
  check('Carts page: says it\'s off, and reads nothing', /off on this device/.test(await carts.textContent('#state-title')) && api.ordersCalls.length === 0, await carts.textContent('#state-title'));
  check('Carts page: the notice shows even when off', (await carts.textContent('#carts-notice')) === NOTICE);
  await carts.close();

  const popupOpen = async () => { const page = watch(await context.newPage()); await page.setViewportSize({ width: 560, height: 600 }); await page.goto(`chrome-extension://${id}/popup.html`); await sleep(500); return page; };
  let popup = await popupOpen();
  check('Popup: no Carts button while it\'s off', !(await popup.isVisible('#carts')));
  await popup.close();

  const flip = async button => {
    await options.bringToFront();
    if (!realPrompt) await options.evaluate(allow => { chrome.permissions.request = async () => allow; }, button === 'Allow');
    await options.click('#carts-enabled');
    if (button && realPrompt) return pressPrompt(button);
    return 'no prompt expected';
  };
  const denied = await flip('Deny');
  await until(options, () => document.getElementById('carts-enabled').checked && /without store access/.test(document.getElementById('notice').textContent));
  check(`Switch: Deny still turns Carts on, as a checklist (${realPrompt ? 'real prompt' : 'simulated'})`, /without store access/.test(await options.textContent('#notice')), `${denied}: ${await options.textContent('#notice')}`);
  if (realPrompt) check('Switch: Deny leaves no store access', (await access(options)).every(granted => !granted));
  await options.click('#carts-enabled');
  await until(options, () => /Carts is off/.test(document.getElementById('notice').textContent));
  const allowed = await flip('Allow');
  await until(options, () => /Carts is on\. Open Carts/.test(document.getElementById('notice').textContent));
  check(`Switch: Allow turns Carts on (${realPrompt ? 'real prompt' : 'simulated'})`, /Carts is on\. Open Carts/.test(await options.textContent('#notice')), `${allowed}: ${await options.textContent('#notice')}`);
  if (realPrompt) check('Switch: every store origin came from that one click', (await access(options)).every(Boolean), await access(options));
  else await context.grantPermissions?.([]).catch(() => undefined);
  check('Options: Open Carts shows', await options.isVisible('#carts-open'));
  await options.setViewportSize({ width: 1366, height: 650 });
  await options.evaluate(() => { document.getElementById('notice').hidden = true; return document.fonts.ready; });
  const sizes = () => options.evaluate(() => ({ tall: document.documentElement.scrollHeight, wide: document.documentElement.scrollWidth, cards: document.querySelectorAll('.ui-card').length, width: innerWidth }));
  const closed = await sizes();
  check('Options: one card, fitting 1366x650 with everything on and details collapsed', closed.cards === 1 && closed.tall <= 650 && closed.wide <= closed.width, closed);
  if (shots) await options.screenshot({ path: join(shots, 'built-options-one-card.png') });
  await options.evaluate(() => { document.querySelector('.settings-disclosure').open = true; });
  const opened = await sizes();
  check('Options: opening a details section may scroll, and never sideways', opened.wide <= opened.width, opened);
  await options.evaluate(() => { document.querySelector('.settings-disclosure').open = false; });
  await options.setViewportSize({ width: 375, height: 800 });
  check('Options: no sideways scroll at phone width', await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await options.setViewportSize({ width: 1366, height: 860 });

  api.orders = fullList();
  const [fromOptions] = await Promise.all([context.waitForEvent('page'), options.click('#carts-open')]);
  await fromOptions.waitForLoadState();
  check('Options: Open Carts opens a full extension page', fromOptions.url().endsWith('/carts.html'), fromOptions.url());
  await fromOptions.close();
  popup = await popupOpen();
  check('Popup: the Carts button shows', await popup.isVisible('#carts'));
  const [fromPopup] = await Promise.all([context.waitForEvent('page'), popup.click('#carts')]);
  await fromPopup.waitForLoadState();
  check('Popup: Carts opens a full extension page', fromPopup.url().endsWith('/carts.html'), fromPopup.url());
  await fromPopup.close(); await popup.close();

  // ---- The screen, and what starts ticked.
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])', { timeout: 15000 });
  const ticked = rowId => carts.isChecked(`input[data-order="${rowId}"]`);
  const disabled = rowId => carts.isDisabled(`input[data-order="${rowId}"]`);
  const rowText = rowId => carts.textContent(`tr[data-order-row="${rowId}"]`);
  check('Screen: the notice is word for word', (await carts.textContent('#carts-notice')) === NOTICE);
  const placing = await carts.evaluate(() => { const n = document.getElementById('carts-notice').getBoundingClientRect(), t = document.getElementById('orders-table').getBoundingClientRect(); return { above: n.top < t.top, tall: n.height, color: getComputedStyle(document.getElementById('carts-notice')).color }; });
  check('Screen: the notice sits above the list', placing.above, placing);
  check('Screen: stores are grouped, by name, unknown last', JSON.stringify(await carts.evaluate(() => [...document.querySelectorAll('tbody')].map(b => b.querySelector('.x-vendor-heading span').textContent))) === JSON.stringify(['Bolt Barn', 'McMaster', 'Pololu', 'REV', 'WCP', 'Other store']));
  const badges = await carts.evaluate(() => Object.fromEntries([...document.querySelectorAll('tbody')].map(b => [b.querySelector('.x-vendor-heading span').textContent, b.querySelector('.x-method').textContent])));
  if (realPrompt) check('Screen: each store shows its method', JSON.stringify(badges) === JSON.stringify({ 'Bolt Barn': 'Checklist', McMaster: 'Item by item', Pololu: 'Item by item', REV: 'Direct', WCP: 'Direct', 'Other store': 'Checklist' }), badges);
  check('Selection: NORMAL starts ticked', await ticked('w1') && await ticked('m1'));
  check('Selection: RUSH starts ticked', await ticked('r1'));
  check('Selection: SLOW starts unticked, and can be ticked', !(await ticked('w2')) && !(await disabled('w2')));
  check('Selection: Incomplete with what its store needs starts unticked, and can be ticked', !(await ticked('r3')) && !(await disabled('r3')));
  check('Incomplete: missing what its store needs is flagged and can\'t be ticked', !(await ticked('r2')) && await disabled('r2') && /Can't add yet.*REV needs a SKU and a quantity/.test(await rowText('r2')), await rowText('r2'));
  check('Marks: "already in someone\'s cart" names who', /Already in someone's cart.*Test Student B \(Workshop laptop\), qty 1/.test(await rowText('r4')), await rowText('r4'));
  check('Marks: already in someone\'s cart starts unticked, and can be ticked', !(await ticked('r4')) && !(await disabled('r4')));
  check('Row: requester, quantity and price show', /Test Student C/.test(await rowText('w2')) && /\$9\.50/.test(await rowText('w2')) && (await carts.$eval('tr[data-order-row="w2"]', r => r.cells[2].textContent)) === '2');
  check('Row: RUSH has its own pill', /RUSH/.test(await rowText('r1')));
  check('Bar: counts what is ticked', (await carts.textContent('#selection-count')) === '6 of 10 items selected from 6 stores', await carts.textContent('#selection-count'));
  const estimate = 2 * 21.4 + 4 * 6.3 + 30 + 2 * 14.85 + 3 * 2.97 + 18;
  check('Bar: estimates the total', (await carts.textContent('#selection-total')).includes(`$${estimate.toFixed(2)}`), await carts.textContent('#selection-total'));
  await carts.click('input[data-group="wcp"]');
  check('Group: its box ticks every row it can', await ticked('w1') && await ticked('w2') && (await carts.textContent('#selection-count')).startsWith('7 of 10'));
  await carts.click('input[data-group="wcp"]');
  check('Group: and unticks them', !(await ticked('w1')) && !(await ticked('w2')));
  await carts.click('input[data-order="w1"]');
  check('Group: one of two shows as partly ticked', await carts.$eval('input[data-group="wcp"]', box => box.indeterminate));
  const bar = await carts.evaluate(async () => { scrollTo(0, 600); await new Promise(done => setTimeout(done, 100)); const box = document.getElementById('action-bar').getBoundingClientRect(); const seen = box.top >= 0 && box.bottom <= innerHeight; scrollTo(0, 0); return { seen, position: getComputedStyle(document.getElementById('action-bar')).position, wide: document.documentElement.scrollWidth <= innerWidth + 1 }; });
  await carts.setViewportSize({ width: 1366, height: 500 });
  const stuck = await carts.evaluate(async () => { scrollTo(0, document.documentElement.scrollHeight); await new Promise(done => setTimeout(done, 100)); const box = document.getElementById('action-bar').getBoundingClientRect(); return { scrolled: scrollY > 0, seen: box.top >= 0 && box.bottom <= innerHeight }; });
  await carts.setViewportSize({ width: 1366, height: 860 });
  check('Bar: sticks while the list scrolls', bar.position === 'sticky' && stuck.scrolled && stuck.seen, { bar, stuck });
  await carts.evaluate(() => scrollTo(0, 0));
  await shot(carts, 'orders');
  await carts.setViewportSize({ width: 375, height: 800 });
  check('Screen: no sideways scroll at phone width', await carts.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), await carts.evaluate(() => document.documentElement.scrollWidth));
  await carts.setViewportSize({ width: 1366, height: 860 });
  await carts.close();

  // ---- Every answer of GET /orders.
  const showing = async (body, status, headers) => {
    api.script = [{ body, status, headers }];
    const page = await openCarts();
    return page;
  };
  api.orders = [];
  carts = await openCarts();
  await until(carts, () => document.getElementById('state-title').textContent === 'No open orders');
  check('Empty: says so, with Check again', (await carts.textContent('#state-title')) === 'No open orders' && (await carts.textContent('#state-action')) === 'Check again');
  await shot(carts, 'empty');
  const before = api.ordersCalls.length;
  await carts.click('#state-action');
  await until(carts, n => n > 0, 500, 1);
  await sleep(300);
  check('Empty: Check again asks with refresh=1', api.ordersCalls.slice(before).includes('?refresh=1'), api.ordersCalls.slice(before));
  await carts.close();

  api.orders = [wcpOrder('w1')];
  carts = await showing({ state: 'refreshing', orders: [], retryAfterSeconds: 1 }, 202, { 'Retry-After': '1' });
  await until(carts, () => /nothing to show yet/.test(document.getElementById('state-text').textContent));
  check('202: says nothing yet, not "no orders"', /doesn't mean there are no orders/.test(await carts.textContent('#state-text')), await carts.textContent('#state-text'));
  await carts.waitForSelector('#orders-view:not([hidden])', { timeout: 8000 });
  check('202: asks again and then shows the orders', await carts.isVisible('tr[data-order-row="w1"]'));
  await carts.close();

  api.script = [{ body: { orders: [wcpOrder('w1')], fetchedMs: Date.now(), refreshing: true } }, { body: { orders: [wcpOrder('w1'), wcpOrder('w9', { sku: 'WCP-1002', productUrl: 'https://wcproducts.com/products/test-hex-shaft?variant=1002' })], fetchedMs: Date.now(), refreshing: false } }];
  carts = await openCarts();
  await carts.waitForSelector('tr[data-order-row="w1"]');
  check('refreshing: true shows what it has, and says more may come', /Still reading/.test(await carts.textContent('#list-notices')) || await carts.isVisible('tr[data-order-row="w9"]'));
  await carts.waitForSelector('tr[data-order-row="w9"]', { timeout: 6000 });
  check('refreshing: true asks again after a second', await carts.isVisible('tr[data-order-row="w9"]') && !/Still reading/.test(await carts.textContent('#list-notices')));
  await carts.close();

  carts = await showing({ orders: [wcpOrder('w1')], fetchedMs: Date.now() - 5 * 60000, stale: true, refreshError: 'rate_limited', refreshing: false, truncated: true, skippedRows: 3 });
  await carts.waitForSelector('tr[data-order-row="w1"]');
  const told = await carts.textContent('#list-notices');
  check('stale: shows its age and the code', /out of date/.test(told) && /5 minutes ago/.test(told) && /rate_limited/.test(told), told);
  check('truncated: says the newest are missing', /more than 500 rows/.test(told), told);
  check('skippedRows: says how many', /3 rows left out/.test(told), told);
  await shot(carts, 'stale');
  await carts.close();

  carts = await showing({ error: 'Turned off by an Admin here.', code: 'carts_disabled' }, 403);
  await until(carts, () => document.getElementById('state-title').textContent === 'Carts is turned off');
  check('403 carts_disabled: shows the site\'s words', (await carts.textContent('#state-text')) === 'Turned off by an Admin here.', await carts.textContent('#state-text'));
  await carts.close();

  for (const code of ['notion_access_lost', 'notion_not_connected', 'notion_schema_changed', 'credentials_unavailable', 'credentials_unreadable']) {
    carts = await showing({ error: `Admin problem ${code}.`, code }, 503);
    await until(carts, () => document.getElementById('state-title').textContent === 'An Admin has to fix this');
    check(`503 ${code}: says an Admin has to act`, (await carts.textContent('#state-text')).includes(code), await carts.textContent('#state-text'));
    await carts.close();
  }
  for (const [status, code] of [[429, 'rate_limited'], [502, 'notion_unavailable'], [503, 'notion_rate_limited']]) {
    carts = await showing({ error: `Waiting on ${code}.`, code, retryAfterSeconds: 1 }, status, { 'Retry-After': '1' });
    await carts.waitForSelector('#orders-view:not([hidden])', { timeout: 8000 });
    check(`${status} ${code}: waits and asks again by itself`, await carts.isVisible('tr[data-order-row="w1"]'));
    await carts.close();
  }

  // ---- A build across every kind of store.
  const build = async page => { await page.click('#build'); await page.waitForSelector('#results-view:not([hidden])', { timeout: 120000 }); };
  const cardText = (page, store) => page.textContent(`[data-result="${store}"]`);
  const fresh = () => { stores.state.reset(); api.marks.length = 0; api.marksCalls.length = 0; api.marksAt.length = 0; api.bodies.length = 0; };
  fresh();
  api.orders = fullList();
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  const pagesBefore = context.pages().length;
  await carts.click('#build');
  await until(carts, () => /^Building/.test(document.getElementById('selection-count').textContent), 15000);
  check('Build: shows progress and a Stop button', /^Building/.test(await carts.textContent('#selection-count')) && await carts.isVisible('#stop'));
  await carts.waitForSelector('#results-view:not([hidden])', { timeout: 120000 });
  await shot(carts, 'results');
  check('Results: the notice stays, and says nothing was bought', (await carts.textContent('#carts-notice')) === NOTICE && /Nothing was bought/.test(await carts.textContent('#results-view')));
  check('Results: the summary counts', /3 added, 1 flagged, 0 failed, 2 to add yourself/.test(await carts.textContent('#results-counts')), await carts.textContent('#results-counts'));
  check('WCP: added, with the variant from the link', stores.state.wcp.cart.get(1001) === 4 && /1 added/.test(await cardText(carts, 'wcp')), [...stores.state.wcp.cart]);
  const wcpAdd = stores.state.adds().filter(a => a.store === 'wcp');
  check('WCP: one line to /cart/add.js', wcpAdd.length === 1 && wcpAdd[0].url.endsWith('/cart/add.js') && wcpAdd[0].body.items.length === 1 && wcpAdd[0].body.items[0].quantity === 4, wcpAdd);
  const wcpLog = stores.state.log.filter(a => a.store === 'wcp').map(a => new URL(a.url).pathname).join(' ');
  check('WCP: read the product, read the cart, added, read the cart, loaded the cart page, read the cart', wcpLog === '/cart /products/test-hex-shaft.js /cart.js /cart/add.js /cart.js /cart /cart.js', wcpLog);
  const lastWcpRead = stores.state.log.filter(a => a.store === 'wcp' && new URL(a.url).pathname === '/cart.js').at(-1).at;
  check('Final read: the store\'s marks came after it', api.marksAt.find(call => call.orderIds.includes('w1'))?.at >= lastWcpRead, { lastWcpRead, marksAt: api.marksAt });
  check('REV: added with action=add', stores.state.rev.cart.get('TEST-3001') === 1 && stores.state.adds().filter(a => a.store === 'rev').every(a => /action=add&sku=TEST-3001&qty=1/.test(a.url)));
  check('Pololu: Quick add line, read back, and the price change is flagged', stores.state.pololu.cart.get('2136') === 2 && stores.state.adds().some(a => a.store === 'pololu' && a.body === '2136,2') && /Price changed: requested at \$14\.85, store shows \$15\.95/.test(await cardText(carts, 'pololu')), await cardText(carts, 'pololu'));
  check('McMaster: pasted one line, pressed ADD, read back', stores.state.mcmaster.cart.get('91251A537') === 2 && /1 added/.test(await cardText(carts, 'mcmaster')), await cardText(carts, 'mcmaster'));
  check('Checklist: a store with no method lists links and quantities', /Add these yourself/.test(await cardText(carts, 'checklist:bolt-barn')) && /qty 3/.test(await cardText(carts, 'checklist:bolt-barn')) && await carts.$eval('[data-result="checklist:bolt-barn"] li a', a => a.href === 'https://bolt-barn.example.test/p/test/100'));
  check('Checklist: an unknown store does too', /Test sheet from nowhere known, qty 1/.test(await cardText(carts, 'checklist:other-store')) && await carts.$eval('[data-result="checklist:other-store"] li a', a => a.href === 'https://not-a-store.example.test/thing'));
  check('Checklist: nothing went to those sites', !outsiders.some(url => /bolt-barn|not-a-store/.test(url)), outsiders);
  const cartLinks = await carts.$$eval('[data-result] a.ui-button', links => links.map(a => a.href));
  check('Results: a link to each built cart, none to checkout', ['https://wcproducts.com/cart', 'https://www.revrobotics.com/cart.php', 'https://www.pololu.com/cart', 'https://www.mcmaster.com/orders/'].every(url => cartLinks.includes(url)) && !cartLinks.some(url => /checkout/.test(url)), cartLinks);
  check('Marks: only the confirmed orders, as ID and quantity', JSON.stringify(api.marks.map(m => m.orderId).sort()) === JSON.stringify(['m1', 'p1', 'r1', 'w1']) && api.marks.every(m => Object.keys(m).sort().join() === 'orderId,quantity'), api.marks);
  check('Privacy: other cart lines never reach the page or the site', !/Private other line|OTHER-LINE|999999|synthetic@example|private cart note/.test(`${await carts.textContent('body')} ${api.bodies.join(' ')}`));
  check('Privacy: no cookie, store or otherwise, ever reached the site', api.cookies.length === 0, api.cookies);
  check('Tabs: every store tab is closed afterwards', context.pages().length === pagesBefore, `${context.pages().length} vs ${pagesBefore}`);
  const gaps = stores.state.addTimes.slice(1).map((at, i) => at - stores.state.addTimes[i]);
  check('Pace: a modest delay between lines', gaps.every(gap => gap >= 500), gaps);
  check('No checkout: not one request reached a checkout address', stores.state.checkoutHits.length === 0, stores.state.checkoutHits);

  // ---- Back, and the same again.
  const totals = () => JSON.stringify([[...stores.state.wcp.cart], [...stores.state.rev.cart], [...stores.state.pololu.cart], [...stores.state.mcmaster.cart]]);
  const holding = totals(), addsSoFar = stores.state.adds().length;
  await carts.click('#back');
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('Retry: a second build adds nothing, in any store', stores.state.adds().length === addsSoFar && totals() === holding, { adds: stores.state.adds().length, holding, now: totals() });
  check('Retry: says each is already in the cart', /Already in the cart: it holds 4, so nothing was added/.test(await cardText(carts, 'wcp')) && /Already in the cart: it holds 1/.test(await cardText(carts, 'rev')), await cardText(carts, 'wcp'));
  await carts.close();

  // Home Depot and Ali Express can't run live from an automated profile, so this is where their injected functions run in a real browser. Synthetic pages only.
  fresh();
  api.orders = [
    order('hd1', { vendor: 'Home Depot', urlVendor: 'Home Depot', productUrl: 'https://www.homedepot.com/p/Test-Hex-Nut/204647886', quantity: 3, unitPrice: null, description: 'Test hex nut' }),
    order('ali1', { vendor: 'Ali Express', urlVendor: 'Ali Express', productUrl: 'https://www.aliexpress.us/item/3256800000000001.html', quantity: 2, unitPrice: null, description: 'Test wire - Size: 0.8mm (5Meter)' }),
  ];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('Home Depot: pressed the page\'s own button, read back after the rows loaded, and named the kept choice', stores.state.homedepot.cart.get('204647886') === 3 && /kept: Delivery/.test(await cardText(carts, 'homedepot')) && stores.state.homedepot.otherPresses === 0, await cardText(carts, 'homedepot'));
  check('Ali Express: selected the named option, added, read back, and said it leaves the ticks alone', stores.state.aliexpress.cart.get('0.8mm (5Meter)') === 2 && /1 added/.test(await cardText(carts, 'aliexpress')) && /leaves those ticks alone/.test(await cardText(carts, 'aliexpress')) && stores.state.aliexpress.otherPresses === 0, await cardText(carts, 'aliexpress'));
  check('Home Depot and Ali Express: only the confirmed orders are marked', JSON.stringify(api.marks.map(m => m.orderId).sort()) === JSON.stringify(['ali1', 'hd1']), api.marks);
  const hdAliAdds = stores.state.adds().length;
  await carts.click('#back');
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('Home Depot and Ali Express: a second build adds nothing', stores.state.adds().length === hdAliAdds && /Already in the cart: it holds 3/.test(await cardText(carts, 'homedepot')) && /Already in the cart: it holds 2/.test(await cardText(carts, 'aliexpress')), { adds: stores.state.adds().length, hdAliAdds });
  await carts.close();
  fresh();
  stores.state.homedepot.mode = 'oops';
  api.orders = [order('hd1', { vendor: 'Home Depot', urlVendor: 'Home Depot', productUrl: 'https://www.homedepot.com/p/Test-Hex-Nut/204647886', quantity: 1, unitPrice: null, description: 'Test hex nut' })];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('Home Depot: the Oops page stops the store, with nothing pressed', /CAPTCHA or bot check/.test(await cardText(carts, 'homedepot')) && stores.state.adds().length === 0, await cardText(carts, 'homedepot'));
  await carts.close();

  // A retry after a store capped a line asks only for what is missing, and a partly filled cart adds the difference.
  fresh();
  api.orders = [wcpOrder('w1', { quantity: 5 })];
  stores.state.wcp.stock.set(1001, 3);
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('Short stock: reported', /Short stock: asked for 5, and the cart holds 3/.test(await cardText(carts, 'wcp')) && stores.state.wcp.cart.get(1001) === 3, await cardText(carts, 'wcp'));
  check('Short stock: no mark', api.marks.length === 0, api.marks);
  await carts.click('#back');
  await carts.waitForSelector('#orders-view:not([hidden])');
  stores.state.wcp.stock.set(1001, 100);
  await build(carts);
  const shortAdds = stores.state.adds().map(a => a.body.items[0].quantity);
  check('Short stock: a retry adds only what is missing', JSON.stringify(shortAdds) === '[5,2]' && stores.state.wcp.cart.get(1001) === 5, shortAdds);
  check('Short stock: the mark comes once the cart holds it all', api.marks.length === 1 && api.marks[0].orderId === 'w1' && api.marks[0].quantity === 5, api.marks);
  await carts.close();

  fresh();
  stores.state.wcp.mode = 'double';
  api.orders = [wcpOrder('w1', { quantity: 2 })];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('Read-back mismatch: reported plainly', /Quantity mismatch: the cart should hold 2, but it holds 4/.test(await cardText(carts, 'wcp')), await cardText(carts, 'wcp'));
  check('Read-back mismatch: no mark', api.marks.length === 0 && api.marksCalls.length === 0, api.marksCalls);
  await carts.close();

  // A store's own cart page changes a quantity after the read-back, as AndyMark's did.
  fresh();
  stores.state.wcp.mode = 'raises-on-page';
  api.orders = [wcpOrder('w1', { quantity: 1 })];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  await shot(carts, 'results-store-changed');
  const raisedCard = await cardText(carts, 'wcp');
  check('Store raised it: flagged, naming both numbers', /The store changed this to 25 after it was added; you asked for 1\. Check the cart before ordering\./.test(raisedCard) && /1 changed by the store/.test(raisedCard) && /you asked for 1, the cart holds 25/.test(raisedCard), raisedCard);
  check('Store raised it: stands out in the card and the summary', await carts.isVisible('[data-result="wcp"] .x-result-changed') && /1 changed by the store/.test(await carts.textContent('#results-counts')), await carts.textContent('#results-counts'));
  check('Store raised it: one add, the store\'s own raise, and the extension never changed it back', stores.state.adds().length === 1 && stores.state.log.filter(a => a.pageUpdate).length >= 1 && stores.state.wcp.cart.get(1001) === 25, stores.state.log.map(a => new URL(a.url).pathname));
  check('Store raised it: no mark', api.marks.length === 0 && api.marksCalls.length === 0, api.marksCalls);
  await carts.click('#back');
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('Store raised it: a second build says plainly the cart holds more, and adds nothing', /The cart already holds 25, more than the 1 you asked for\. Nothing was added/.test(await cardText(carts, 'wcp')) && stores.state.adds().length === 1 && stores.state.wcp.cart.get(1001) === 25, await cardText(carts, 'wcp'));
  await carts.close();

  // AndyMark sells some items only in multiples, and its own cart page would round them down. A build adds the multiple at or above the request, and says so.
  const amAdds = () => stores.state.adds().filter(a => a.store === 'andymark');
  const amMoved = () => stores.state.log.filter(a => a.store === 'andymark' && a.pageUpdate && a.moved);
  fresh();
  api.orders = [amOrder('a1')];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  await shot(carts, 'results-rounded');
  const roundedCard = await cardText(carts, 'andymark');
  check('Rounded up: 1 at multiples of 25 sends 25, and the cart holds it', amAdds().length === 1 && amAdds()[0].body.items[0].quantity === 25 && stores.state.andymark.cart.get(7001) === 25, amAdds());
  check('Rounded up: flagged in plain words, naming both numbers', /AndyMark sells this in multiples of 25, so the cart holds 25, not the 1 requested\./.test(roundedCard) && /you asked for 1, the cart holds 25/.test(roundedCard), roundedCard);
  check('Rounded up: stands out in the card and the summary', await carts.isVisible('[data-result="andymark"] .x-result-rounded') && /1 rounded up/.test(roundedCard) && /1 rounded up to what the store sells: check before ordering/.test(await carts.textContent('#results-counts')), await carts.textContent('#results-counts'));
  check('Rounded up: doesn\'t read as a failure or a mismatch', !/1 failed|Failed, not in the cart|mismatch|changed by the store|more than/.test(roundedCard) && /0 failed/.test(await carts.textContent('#results-counts')), roundedCard);
  check('Rounded up: the store\'s own cart page ran and moved nothing', stores.state.log.some(a => a.store === 'andymark' && a.pageUpdate) && amMoved().length === 0 && !(await carts.isVisible('[data-result="andymark"] .x-result-changed:not(.x-result-rounded)')), stores.state.log.filter(a => a.pageUpdate));
  check('Rounded up: marked, at the quantity the order asked for', api.marks.length === 1 && api.marks[0].orderId === 'a1' && api.marks[0].quantity === 1, api.marks);
  await carts.setViewportSize({ width: 375, height: 800 });
  check('Rounded up: no sideways scroll at phone width', await carts.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), await carts.evaluate(() => document.documentElement.scrollWidth));
  await carts.setViewportSize({ width: 1366, height: 860 });
  await carts.click('#back');
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  const roundedRetry = await cardText(carts, 'andymark');
  check('Rounded up: a second build adds nothing, and stays flagged as rounded', amAdds().length === 1 && stores.state.andymark.cart.get(7001) === 25 && /Already in the cart: it holds 25, so nothing was added/.test(roundedRetry) && /not the 1 requested/.test(roundedRetry) && !/more than/.test(roundedRetry), roundedRetry);
  check('Rounded up: a second build marks it too', api.marks.length === 2 && api.marks[1].quantity === 1, api.marks);
  await carts.close();

  fresh();
  api.orders = [amOrder('a1', { quantity: 30 })];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('Rounded up: 30 at multiples of 25 holds 50, where the page alone would leave 25', amAdds()[0]?.body.items[0].quantity === 50 && stores.state.andymark.cart.get(7001) === 50 && amMoved().length === 0 && /so the cart holds 50, not the 30 requested/.test(await cardText(carts, 'andymark')), await cardText(carts, 'andymark'));
  await carts.close();

  fresh();
  api.orders = [amOrder('a1', { quantity: 25 }), amOrder('a2', { description: 'Test normal screw', sku: 'AM-TEST-1', quantity: 3, unitPrice: 0.4 })];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  const amPlain = await cardText(carts, 'andymark');
  check('Multiples: an exact multiple and an item sold in 1s add normally, with no flag', amAdds().map(a => a.body.items[0].quantity).join() === '25,3' && /2 added/.test(amPlain) && !/flagged|rounded up|multiples of/.test(amPlain) && !(await carts.isVisible('[data-result="andymark"] .x-result-rounded')), amPlain);
  await carts.close();

  fresh();
  api.orders = [amOrder('a1'), amOrder('a2', { description: 'Test small screw, again' })];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  const amShared = await cardText(carts, 'andymark');
  check('Two orders of 1: one add of 25, and the second is covered by it', amAdds().length === 1 && stores.state.andymark.cart.get(7001) === 25, amAdds());
  check('Two orders of 1: both flagged, saying they share it', /2 rounded up/.test(amShared) && /The 2 orders for this part total 2, so the cart holds 25 for them together/.test(amShared) && /you asked for 2 across 2 orders, the cart holds 25/.test(amShared), amShared);
  check('Two orders of 1: both marked at their own quantity', api.marks.map(mark => `${mark.orderId}:${mark.quantity}`).join() === 'a1:1,a2:1', api.marks);
  await carts.close();
  check('Rounded up: no checkout request', stores.state.checkoutHits.length === 0, stores.state.checkoutHits);

  // A wall at the final read is not a failed build.
  fresh();
  stores.state.wcp.mode = 'wall-after-add';
  api.orders = [wcpOrder('w1', { quantity: 2 })];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  const walledCard = await cardText(carts, 'wcp');
  check('Wall at the final read: keeps the result and says the check couldn\'t run', /1 added/.test(walledCard) && /final check of this cart couldn't run, because WCP showed a CAPTCHA or bot check/.test(walledCard) && stores.state.adds().length === 1, walledCard);
  check('Wall at the final read: the read-back\'s mark stands', api.marks.length === 1 && api.marks[0].orderId === 'w1', api.marks);
  await carts.close();

  fresh();
  api.orders = [wcpOrder('w1', { description: 'Test gone', sku: 'WCP-3001', productUrl: 'https://wcproducts.com/products/test-sold-out' }), wcpOrder('w2', { description: 'Test wrong SKU', sku: 'WCP-1002', productUrl: 'https://wcproducts.com/products/test-hex-shaft?variant=1001' }), wcpOrder('w3', { description: 'Test no such', sku: 'X', productUrl: 'https://wcproducts.com/products/test-no-such' })];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  const wcpFail = await cardText(carts, 'wcp');
  check('Failures: out of stock, a SKU that doesn\'t match, a gone product; none added', /out of stock/.test(wcpFail) && /SKU WCP-1002, but the saved link's option is SKU WCP-1001/.test(wcpFail) && /no longer has this product/.test(wcpFail) && stores.state.adds().length === 0 && /Failed, not in the cart/.test(wcpFail), wcpFail);
  check('Failures: each links to its product', (await carts.$$eval('[data-result="wcp"] li a', links => links.length)) === 3);
  check('Failures: no marks', api.marks.length === 0);
  await carts.close();

  fresh();
  api.orders = [revOrder('r1', { sku: 'TEST-NOT-SOLD' })];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('REV: the store\'s own refusal is shown', /not available for purchase/.test(await cardText(carts, 'rev')) && /1 failed/.test(await cardText(carts, 'rev')), await cardText(carts, 'rev'));
  await carts.close();

  // ---- Walls: stop that store, leave its items as links, try nothing else, and let other stores carry on.
  fresh();
  stores.state.mcmaster.mode = 'login';
  api.orders = [mcmOrder('m1'), mcmOrder('m2', { sku: '98689A112' }), polOrder('p1')];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  await shot(carts, 'wall');
  const mcmCard = await cardText(carts, 'mcmaster');
  check('Login wall: says so, and stops', /McMaster asked for a sign-in/.test(mcmCard) && /2 to add yourself/.test(mcmCard), mcmCard);
  check('Login wall: only the first page was asked for, and nothing typed or added', stores.state.log.filter(a => a.store === 'mcmaster').length === 1 && !stores.state.adds().some(a => a.store === 'mcmaster'), stores.state.log.filter(a => a.store === 'mcmaster'));
  check('Login wall: items stay as links', (await carts.$$eval('[data-result="mcmaster"] li a', links => links.length)) === 2);
  check('Login wall: another store carries on', stores.state.pololu.cart.get('2136') === 2);
  check('Login wall: marks only the store that worked', JSON.stringify(api.marks.map(m => m.orderId)) === '["p1"]', api.marks);
  await carts.close();

  fresh();
  stores.state.pololu.mode = 'challenge';
  api.orders = [polOrder('p1')];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  const polCard = await cardText(carts, 'pololu');
  check('Bot check: says so, and didn\'t try to get past it', /showed a CAPTCHA or bot check/.test(polCard) && /did not try to get past it/.test(polCard) && stores.state.log.filter(a => a.store === 'pololu').length === 1, polCard);
  await carts.close();

  fresh();
  stores.state.pololu.mode = 'unexpected';
  api.orders = [polOrder('p1')];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('Unexpected page: stops, and leaves a link', /a page this didn't expect/.test(await cardText(carts, 'pololu')) && /1 to add yourself/.test(await cardText(carts, 'pololu')) && stores.state.adds().length === 0, await cardText(carts, 'pololu'));
  check('Unexpected page: no mark', api.marks.length === 0);
  await carts.close();

  fresh();
  stores.state.wcp.mode = 'block-read';
  api.orders = [wcpOrder('w1')];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('A refused cart read: stops, with nothing added', /CAPTCHA or bot check/.test(await cardText(carts, 'wcp')) && stores.state.adds().length === 0, await cardText(carts, 'wcp'));
  await carts.close();

  fresh();
  stores.state.wcp.mode = 'challenge-read';
  api.orders = [wcpOrder('w1')];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('A challenge page in place of cart data: stops, with nothing added', /1 to add yourself/.test(await cardText(carts, 'wcp')) && stores.state.adds().length === 0, await cardText(carts, 'wcp'));
  await carts.close();

  fresh();
  stores.state.rev.mode = 'login';
  api.orders = [revOrder('r1')];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('REV behind a wall from the first page: stops with a link', /asked for a sign-in/.test(await cardText(carts, 'rev')) && stores.state.adds().length === 0, await cardText(carts, 'rev'));
  await carts.close();

  // ---- Marks that don't land.
  fresh();
  api.orders = [wcpOrder('w1', { quantity: 1 })];
  api.marksScript = [{ status: 429, body: { code: 'rate_limited', retryAfterSeconds: 1 }, headers: { 'Retry-After': '1' } }, { status: 500, body: { error: 'Boom.' } }];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await build(carts);
  check('Marks: a failure says the cart is built but unrecorded', /didn't record them/.test(await carts.textContent('#marks-notice')) && await carts.isVisible('#retry-marks'), await carts.textContent('#marks-notice'));
  await carts.click('#retry-marks');
  await until(carts, () => document.getElementById('marks-notice').hidden, 5000);
  check('Marks: Try recording again sends the same marks once', api.marks.length === 1 && api.marks[0].orderId === 'w1', api.marks);
  await carts.close();

  // ---- Stop.
  fresh();
  api.orders = [wcpOrder('w1', { quantity: 1 }), wcpOrder('w2', { quantity: 1, sku: 'WCP-1002', productUrl: 'https://wcproducts.com/products/test-hex-shaft?variant=1002' })];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  await carts.click('#build');
  await until(carts, () => /^Building/.test(document.getElementById('selection-count').textContent), 15000);
  await carts.click('#stop');
  await carts.waitForSelector('#results-view:not([hidden])', { timeout: 60000 });
  check('Stop: what wasn\'t reached stays as a link', /stopped before this item/.test(await cardText(carts, 'wcp')) && stores.state.adds().length <= 1, await cardText(carts, 'wcp'));
  await carts.close();

  // ---- No access: a checklist, and nothing goes to the store. Only provable with the real permission flow.
  if (realPrompt) {
    fresh();
    await options.bringToFront();
    await options.evaluate(origins => chrome.permissions.remove({ origins }), STORE_ORIGINS);
    api.orders = [wcpOrder('w1'), revOrder('r1')];
    carts = await openCarts();
    await carts.waitForSelector('#permission:not([hidden])');
    check('No access: asks, naming the stores', /WCP/.test(await carts.textContent('#permission-stores')) && /REV/.test(await carts.textContent('#permission-stores')) && /2 stores need access/.test(await carts.textContent('#permission-count')));
    await shot(carts, 'permission');
    await carts.click('#permission-skip');
    await carts.waitForSelector('#orders-view:not([hidden])');
    check('No access: Not now shows the list, as a checklist', /Checklist/.test(await carts.textContent('tbody[data-store="wcp"] .x-method')) && await carts.isVisible('#allow-later'));
    await build(carts);
    check('No access: nothing goes to a store', stores.state.log.length === 0, stores.state.log);
    check('No access: items are links, and no marks', /2 to add yourself|1 to add yourself/.test(await cardText(carts, 'wcp')) && api.marks.length === 0);
    await carts.close();
    carts = await openCarts();
    await carts.waitForSelector('#permission:not([hidden])');
    await carts.bringToFront();
    await carts.click('#permission-allow');
    const pressed = pressPrompt('Allow');
    await carts.waitForSelector('#orders-view:not([hidden])', { timeout: 15000 });
    check('No access: Allow from this page grants what it listed, and only that', (await access(carts)).filter(Boolean).length === 2 && await carts.evaluate(() => chrome.permissions.contains({ origins: ['https://wcproducts.com/*'] })), `${pressed}: ${await access(carts)}`);
    await carts.close();
    await options.bringToFront();
    await options.evaluate(origins => chrome.permissions.request({ origins }).catch(() => false), []).catch(() => undefined);
  }

  // ---- The Admin's switch.
  api.cartsEnabled = false;
  await options.bringToFront();
  await options.reload();
  await options.waitForSelector('#paired-card:not([hidden])');
  await until(options, () => document.getElementById('carts-setting').hidden, 8000);
  check('Admin off: Options hides the switch and the button', !(await options.isVisible('#carts-setting')) && !(await options.isVisible('#carts-open')));
  popup = await popupOpen();
  check('Admin off: the popup hides Carts', !(await popup.isVisible('#carts')));
  await popup.close();
  carts = await openCarts();
  await until(carts, () => document.getElementById('state-title').textContent === 'Carts is turned off');
  check('Admin off: the Carts page says so', /An Admin turned Carts off/.test(await carts.textContent('#state-text')), await carts.textContent('#state-text'));
  await carts.close();
  api.cartsEnabled = true;
  await options.reload();
  await until(options, () => !document.getElementById('carts-setting').hidden, 8000);
  check('Admin on again: this device\'s choice comes back', await options.isChecked('#carts-enabled'));

  // Turned off mid-way: the store's cart is built, and the mark is refused with the plugin's own words.
  fresh();
  api.orders = [wcpOrder('w1', { quantity: 1 })];
  carts = await openCarts();
  await carts.waitForSelector('#orders-view:not([hidden])');
  api.marksScript = [{ status: 403, body: { code: 'carts_disabled', error: 'An Admin just turned Carts off.' } }];
  if (realPrompt) {
    const grant = await carts.isVisible('#allow-later');
    if (grant) { await carts.bringToFront(); await carts.click('#allow-later'); pressPrompt('Allow'); await sleep(800); }
  }
  await build(carts);
  check('Admin off during a build: says the marks weren\'t recorded, with no retry button', /An Admin just turned Carts off/.test(await carts.textContent('#marks-notice')) && !(await carts.isVisible('#retry-marks')), await carts.textContent('#marks-notice'));
  await carts.close();

  // ---- Turning it off, then unpairing.
  await options.bringToFront();
  await options.click('#carts-enabled');
  await until(options, () => /Carts is off/.test(document.getElementById('notice').textContent));
  if (realPrompt) check('Switch off: gives back the store access', (await access(options)).every(granted => !granted), await access(options));
  carts = await openCarts();
  await until(carts, () => !document.getElementById('state').hidden);
  check('Switch off: the Carts page says so', /off on this device/.test(await carts.textContent('#state-title')));
  await carts.close();

  // A revoked device.
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'set-carts', enabled: true }));
  api.revoked = true;
  carts = await openCarts();
  await until(carts, () => /Pair this device/.test(document.getElementById('state-title').textContent));
  check('401 pair_again: prompts to pair again', /Pair this device again/.test(await carts.textContent('#state-title')), await carts.textContent('#state-title'));
  await carts.close();

  check('Safety overall: no checkout request in any scenario', stores.state.checkoutHits.length === 0, stores.state.checkoutHits);
  check('Extension pages never reach the network themselves', remote.length === 0, remote);
  check('Nothing tried to leave for any other site', !outsiders.length, outsiders);
  check('No page errors or CSP errors', problems.length === 0, problems);
} catch (error) {
  check(`The run finished (${error?.message ?? error})`, false);
  console.error(error);
} finally {
  await context.close().catch(() => undefined);
  try { rmSync(work, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Windows can hold the profile a moment longer. */ }
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
