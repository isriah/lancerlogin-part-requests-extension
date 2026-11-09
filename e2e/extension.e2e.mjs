// End-to-end run of the built extension in a real browser, against a simulated plugin API routed at the site's origin.
// No real site, key, Notion database or Discord is involved. Product pages are small synthetic copies unless E2E_LIVE_STORES=1.
// Run: npm run build && npm run e2e. Set E2E_SCREENSHOTS to a folder to save built-v2-*.png there.
//
// The test copy of the manifest changes one thing: it lists the test stores under host_permissions, because automation cannot
// click the toolbar icon and so cannot trigger activeTab. That is the one thing this cannot prove: Chrome's toolbar-click grant.
//
// On Windows with Edge (the default there), Chrome's real permission prompt shows, so the browser window is headed and
// press-prompt-button.ps1 clicks Allow or Deny through UI Automation. Don't use the mouse during that part. Anywhere else, or
// with E2E_PROMPT=stub, the test manifest also lists the site and Deny is simulated in the page, which proves less.
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const work = mkdtempSync(join(tmpdir(), 'part-requests-e2e-'));
const shots = process.env.E2E_SCREENSHOTS;
const channel = process.env.E2E_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium');
const realPrompt = process.env.E2E_PROMPT !== 'stub' && process.platform === 'win32' && channel === 'msedge';
const SITE = 'https://team-site.example.test';
const productUrl = 'https://www.revrobotics.com/rev-21-1651/';
const stores = ['https://www.revrobotics.com/*', 'https://www.pololu.com/*', 'https://example.com/*'];

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` -> ${detail}` : ''}`); };
const productionManifest = JSON.parse(readFileSync(join(root, 'dist', 'manifest.json'), 'utf8'));
check('Built manifest asks only for https sites, optionally', JSON.stringify(productionManifest.optional_host_permissions) === '["https://*/*"]' && !productionManifest.host_permissions && !/localhost|http:|notion\.com/.test(JSON.stringify(productionManifest)));

const extension = join(work, 'extension');
cpSync(join(root, 'dist'), extension, { recursive: true });
writeFileSync(join(extension, 'manifest.json'), JSON.stringify({ ...productionManifest, host_permissions: realPrompt ? stores : [...stores, `${SITE}/*`] }));

// The simulated plugin. It follows the README's contract, including one create per submission ID.
const DEVICE_KEY = 'e2eFakeDeviceKey00000000000000000000000000x'.slice(0, 43);
const SECOND_KEY = 'e2eFakeDeviceKey00000000000000000000000000y'.slice(0, 43);
const PERSON = 'c0000000-0000-4000-8000-00000000000a', GUEST = 'c0000000-0000-4000-8000-00000000000b';
const UPDATE_URL = 'https://github.com/isriah/lancerlogin-part-requests-extension/releases';
const DATABASE_URL = 'https://www.notion.so/11111111222243338444555555555555';
const api = {
  pins: new Set(['K7M29QXP', 'QQQQRRRR']), pairLost: new Set(['QQQQRRRR']), revoked: false, calls: [], posts: [], gets: [], recipients: [], checks: [], recorded: new Map(), keysSeen: new Set(),
  behavior: 'ok', latency: 0, release: null, maintenanceLeft: 0, retryAfter: '1', repeats: [], teams: [{ id: 'team-1', name: 'Test Team One' }, { id: 'team-2', name: 'Test Team Two' }],
  people: [{ id: PERSON, name: 'Test Student A' }, { id: GUEST, name: 'Test Guest' }], defaultRecipientId: null, currentKey: DEVICE_KEY,
  minimumVersion: '0.3.0', updateUrl: UPDATE_URL, databaseLink: DATABASE_URL, selfRevoke: 'ok', selfRevoked: [],
  status: 'ok', statusBody: null, statusCalls: [], checkFails: false,
};
const TEAM_A = { primaryColor: '#0b3d91', secondaryColor: '#f58220', organizationName: 'Test Robotics Team A' };
const TEAM_B = { primaryColor: '#ffd100', secondaryColor: '#00594c', organizationName: 'Test Robotics Team B' };
api.statusBody = { settings: TEAM_A };
const PAGE = 'https://app.notion.com/p/new-request';
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function plugin(route) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const reply = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  // Core's public status, for the team's colors. It must never receive the device key.
  if (path === '/api/setup/status') {
    api.statusCalls.push(request.headers()['authorization'] ?? '');
    if (api.status === 'offline') return route.abort('internetdisconnected');
    return reply(api.statusBody, api.status === 'error' ? 500 : 200);
  }
  if (!path.startsWith('/api/public/part-requests')) return route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Not the API</h1>' });
  const name = path.slice('/api/public/part-requests'.length);
  const key = /^Bearer (.+)$/.exec(request.headers()['authorization'] ?? '')?.[1];
  const body = request.method() === 'POST' ? request.postDataJSON() : undefined;
  api.calls.push(`${request.method()} ${name}`);
  if (key) api.keysSeen.add(key);
  if (name === '/pair') {
    const pin = String(body.pin).replaceAll('-', '');
    if (!api.pins.has(pin)) return reply({ error: 'That PIN does not work. Run /ordering-pin in Discord to get a new one.', code: 'pin_refused' }, 401);
    // Spent, but the answer never arrived.
    if (api.pairLost.has(pin)) { api.pins.delete(pin); api.pairLost.delete(pin); return route.fulfill({ status: 504, contentType: 'text/html', body: 'Gateway timeout' }); }
    api.pins.delete(pin); api.pairedLabel = body.deviceLabel; api.revoked = false;
    return reply({ deviceKey: api.currentKey, memberName: 'Test Student A' }, 201);
  }
  if (name === '/devices/self/revoke' && api.selfRevoke === 'offline') return route.abort('internetdisconnected');
  if (name === '/devices/self/revoke' && api.selfRevoke === 'ok' && key === api.currentKey) { api.selfRevoked.push(key); api.revoked = true; return reply({ revoked: true }); }
  if (key !== api.currentKey || api.revoked) return reply({ error: 'This device is no longer paired. Run /ordering-pin in Discord and pair it again.', code: 'pair_again' }, 401);
  if (name === '/options') return reply({ memberName: 'Test Student A', teams: api.teams, recipients: api.people, defaultRecipientId: api.defaultRecipientId, statuses: ['NORMAL Request', 'Incomplete Request'], vendors: ['REV'], recipientsUpdatedMs: 1, minimumExtensionVersion: api.minimumVersion, updateUrl: api.updateUrl, databaseLink: api.databaseLink });
  if (name === '/recipient') { api.recipients.push(body); api.defaultRecipientId = body.notionUserId; return reply({ defaultRecipientId: body.notionUserId }); }
  if (name === '/check') { api.checks.push(body); if (api.checkFails) return route.abort('internetdisconnected'); return reply({ repeats: api.repeats }); }
  if (name.startsWith('/requests/')) {
    const id = name.slice('/requests/'.length); api.gets.push(id);
    const saved = api.recorded.get(id);
    return saved ? reply({ ...saved.body, replayed: true }, saved.status === 201 ? 200 : saved.status) : reply({ error: 'There is no request with that ID.', code: 'not_found' }, 404);
  }
  if (name === '/requests') {
    api.posts.push(body);
    if (api.maintenanceLeft > 0) { api.maintenanceLeft--; return reply({ error: 'An installation update requires temporary write suspension. Retry after recovery or completion.', code: 'update_maintenance' }, 503, { 'Retry-After': api.retryAfter }); }
    const existing = api.recorded.get(body.submissionId);
    if (existing) return reply({ ...existing.body, replayed: true }, existing.status === 201 ? 200 : existing.status);
    const id = body.submissionId;
    const respond = (status, value) => { api.recorded.set(id, { status, body: value }); return reply(value, status); };
    if (api.behavior === 'gateway') return route.fulfill({ status: 504, contentType: 'text/html', body: 'Gateway timeout' });
    // Created, but the answer never arrived.
    if (api.behavior === 'lost') { api.recorded.set(id, { status: 201, body: { submissionId: id, state: 'created', pageUrl: PAGE, repeats: [] } }); return route.fulfill({ status: 504, contentType: 'text/html', body: 'Gateway timeout' }); }
    if (api.behavior === 'uncertain') return respond(202, { submissionId: id, state: 'uncertain', error: 'Notion may or may not have created this request.', code: 'notion_uncertain' });
    if (api.behavior === 'failed') return respond(502, { submissionId: id, state: 'failed', error: 'Notion refused this request.', code: 'notion_400' });
    if (api.latency) await sleep(api.latency);
    if (api.behavior === 'hold') await new Promise(done => { api.release = done; });
    return respond(201, { submissionId: id, state: 'created', pageUrl: PAGE, repeats: api.repeats }).catch(() => undefined);
  }
  return reply({ error: 'Not found' }, 404);
}
const revPage = (title, price = '<div class="productView-price"><span data-product-price-without-tax>$30.00</span></div>', extra = '') => `<!doctype html><meta charset="utf-8"><title>${title}</title><div class="productView"><h1 class="productView-title">${title}</h1>${price}<span data-product-sku>TEST-1</span>${extra}</div>`;
const expressUrl = name => `https://www.revrobotics.com/test-express-${name}/`;
const expressPages = {
  ok: revPage('Test bearing, sending'), rapid: revPage('Test bearing, rapid reopen'), uncertain: revPage('Test bearing, uncertain'), noanswer: revPage('Test bearing, no answer'), refused: revPage('Test bearing, refused'), news: revPage('Test bearing, new request'), edited: revPage('Test bearing, edited', ''), closed: revPage('Test bearing, popup closed'), lightuncertain: revPage('Test bearing, light uncertain'), lostanswer: revPage('Test bearing, answer lost'),
  price: revPage('Test bearing, no price', ''),
  variant: revPage('Test hex shaft', '<div class="productView-price"><span data-product-price-without-tax>$12.50</span></div>', '<div data-product-option-change><select class="form-select form-select--small" name="attribute[1]"><option value="">Choose a length</option><option value="4">4 in.</option></select></div>'),
  currency: revPage('Test crimp terminals', '<div class="productView-price"><span data-product-price-without-tax>\u20ac19.50</span></div>'),
  repeat: revPage('Test bearing, repeat'), check: revPage('Test bearing, check fails'), defaults: revPage('Test bearing, no defaults'), all: revPage('Test bearing, every reason', ''),
};
const storePages = {
  ...Object.fromEntries(Object.entries(expressPages).map(([name, html]) => [expressUrl(name), html])),
  [productUrl]: '<!doctype html><title>NEO 550</title><div class="productView"><h1 class="productView-title">NEO 550 Brushless Motor</h1><div class="productView-price"><span data-product-price-without-tax>$30.00</span></div><span data-product-sku>REV-21-1651</span></div>',
  'https://www.pololu.com/search/compare/1': '<!doctype html><title>Compare</title><h1>Compare products</h1>',
  'https://example.com/': '<!doctype html><title>Other site</title><h1>Not a store</h1>',
};

// waitForFunction evaluates strings, which the extension's CSP correctly refuses.
const until = async (page, predicate, timeout, arg) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await page.evaluate(predicate, arg)) return true; await sleep(100); } return false; };
const fits = (page, height) => page.evaluate(limit => {
  const frame = document.getElementById('frame') ?? document.documentElement;
  // Every control a student can reach stays at the dashboard's 44px, whatever else is showing.
  const small = [...document.querySelectorAll('button,a.ui-button,select,textarea,input:not([type=checkbox]):not([role=switch])')].filter(node => { const { height: tall } = node.getBoundingClientRect(); return tall > 0 && tall < 43.5; });
  return document.fonts.ready.then(() => !small.length && document.documentElement.scrollHeight <= limit && document.documentElement.scrollWidth <= innerWidth + 1 && frame.scrollHeight <= limit && frame.scrollWidth <= frame.clientWidth + 1);
}, height);
const scrollHeight = page => page.evaluate(() => `${document.documentElement.scrollHeight} frame ${document.getElementById('frame')?.scrollHeight}`);
// Saved for comparing with the mockup: the popup as Chrome shows it, cut to its own frame, and pages as they are.
const shot = async (page, name) => {
  if (!shots) return;
  const frame = page.locator('#frame');
  await page.evaluate(() => document.fonts.ready);
  if (await frame.count()) await frame.screenshot({ path: join(shots, `built-v2-${name}.png`) });
  else await page.screenshot({ path: join(shots, `built-v2-${name}.png`), fullPage: true });
};
const textOf = (page, id) => page.textContent(`#${id}`);
const titleIs = (page, text, timeout = 10000) => until(page, wanted => !document.getElementById('result').hidden && document.getElementById('result-title').textContent === wanted, timeout, text);

const profile = join(work, 'profile');
const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.E2E_BROWSER ? { executablePath: process.env.E2E_BROWSER } : { channel }), headless: !realPrompt && !process.env.E2E_HEADED, viewport: { width: 1100, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check'],
});
const problems = [], allRequests = [], fontRequests = [], extensionPageRemote = [];
// This process also answers for the fake site, so it must never wait synchronously. A blocked event loop holds every request the
// worker sends, and a pair request held for 40 seconds hits the client's timeout and reads as "Could not reach".
const powershell = args => new Promise(done => execFile('powershell.exe', args, { encoding: 'utf8', timeout: 120000 }, (error, stdout, stderr) => done((stdout || stderr || error?.message || '').trim())));
let loopLag = 0, lastTick = Date.now();
const lagWatch = setInterval(() => { loopLag = Math.max(loopLag, Date.now() - lastTick - 250); lastTick = Date.now(); }, 250);
async function pressPrompt(button) {
  // Playwright exposes no browser PID, so find this run's Edge by its unique profile folder.
  const listed = await powershell(['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${profile.replaceAll("'", "''")}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1).ProcessId`]);
  if (!/^\d+$/.test(listed)) return `no browser process found for the test profile (${listed})`;
  return powershell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'press-prompt-button.ps1'), '-RootPid', listed, '-Button', button]);
}
try {
  await context.route(`${SITE}/**`, plugin);
  context.on('request', request => {
    const url = request.url();
    allRequests.push(url);
    if (request.resourceType() === 'font') fontRequests.push(url);
    let from = '';
    try { from = request.frame().url(); } catch { /* The service worker has no frame, and it is allowed to call the site. */ }
    if (from.startsWith('chrome-extension://') && !url.startsWith('chrome-extension://') && !url.startsWith('data:')) extensionPageRemote.push(url);
  });
  if (!process.env.E2E_LIVE_STORES) for (const [url, body] of Object.entries(storePages)) await context.route(url, route => route.fulfill({ status: 200, contentType: 'text/html', body }));

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const optionsUrl = `chrome-extension://${id}/options.html`;
  const watch = page => { page.on('pageerror', e => problems.push(`${page.url().slice(0, 40)}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Illegal invocation|Uncaught/.test(m.text())) problems.push(m.text()); }); return page; };
  context.on('serviceworker', w => w.on?.('console', m => { if (m.type() === 'error') problems.push(`worker: ${m.text()}`); }));

  // ---- Unpaired: the pairing screen and its layout.
  const options = watch(await context.newPage());
  await options.goto(optionsUrl);
  await options.waitForSelector('#pair-form:not([hidden])');
  await options.setViewportSize({ width: 1366, height: 650 });
  check('Options: says where PINs come from', /\/ordering-pin/.test(await textOf(options, 'pair-form')) && /Discord/.test(await textOf(options, 'pair-form')));
  check('Options: no token, database or guest import UI', await options.evaluate(() => ['token', 'database-url', 'data-source', 'import-form'].every(name => !document.getElementById(name))));
  check('Options: header badge renamed', !/PILOT/.test(await options.textContent('.x-page-head')), await options.textContent('.x-page-head'));
  check('Options: pairing screen fits 1366x650', await fits(options, 650), await scrollHeight(options));
  await shot(options, 'pairing-screen');

  const send = message => options.evaluate(value => chrome.runtime.sendMessage(value), message);
  const canReach = () => options.evaluate(origin => chrome.permissions.contains({ origins: [`${origin}/*`] }), SITE);
  async function pairWith(address, pin, label, button) {
    await options.bringToFront(); // Chrome shows the prompt on the active tab.
    await options.fill('#site-address', address); await options.fill('#pin', pin); await options.fill('#device-label', label);
    if (!realPrompt && button === 'Deny') await options.evaluate(() => { chrome.permissions.request = async () => false; });
    await options.click('#pair');
    if (!button || !realPrompt) return 'no prompt expected';
    return pressPrompt(button);
  }

  // ---- Unpaired: LancerLogin's default colors, bundled fonts, dark by default.
  const cssVar = (target, name) => target.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name);
  check('Colors: unpaired uses the default primary', (await cssVar(options, '--primary')) === '#b80100', await cssVar(options, '--primary'));
  check('Colors: unpaired uses the default secondary', (await cssVar(options, '--secondary')) === '#eeb822', await cssVar(options, '--secondary'));
  check('Colors: unpaired shows LancerLogin and says so', (await textOf(options, 'brand-name')) === 'LancerLogin' && await options.isVisible('#default-colors-notice'));
  check('Theme: starts dark, and the switch says Light mode is off', (await options.getAttribute('html', 'data-theme')) === 'dark' && (await options.getAttribute('#theme-toggle', 'aria-checked')) === 'false');
  const fontFaces = () => options.evaluate(async () => { await document.fonts.ready; return { roboto: ['400', '500', '700'].every(w => document.fonts.check(`${w} 16px Roboto`)), bebas: document.fonts.check('16px "Bebas Neue"'), body: getComputedStyle(document.querySelector('label')).fontFamily, heading: getComputedStyle(document.querySelector('h2')).fontFamily }; });
  const faces = await fontFaces();
  check('Fonts: Roboto 400, 500 and 700 and Bebas Neue load from the extension', faces.roboto && faces.bebas, JSON.stringify(faces));
  check('Fonts: headings use Bebas Neue and fields use Roboto', /Bebas Neue/.test(faces.heading) && /Roboto/.test(faces.body), JSON.stringify(faces));
  // Chrome's own stylesheet for extension pages shrinks the body to 75% unless told otherwise.
  check('Fonts: fields are full size, not the extension default', await options.evaluate(() => getComputedStyle(document.body).fontSize === '17px' && getComputedStyle(document.getElementById('site-address')).fontSize === '17px' && /Roboto/.test(getComputedStyle(document.body).fontFamily)), await options.evaluate(() => getComputedStyle(document.body).fontSize));
  check('Express: the switch is off and disabled until paired', !(await options.isChecked('#express-enabled')) && await options.isDisabled('#express-enabled'));
  await shot(options, 'options-unpaired');

  // Bad addresses never reach Chrome's prompt or the network.
  const callsBefore = api.calls.length;
  await pairWith('http://team-site.example.test', 'K7M2-9QXP', 'x');
  check('Pairing: an http address is refused', /https/.test(await textOf(options, 'notice')), await textOf(options, 'notice'));
  await pairWith(SITE, 'SHORT', 'x');
  check('Pairing: a malformed PIN is refused', /8-character/.test(await textOf(options, 'notice')), await textOf(options, 'notice'));
  check('Pairing: neither reached the site', api.calls.length === callsBefore);
  check('Before pairing, the extension has no access to the site', realPrompt ? !(await canReach()) : true);

  // Control: without the grant, the worker cannot reach the site. Deny is the real prompt where it can be.
  const denied = await pairWith(SITE, 'K7M2-9QXP', 'Test laptop', 'Deny');
  await until(options, () => /Deny/.test(document.getElementById('notice').textContent), 8000);
  check(`Pairing: Deny shows a clear message (${realPrompt ? 'real prompt' : 'simulated'})`, /You chose Deny/.test(await textOf(options, 'notice')) && /not used/.test(await textOf(options, 'notice')), `${denied}: ${await textOf(options, 'notice')}`);
  check('Pairing: Deny sends nothing and spends no PIN', !api.calls.includes('POST /pair') && api.pins.has('K7M29QXP'));
  check('Pairing: Deny leaves no access', realPrompt ? !(await canReach()) : true);
  await shot(options, 'pairing-denied');

  // Unpaired popup: capture and drafts still work, sending does not.
  async function popupFor(productPage) {
    const tabId = await options.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url)?.id, productPage.url());
    const popup = watch(await context.newPage());
    await popup.addInitScript(tab => { const query = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = async q => q.active ? [{ id: tab }] : query(q); }, tabId);
    await popup.setViewportSize({ width: 560, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await until(popup, () => !document.getElementById('loading') || document.getElementById('loading').hidden, 15000);
    return popup;
  }
  async function product(url) {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    return page;
  }
  const visible = (page, sel) => page.isVisible(sel);
  const reopen = async (old, page) => { await old.close(); return popupFor(page); };

  let page = await product(productUrl);
  let popup = await popupFor(page);
  await popup.waitForSelector('#request-form:not([hidden])', { timeout: 15000 });
  check('Popup unpaired: shows the pairing prompt', await visible(popup, '#setup') && /ordering-pin/.test(await textOf(popup, 'setup-message')));
  check('Popup unpaired: still captures the product', /NEO 550/.test(await popup.inputValue('#description')));
  check('Popup unpaired: Create is disabled', await popup.isDisabled('#submit'));
  check('Popup unpaired: fits 600px', await fits(popup, 600), await scrollHeight(popup));
  await shot(popup, 'popup-unpaired');
  await popup.fill('#description', '[TEST] typed before pairing');
  await popup.waitForTimeout(300);
  popup = await reopen(popup, page);
  await popup.waitForSelector('#request-form:not([hidden])');
  check('Popup unpaired: a draft survives', (await popup.inputValue('#description')) === '[TEST] typed before pairing');
  await popup.close();

  // Allow, wrong PIN: the grant stays, because the site proved itself.
  const allowed = await pairWith(SITE, 'WRNG-PNSS', 'Test laptop', 'Allow');
  await until(options, () => /does not work/.test(document.getElementById('notice').textContent), 10000);
  check(`Pairing: Allow, then a wrong PIN is explained (${realPrompt ? 'real prompt' : 'granted in manifest'})`, /does not work/.test(await textOf(options, 'notice')), `${allowed}: ${await textOf(options, 'notice')}`);
  check('Pairing: Allow grants that one site', await canReach());
  if (realPrompt) check('Pairing: Chrome really showed the prompt that Allow pressed', allowed === 'clicked:Allow', allowed);
  check('Pairing: Allow grants no other site', !(await options.evaluate(() => chrome.permissions.contains({ origins: ['https://other-site.example.test/*'] }))));

  // A PIN the site spent, but whose answer was lost: the student is told to get a new PIN, and the same again when that PIN is refused.
  await pairWith(SITE, 'QQQQ-RRRR', 'Test laptop');
  await until(options, () => /may already be used up/.test(document.getElementById('notice').textContent), 10000);
  const lostPin = await textOf(options, 'notice');
  check('Pairing: a lost answer says the PIN may be used up, and to get a new one', /Your PIN may already be used up/.test(lostPin) && /run \/ordering-pin in Discord to get a new PIN/.test(lostPin) && !/Could not reach/.test(lostPin) && !api.pins.has('QQQQRRRR'), lostPin);
  await pairWith(SITE, 'QQQQ-RRRR', 'Test laptop', 'Allow');
  await until(options, () => /probably used up/.test(document.getElementById('notice').textContent), 10000);
  const reusedPin = await textOf(options, 'notice');
  check('Pairing: the same PIN again is refused with the same advice, not a generic error', /That PIN didn't work\. It was probably used up when the site didn't answer last time\. Run \/ordering-pin in Discord to get a new PIN/.test(reusedPin) && !/does not work/.test(reusedPin), reusedPin);
  check('Pairing: no PIN is kept in storage', !JSON.stringify(await options.evaluate(() => chrome.storage.local.get(null))).includes('QQQQRRRR'));

  // The address and PIN as pasted: a path on the address, no hyphen in the PIN, lower case.
  await pairWith(`  ${SITE}/settings/ `, 'k7m29qxp', 'Test laptop');
  await options.waitForSelector('#paired-card:not([hidden])', { timeout: 10000 }).catch(() => {});
  check('Pairing: succeeds with a messy address and no hyphen', await visible(options, '#paired-card'), await textOf(options, 'notice'));
  check('Pairing: the path was normalized and /api added', api.calls.includes('POST /pair') && api.calls.includes('GET /options'));
  check('Pairing: sends the device label', api.pairedLabel === 'Test laptop');
  check('Colors: read once at pairing, without the device key', api.statusCalls.length === 1 && api.statusCalls[0] === '', JSON.stringify(api.statusCalls));
  check('Colors: the team\'s primary applies after pairing', await until(options, () => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() === '#0b3d91', 8000), await cssVar(options, '--primary'));
  check('Colors: the organization name shows as plain text', (await textOf(options, 'brand-name')) === TEAM_A.organizationName && (await textOf(options, 'paired-team')) === TEAM_A.organizationName);
  check('Colors: swatches and the check time show', /#0B3D91/.test(await textOf(options, 'swatch-primary')) && /#F58220/.test(await textOf(options, 'swatch-secondary')) && /Checked today/.test(await textOf(options, 'brand-checked')));
  check('Options: shows who, where and which device', /Test Student A/.test(await textOf(options, 'paired-member')) && (await textOf(options, 'paired-origin')) === new URL(SITE).host && (await textOf(options, 'paired-label')) === 'Test laptop');
  check('Options: PIN field is cleared', await options.evaluate(() => document.getElementById('pin').value === ''));
  check('Options: paired screen fits 1366x650', await fits(options, 650), await scrollHeight(options));
  check('Options: one settings card, with every section inside it', await options.evaluate(() => document.querySelectorAll('.ui-card').length === 1 && ['pairing-title', 'defaults-title', 'settings-title', 'stores-title'].every(id => document.querySelector('.x-settings-card').contains(document.getElementById(id)))));
  check('Options: no font license link, and the notices still ship', await options.evaluate(() => !document.querySelector('a[href*="THIRD_PARTY"]')) && readFileSync(join(root, 'dist', 'THIRD_PARTY_NOTICES.txt'), 'utf8').length > 0);
  check('Options: Unpair explains it frees a slot, and what happens offline', /frees one of your 5 device slots/.test(await textOf(options, 'paired-card')) && /an Admin may need to remove/.test(await textOf(options, 'paired-card')));
  check('Options: at the minimum version there is no update notice', !(await visible(options, '#update-notice')));
  await shot(options, 'pairing-paired');

  // Defaults: teams and people from /options, the person saved with the site.
  check('Options: teams come from the plugin', await options.$$eval('#default-team option', list => list.some(o => o.textContent === 'Test Team One')));
  check('Options: recipients come from the plugin', await options.$$eval('#default-recipient option', list => list.some(o => o.textContent === 'Test Guest')));
  await options.selectOption('#default-team', 'team-1');
  await options.selectOption('#default-recipient', PERSON);
  await options.evaluate(() => document.getElementById('defaults-form').requestSubmit());
  await until(options, () => /Defaults saved/.test(document.getElementById('notice').textContent), 10000);
  check('Options: chosen person is saved through /recipient', JSON.stringify(api.recipients.at(-1)) === JSON.stringify({ notionUserId: PERSON }), JSON.stringify(api.recipients));
  api.people.push({ id: 'c0000000-0000-4000-8000-00000000000c', name: 'Test Newer Person' });
  const reopened = watch(await context.newPage());
  await reopened.goto(optionsUrl);
  check('Options: reopening picks up new recipients', await until(reopened, () => [...document.querySelectorAll('#default-recipient option')].some(o => o.textContent === 'Test Newer Person'), 10000));
  check('Options: refresh keeps saved defaults', (await reopened.inputValue('#default-recipient')) === PERSON && (await reopened.inputValue('#default-team')) === 'team-1');
  await reopened.setViewportSize({ width: 420, height: 800 });
  check('Options: no sideways scroll at narrow width', await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await reopened.close();

  // The update notice: the built version is 1.0.0, and 1.10.0 is above it.
  api.minimumVersion = '1.10.0';
  const outdated = watch(await context.newPage());
  await outdated.goto(optionsUrl);
  await outdated.setViewportSize({ width: 1366, height: 650 });
  check('Update notice: Options shows it below the minimum, comparing numbers', await until(outdated, () => !document.getElementById('update-notice').hidden, 10000) && (await textOf(outdated, 'update-text')).includes(productionManifest.version) && /1\.10\.0/.test(await textOf(outdated, 'update-text')));
  check('Update notice: Options links to the releases page', (await outdated.getAttribute('#update-link', 'href')) === UPDATE_URL && (await outdated.getAttribute('#update-link', 'target')) === '_blank');
  check('Update notice: Options still works', await visible(outdated, '#paired-card') && !(await outdated.isDisabled('#unpair')));
  check('Options with the update notice fits 1366x650', await fits(outdated, 650), await scrollHeight(outdated));
  await shot(outdated, 'options-update-notice');
  await outdated.close();
  api.minimumVersion = '0.3.0';

  // ---- Team colors: strict validation, last good kept, at most daily.
  const rendered = target => target.evaluate(() => {
    const css = getComputedStyle(document.documentElement), button = getComputedStyle(document.querySelector('.ui-button--primary'));
    return { primary: css.getPropertyValue('--primary').trim(), secondary: css.getPropertyValue('--secondary').trim(), button: button.backgroundColor, text: button.color, edge: button.borderTopColor, focus: css.getPropertyValue('--ui-focus').trim() };
  });
  const relight = async () => { await options.evaluate(() => chrome.storage.local.set({ brandAttemptAt: Date.now() - 25 * 3600_000 })); const before = api.statusCalls.length; await options.reload(); await options.waitForSelector('#paired-card:not([hidden])'); await until(options, () => true, 100); const end = Date.now() + 8000; while (api.statusCalls.length === before && Date.now() < end) await sleep(100); await sleep(400); await options.reload(); await options.waitForSelector('#paired-card:not([hidden])'); return api.statusCalls.length - before; };
  const teamAButton = await rendered(options);
  check('Colors: the primary button really is painted from the tokens', teamAButton.button === 'rgb(11, 61, 145)' && teamAButton.text === 'rgb(255, 255, 255)', JSON.stringify(teamAButton));
  check('Colors: a dark primary gets a readable edge on the dark card', teamAButton.edge !== 'rgb(11, 61, 145)', JSON.stringify(teamAButton));
  check('Colors: the status pill keeps its fixed tone', await options.evaluate(() => getComputedStyle(document.getElementById('pairing-state')).color) === 'rgb(183, 247, 209)');
  await shot(options, 'options-paired');
  let statusBefore = api.statusCalls.length;
  await options.reload();
  await options.waitForSelector('#paired-card:not([hidden])');
  await sleep(600);
  check('Colors: not asked for again within a day', api.statusCalls.length === statusBefore, `${api.statusCalls.length - statusBefore} more`);
  for (const [name, body] of [['a short color', { settings: { ...TEAM_B, primaryColor: '#abc' } }], ['a CSS injection', { settings: { ...TEAM_B, secondaryColor: '#000000;background:url(https://evil.example.test/x)' } }], ['a name with a line break', { settings: { ...TEAM_B, organizationName: 'x\ny' } }], ['no settings', {}]]) {
    api.statusBody = body;
    const asked = await relight();
    check(`Colors: ${name} is refused and the last good stay`, asked === 1 && (await cssVar(options, '--primary')) === '#0b3d91' && (await textOf(options, 'brand-name')) === TEAM_A.organizationName, `asked ${asked}, ${await cssVar(options, '--primary')}`);
  }
  api.status = 'offline';
  check('Colors: a failed fetch keeps the last good', (await relight()) === 1 && (await cssVar(options, '--primary')) === '#0b3d91' && (await rendered(options)).button === 'rgb(11, 61, 145)');
  api.status = 'error'; api.statusBody = { settings: TEAM_B };
  check('Colors: an error status keeps the last good', (await relight()) === 1 && (await cssVar(options, '--primary')) === '#0b3d91');
  api.status = 'ok';
  check('Colors: a later good answer replaces them', (await relight()) === 1 && (await cssVar(options, '--primary')) === '#ffd100' && (await textOf(options, 'brand-name')) === TEAM_B.organizationName);
  const yellow = await rendered(options);
  check('Colors: a light primary gets dark text', yellow.text === 'rgb(17, 23, 20)', JSON.stringify(yellow));
  await shot(options, 'options-paired-teamb-dark');
  // The theme and the colors are set before the page has a body, so neither can flash.
  const firstPaint = async () => {
    const page = await context.newPage();
    await page.addInitScript(() => { new MutationObserver((_, watcher) => { if (document.body) { watcher.disconnect(); const root = document.documentElement; window.__first = { theme: root.getAttribute('data-theme'), primary: root.style.getPropertyValue('--primary') }; } }).observe(document, { childList: true, subtree: true }); });
    await page.goto(optionsUrl);
    const value = await page.evaluate(() => window.__first);
    await page.close();
    return value;
  };
  await options.click('#theme-toggle');
  check('Theme: the switch turns on Light mode at once', (await options.getAttribute('html', 'data-theme')) === 'light' && (await options.getAttribute('#theme-toggle', 'aria-checked')) === 'true');
  await until(options, () => chrome.storage.local.get('theme').then(v => v.theme === 'light'), 3000);
  const flash = await firstPaint();
  check('Theme: a new page is already light before its body exists', flash?.theme === 'light' && flash?.primary === '#ffd100', JSON.stringify(flash));
  await options.reload();
  await options.waitForSelector('#paired-card:not([hidden])');
  check('Theme: light keeps the choice after a reload', (await options.getAttribute('html', 'data-theme')) === 'light');
  check('Theme: light surfaces apply', await options.evaluate(() => getComputedStyle(document.querySelector('.ui-card')).backgroundColor) === 'rgb(255, 255, 255)');
  check('Options paired, light: fits 1366x650', await fits(options, 650), await scrollHeight(options));
  await shot(options, 'options-paired-teamb-light');
  await options.click('#theme-toggle');
  await until(options, () => chrome.storage.local.get('theme').then(v => v.theme === 'dark'), 3000);
  api.statusBody = { settings: TEAM_A };
  await relight();

  // The key stays in the worker. Popup messages and product pages never see it.
  const asPopup = await send({ type: 'settings' });
  check('The settings a page receives never contain the key', !JSON.stringify(asPopup).includes(DEVICE_KEY));
  check('Storage is limited to trusted contexts', await worker.evaluate(async () => (await chrome.storage.local.getAccessLevel?.()) ?? 'n/a').then(a => a === 'n/a' || a?.accessLevel === 'TRUSTED_CONTEXTS' || a === 'TRUSTED_CONTEXTS').catch(() => true));
  check('Every keyed call sent the bearer key', api.keysSeen.size === 1 && api.keysSeen.has(DEVICE_KEY));
  check('The colors route never received the bearer key', api.statusCalls.every(value => value === ''));

  // ---- Rejected pages cannot create anything.
  let other = await product('https://example.com/');
  popup = await popupFor(other);
  check('Unsupported site shows the store list', await visible(popup, '#unsupported'));
  check('Unsupported site offers no form', !(await visible(popup, '#request-form')));
  await popup.close(); await other.close();
  other = await product('https://www.pololu.com/search/compare/1');
  popup = await popupFor(other);
  check('Supported store, non-product page refuses', await visible(popup, '#not-product'));
  await popup.close(); await other.close();

  // ---- Capture from a product page, with the saved defaults.
  await page.close();
  page = await product(productUrl);
  popup = await popupFor(page);
  await popup.waitForSelector('#request-form:not([hidden])', { timeout: 15000 });
  check('Capture fills description', /NEO 550/.test(await popup.inputValue('#description')));
  check('Capture fills SKU', (await popup.inputValue('#sku')) === 'REV-21-1651', await popup.inputValue('#sku'));
  check('Capture fills price', Number(await popup.inputValue('#price')) > 0, await popup.inputValue('#price'));
  check('Saved defaults applied', (await popup.inputValue('#team')) === 'team-1' && (await popup.inputValue('#recipient')) === PERSON);
  check('Vendor derived from URL', (await popup.textContent('#vendor')).trim() === 'REV');
  check('Popup paired: no pairing prompt', !(await visible(popup, '#setup')));
  check('Popup paired: uses the team colors and name, from the worker', (await cssVar(popup, '--primary')) === '#0b3d91' && (await textOf(popup, 'brand-name')) === TEAM_A.organizationName, await cssVar(popup, '--primary'));
  check('Popup paired: shows no Carts button while Carts is off', !(await popup.isVisible('#carts')));
  check('Create request sits at the top of the form', await popup.evaluate(() => document.getElementById('submit').getBoundingClientRect().top < document.getElementById('description').getBoundingClientRect().top));
  await shot(popup, 'popup-form');

  // Chrome caps toolbar popups at 800x600, so the form must fit, even with every warning showing.
  check('Popup form fits without scrolling', await fits(popup, 600), await scrollHeight(popup));
  const showWarnings = paired => popup.evaluate(isPaired => {
    const fill = (id, lines) => { const list = document.getElementById(id); list.replaceChildren(...lines.map(text => Object.assign(document.createElement('li'), { textContent: text }))); list.parentElement.hidden = false; };
    fill('capture-issues', ['Select all product options on the store page, or enter the exact variant and price manually.', 'Unit price needs your review.', 'SKU was not confirmed; it is optional.']);
    document.getElementById('currency-row').hidden = false;
    const n = document.getElementById('notice'); n.hidden = false; n.textContent = 'This device is no longer paired. Run /ordering-pin in Discord and pair it again.';
    if (isPaired) {
      // Validation and the repeat check only run on a paired device.
      fill('validation', ['Choose a team.', 'Enter a quantity.', 'Enter a unit price in USD.']);
      document.getElementById('repeat-names').textContent = 'Test Student B on Nov 1, 3:02 PM; Test Student C on Nov 2, 9:15 AM; Test Student D on Nov 3, 10:00 AM';
      document.getElementById('repeat-warning').hidden = false;
    } else {
      document.getElementById('setup').hidden = false; document.getElementById('setup-title').textContent = 'Pair this device again'; document.getElementById('setup-message').textContent = 'It is no longer paired. Run /ordering-pin in Discord for a new PIN. Your drafts are kept.';
    }
  }, paired);
  const hideWarnings = () => popup.evaluate(() => { for (const name of ['capture-issues-box', 'validation-box', 'currency-row', 'notice', 'repeat-warning', 'setup']) document.getElementById(name).hidden = true; });
  await showWarnings(true);
  check('Popup form still fits with every warning showing', await fits(popup, 600), await scrollHeight(popup));
  await shot(popup, 'popup-worst-case');
  await hideWarnings();
  await showWarnings(false);
  check('Popup form still fits with every unpaired warning showing', await fits(popup, 600), await scrollHeight(popup));
  await hideWarnings();

  // The popup's update notice, with every other warning too, and it blocks nothing.
  api.minimumVersion = '1.10.0';
  popup = await reopen(popup, page);
  await popup.waitForSelector('#request-form:not([hidden])');
  check('Update notice: the popup shows it below the minimum', await until(popup, () => !document.getElementById('update-notice').hidden, 8000));
  check('Update notice: the popup links to the releases page', (await popup.getAttribute('#update-link', 'href')) === UPDATE_URL);
  check('Update notice: the popup can still send', !(await popup.isDisabled('#submit')));
  check('Popup with the update notice fits 600px', await fits(popup, 600), await scrollHeight(popup));
  await shot(popup, 'popup-update-notice');
  await popup.evaluate(() => {
    const list = document.getElementById('capture-issues');
    list.replaceChildren(...['Select all product options on the store page, or enter the exact variant and price manually.', 'Unit price needs your review.', 'SKU was not confirmed; it is optional.'].map(text => Object.assign(document.createElement('li'), { textContent: text })));
    list.parentElement.hidden = false; document.getElementById('currency-row').hidden = false;
  });
  check('Update notice: stays beside capture warnings', await visible(popup, '#update-notice'));
  check('Popup with the update notice and capture warnings fits 600px', await fits(popup, 600), await scrollHeight(popup));
  await hideWarnings();
  await showWarnings(true);
  check('Update notice: gives way to messages that need acting on', !(await visible(popup, '#update-notice')));
  check('Popup with an update due and every warning fits 600px', await fits(popup, 600), await scrollHeight(popup));
  await hideWarnings();
  await showWarnings(false);
  check('Popup with an update due and every unpaired warning fits 600px', await fits(popup, 600), await scrollHeight(popup));
  await hideWarnings();
  check('Update notice: returns when those clear', await visible(popup, '#update-notice'));
  api.minimumVersion = '0.3.0';
  popup = await reopen(popup, page);
  await popup.waitForSelector('#request-form:not([hidden])');
  check('Update notice: gone once the version meets the minimum', await until(popup, () => document.getElementById('update-notice').hidden, 8000));

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
  popup = await reopen(popup, page);
  await popup.waitForSelector('#request-form:not([hidden])');
  check('Edits survive closing the popup', (await popup.inputValue('#description')) === '[TEST] edited description' && (await popup.inputValue('#quantity')) === '3');
  check('Total preview uses quantity x price', /\$90\.00/.test(await popup.textContent('#total')), await popup.textContent('#total'));
  await popup.click('#discard');
  await until(popup, () => /NEO 550/.test(document.getElementById('description').value), 15000);
  check('Discard recaptures the page', /NEO 550/.test(await popup.inputValue('#description')));

  // ---- The repeat warning: who and when, and it never blocks.
  check('The repeat check asks with the URL and SKU', api.checks.some(c => c.url === productUrl && c.sku === 'REV-21-1651'), JSON.stringify(api.checks.at(-1)));
  check('No repeats, no warning', !(await visible(popup, '#repeat-warning')));
  api.repeats = [{ memberName: 'Test Student B', createdMs: Date.UTC(2026, 10, 3, 18, 30), pageUrl: 'https://app.notion.com/p/earlier-request', state: 'created' }];
  popup = await reopen(popup, page);
  await popup.waitForSelector('#request-form:not([hidden])');
  await until(popup, () => !document.getElementById('repeat-warning').hidden, 8000);
  check('Repeat warning names who and when', /Test Student B on Nov 3/.test(await textOf(popup, 'repeat-names')), await textOf(popup, 'repeat-names'));
  check('Repeat warning links to the earlier request', (await popup.getAttribute('#repeat-link', 'href')) === 'https://app.notion.com/p/earlier-request');
  check('Repeat warning does not block sending', !(await popup.isDisabled('#submit')));
  check('Popup with the repeat warning fits 600px', await fits(popup, 600), await scrollHeight(popup));
  await shot(popup, 'popup-repeat-warning');
  api.repeats = [];

  // Real mouse clicks at one spot, at realistic speed: the screen changing under the cursor must not create more.
  api.latency = 400;
  await popup.fill('#description', '[TEST] click storm');
  await popup.waitForTimeout(300);
  {
    const box = await popup.locator('#submit').boundingBox();
    const start = api.posts.length;
    for (let i = 0; i < 12; i++) { await popup.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await popup.waitForTimeout(150); }
    await popup.waitForTimeout(1200);
    check('Twelve real clicks at one spot create one request', api.posts.length - start === 1, `posts=${api.posts.length - start}`);
    check('The clicks did not reach New request and start another', await visible(popup, '#result'));
    api.posts.length = start;
  }
  api.latency = 0;
  await popup.waitForTimeout(1600);
  if (await popup.isVisible('#new-request')) await popup.click('#new-request');
  await popup.waitForSelector('#request-form:not([hidden])', { timeout: 15000 });

  // Duplicate protection: rapid submits while the create is pending, then close and reopen.
  await popup.fill('#description', '[TEST] duplicate check');
  await popup.waitForTimeout(300);
  api.behavior = 'hold';
  await popup.evaluate(() => { const f = document.getElementById('request-form'); for (let i = 0; i < 5; i++) f.requestSubmit(); });
  await popup.waitForTimeout(1200);
  check('Five rapid submits send one create', api.posts.length === 1, `posts=${api.posts.length}`);
  popup = await reopen(popup, page);
  await popup.waitForTimeout(800);
  check('Reopening while pending sends nothing new', api.posts.length === 1, `posts=${api.posts.length}`);
  check('Reopening while pending shows the sending state', await visible(popup, '#result') && (await textOf(popup, 'result-title')) === 'Sending your request', await textOf(popup, 'result-title'));
  api.behavior = 'ok';
  api.release?.();
  check('Success shown after pending resolves', await titleIs(popup, 'Request created'), await textOf(popup, 'result-title'));
  check('Open in Notion uses the returned link', (await popup.getAttribute('#notion-link', 'href')) === PAGE);
  await shot(popup, 'popup-success');

  // The request payload is exactly the plugin's contract.
  const sent = api.posts[0];
  check('Payload has exactly submissionId and draft', JSON.stringify(Object.keys(sent).sort()) === '["draft","submissionId"]');
  check('Payload ID is a lowercase UUID', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sent.submissionId), sent.submissionId);
  check('Payload draft has exactly the expected fields', JSON.stringify(Object.keys(sent.draft).sort()) === '["currencyConfirmed","description","price","quantity","recipient","sku","status","team","url"]', Object.keys(sent.draft).join());
  check('Payload carries the reviewed values', sent.draft.description === '[TEST] duplicate check' && sent.draft.status === 'NORMAL Request' && sent.draft.team === 'team-1' && sent.draft.recipient === PERSON && sent.draft.sku === 'REV-21-1651' && sent.draft.url === productUrl && sent.draft.quantity === 1 && sent.draft.price === 30 && sent.draft.currencyConfirmed === true, JSON.stringify(sent.draft));

  // A success receipt survives reopening and blocks another create.
  popup = await reopen(popup, page);
  await popup.waitForTimeout(600);
  check('Reopening after success shows the receipt, no new create', (await textOf(popup, 'result-title')) === 'Request created' && api.posts.length === 1, `posts=${api.posts.length}`);

  const fresh = async description => {
    await popup.click('#new-request');
    await popup.waitForSelector('#request-form:not([hidden])', { timeout: 15000 });
    await popup.fill('#description', description);
    await popup.waitForTimeout(300);
  };

  // An Incomplete request with only the minimum fields.
  await fresh('[TEST] incomplete');
  await popup.selectOption('#status', 'Incomplete Request');
  await popup.selectOption('#team', '');
  await popup.selectOption('#recipient', '');
  await popup.fill('#price', '');
  await popup.fill('#quantity', '');
  await popup.waitForTimeout(300);
  await popup.click('#submit');
  await titleIs(popup, 'Request created');
  const incomplete = api.posts[1]?.draft;
  check('Incomplete request sends empty values as the contract says', incomplete?.status === 'Incomplete Request' && incomplete.team === '' && incomplete.recipient === '' && incomplete.quantity === null && incomplete.price === null, JSON.stringify(incomplete));

  // A recorded uncertain result is never retried automatically; retry needs a check and then uses a new ID.
  await fresh('[TEST] uncertain');
  api.behavior = 'uncertain';
  let before = api.posts.length;
  await popup.click('#submit');
  check('Uncertain result says to check Notion', await titleIs(popup, 'Check Notion before retrying'), await textOf(popup, 'result-title'));
  check('Retry stays disabled until you confirm', await popup.isDisabled('#retry'));
  check('Uncertain result links to the ordering database', await visible(popup, '#database-link') && (await popup.getAttribute('#database-link', 'href')) === DATABASE_URL && /Check ordering database/.test(await textOf(popup, 'database-link')));
  check('The database link opens in a new tab', (await popup.getAttribute('#database-link', 'target')) === '_blank');
  check('Popup with the uncertain result and link fits 600px', await fits(popup, 600), await scrollHeight(popup));
  // A lookalike from the site is dropped in the worker, and one already saved is dropped by the popup's own check.
  api.databaseLink = 'https://notion.so.evil.example.test/x';
  popup = await reopen(popup, page);
  await until(popup, () => document.getElementById('database-link').hidden, 8000);
  check('A lookalike database link from the site is never offered', !(await visible(popup, '#database-link')) && !(await popup.getAttribute('#database-link', 'href')));
  await options.evaluate(async () => { const { options: saved } = await chrome.storage.local.get('options'); await chrome.storage.local.set({ options: { ...saved, databaseLink: 'https://evilnotion.so/x' } }); });
  api.databaseLink = 'javascript:alert(1)';
  popup = await reopen(popup, page);
  await popup.waitForTimeout(600);
  check('A bad link in saved lists is not offered either', !(await visible(popup, '#database-link')));
  api.databaseLink = DATABASE_URL;
  popup = await reopen(popup, page);
  await popup.waitForTimeout(800);
  check('Uncertain result is not resent on reopen', api.posts.length === before + 1, `posts=${api.posts.length}`);
  check('Still uncertain after reopening', (await textOf(popup, 'result-title')) === 'Check Notion before retrying');
  await shot(popup, 'popup-uncertain');
  api.behavior = 'ok';
  const uncertainId = api.posts.at(-1).submissionId;
  await popup.check('#checked-notion');
  await popup.click('#retry');
  await popup.waitForSelector('#request-form:not([hidden])');
  await popup.click('#submit');
  await titleIs(popup, 'Request created');
  check('After confirming, the retry uses a new ID', api.posts.at(-1).submissionId !== uncertainId && api.posts.length === before + 2, `posts=${api.posts.length - before}`);

  // No answer: the gateway failed. Reopening only reads; the site has no record, so a chosen retry uses the same ID.
  await fresh('[TEST] no answer');
  api.behavior = 'gateway';
  before = api.posts.length;
  await popup.click('#submit');
  check('No answer says to check Notion', await titleIs(popup, 'Check Notion before retrying'), await textOf(popup, 'result-title'));
  const lostId = api.posts.at(-1).submissionId;
  api.behavior = 'ok';
  popup = await reopen(popup, page);
  await popup.waitForTimeout(800);
  check('No answer is not resent on reopen, only read', api.posts.length === before + 1 && api.gets.includes(lostId), `posts=${api.posts.length - before}`);
  check('The site having no record is explained', (await textOf(popup, 'result-title')) === 'Request was not created' && /no record/.test(await textOf(popup, 'result-message')), await textOf(popup, 'result-message'));
  await popup.click('#retry');
  await popup.waitForSelector('#request-form:not([hidden])');
  await popup.click('#submit');
  await titleIs(popup, 'Request created');
  check('A chosen retry after no record keeps the same ID', api.posts.at(-1).submissionId === lostId && api.posts.length === before + 2);

  // Notion refused: recorded as failed, so trying again needs a new ID.
  await fresh('[TEST] refused');
  api.behavior = 'failed';
  await popup.click('#submit');
  check('A refusal says it was not created and why', await titleIs(popup, 'Request was not created') && /refused/.test(await textOf(popup, 'result-message')), await textOf(popup, 'result-message'));
  const failedId = api.posts.at(-1).submissionId;
  api.behavior = 'ok';
  await popup.click('#retry');
  await popup.waitForSelector('#request-form:not([hidden])');
  await popup.click('#submit');
  await titleIs(popup, 'Request created');
  check('Trying again after a refusal uses a new ID', api.posts.at(-1).submissionId !== failedId);

  // Maintenance: Core's 503 with Retry-After. The same ID is resent by itself, a limited number of times.
  await fresh('[TEST] maintenance');
  api.maintenanceLeft = 2; api.retryAfter = '2';
  before = api.posts.length;
  await popup.click('#submit');
  check('During maintenance the popup says the site is updating', await until(popup, () => /updating/.test(document.getElementById('notice').textContent), 8000), await textOf(popup, 'notice'));
  await shot(popup, 'popup-maintenance');
  check('After maintenance the request is created', await titleIs(popup, 'Request created', 20000), await textOf(popup, 'result-title'));
  const tries = api.posts.slice(before);
  check('503 retry resends with the same ID', tries.length === 3 && new Set(tries.map(p => p.submissionId)).size === 1, `tries=${tries.length}`);
  check('503 retry resends the same draft', new Set(tries.map(p => JSON.stringify(p.draft))).size === 1);

  // Closing the popup during maintenance: the worker carries on by itself, and reopening shows where it stands.
  await fresh('[TEST] closed during maintenance');
  api.maintenanceLeft = 2; api.retryAfter = '2';
  before = api.posts.length;
  await popup.click('#submit');
  await until(popup, () => /updating/.test(document.getElementById('notice').textContent), 8000);
  popup = await reopen(popup, page);
  check('Reopening during maintenance shows the site is updating', (await textOf(popup, 'result-title')) === 'Sending your request' && /updating/.test(await textOf(popup, 'result-message')), await textOf(popup, 'result-message'));
  check('The worker finishes after the popup closed', await titleIs(popup, 'Request created', 20000), await textOf(popup, 'result-title'));
  check('Closing the popup changes nothing: one ID, three tries', api.posts.length - before === 3 && new Set(api.posts.slice(before).map(p => p.submissionId)).size === 1, `tries=${api.posts.length - before}`);

  await fresh('[TEST] long maintenance');
  api.maintenanceLeft = 50; api.retryAfter = '1';
  before = api.posts.length;
  await popup.click('#submit');
  await until(popup, () => /still updating/.test(document.getElementById('notice').textContent), 20000);
  check('Maintenance retries are limited, then the student is told', api.posts.length - before === 5 && /still updating/.test(await textOf(popup, 'notice')), `tries=${api.posts.length - before}: ${await textOf(popup, 'notice')}`);
  check('The draft stays open afterwards', await visible(popup, '#request-form') && !(await popup.isDisabled('#submit')) && (await popup.inputValue('#description')) === '[TEST] long maintenance');
  const longId = api.posts.at(-1).submissionId;
  api.maintenanceLeft = 0;
  await popup.click('#submit');
  await titleIs(popup, 'Request created');
  check('Sending again later uses the same ID', api.posts.at(-1).submissionId === longId);

  // A worker stopped mid-send: its restart never resends, and the recorded result is read back.
  await fresh('[TEST] worker stops');
  api.behavior = 'hold';
  before = api.posts.length;
  await popup.click('#submit');
  await until(popup, () => document.getElementById('submit').disabled, 3000);
  await popup.waitForTimeout(600);
  const session = await context.newCDPSession(options);
  await session.send('ServiceWorker.enable');
  await session.send('ServiceWorker.stopAllWorkers');
  await session.detach();
  api.behavior = 'ok'; api.release?.();
  await sleep(500);
  const orphan = api.posts.at(-1).submissionId;
  // Thirty seconds have "passed": the pending record now has no worker behind it.
  await options.evaluate(async key => { const stored = (await chrome.storage.local.get(key))[key]; await chrome.storage.local.set({ [key]: { ...stored, updatedAt: Date.now() - 60_000 } }); }, `submission:${orphan}`);
  popup = await reopen(popup, page);
  await popup.waitForTimeout(1000);
  check('A restarted worker does not resend the pending request', api.posts.length === before + 1, `posts=${api.posts.length - before}`);
  check('A restarted worker reads the recorded result', (await textOf(popup, 'result-title')) === 'Request created' && api.gets.includes(orphan), await textOf(popup, 'result-title'));

  // ---- A revoked device while a form is open: a clear message, nothing lost, and pairing again brings it back.
  await fresh('[TEST] revoked while open');
  await popup.fill('#quantity', '4');
  await popup.waitForTimeout(300);
  api.revoked = true;
  before = api.posts.length;
  await popup.click('#submit');
  check('Revoked device: the popup asks to pair again', await until(popup, () => !document.getElementById('setup').hidden, 8000) && /Pair this device again/.test(await textOf(popup, 'setup-title')));
  check('Revoked device: the message says what to do', /pair it again/.test(await textOf(popup, 'notice')), await textOf(popup, 'notice'));
  check('Revoked device: Create is disabled', await popup.isDisabled('#submit'));
  check('Revoked device: the popup fits 600px', await fits(popup, 600), await scrollHeight(popup));
  await shot(popup, 'popup-revoked');
  check('Revoked device: the key is forgotten', !('deviceKey' in await options.evaluate(() => chrome.storage.local.get('deviceKey'))));
  popup = await reopen(popup, page);
  await popup.waitForSelector('#request-form:not([hidden])');
  check('Revoked device: the draft and its edits are kept', (await popup.inputValue('#description')) === '[TEST] revoked while open' && (await popup.inputValue('#quantity')) === '4');
  check('Revoked device: the team and person are kept', (await popup.inputValue('#team')) === 'team-1' && (await popup.inputValue('#recipient')) === PERSON);
  await options.reload();
  await options.waitForSelector('#pair-form:not([hidden])');
  check('Options: shows pair again with the site filled in', (await textOf(options, 'pairing-state')) === 'Pair again' && (await options.inputValue('#site-address')) === SITE && /drafts are kept/.test(await textOf(options, 'notice')));
  check('Options: the pair-again screen fits 1366x650', await fits(options, 650), await scrollHeight(options));
  await shot(options, 'pairing-again');

  api.pins.add('K7M29QXA'); api.currentKey = SECOND_KEY;
  // The site is already allowed, so Chrome grants it again with no prompt.
  await pairWith(SITE, 'K7M2-9QXA', 'Test laptop');
  await options.waitForSelector('#paired-card:not([hidden])', { timeout: 10000 }).catch(() => {});
  check('Pairing again works without a new prompt', await visible(options, '#paired-card'), await textOf(options, 'notice'));
  popup = await reopen(popup, page);
  await popup.waitForSelector('#request-form:not([hidden])');
  check('After pairing again, the draft can be sent', !(await popup.isDisabled('#submit')) && !(await visible(popup, '#setup')));
  await popup.click('#submit');
  await titleIs(popup, 'Request created');
  check('After pairing again, it sends the new key and the same draft', api.posts.at(-1).draft.quantity === 4 && api.keysSeen.has(SECOND_KEY), JSON.stringify(api.posts.at(-1).draft));

  // A revoked device found while opening the popup, with no send.
  await popup.click('#new-request');
  await popup.waitForSelector('#request-form:not([hidden])', { timeout: 15000 });
  api.revoked = true;
  popup = await reopen(popup, page);
  check('Revoked device: found when the popup opens', await until(popup, () => !document.getElementById('setup').hidden, 8000));
  await options.reload();
  await options.waitForSelector('#pair-form:not([hidden])');
  api.pins.add('K7M29QXB');
  await pairWith(SITE, 'K7M29QXB', 'Test laptop');
  await options.waitForSelector('#paired-card:not([hidden])', { timeout: 10000 }).catch(() => {});

  // Unpair while offline: it still happens here, and says an Admin may need to remove the device.
  await popup.close();
  api.selfRevoke = 'offline';
  const offlineKey = api.currentKey;
  options.once('dialog', dialog => dialog.accept());
  await options.click('#unpair');
  await options.waitForSelector('#pair-form:not([hidden])', { timeout: 15000 }).catch(() => {});
  check('Unpair offline: returns to the pairing screen', await visible(options, '#pair-form') && (await textOf(options, 'pairing-state')) === 'Not paired');
  check('Unpair offline: says an Admin may need to remove it', /Unpaired on this computer/.test(await textOf(options, 'notice')) && /an Admin may need to remove it/.test(await textOf(options, 'notice')), await textOf(options, 'notice'));
  check('Unpair offline: the key is gone', !('deviceKey' in await options.evaluate(() => chrome.storage.local.get('deviceKey'))));
  check('Unpair offline: Chrome\'s access to the site is removed', realPrompt ? !(await canReach()) : true);
  check('Unpair offline: the site never heard of it', !api.selfRevoked.includes(offlineKey));

  // Unpair with an expired key: the site refuses it, and the wording is the same.
  api.selfRevoke = 'ok'; api.pins.add('K7M29QXC');
  // Chrome remembers a host it was granted once, so this grant comes back at once with no prompt to press.
  await pairWith(SITE, 'K7M29QXC', 'Test laptop');
  await options.waitForSelector('#paired-card:not([hidden])', { timeout: 10000 }).catch(() => {});
  check('Pairing after an unpair: Chrome gives the site back with no prompt, and pairing works', await visible(options, '#paired-card') && (realPrompt ? await canReach() : true), await textOf(options, 'notice'));
  api.selfRevoke = 'expired'; api.revoked = true;
  options.once('dialog', dialog => dialog.accept());
  await options.click('#unpair');
  await options.waitForSelector('#pair-form:not([hidden])', { timeout: 10000 }).catch(() => {});
  check('Unpair with an expired key: still unpairs, and says an Admin may need to remove it', (await textOf(options, 'pairing-state')) === 'Not paired' && /an Admin may need to remove it/.test(await textOf(options, 'notice')), await textOf(options, 'notice'));

  // Unpair: tells the site, frees the slot, forgets the key and the site's access, and keeps drafts.
  api.selfRevoke = 'ok'; api.pins.add('K7M29QXD');
  await pairWith(SITE, 'K7M29QXD', 'Test laptop');
  await options.waitForSelector('#paired-card:not([hidden])', { timeout: 10000 }).catch(() => {});
  const callsBeforeUnpair = api.calls.length;
  options.once('dialog', dialog => dialog.accept());
  await options.click('#unpair');
  await options.waitForSelector('#pair-form:not([hidden])', { timeout: 5000 }).catch(() => {});
  check('Unpair: says the slot is free, and needs no Admin', /frees one of your 5 device slots/.test(await textOf(options, 'notice')) && !/Admin/.test(await textOf(options, 'notice')), await textOf(options, 'notice'));
  await shot(options, 'unpaired');
  check('Unpair: returns to the pairing screen', await visible(options, '#pair-form') && (await textOf(options, 'pairing-state')) === 'Not paired');
  check('Unpair: the key is gone', !('deviceKey' in await options.evaluate(() => chrome.storage.local.get('deviceKey'))));
  check('Unpair: Chrome\'s access to the site is removed', realPrompt ? !(await canReach()) : true);
  check('Unpair: calls the site once, with the key, then nothing else', api.calls.slice(callsBeforeUnpair).join() === 'POST /devices/self/revoke' && api.selfRevoked.at(-1) === api.currentKey, api.calls.slice(callsBeforeUnpair).join());
  popup = await popupFor(page);
  await popup.waitForSelector('#request-form:not([hidden])');
  check('Unpair: the draft on this page is kept', /NEO 550/.test(await popup.inputValue('#description')) && await popup.isDisabled('#submit'));
  await popup.close(); await page.close();

  // Unpair cleared the team's colors and name, in the page and in storage.
  check('Colors: Unpair returns to the default colors', (await cssVar(options, '--primary')) === '#b80100' && (await textOf(options, 'brand-name')) === 'LancerLogin');
  check('Colors: Unpair clears the saved colors and the synchronous copy', await options.evaluate(async () => !(await chrome.storage.local.get('brand')).brand && !(localStorage.getItem('part-requests-appearance') ?? '').includes('tokens')));
  check('Options unpaired: fits 1366x650', await fits(options, 650), await scrollHeight(options));

  // ---- Express addition. It's off until a student turns it on, and a page's whole flow runs in the worker.
  api.selfRevoke = 'ok'; api.pins.add('K7M29QXE');
  await pairWith(SITE, 'K7M29QXE', 'Test laptop');
  await options.waitForSelector('#paired-card:not([hidden])', { timeout: 15000 }).catch(() => {});
  await options.selectOption('#default-team', 'team-1');
  await options.selectOption('#default-recipient', PERSON);
  await options.evaluate(() => document.getElementById('defaults-form').requestSubmit());
  await until(options, () => /Defaults saved/.test(document.getElementById('notice').textContent), 10000);
  const expressCount = () => api.posts.length;
  const reasons = popup2 => popup2.textContent('#express-reasons');
  let start = expressCount();
  let express = await product(expressUrl('closed'));
  popup = await popupFor(express);
  await popup.waitForSelector('#request-form:not([hidden])', { timeout: 15000 });
  await popup.waitForTimeout(500);
  check('Express: off by default, the toolbar click shows the form and sends nothing', !(await options.isChecked('#express-enabled')) && expressCount() === start, `posts=${expressCount() - start}`);
  check('Express: off by default, no reasons are listed', !(await visible(popup, '#express-reasons-box')));
  await popup.close();
  await express.close();
  await options.bringToFront();
  await options.click('.x-setting');
  check('Express: the Options switch turns it on', await until(options, () => /is on/.test(document.getElementById('notice').textContent), 5000) && await options.isChecked('#express-enabled'));
  check('Options with Express on: fits 1366x650', await fits(options, 650), await scrollHeight(options));
  await shot(options, 'options-express-on');

  // Sends with no click. The popup shows sending, closing it cancels nothing, and reopening never sends again.
  api.behavior = 'hold'; start = expressCount();
  const okPage = await product(expressUrl('ok'));
  popup = await popupFor(okPage);
  check('Express: sends by itself and shows sending', await titleIs(popup, 'Sending your request', 8000) && /You can close this popup/.test(await textOf(popup, 'result-message')), await textOf(popup, 'result-title'));
  check('Express sending: one create', expressCount() === start + 1, `posts=${expressCount() - start}`);
  check('Express sending: shows the item and the details', /Test bearing, sending/.test(await textOf(popup, 'result-item')) && /\$30\.00 USD/.test(await textOf(popup, 'result-facts')) && /Test Team One/.test(await textOf(popup, 'result-facts')) && /Test Student A/.test(await textOf(popup, 'result-facts')));
  check('Express sending: no form underneath', !(await visible(popup, '#request-form')));
  check('Express sending: fits 600px', await fits(popup, 600), await scrollHeight(popup));
  await shot(popup, 'express-sending');
  const okPost = api.posts.at(-1);
  check('Express: sends NORMAL, quantity 1, with the defaults, in the same shape as the form', okPost.draft.status === 'NORMAL Request' && okPost.draft.quantity === 1 && okPost.draft.team === 'team-1' && okPost.draft.recipient === PERSON && okPost.draft.price === 30 && okPost.draft.currencyConfirmed === true && JSON.stringify(Object.keys(okPost.draft).sort()) === '["currencyConfirmed","description","price","quantity","recipient","sku","status","team","url"]', JSON.stringify(okPost.draft));
  await popup.close();
  for (let i = 0; i < 3; i++) { const again = await popupFor(okPage); await sleep(150); await again.close(); }
  await sleep(300);
  check('Express: closing and reopening while it sends sends nothing more', expressCount() === start + 1, `posts=${expressCount() - start}`);
  const piled = await Promise.all([popupFor(okPage), popupFor(okPage), popupFor(okPage)]);
  await sleep(300);
  check('Express: three popups at once while it sends send nothing more', expressCount() === start + 1, `posts=${expressCount() - start}`);
  await Promise.all(piled.map(p => p.close()));
  api.behavior = 'ok'; api.release?.();
  await sleep(500);
  popup = await popupFor(okPage);
  check('Express: the send finished with the popup closed, and shows success', await titleIs(popup, 'Request sent', 10000), await textOf(popup, 'result-title'));
  check('Express success: links to Notion, and explains there is no undo', (await popup.getAttribute('#notion-link', 'href')) === PAGE && /Open in Notion to review/.test(await textOf(popup, 'notion-link')) && /no undo/.test(await textOf(popup, 'express-help')));
  check('Express success: offers New request and turning it off', await visible(popup, '#new-request') && await visible(popup, '#express-off'));
  check('Express success: says it is created', /Created/.test(await textOf(popup, 'result-pill')));
  check('Express success: fits 600px', await fits(popup, 600), await scrollHeight(popup));
  await shot(popup, 'express-success');
  popup = await reopen(popup, okPage);
  await sleep(400);
  check('Express: a page already sent shows its receipt, with no second send', (await textOf(popup, 'result-title')) === 'Request sent' && expressCount() === start + 1, `posts=${expressCount() - start}`);
  check('Express: the ID never changed', new Set(api.posts.slice(start).map(p => p.submissionId)).size === 1);
  await popup.close();

  // Rapid reopen from the very first click: all of them share one draft and one ID.
  start = expressCount();
  const rapidPage = await product(expressUrl('rapid'));
  const rapid = await Promise.all([popupFor(rapidPage), popupFor(rapidPage), popupFor(rapidPage), popupFor(rapidPage)]);
  await sleep(1000);
  check('Express: four popups at once on a new page send one request', expressCount() === start + 1, `posts=${expressCount() - start}`);
  await Promise.all(rapid.map(p => p.close()));
  await rapidPage.close();

  // New request is a deliberate choice of the form.
  start = expressCount();
  const newsPage = await product(expressUrl('news'));
  popup = await popupFor(newsPage);
  await titleIs(popup, 'Request sent', 10000);
  await popup.click('#new-request');
  await popup.waitForSelector('#request-form:not([hidden])', { timeout: 15000 });
  await sleep(300);
  check('Express: New request shows the form and sends nothing', expressCount() === start + 1 && !(await visible(popup, '#express-reasons-box')), `posts=${expressCount() - start}`);
  popup = await reopen(popup, newsPage);
  await popup.waitForSelector('#request-form:not([hidden])');
  await sleep(300);
  check('Express: reopening after New request still waits for a click', expressCount() === start + 1 && !(await visible(popup, '#result')), `posts=${expressCount() - start}`);
  await popup.close();
  await newsPage.close();

  // Uncertain and no answer: never resent by reopening, and only by a new, checked click.
  start = expressCount();
  api.behavior = 'uncertain';
  const uncertainPage = await product(expressUrl('uncertain'));
  popup = await popupFor(uncertainPage);
  check('Express uncertain: says so', await titleIs(popup, 'Not sure it was created', 10000) && /won.t be resent/.test(await textOf(popup, 'result-message')), await textOf(popup, 'result-title'));
  check('Express uncertain: retry waits for the check, and the database link shows', await popup.isDisabled('#retry') && await visible(popup, '#database-link'));
  check('Express uncertain: fits 600px', await fits(popup, 600), await scrollHeight(popup));
  await shot(popup, 'express-uncertain');
  api.behavior = 'ok';
  for (let i = 0; i < 3; i++) { popup = await reopen(popup, uncertainPage); await sleep(300); }
  check('Express uncertain: reopening three times never resends', expressCount() === start + 1 && (await textOf(popup, 'result-title')) === 'Not sure it was created', `posts=${expressCount() - start}`);
  const uncertainFirst = api.posts.at(-1).submissionId;
  await popup.check('#checked-notion');
  await popup.click('#retry');
  await popup.waitForSelector('#request-form:not([hidden])');
  await sleep(300);
  check('Express uncertain: confirming returns to the form without sending', expressCount() === start + 1, `posts=${expressCount() - start}`);
  popup = await reopen(popup, uncertainPage);
  await popup.waitForSelector('#request-form:not([hidden])');
  await sleep(300);
  check('Express uncertain: reopening that form still doesn\'t send', expressCount() === start + 1 && !(await visible(popup, '#result')), `posts=${expressCount() - start}`);
  await popup.click('#submit');
  await titleIs(popup, 'Request created');
  check('Express uncertain: the student\'s own click uses a new ID', expressCount() === start + 2 && api.posts.at(-1).submissionId !== uncertainFirst);
  await popup.close();
  await uncertainPage.close();

  // No answer: only the site's record decides, read back without resending.
  start = expressCount();
  api.behavior = 'gateway';
  const lostPage = await product(expressUrl('noanswer'));
  popup = await popupFor(lostPage);
  check('Express no answer, no record: says nothing was created', await titleIs(popup, 'Request was not created', 10000) && /no record/.test(await textOf(popup, 'result-message')), await textOf(popup, 'result-title'));
  const lostSent = api.posts.at(-1).submissionId;
  api.behavior = 'ok';
  popup = await reopen(popup, lostPage);
  await sleep(600);
  check('Express no answer, no record: reopening only reads, and never resends', expressCount() === start + 1 && api.gets.includes(lostSent), `posts=${expressCount() - start}`);
  await popup.click('#retry');
  await popup.waitForSelector('#request-form:not([hidden])');
  await sleep(300);
  check('Express no answer, no record: Review and retry shows the form without sending', expressCount() === start + 1, `posts=${expressCount() - start}`);
  await popup.close();
  await lostPage.close();
  start = expressCount();
  api.behavior = 'lost';
  const lostAnswerPage = await product(expressUrl('lostanswer'));
  popup = await popupFor(lostAnswerPage);
  check('Express answer lost: the recorded result is read back as sent', await titleIs(popup, 'Request sent', 10000), await textOf(popup, 'result-title'));
  check('Express answer lost: nothing was resent', expressCount() === start + 1, `posts=${expressCount() - start}`);
  api.behavior = 'ok';
  await popup.close();
  await lostAnswerPage.close();

  // A refusal returns to the form with the error.
  start = expressCount();
  api.behavior = 'failed';
  const refusedPage = await product(expressUrl('refused'));
  popup = await popupFor(refusedPage);
  check('Express refused: returns to the form with the error', await until(popup, () => !document.getElementById('request-form').hidden && /refused/.test(document.getElementById('express-reasons').textContent), 10000), await textOf(popup, 'result-title'));
  check('Express refused: fits 600px', await fits(popup, 600), await scrollHeight(popup));
  api.behavior = 'ok';
  const refusedId = api.posts.at(-1).submissionId;
  popup = await reopen(popup, refusedPage);
  await popup.waitForSelector('#request-form:not([hidden])');
  await sleep(300);
  check('Express refused: reopening doesn\'t send again', expressCount() === start + 1 && /refused/.test(await reasons(popup)), `posts=${expressCount() - start}`);
  await popup.click('#submit');
  await titleIs(popup, 'Request created');
  check('Express refused: the student\'s click uses a new ID', api.posts.at(-1).submissionId !== refusedId);
  await popup.close();
  await refusedPage.close();

  // Every reason falls back to the form, says why, and sends nothing. These pages stay open for the light pass.
  const fallback = async (name, arrange, expected, invalid) => {
    start = expressCount();
    await arrange?.();
    const target = await product(expressUrl(name));
    const form = await popupFor(target);
    const shown = await form.waitForSelector('#request-form:not([hidden])', { timeout: 15000 }).then(() => true).catch(() => false);
    await until(form, () => !document.getElementById('express-reasons-box').hidden, 5000);
    await sleep(200);
    const text = await reasons(form);
    check(`Express fallback, ${name}: the form lists the reason`, shown && expected.test(text) && /Not sent yet/.test(await textOf(form, 'express-reasons-box')), text);
    check(`Express fallback, ${name}: nothing was sent`, expressCount() === start, `posts=${expressCount() - start}`);
    for (const id of invalid) check(`Express fallback, ${name}: ${id} is marked`, (await form.getAttribute(`#${id}`, 'aria-invalid')) === 'true');
    check(`Express fallback, ${name}: fits 600px`, await fits(form, 600), await scrollHeight(form));
    await shot(form, `express-review-${name}`);
    return { target, form };
  };
  const views = {};
  views.price = await fallback('price', null, /No price was found/, ['price']);
  await views.price.form.close();
  views.variant = await fallback('variant', null, /Options aren.t selected/, ['description', 'price']);
  check('Express fallback, variant: the unknown price stays blank', (await views.variant.form.inputValue('#price')) === '');
  await views.variant.form.close();
  views.currency = await fallback('currency', null, /EUR 19\.50, not USD/, ['price']);
  check('Express fallback, currency: the foreign number isn\'t left in the USD field, and the check shows', (await views.currency.form.inputValue('#price')) === '' && await visible(views.currency.form, '#currency-row'));
  await views.currency.form.close();
  api.repeats = [{ memberName: 'Test Student B', createdMs: Date.UTC(2026, 10, 7, 20, 2), pageUrl: 'https://app.notion.com/p/earlier-request', state: 'created' }];
  views.repeat = await fallback('repeat', null, /Test Student B requested this on Nov 7.*You can still send yours/, []);
  check('Express fallback, repeat: links to the earlier request', await views.repeat.form.evaluate(() => document.querySelector('#express-reasons a')?.getAttribute('href')) === 'https://app.notion.com/p/earlier-request');
  check('Express fallback, repeat: the warning isn\'t shown twice', !(await visible(views.repeat.form, '#repeat-warning')));
  await views.repeat.form.click('#submit');
  await titleIs(views.repeat.form, 'Request created');
  check('Express fallback, repeat: one click still sends it', expressCount() === start + 1);
  api.repeats = [];
  await views.repeat.form.close();
  api.checkFails = true;
  views.check = await fallback('check', null, /check for recent requests could not run/, []);
  api.checkFails = false;
  await views.check.form.close();
  const savedDefaults = await options.evaluate(() => chrome.storage.local.get(['defaultTeam', 'options']));
  await options.evaluate(() => chrome.storage.local.remove('defaultTeam'));
  views.defaults = await fallback('defaults', null, /No default team or Notion name/, ['team']);
  check('Express fallback, defaults: links to Settings', /Settings/.test(await views.defaults.form.evaluate(() => document.querySelector('#express-reasons a')?.textContent ?? '')));
  await views.defaults.form.close();
  await options.evaluate(() => chrome.storage.local.remove('defaultTeam'));
  api.repeats = [{ memberName: 'Test Student B', createdMs: Date.UTC(2026, 10, 7, 20, 2), pageUrl: 'https://app.notion.com/p/earlier-request', state: 'created' }, { memberName: 'Test Student C', createdMs: Date.UTC(2026, 10, 8, 14, 15), pageUrl: null, state: 'created' }];
  views.all = await fallback('all', null, /No price was found[\s\S]*No default team[\s\S]*Test Student B/, ['price', 'team']);
  check('Express fallback, every reason: the reasons scroll inside their box', await views.all.form.evaluate(() => { const box = document.getElementById('alerts'); return box.clientHeight <= 150; }));
  await views.all.form.close();
  api.repeats = [];
  await options.evaluate(saved => chrome.storage.local.set(saved), savedDefaults);

  // A student edits a fallback: it's theirs now, and even a full page doesn't send it by itself.
  start = expressCount();
  const editedPage = await product(expressUrl('edited'));
  popup = await popupFor(editedPage);
  await popup.waitForSelector('#request-form:not([hidden])');
  await popup.fill('#price', '12.50');
  await popup.waitForTimeout(300);
  popup = await reopen(popup, editedPage);
  await popup.waitForSelector('#request-form:not([hidden])');
  await sleep(300);
  check('Express: an edited draft is restored and not sent', (await popup.inputValue('#price')) === '12.5' && expressCount() === start, `posts=${expressCount() - start}`);
  await popup.close();
  await editedPage.close();

  // Selecting the option and reopening is what the variant reason says to do, and it uses the same ID.
  start = expressCount();
  const variantId = await options.evaluate(url => chrome.storage.local.get(null).then(all => Object.values(all).find(v => v?.draft?.url === url)?.submissionId), expressUrl('variant'));
  await views.variant.target.selectOption('select', '4');
  await views.variant.target.bringToFront();
  popup = await popupFor(views.variant.target);
  check('Express: choosing the option and reopening sends it', await until(popup, () => !document.getElementById('result').hidden, 8000) && expressCount() === start + 1, `posts=${expressCount() - start}`);
  check('Express: that send uses the draft\'s first ID, with the page\'s price', api.posts.at(-1).submissionId === variantId && api.posts.at(-1).draft.price === 12.5, JSON.stringify(api.posts.at(-1)));
  await popup.close();

  // Layout again in Light mode, every state, on team colors with a light primary.
  api.statusBody = { settings: TEAM_B };
  await relight();
  await options.click('#theme-toggle');
  await until(options, () => chrome.storage.local.get('theme').then(v => v.theme === 'light'), 3000);
  check('Light: Options with Express on fits 1366x650', await fits(options, 650), await scrollHeight(options));
  await shot(options, 'options-express-on-light');
  for (const name of ['price', 'currency', 'check', 'defaults', 'all']) {
    if (name === 'defaults' || name === 'all') await options.evaluate(() => chrome.storage.local.remove('defaultTeam'));
    if (name === 'all') api.repeats = [{ memberName: 'Test Student B', createdMs: Date.UTC(2026, 10, 7, 20, 2), pageUrl: null, state: 'created' }];
    if (name === 'check') api.checkFails = true;
    const form = await popupFor(views[name].target);
    const box = await until(form, () => !document.getElementById('request-form').hidden && !document.getElementById('express-reasons-box').hidden, 8000);
    check(`Light: fallback ${name} fits 600px`, box && await fits(form, 600), await scrollHeight(form));
    check(`Light: fallback ${name} is really light`, await form.evaluate(() => getComputedStyle(document.querySelector('.ui-card')).backgroundColor) === 'rgb(255, 255, 255)');
    await shot(form, `express-review-${name}-light`);
    await form.close();
    api.checkFails = false; api.repeats = [];
    if (name === 'defaults' || name === 'all') await options.evaluate(saved => chrome.storage.local.set(saved), savedDefaults);
  }
  popup = await popupFor(okPage);
  check('Light: Express success fits 600px', await titleIs(popup, 'Request sent') && await fits(popup, 600), await scrollHeight(popup));
  await shot(popup, 'express-success-light');
  await popup.close();
  api.behavior = 'hold';
  const lightSending = await product(`${expressUrl('closed')}`);
  popup = await popupFor(lightSending);
  check('Light: Express sending fits 600px', await titleIs(popup, 'Sending your request', 8000) && await fits(popup, 600), await scrollHeight(popup));
  await shot(popup, 'express-sending-light');
  api.behavior = 'ok'; api.release?.();
  await titleIs(popup, 'Request sent', 8000);
  await popup.close();
  await lightSending.close();
  api.behavior = 'uncertain';
  const lightUncertain = await product(expressUrl('lightuncertain'));
  popup = await popupFor(lightUncertain);
  check('Light: Express uncertain fits 600px', await titleIs(popup, 'Not sure it was created', 10000) && await fits(popup, 600), await scrollHeight(popup));
  await shot(popup, 'express-uncertain-light');
  await popup.close();
  await lightUncertain.close();
  api.behavior = 'ok';
  await options.click('#theme-toggle');
  await until(options, () => chrome.storage.local.get('theme').then(v => v.theme === 'dark'), 3000);
  for (const view2 of Object.values(views)) await view2.target.close().catch(() => undefined);
  await okPage.close();

  // Turning it off puts the form back.
  await options.bringToFront();
  await options.click('.x-setting');
  await until(options, () => /is off/.test(document.getElementById('notice').textContent), 5000);
  start = expressCount();
  const offPage = await product(expressUrl('price'));
  popup = await popupFor(offPage);
  await popup.waitForSelector('#request-form:not([hidden])');
  await sleep(300);
  check('Express off again: no reasons, nothing sent', !(await visible(popup, '#express-reasons-box')) && expressCount() === start);
  await popup.close();
  await offPage.close();
  check('Fonts: no page ever asked anything but the extension for a font', fontRequests.length > 0 && fontRequests.every(url => url.startsWith('chrome-extension://')), fontRequests.filter(url => !url.startsWith('chrome-extension://')).join());
  check('Fonts: no request went to a font host', !allRequests.some(url => /fonts\.(googleapis|gstatic)\.com|fontsource/.test(url)));
  check('Extension pages made no remote requests of their own', extensionPageRemote.length === 0, extensionPageRemote.slice(0, 3).join());
  options.once('dialog', dialog => dialog.accept());
  await options.click('#unpair');
  await options.waitForSelector('#pair-form:not([hidden])', { timeout: 5000 }).catch(() => {});
  check('Express: Unpair turns the switch off', await options.isDisabled('#express-enabled') && !(await options.isChecked('#express-enabled')) && !(await options.evaluate(() => chrome.storage.local.get('expressEnabled'))).expressEnabled);

  const finalStore = await options.evaluate(() => chrome.storage.local.get(null));
  check('No key is left anywhere in storage', !JSON.stringify(finalStore).includes(DEVICE_KEY) && !JSON.stringify(finalStore).includes(SECOND_KEY));
  check('No page errors, CSP errors or illegal invocations', problems.length === 0, problems.slice(0, 4).join(' | '));
  check('The test kept answering for the fake site throughout', loopLag < 5000, `blocked for ${loopLag}ms`);
  check('The built CSP limits fonts to the extension', /font-src 'self'/.test(productionManifest.content_security_policy.extension_pages));
} catch (error) {
  check('Run completed without crashing', false, String(error.stack || error.message).slice(0, 800));
} finally {
  clearInterval(lagWatch);
  await context.close();
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed (${realPrompt ? 'real permission prompt' : 'simulated permission prompt'})`);
process.exit(failed.length ? 1 : 0);
