// The real store tab. It runs in the Carts page, never the service worker. Every address and every load goes through safety.ts and page-check.ts.
import { inspectPage } from './page-check';
import { allowedInTab } from './safety';
import { StoreStop, type PageStop, type StoreMethod, type StoreTab } from './store-method';

const LOAD_TIMEOUT_MS = 30_000;
const SETTLE_MS = 300;
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

export class ChromeStoreTab implements StoreTab {
  private constructor(private store: StoreMethod, private tabId: number) {}

  /** Opens the store's start page in a new tab, in this browser's own session. */
  static async open(store: StoreMethod, active: boolean): Promise<ChromeStoreTab> {
    if (!store.startUrl || !allowedInTab(store, store.startUrl)) throw new StoreStop('unexpected', 'no safe start page');
    const created = await chrome.tabs.create({ url: 'about:blank', active });
    const tab = new ChromeStoreTab(store, created.id!);
    try { await tab.goto(store.startUrl); }
    catch (error) { await tab.close(); throw error; }
    return tab;
  }
  async goto(url: string): Promise<void> {
    if (!allowedInTab(this.store, url)) throw new StoreStop('unexpected', 'refused an address outside the store or at checkout');
    const loaded = this.nextLoad();
    await chrome.tabs.update(this.tabId, { url });
    await loaded;
    await this.check();
  }
  async run<A extends unknown[], R>(func: (...args: A) => R | Promise<R>, ...args: A): Promise<Awaited<R>> {
    await this.confirmLocation();
    return this.inject(func, args);
  }
  async runThenLoad<A extends unknown[], R>(func: (...args: A) => R | Promise<R>, ...args: A): Promise<Awaited<R>> {
    await this.confirmLocation();
    const loaded = this.nextLoad();
    const answer = await this.inject(func, args);
    if ((answer as PageStop | undefined)?.kind === 'stop') { void loaded.catch(() => undefined); return answer; }
    await loaded;
    await this.check();
    return answer;
  }
  async close(): Promise<void> { await chrome.tabs.remove(this.tabId).catch(() => undefined); }

  private async inject<A extends unknown[], R>(func: (...args: A) => R | Promise<R>, args: A): Promise<Awaited<R>> {
    let results;
    try { results = await chrome.scripting.executeScript({ target: { tabId: this.tabId }, world: 'ISOLATED', func: func as (...a: unknown[]) => unknown, args }); }
    catch { throw new StoreStop('unexpected', 'Chrome could not run in the store\'s tab'); }
    return results[0]?.result as Awaited<R>;
  }
  private async confirmLocation(): Promise<void> {
    let tab;
    try { tab = await chrome.tabs.get(this.tabId); } catch { throw new StoreStop('unexpected', 'the store\'s tab was closed'); }
    if (!allowedInTab(this.store, tab.url ?? '')) throw new StoreStop('unexpected', 'the tab left the store');
  }
  /** After any load: still on the store, not at checkout, no wall. */
  private async check(): Promise<void> {
    await this.confirmLocation();
    const answer = await this.inject(inspectPage, []);
    if (answer?.kind === 'stop') throw new StoreStop(answer.reason, answer.detail);
  }
  private nextLoad(): Promise<void> {
    return new Promise<void>((done, fail) => {
      const finish = (error?: StoreStop) => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(updated);
        chrome.tabs.onRemoved.removeListener(removed);
        if (error) fail(error); else void sleep(SETTLE_MS).then(() => done());
      };
      // The new tab's blank page finishes first, and doesn't count.
      const updated = (tabId: number, change: { status?: string }, tab?: { url?: string }) => { if (tabId === this.tabId && change.status === 'complete' && tab?.url !== 'about:blank') finish(); };
      const removed = (tabId: number) => { if (tabId === this.tabId) finish(new StoreStop('unexpected', 'the store\'s tab was closed')); };
      const timer = setTimeout(() => finish(new StoreStop('unexpected', 'the store\'s page did not load')), LOAD_TIMEOUT_MS);
      chrome.tabs.onUpdated.addListener(updated);
      chrome.tabs.onRemoved.addListener(removed);
    });
  }
}
