// The Carts page. Builds run here, in this tab, never in the service worker: closing this tab ends a build, and the device key stays with the worker.
import '../styles.css';
import { applyAppearance } from '../appearance';
import type { SettingsView } from '../types';
import { el, errorText, notice, send, showUpdateNotice, UiError } from '../ui';
import { ChromeStoreTab } from './chrome-tab';
import { allStoreOrigins, OTHER_STORE } from './registry';
import { buildStore, checklistResult, marksFor, stopMessage, type ItemResult, type StoreResult } from './runner';
import { CART_SETTLE_MS, paceMs } from './safety';
import { groupOrders, isTicked, summarize, type OrderRow, type StoreGroup } from './selection';
import { BADGE_LABEL, StoreStop, type StoreBadge, type StoreMethod } from './store-method';
import type { CartMark, MarkInput, MarksOutcome, OrdersList, OrdersOutcome } from './types';

/** How many times this page asks again by itself before leaving it to the Refresh button. The plugin reads at most 10 pages of 50. */
const MAX_REFRESH_POLLS = 15;
const MAX_WAITS = 4;
const MARK_BATCH = 100;

let settings: SettingsView = { pairing: 'unpaired', defaultTeam: '' };
let list: OrdersList | undefined;
let groups: StoreGroup[] = [];
const ticks = new Map<string, boolean>();
/** Which store origins Chrome has granted. Read ahead of time, because a click can't wait before asking Chrome. */
const access = new Map<string, boolean>();
let declined = false;
let building = false;
let stopRequested = false;
let results: StoreResult[] = [];
let builtAt = 0;
let unsentMarks: MarkInput[] = [];
let loadGeneration = 0;
let polls = 0;
let waits = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const money = (value: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { tone?: string } = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const { tone, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  if (tone !== undefined) node.dataset.tone = tone;
  node.append(...children);
  return node;
}
const pill = (text: string, tone = '', extra = ''): HTMLElement => h('span', { className: `status-pill ui-status ${tone ? '' : 'pill-neutral '}${extra}`.trim(), ...(tone ? { tone } : {}) }, text);
const link = (href: string, text: string, className = ''): HTMLAnchorElement => h('a', { href, target: '_blank', rel: 'noopener noreferrer', className }, text);
const shortDate = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const clockTime = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const hasAccess = (store: StoreMethod): boolean => store.origins.every(origin => access.get(origin));
const canAutomate = (store: StoreMethod): boolean => !!store.steps && store.origins.length > 0;
const needingAccess = (): StoreMethod[] => groups.map(g => g.store).filter(store => canAutomate(store) && !hasAccess(store));
const shownBadge = (store: StoreMethod): StoreBadge => canAutomate(store) && !hasAccess(store) ? 'checklist' : store.badge;
const shownHelp = (store: StoreMethod): string => canAutomate(store) && !hasAccess(store) ? 'No store access yet, so this is a list for you to add yourself' : store.badgeHelp;
const badge = (kind: StoreBadge, help: string): HTMLElement => { const node = pill(BADGE_LABEL[kind], '', 'x-method'); node.title = help; return node; };

async function readAccess(): Promise<void> {
  for (const origin of allStoreOrigins()) access.set(origin, await chrome.permissions.contains({ origins: [origin] }));
}
function hideAll(): void {
  for (const id of ['state', 'permission', 'orders-view', 'results-view', 'list-notices']) el(id).hidden = true;
}
function showState(title: string, text: string, action?: { label: string; run(): void }): void {
  hideAll();
  el('state').hidden = false;
  el('state-title').textContent = title;
  el('state-text').textContent = text;
  const button = el<HTMLButtonElement>('state-action');
  button.hidden = !action;
  button.onclick = action ? () => action.run() : null;
  button.textContent = action?.label ?? '';
}
const openSettings = () => { void chrome.runtime.openOptionsPage(); };

function renderListNotices(): void {
  const box = el('list-notices'); box.replaceChildren();
  if (!list) { box.hidden = true; return; }
  const add = (tone: string, title: string, text: string) => box.append(h('p', { className: 'x-tone', tone }, h('strong', {}, title), text));
  if (list.stale || list.refreshError) {
    const minutes = list.fetchedMs ? Math.max(0, Math.round((Date.now() - list.fetchedMs) / 60000)) : null;
    const age = minutes === null ? 'an earlier read' : minutes < 1 ? 'less than a minute ago' : `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    add('warning', 'This list may be out of date.', `It's from ${age}, because the last read from Notion didn't work${list.refreshError ? ` (${list.refreshError})` : ''}.`);
  }
  if (list.refreshing) add('neutral', 'Still reading the list.', 'More orders may appear in a moment.');
  if (list.truncated) add('warning', 'Some orders are missing.', 'There are more than 500 rows, and the newest aren\'t shown. Clear out old rows in Notion to see them.');
  if (list.skippedRows > 0) add('warning', `${list.skippedRows} row${list.skippedRows === 1 ? '' : 's'} left out.`, 'Notion returned rows that aren\'t open orders. Tell an Admin if this keeps happening.');
  box.hidden = !box.childElementCount;
}
function markNote(marks: CartMark[]): HTMLElement | null {
  if (!marks.length) return null;
  const words = marks.map(mark => `${mark.ownDevice ? 'This device' : mark.memberName}${!mark.ownDevice && mark.deviceLabel ? ` (${mark.deviceLabel})` : ''}, qty ${mark.quantity}${mark.markedMs ? `, ${shortDate(mark.markedMs)}` : ''}`).join('; ');
  return h('span', { className: 'x-row-note', tone: 'warning' }, h('b', {}, '! Already in someone\'s cart'), h('span', {}, `${words}.`));
}
function rowNode(row: OrderRow): HTMLTableRowElement {
  const { order } = row;
  const name = order.description ?? 'No description';
  const box = h('input', { type: 'checkbox', checked: isTicked(row, ticks), disabled: !!row.blocked || building, ariaLabel: `Include ${name}` });
  box.dataset.order = order.id;
  box.addEventListener('change', () => { ticks.set(order.id, box.checked); updateSelection(); });
  const item = h('td', {}, h('span', { className: 'x-order-item' }, name), h('span', { className: 'x-order-sku' }, order.sku ?? 'No SKU'));
  if (row.blocked) {
    const note = h('span', { className: 'x-row-note', tone: 'warning' }, h('b', {}, '! Can\'t add yet'), h('span', {}, `${row.blocked} `));
    if (order.url) note.lastElementChild!.append(link(order.url, 'Open in Notion ↗'));
    item.append(note);
  }
  const marks = markNote(order.cartMarks);
  if (marks) item.append(marks);
  if (!row.blocked && order.statusGroup === 'SLOW') item.append(h('span', { className: 'x-row-note' }, h('b', {}, 'Waiting'), h('span', {}, 'SLOW requests stay unticked unless you tick them.')));
  if (!row.blocked && order.statusGroup === 'INCOMPLETE') item.append(h('span', { className: 'x-row-note' }, h('b', {}, 'Incomplete'), h('span', {}, 'Incomplete requests stay unticked unless you tick them.')));
  const statusName = order.statusGroup;
  const node = h('tr', {},
    h('td', {}, h('label', { className: 'x-row-check' }, box)), item,
    h('td', {}, order.quantity === null ? '-' : String(order.quantity)),
    h('td', {}, order.unitPrice === null ? '-' : money(order.unitPrice)),
    h('td', { className: 'x-td-req' }, order.requesters.join(', ') || '-'),
    h('td', {}, pill(statusName, statusName === 'RUSH' ? 'warning' : '', 'x-status-pill')));
  node.dataset.orderRow = order.id;
  return node;
}
function groupNode(group: StoreGroup): HTMLTableSectionElement {
  const all = h('input', { type: 'checkbox', disabled: building || group.rows.every(row => !!row.blocked), ariaLabel: `Select all from ${group.store.label}` });
  all.dataset.group = group.store.id;
  all.addEventListener('change', () => {
    for (const row of group.rows) if (!row.blocked) ticks.set(row.order.id, all.checked);
    renderTable();
  });
  const head = h('th', { colSpan: 5, scope: 'rowgroup', className: 'x-vendor-cell' }, h('span', { className: 'x-vendor-heading' }, h('span', {}, group.store.label), badge(shownBadge(group.store), shownHelp(group.store)), h('small', {}, shownHelp(group.store))));
  const section = h('tbody', {}, h('tr', { className: 'x-vendor-row' }, h('td', {}, h('label', { className: 'x-row-check' }, all)), head), ...group.rows.map(rowNode));
  section.dataset.store = group.store.id;
  return section;
}
function updateSelection(): void {
  const summary = summarize(groups, ticks);
  el('selection-count').textContent = building ? '' : `${summary.ticked} of ${summary.total} items selected from ${summary.stores} store${summary.stores === 1 ? '' : 's'}`;
  if (!building) el('selection-total').textContent = `Estimated ${money(summary.estimate)} before shipping and tax${summary.withoutPrice ? `, with ${summary.withoutPrice} item${summary.withoutPrice === 1 ? '' : 's'} without a price` : ''}`;
  el<HTMLButtonElement>('build').disabled = building || !summary.ticked;
  el<HTMLButtonElement>('refresh').disabled = building;
  el('stop').hidden = !building;
  el('allow-later').hidden = building || !needingAccess().length;
  for (const group of groups) {
    const all = document.querySelector<HTMLInputElement>(`input[data-group="${CSS.escape(group.store.id)}"]`);
    if (!all) continue;
    const open = group.rows.filter(row => !row.blocked);
    const on = open.filter(row => isTicked(row, ticks)).length;
    all.checked = on > 0 && on === open.length;
    all.indeterminate = on > 0 && on < open.length;
  }
}
function renderTable(): void {
  const table = el('orders-table');
  table.querySelectorAll('tbody').forEach(node => node.remove());
  table.append(...groups.map(groupNode));
  updateSelection();
}
function renderPermission(): void {
  hideAll();
  el('permission').hidden = false;
  const stores = groups.map(g => g.store).filter(canAutomate);
  const missing = needingAccess().length;
  el('permission-count').textContent = `! ${missing} store${missing === 1 ? ' needs' : 's need'} access`;
  el('permission-stores').replaceChildren(...stores.map(store => h('li', {}, h('span', {}, store.label), hasAccess(store) ? pill('✓ Allowed', 'success') : pill('Needs access'))));
}
function renderOrders(): void {
  if (!list) return;
  groups = groupOrders(list.orders);
  hideAll();
  renderListNotices();
  if (!list.orders.length) {
    if (list.refreshing) { showState('Reading open orders', 'This can take a few seconds.'); el('list-notices').hidden = true; return; }
    showState('No open orders', 'NORMAL and RUSH requests from your team\'s Notion database show up here. Nothing is waiting right now.', { label: 'Check again', run: () => { void load(true); } });
    renderListNotices();
    return;
  }
  if (needingAccess().length && !declined) { renderPermission(); renderListNotices(); return; }
  el('orders-view').hidden = false;
  renderTable();
}
function askLater(what: () => void, seconds: number): void {
  clearTimeout(timer);
  timer = setTimeout(what, Math.max(seconds, 1) * 1000);
}
/** Every answer in the README's table. Polling stops by itself, and a person can always press Refresh. */
function take(outcome: OrdersOutcome): void {
  switch (outcome.kind) {
    case 'orders': {
      waits = 0;
      list = outcome;
      notice('');
      renderOrders();
      if (outcome.refreshing && polls < MAX_REFRESH_POLLS) { polls++; askLater(() => { void load(false, true); }, 1); }
      return;
    }
    case 'refreshing':
      if (!list) showState('Reading open orders', 'There\'s nothing to show yet. That doesn\'t mean there are no orders. This can take a few seconds.');
      if (polls < MAX_REFRESH_POLLS) { polls++; askLater(() => { void load(false, true); }, outcome.retryAfterSeconds); }
      else notice('The site is taking a long time to read the orders. Press Refresh to ask again.', 'warning');
      return;
    case 'disabled':
      list = undefined; groups = [];
      showState('Carts is turned off', outcome.message);
      return;
    case 'wait':
      if (waits < MAX_WAITS) {
        waits++;
        notice(`${outcome.message} Trying again in ${Math.round(outcome.retryAfterSeconds)} seconds.`, 'warning');
        if (!list) showState('Waiting for the site', 'The open orders will show as soon as the site can read them.');
        askLater(() => { void load(false, true); }, outcome.retryAfterSeconds);
      } else {
        notice(`${outcome.message} Press Refresh to ask again.`, 'warning');
        if (!list) showState('Waiting for the site', 'The open orders aren\'t available yet.', { label: 'Check again', run: () => { void load(true); } });
      }
      return;
    case 'admin':
      list = undefined; groups = [];
      showState('An Admin has to fix this', `${outcome.message} (${outcome.code})`, { label: 'Check again', run: () => { void load(true); } });
      return;
    case 'error':
      notice(outcome.message, 'error');
      if (!list) showState('Couldn\'t load the open orders', outcome.message, { label: 'Check again', run: () => { void load(true); } });
  }
}
async function load(refresh = false, keepCounts = false): Promise<void> {
  if (building) return;
  clearTimeout(timer);
  if (!keepCounts) { polls = 0; waits = 0; }
  const generation = ++loadGeneration;
  if (!list) showState('Reading open orders', 'This can take a few seconds.');
  try {
    const outcome = await send<OrdersOutcome>({ type: 'carts-orders', refresh });
    if (generation !== loadGeneration || building) return;
    settings = await send<SettingsView>({ type: 'settings' });
    applyAppearance(settings);
    take(outcome);
  } catch (error) {
    if (generation !== loadGeneration) return;
    if (error instanceof UiError && error.code === 'pair_again') { showNotPaired(); return; }
    notice(errorText(error), 'error');
    if (!list) showState('Couldn\'t load the open orders', errorText(error), { label: 'Check again', run: () => { void load(true); } });
  }
}
function showNotPaired(): void {
  list = undefined; groups = [];
  showState(settings.pairing === 'unpaired' ? 'Pair this device first' : 'Pair this device again', 'Carts uses your team\'s LancerLogin site. Open Settings and pair with a PIN from /ordering-pin in Discord. Your drafts are kept.', { label: 'Open Settings', run: openSettings });
}

async function allowAccess(): Promise<boolean> {
  const missing = [...new Set(needingAccess().flatMap(store => store.origins))];
  // Chrome only shows the prompt during this click, so nothing may be awaited before this request.
  const granted = missing.length ? await chrome.permissions.request({ origins: missing }) : true;
  await readAccess();
  return granted;
}
el('permission-allow').addEventListener('click', () => {
  void allowAccess().then(granted => {
    if (!granted) { declined = true; notice('You chose Deny, so those stores stay as a checklist.', 'warning'); }
    renderOrders();
  }).catch(error => notice(errorText(error), 'error'));
});
el('permission-skip').addEventListener('click', () => { declined = true; renderOrders(); });
el('allow-later').addEventListener('click', () => {
  void allowAccess().then(granted => {
    if (!granted) notice('You chose Deny, so those stores stay as a checklist.', 'warning');
    renderTable();
  }).catch(error => notice(errorText(error), 'error'));
});
el('refresh').addEventListener('click', () => { void load(true); });
el('stop').addEventListener('click', () => { stopRequested = true; el<HTMLButtonElement>('stop').disabled = true; el('selection-total').textContent = 'Stopping after this line.'; });

/** Sends what a read-back confirmed. Nothing was recorded on a wait, so the same marks go again. Left over marks can be retried from the results. */
async function sendMarks(marks: MarkInput[]): Promise<string | null> {
  for (let start = 0; start < marks.length; start += MARK_BATCH) {
    const batch = marks.slice(start, start + MARK_BATCH);
    let tries = 0;
    for (;;) {
      let answer: MarksOutcome;
      try { answer = await send<MarksOutcome>({ type: 'carts-marks', marks: batch }); }
      catch (error) { unsentMarks.push(...marks.slice(start)); return errorText(error); }
      if (answer.kind === 'marked') break;
      if (answer.kind === 'wait' && tries < 2) { tries++; await sleep(Math.min(answer.retryAfterSeconds, 30) * 1000); continue; }
      if (answer.kind !== 'disabled') unsentMarks.push(...marks.slice(start));
      return answer.message;
    }
  }
  return null;
}
function showMarksProblem(problem: string | null): void {
  const box = el('marks-notice');
  box.hidden = !problem;
  box.textContent = problem ? `The carts are built, but the site didn't record them, so others won't see them as in someone's cart yet. ${problem}` : '';
  el('retry-marks').hidden = !problem || !unsentMarks.length;
}
el('retry-marks').addEventListener('click', () => {
  const marks = unsentMarks; unsentMarks = [];
  void sendMarks(marks).then(showMarksProblem);
});

async function build(): Promise<void> {
  clearTimeout(timer);
  building = true; stopRequested = false; unsentMarks = []; results = [];
  el<HTMLButtonElement>('stop').disabled = false;
  renderTable();
  el('selection-count').textContent = 'Building carts...';
  el('selection-total').textContent = 'Keep this tab open. Nothing is checked out.';
  let markProblem: string | null = null;
  const chosen = groups.map(group => ({ store: group.store, orders: group.rows.filter(row => isTicked(row, ticks)).map(row => row.order) })).filter(entry => entry.orders.length);
  for (const { store, orders } of chosen) {
    const steps = store.steps;
    if (!steps) { results.push(checklistResult(store, orders)); continue; }
    if (!hasAccess(store)) { results.push(checklistResult(store, orders, { noAccess: true })); continue; }
    if (stopRequested) {
      const result = checklistResult(store, orders);
      result.items = result.items.map(item => ({ ...item, message: 'The build was stopped before this item.' }));
      results.push(result); continue;
    }
    let tab: ChromeStoreTab | undefined;
    let result: StoreResult;
    try {
      tab = await ChromeStoreTab.open(store, !!steps.foreground);
      result = await buildStore(store, steps, orders, tab, {
        pause: () => sleep(paceMs()),
        settle: () => sleep(CART_SETTLE_MS),
        shouldStop: () => stopRequested,
        onProgress: (done, total) => { el('selection-count').textContent = `Building ${store.label}: ${Math.min(done + 1, total)} of ${total}`; },
        onFinalCheck: () => { el('selection-count').textContent = `Building ${store.label}: checking the cart once more`; },
      });
    } catch (error) {
      const reason = error instanceof StoreStop ? error.reason : 'unexpected';
      result = checklistResult(store, orders, { stopped: { reason, message: stopMessage(store.label, reason) } });
    } finally {
      await tab?.close();
    }
    results.push(result);
    // After each store's final read, so a line the store changed is never marked, and before the next store, so a mark is never lost to a later store's trouble.
    const marks = marksFor(result);
    if (marks.length) markProblem = await sendMarks(marks) ?? markProblem;
  }
  builtAt = Date.now();
  building = false;
  renderResults();
  showMarksProblem(markProblem);
  const here = await chrome.tabs.getCurrent() as chrome.tabs.Tab | undefined;
  if (here?.id !== undefined) void chrome.tabs.update(here.id, { active: true });
}
el('build').addEventListener('click', () => {
  if (building || !summarize(groups, ticks).ticked) return;
  void build().catch(error => { building = false; notice(errorText(error), 'error'); renderOrders(); });
});

const resultGroup = (title: string, items: HTMLElement[]): HTMLElement => h('div', { className: 'x-result-group' }, h('h3', {}, title), h('ul', {}, ...items));
function resultItem(result: ItemResult): HTMLElement {
  const marks: Record<string, [string, string]> = { added: ['✓', 'success'], flagged: ['!', 'warning'], failed: ['✕', 'error'], checklist: ['☐', ''] };
  const [mark, tone] = marks[result.outcome];
  const changed = result.storeChanged, rounded = result.rounded;
  const title = h('span', {}, `${result.order.description ?? 'No description'}, ${changed ? `you asked for ${changed.asked}, the cart holds ${changed.holds}` : rounded ? `you asked for ${rounded.asked}${rounded.orders > 1 ? ` across ${rounded.orders} orders` : ''}, the cart holds ${rounded.holds}` : `qty ${result.order.quantity ?? '?'}`}`);
  if ((result.outcome === 'failed' || result.outcome === 'checklist') && result.order.productUrl) title.append(' ', link(result.order.productUrl, 'Open product ↗'));
  if (rounded) title.append(h('small', {}, rounded.note));
  if (result.message) title.append(h('small', {}, result.message));
  return h('li', { }, h('span', { className: 'x-mark', tone, ariaHidden: 'true' }, mark), title);
}
function storeCard(result: StoreResult): HTMLElement {
  const of = (outcome: string) => result.items.filter(item => item.outcome === outcome);
  const [added, flagged, failed, checklist] = ['added', 'flagged', 'failed', 'checklist'].map(of);
  const changed = flagged.filter(item => item.storeChanged), rounded = flagged.filter(item => item.rounded);
  const counts = h('div', { className: 'x-actions x-result-counts' });
  if (added.length) counts.append(pill(`✓ ${added.length} added`, 'success'));
  if (flagged.length) counts.append(pill(`! ${flagged.length} flagged`, 'warning'));
  if (changed.length) counts.append(pill(`! ${changed.length} changed by the store`, 'warning'));
  if (rounded.length) counts.append(pill(`! ${rounded.length} rounded up`, 'warning'));
  if (failed.length) counts.append(pill(`✕ ${failed.length} failed`, 'error'));
  if (checklist.length) counts.append(pill(`${checklist.length} to add yourself`));
  const card = h('section', { className: 'ui-card' }, h('div', { className: 'x-card-head' }, h('h2', {}, result.label), badge(result.badge, result.noAccess ? 'No store access, so this is a list for you to add yourself' : '')), counts);
  card.dataset.result = result.storeId;
  if (result.stopped) card.append(h('p', { className: 'x-tone x-result-stop', tone: 'warning' }, result.stopped.message));
  if (result.noAccess) card.append(h('p', { className: 'x-help x-result-stop' }, 'This extension has no access to this store, so nothing was tried.'));
  if (result.finalCheckNote) card.append(h('p', { className: 'x-tone x-result-stop', tone: 'warning' }, result.finalCheckNote));
  if (result.resultNote && (added.length || flagged.length)) card.append(h('p', { className: 'x-help x-result-stop' }, result.resultNote));
  const standOut = (title: string, items: ItemResult[], extra = ''): void => {
    if (!items.length) return;
    const group = resultGroup(title, items.map(resultItem));
    group.classList.add('x-tone', 'x-result-changed', ...(extra ? [extra] : []));
    group.dataset.tone = 'warning';
    card.append(group);
  };
  standOut('The store changed the quantity, check before ordering', changed);
  standOut('Rounded up to what the store sells, check before ordering', rounded, 'x-result-rounded');
  if (added.length) card.append(resultGroup('Added', added.map(resultItem)));
  const plain = flagged.filter(item => !item.storeChanged && !item.rounded);
  if (plain.length) card.append(resultGroup('Flagged, check in the cart', plain.map(resultItem)));
  if (failed.length) card.append(resultGroup('Failed, not in the cart', failed.map(resultItem)));
  if (checklist.length) card.append(resultGroup('Add these yourself', checklist.map(resultItem)));
  if (result.cartUrl) {
    const open = link(result.cartUrl, `Open ${result.label} cart ↗`, `ui-button${added.length || flagged.length ? ' ui-button--primary' : ''}`);
    card.append(h('div', { className: 'x-actions x-result-action' }, open));
  } else {
    // A store with no method yet has no known cart page, so this goes to the store's own site.
    const site = result.items.map(item => item.order.productUrl).find(Boolean);
    if (site && result.label !== OTHER_STORE) card.append(h('div', { className: 'x-actions x-result-action' }, link(new URL(site).origin, `Open ${result.label} ↗`, 'ui-button')));
  }
  return card;
}
function renderResults(): void {
  hideAll();
  el('results-view').hidden = false;
  const count = (outcome: string) => results.reduce((sum, result) => sum + result.items.filter(item => item.outcome === outcome).length, 0);
  const today = new Date(builtAt).toDateString() === new Date().toDateString();
  el('results-when').textContent = `Built ${today ? 'today' : shortDate(builtAt)} at ${clockTime(builtAt)}`;
  const changed = results.reduce((sum, result) => sum + result.items.filter(item => item.storeChanged).length, 0);
  const rounded = results.reduce((sum, result) => sum + result.items.filter(item => item.rounded).length, 0);
  el('results-counts').textContent = `${count('added')} added, ${count('flagged')} flagged, ${count('failed')} failed, ${count('checklist')} to add yourself${changed ? `. ${changed} changed by the store: check before ordering` : ''}${rounded ? `. ${rounded} rounded up to what the store sells: check before ordering` : ''}`;
  el('results').replaceChildren(...results.map(storeCard));
}
el('back').addEventListener('click', () => { void load(); });
window.addEventListener('beforeunload', event => { if (building) event.preventDefault(); });

el('open-settings').addEventListener('click', openSettings);
el('theme-toggle').addEventListener('click', async () => {
  const theme = settings.theme === 'light' ? 'dark' : 'light';
  settings = { ...settings, theme };
  applyAppearance(settings); el('theme-toggle').setAttribute('aria-checked', String(theme === 'light'));
  try { settings = await send<SettingsView>({ type: 'set-theme', theme }); }
  catch (error) { notice(errorText(error), 'error'); }
});
// Access can change in Settings or Chrome's own menu while this page is open. A results page stays put.
const accessChanged = () => { if (!building) void readAccess().then(() => { if (list && el('results-view').hidden) renderOrders(); }); };
chrome.permissions.onAdded?.addListener(accessChanged);
chrome.permissions.onRemoved?.addListener(accessChanged);

async function start(): Promise<void> {
  el('version').textContent = chrome.runtime.getManifest().version;
  await readAccess();
  settings = await send<SettingsView>({ type: 'settings' });
  applyAppearance(settings);
  el('theme-toggle').setAttribute('aria-checked', String(settings.theme === 'light'));
  showUpdateNotice(settings.options);
  if (settings.pairing !== 'paired') { showNotPaired(); return; }
  if (settings.cartsEnabled !== true) { showState('Carts is off on this device', 'Turn on Carts in Settings to see your team\'s open orders and fill store carts here.', { label: 'Open Settings', run: openSettings }); return; }
  // Even if the saved lists say an Admin turned it off: /orders is the current answer, and says so itself.
  await load();
}
void start().catch(error => showState('Couldn\'t open Carts', errorText(error)));
