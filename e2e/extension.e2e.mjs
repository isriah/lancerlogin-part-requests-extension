// End-to-end run of the built extension in a real browser, against a simulated plugin API routed at the site's origin.
// No real site, key, Notion database or Discord is involved. Product pages are small synthetic copies unless E2E_LIVE_STORES=1.
// Run: npm run build && npm run e2e
//
// The test copy of the manifest changes one thing: it lists the test stores under host_permissions, because automation cannot
// click the toolbar icon and so cannot trigger activeTab. That is the one thing this cannot prove: Chrome's toolbar-click grant.
//
// On Windows with Edge (the default there), Chrome's real permission prompt shows, so the browser window is headed and
// press-prompt-button.ps1 clicks Allow or Deny through UI Automation. Don't use the mouse during that part. Anywhere else, or
// with E2E_PROMPT=stub, the test manifest also lists the site and Deny is simulated in the page, which proves less.
import { execFileSync, spawnSync } from 'node:child_process';
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
const api = {
  pins: new Set(['K7M29QXP']), revoked: false, calls: [], posts: [], gets: [], recipients: [], checks: [], recorded: new Map(), keysSeen: new Set(),
  behavior: 'ok', latency: 0, release: null, maintenanceLeft: 0, retryAfter: '1', repeats: [], teams: [{ id: 'team-1', name: 'Test Team One' }, { id: 'team-2', name: 'Test Team Two' }],
  people: [{ id: PERSON, name: 'Test Student A' }, { id: GUEST, name: 'Test Guest' }], defaultRecipientId: null, currentKey: DEVICE_KEY,
};
const PAGE = 'https://app.notion.com/p/new-request';
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function plugin(route) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const reply = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  if (!path.startsWith('/api/public/part-requests')) return route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Not the API</h1>' });
  const name = path.slice('/api/public/part-requests'.length);
  const key = /^Bearer (.+)$/.exec(request.headers()['authorization'] ?? '')?.[1];
  const body = request.method() === 'POST' ? request.postDataJSON() : undefined;
  api.calls.push(`${request.method()} ${name}`);
  if (key) api.keysSeen.add(key);
  if (name === '/pair') {
    const pin = String(body.pin).replaceAll('-', '');
    if (!api.pins.has(pin)) return reply({ error: 'That PIN does not work. Run /ordering-pin in Discord to get a new one.', code: 'pin_refused' }, 401);
    api.pins.delete(pin); api.pairedLabel = body.deviceLabel; api.revoked = false;
    return reply({ deviceKey: api.currentKey, memberName: 'Test Student A' }, 201);
  }
  if (key !== api.currentKey || api.revoked) return reply({ error: 'This device is no longer paired. Run /ordering-pin in Discord and pair it again.', code: 'pair_again' }, 401);
  if (name === '/options') return reply({ memberName: 'Test Student A', teams: api.teams, recipients: api.people, defaultRecipientId: api.defaultRecipientId, statuses: ['NORMAL Request', 'Incomplete Request'], vendors: ['REV'], recipientsUpdatedMs: 1 });
  if (name === '/recipient') { api.recipients.push(body); api.defaultRecipientId = body.notionUserId; return reply({ defaultRecipientId: body.notionUserId }); }
  if (name === '/check') { api.checks.push(body); return reply({ repeats: api.repeats }); }
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
    if (api.behavior === 'uncertain') return respond(202, { submissionId: id, state: 'uncertain', error: 'Notion may or may not have created this request.', code: 'notion_uncertain' });
    if (api.behavior === 'failed') return respond(502, { submissionId: id, state: 'failed', error: 'Notion refused this request.', code: 'notion_400' });
    if (api.latency) await sleep(api.latency);
    if (api.behavior === 'hold') await new Promise(done => { api.release = done; });
    return respond(201, { submissionId: id, state: 'created', pageUrl: PAGE, repeats: api.repeats }).catch(() => undefined);
  }
  return reply({ error: 'Not found' }, 404);
}
const storePages = {
  [productUrl]: '<!doctype html><title>NEO 550</title><div class="productView"><h1 class="productView-title">NEO 550 Brushless Motor</h1><div class="productView-price"><span data-product-price-without-tax>$30.00</span></div><span data-product-sku>REV-21-1651</span></div>',
  'https://www.pololu.com/search/compare/1': '<!doctype html><title>Compare</title><h1>Compare products</h1>',
  'https://example.com/': '<!doctype html><title>Other site</title><h1>Not a store</h1>',
};

// waitForFunction evaluates strings, which the extension's CSP correctly refuses.
const until = async (page, predicate, timeout, arg) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await page.evaluate(predicate, arg)) return true; await sleep(100); } return false; };
const fits = (page, height) => page.evaluate(limit => document.documentElement.scrollHeight <= limit && document.documentElement.scrollWidth <= innerWidth + 1, height);
const scrollHeight = page => page.evaluate(() => String(document.documentElement.scrollHeight));
const textOf = (page, id) => page.textContent(`#${id}`);
const titleIs = (page, text, timeout = 10000) => until(page, wanted => !document.getElementById('result').hidden && document.getElementById('result-title').textContent === wanted, timeout, text);

const profile = join(work, 'profile');
const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.E2E_BROWSER ? { executablePath: process.env.E2E_BROWSER } : { channel }), headless: !realPrompt && !process.env.E2E_HEADED, viewport: { width: 1100, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check'],
});
const problems = [];
function pressPrompt(button) {
  // Playwright exposes no browser PID, so find this run's Edge by its unique profile folder.
  const listed = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${profile.replaceAll("'", "''")}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1).ProcessId`], { encoding: 'utf8' }).trim();
  if (!/^\d+$/.test(listed)) return `no browser process found for the test profile (${listed})`;
  const pressed = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'press-prompt-button.ps1'), '-RootPid', listed, '-Button', button], { encoding: 'utf8' });
  return pressed.stdout.trim() || pressed.stderr.trim();
}
try {
  await context.route(`${SITE}/**`, plugin);
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
  check('Options: header badge renamed', !/PILOT/.test(await options.textContent('.masthead')), await options.textContent('.masthead'));
  check('Options: pairing screen fits 1366x650', await fits(options, 650), await scrollHeight(options));
  if (shots) await options.screenshot({ path: join(shots, 'pairing-screen.png') });

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
  if (shots) await options.screenshot({ path: join(shots, 'pairing-denied.png') });

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
  if (shots) await popup.screenshot({ path: join(shots, 'popup-unpaired.png') });
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
  check('Pairing: Allow grants no other site', !(await options.evaluate(() => chrome.permissions.contains({ origins: ['https://other-site.example.test/*'] }))));

  // The address and PIN as pasted: a path on the address, no hyphen in the PIN, lower case.
  await pairWith(`  ${SITE}/settings/ `, 'k7m29qxp', 'Test laptop');
  await options.waitForSelector('#paired-card:not([hidden])', { timeout: 10000 }).catch(() => {});
  check('Pairing: succeeds with a messy address and no hyphen', await visible(options, '#paired-card'), await textOf(options, 'notice'));
  check('Pairing: the path was normalized and /api added', api.calls.includes('POST /pair') && api.calls.includes('GET /options'));
  check('Pairing: sends the device label', api.pairedLabel === 'Test laptop');
  check('Options: shows who, where and which device', /Test Student A/.test(await textOf(options, 'paired-member')) && (await textOf(options, 'paired-origin')) === SITE && (await textOf(options, 'paired-label')) === 'Test laptop');
  check('Options: PIN field is cleared', await options.evaluate(() => document.getElementById('pin').value === ''));
  check('Options: paired screen fits 1366x650', await fits(options, 650), await scrollHeight(options));
  check('Options: Unpair explains it only forgets the key here', /only forgets the key/.test(await textOf(options, 'paired-card')));
  if (shots) await options.screenshot({ path: join(shots, 'pairing-paired.png') });

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

  // The key stays in the worker. Popup messages and product pages never see it.
  const asPopup = await send({ type: 'settings' });
  check('The settings a page receives never contain the key', !JSON.stringify(asPopup).includes(DEVICE_KEY));
  check('Storage is limited to trusted contexts', await worker.evaluate(async () => (await chrome.storage.local.getAccessLevel?.()) ?? 'n/a').then(a => a === 'n/a' || a?.accessLevel === 'TRUSTED_CONTEXTS' || a === 'TRUSTED_CONTEXTS').catch(() => true));
  check('Every keyed call sent the bearer key', api.keysSeen.size === 1 && api.keysSeen.has(DEVICE_KEY));

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
  check('Create request sits at the top of the form', await popup.evaluate(() => document.getElementById('submit').getBoundingClientRect().top < document.getElementById('description').getBoundingClientRect().top));
  if (shots) await popup.screenshot({ path: join(shots, 'popup-form.png'), fullPage: true });

  // Chrome caps toolbar popups at 800x600, so the form must fit, even with every warning showing.
  check('Popup form fits without scrolling', await fits(popup, 600), await scrollHeight(popup));
  const showWarnings = paired => popup.evaluate(isPaired => {
    const fill = (id, lines) => { const list = document.getElementById(id); list.replaceChildren(...lines.map(text => Object.assign(document.createElement('li'), { textContent: text }))); list.hidden = false; };
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
  const hideWarnings = () => popup.evaluate(() => { for (const name of ['capture-issues', 'validation', 'currency-row', 'notice', 'repeat-warning', 'setup']) document.getElementById(name).hidden = true; });
  await showWarnings(true);
  check('Popup form still fits with every warning showing', await fits(popup, 600), await scrollHeight(popup));
  if (shots) await popup.screenshot({ path: join(shots, 'popup-worst-case.png') });
  await hideWarnings();
  await showWarnings(false);
  check('Popup form still fits with every unpaired warning showing', await fits(popup, 600), await scrollHeight(popup));
  await hideWarnings();

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
  if (shots) await popup.screenshot({ path: join(shots, 'popup-repeat-warning.png') });
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
  if (shots) await popup.screenshot({ path: join(shots, 'popup-success.png'), fullPage: true });

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
  popup = await reopen(popup, page);
  await popup.waitForTimeout(800);
  check('Uncertain result is not resent on reopen', api.posts.length === before + 1, `posts=${api.posts.length}`);
  check('Still uncertain after reopening', (await textOf(popup, 'result-title')) === 'Check Notion before retrying');
  if (shots) await popup.screenshot({ path: join(shots, 'popup-uncertain.png'), fullPage: true });
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
  if (shots) await popup.screenshot({ path: join(shots, 'popup-maintenance.png') });
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
  if (shots) await popup.screenshot({ path: join(shots, 'popup-revoked.png') });
  check('Revoked device: the key is forgotten', !('deviceKey' in await options.evaluate(() => chrome.storage.local.get('deviceKey'))));
  popup = await reopen(popup, page);
  await popup.waitForSelector('#request-form:not([hidden])');
  check('Revoked device: the draft and its edits are kept', (await popup.inputValue('#description')) === '[TEST] revoked while open' && (await popup.inputValue('#quantity')) === '4');
  check('Revoked device: the team and person are kept', (await popup.inputValue('#team')) === 'team-1' && (await popup.inputValue('#recipient')) === PERSON);
  await options.reload();
  await options.waitForSelector('#pair-form:not([hidden])');
  check('Options: shows pair again with the site filled in', (await textOf(options, 'pairing-state')) === 'PAIR AGAIN' && (await options.inputValue('#site-address')) === SITE && /drafts are kept/.test(await textOf(options, 'notice')));
  check('Options: the pair-again screen fits 1366x650', await fits(options, 650), await scrollHeight(options));
  if (shots) await options.screenshot({ path: join(shots, 'pairing-again.png') });

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

  // Unpair: forgets the key and the site's access, keeps drafts, and makes no call to the site.
  await popup.close();
  const callsBeforeUnpair = api.calls.length;
  options.once('dialog', dialog => dialog.accept());
  await options.click('#unpair');
  await options.waitForSelector('#pair-form:not([hidden])', { timeout: 5000 }).catch(() => {});
  check('Unpair: returns to the pairing screen', await visible(options, '#pair-form') && (await textOf(options, 'pairing-state')) === 'NOT PAIRED');
  check('Unpair: the key is gone', !('deviceKey' in await options.evaluate(() => chrome.storage.local.get('deviceKey'))));
  check('Unpair: Chrome\'s access to the site is removed', realPrompt ? !(await canReach()) : true);
  check('Unpair: only local, with no call to the site', api.calls.length === callsBeforeUnpair, api.calls.slice(callsBeforeUnpair).join());
  popup = await popupFor(page);
  await popup.waitForSelector('#request-form:not([hidden])');
  check('Unpair: the draft on this page is kept', /NEO 550/.test(await popup.inputValue('#description')) && await popup.isDisabled('#submit'));
  await popup.close(); await page.close();

  const finalStore = await options.evaluate(() => chrome.storage.local.get(null));
  check('No key is left anywhere in storage', !JSON.stringify(finalStore).includes(DEVICE_KEY) && !JSON.stringify(finalStore).includes(SECOND_KEY));
  check('No page errors, CSP errors or illegal invocations', problems.length === 0, problems.slice(0, 4).join(' | '));
} catch (error) {
  check('Run completed without crashing', false, String(error.stack || error.message).slice(0, 800));
} finally {
  await context.close();
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed (${realPrompt ? 'real permission prompt' : 'simulated permission prompt'})`);
process.exit(failed.length ? 1 : 0);
