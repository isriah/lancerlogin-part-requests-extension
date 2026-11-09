// A live check of the store modules against the real stores, through the built extension, in a throwaway browser profile that is deleted afterwards.
// It adds one real item per store to that profile's own carts and goes no further: it never checks out, signs in or answers a challenge. The plugin is
// simulated with synthetic data. It stops at any wall, which is the result for that store.
// Run: npm run build && npm run live:carts. E2E_SCREENSHOTS=<folder> saves built-carts-live-*.png. Never point this at anyone's own profile.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'part-requests-carts-live-'));
const shots = process.env.E2E_SCREENSHOTS;
const channel = process.env.E2E_CHANNEL || 'msedge';
const SITE = 'https://team-site.example.test';
const DEVICE_KEY = 'e2eFakeDeviceKey00000000000000000000000000x'.slice(0, 43);
const STORES = ['https://www.mcmaster.com/*', 'https://www.pololu.com/*', 'https://www.revrobotics.com/*', 'https://wcproducts.com/*'];
const manifest = JSON.parse(readFileSync(join(root, 'dist', 'manifest.json'), 'utf8'));
const extension = join(work, 'extension');
cpSync(join(root, 'dist'), extension, { recursive: true });
writeFileSync(join(extension, 'manifest.json'), JSON.stringify({ ...manifest, host_permissions: [`${SITE}/*`, ...STORES] }));

const order = (id, extra) => ({ id, url: `https://app.notion.com/p/synthetic-${id}`, description: `Live check ${id}`, vendor: null, urlVendor: null, sku: null, productUrl: null, quantity: 2, unitPrice: null, status: 'NORMAL Request', statusGroup: 'NORMAL', teams: ['Test Team One'], requesters: ['Test Student A'], cartMarks: [], ...extra });
const api = { orders: [], marks: [] };
async function plugin(route) {
  const request = route.request(), path = new URL(request.url()).pathname, name = path.slice('/api/public/part-requests'.length);
  const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (path === '/api/setup/status') return reply({ settings: { primaryColor: '#0b3d91', secondaryColor: '#f58220', organizationName: 'Test Robotics Team A' } });
  if (name === '/pair') return reply({ deviceKey: DEVICE_KEY, memberName: 'Test Student A' }, 201);
  if (name === '/options') return reply({ memberName: 'Test Student A', teams: [{ id: 't', name: 'Test Team One' }], recipients: [{ id: 'p', name: 'Test Student A' }], defaultRecipientId: 'p', statuses: [], vendors: [], recipientsUpdatedMs: 1, minimumExtensionVersion: '0.3.0', updateUrl: null, databaseLink: null, cartsEnabled: true });
  if (name === '/orders') return reply({ orders: api.orders, fetchedMs: Date.now(), stale: false, refreshing: false, refreshError: null, truncated: false, skippedRows: 0, statuses: [] });
  if (name === '/orders/marks') { const { marks } = request.postDataJSON(); api.marks.push(...marks); return reply({ marked: marks.length, markedMs: 1, expiresMs: 2 }, 201); }
  return reply({ error: 'Not found' }, 404);
}
const context = await chromium.launchPersistentContext(join(work, 'profile'), {
  channel, headless: false, viewport: { width: 1366, height: 860 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check'],
});
const report = { navigations: [], checkoutNavigations: [], stages: {} };
const fail = [];
try {
  await context.route(`${SITE}/**`, plugin);
  // Every top-level page anything in this browser went to. A checkout address is refused here too, and recorded.
  await context.route('**/*', route => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.frame().parentFrame()) return route.fallback();
    const url = request.url();
    report.navigations.push(`${request.method()} ${url.split('?')[0]}`);
    if (/\/checkouts?(\/|$|\?)|action=buy|\/cart\/\d+:\d+/i.test(new URL(url).pathname + new URL(url).search)) { report.checkoutNavigations.push(url); return route.abort(); }
    return route.fallback();
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.fill('#site-address', SITE); await options.fill('#pin', 'K7M2-9QXP');
  await options.click('#pair');
  await options.waitForSelector('#paired-card:not([hidden])', { timeout: 15000 });
  await options.click('#carts-enabled');
  await options.waitForSelector('#carts-open:not([hidden])', { timeout: 15000 });

  const run = async (name, orders, again = true) => {
    api.orders = orders; api.marks = [];
    const carts = await context.newPage();
    await carts.goto(`chrome-extension://${id}/carts.html`);
    await carts.waitForSelector('#orders-view:not([hidden])', { timeout: 15000 });
    const once = async label => {
      await carts.click('#build');
      await carts.waitForSelector('#results-view:not([hidden])', { timeout: 180000 });
      const cards = await carts.$$eval('[data-result]', list => Object.fromEntries(list.map(card => [card.dataset.result, card.innerText.replace(/\s+/g, ' ')])));
      if (shots) await carts.screenshot({ path: join(shots, `built-carts-live-${name}-${label}.png`), fullPage: true });
      return { cards, marks: api.marks.slice() };
    };
    report.stages[name] = { first: await once('first') };
    if (again) {
      await carts.click('#back');
      await carts.waitForSelector('#orders-view:not([hidden])', { timeout: 15000 });
      api.marks = [];
      report.stages[name].retry = await once('retry');
    }
    await carts.close();
  };
  const revPole = [
    order('rev', { vendor: 'REV', urlVendor: 'REV', sku: 'REV-21-1651', productUrl: 'https://www.revrobotics.com/rev-21-1651/', description: 'Live check REV NEO 550' }),
    order('pololu', { vendor: 'Pololu', urlVendor: 'Pololu', productUrl: 'https://www.pololu.com/product/2136', description: 'Live check Pololu driver' }),
  ];
  const only = process.env.LIVE_ONLY ? process.env.LIVE_ONLY.split(',') : null;
  const wanted = name => !only || only.includes(name);
  if (wanted('rev-pololu')) await run('rev-pololu', revPole);
  // What the real carts hold, read by this script in the same profile: the lines only.
  const look = await context.newPage();
  if (wanted('rev-pololu')) {
    await look.goto('https://www.revrobotics.com/cart.php', { waitUntil: 'domcontentloaded' });
    report.revCart = await look.evaluate(async () => (await (await fetch('/api/storefront/carts')).json()).flatMap(c => c.lineItems.physicalItems.map(i => [i.sku, i.quantity])));
    await look.goto('https://www.pololu.com/cart', { waitUntil: 'domcontentloaded' });
    report.pololuCart = await look.evaluate(() => [...document.querySelectorAll('tr.cart-product')].map(r => [r.querySelector('a[href*="/product/"]').getAttribute('href'), r.querySelector('input[name$="[quantity]"]').value]));
  }

  // WCP: a real variant that lists a SKU and is available, found read-only, so the saved link and the SKU both get tested.
  if (wanted('wcp')) {
    await look.goto('https://wcproducts.com/cart', { waitUntil: 'domcontentloaded' });
    const product = await look.evaluate(async () => {
      const { products } = await (await fetch('/products.json?limit=100')).json();
      const list = products.flatMap(p => p.variants.filter(v => v.available && v.sku).map(v => ({ handle: p.handle, id: v.id, sku: v.sku, price: Number(v.price), title: p.title }))).sort((a, b) => a.price - b.price);
      return { found: list[0] ?? null, seen: products.length, withSku: list.length };
    });
    report.wcpProduct = product;
    if (product.found) {
      const { found } = product;
      await run('wcp', [order('wcp', { vendor: 'WCP', urlVendor: 'WCP', sku: found.sku, productUrl: `https://wcproducts.com/products/${found.handle}?variant=${found.id}`, unitPrice: found.price, description: 'Live check WCP item' })]);
      await look.goto('https://wcproducts.com/cart', { waitUntil: 'domcontentloaded' });
      report.wcpCart = await look.evaluate(async () => (await (await fetch('/cart.js')).json()).items.map(i => [i.variant_id, i.sku, i.quantity]));
    }
  }
  // McMaster last: a fresh profile is expected to hit its login wall, and that's where it stops.
  if (wanted('mcmaster')) await run('mcmaster', [order('mcmaster', { vendor: 'McMaster', urlVendor: 'McMaster', productUrl: 'https://www.mcmaster.com/91251A537/', description: 'Live check McMaster screws' })], false);
  await look.close();
} catch (error) {
  fail.push(String(error?.message ?? error));
} finally {
  await context.close().catch(() => undefined);
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); report.profileDeleted = true; } catch { report.profileDeleted = `left at ${work}`; }
}
console.log(JSON.stringify({ ...report, navigations: [...new Set(report.navigations)], fail }, null, 1));
process.exit(fail.length || report.checkoutNavigations.length ? 1 : 0);
