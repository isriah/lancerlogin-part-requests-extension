// McMaster's order page: "Paste part numbers and quantities", then ADD, then read the lines back. It has never run against a signed-in account,
// because a fresh browser gets a login wall, which stops the store like any other wall. docs/CARTS.md says what the owner has to check.
import { stopIf, type CartLine, type PageStop, type StoreMethod } from '../store-method';
import type { CartOrder } from '../types';

const HOME = 'https://www.mcmaster.com';
const PART = /^\d+[A-Z]\d+$/;

/** A part number from the SKU or the link. */
export function mcmasterPart(order: Pick<CartOrder, 'productUrl' | 'sku'>): string | null {
  const sku = order.sku?.trim().toUpperCase() ?? '';
  if (PART.test(sku)) return sku;
  try { return /^\/(\d+[A-Z]\d+)(?:\/|$)/i.exec(new URL(order.productUrl ?? '').pathname)?.[1]?.toUpperCase() ?? null; } catch { return null; }
}
/**
 * Injected on the order page. Reads the quantity box on the same line as each part number, and hands back only the lines asked for. The order
 * page has to be recognizable, so that "not on the page" can mean "not in the cart" and not "the page changed". It draws itself after loading, so
 * this waits for either the order page or a sign-in. The sign-in stops the store here, because the check after loading runs too soon to see it.
 */
export async function mcmasterReadCart(keys: string[], waitMs = 10_000): Promise<CartLine[] | PageStop> {
  const started = Date.now();
  // What a person can see, so that words in the page's scripts don't count. The sign-in is checked first, because it can sit over a hidden order page.
  const visibleText = () => document.body?.innerText ?? document.body?.textContent ?? '';
  for (;;) {
    const shownPassword = [...document.querySelectorAll('input[type="password"]')].some(node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; });
    if (shownPassword || /please log in|log in to continue/i.test(visibleText())) return { kind: 'stop', reason: 'login', detail: 'a sign-in page' };
    if (/paste part numbers/i.test(visibleText())) break;
    if (Date.now() - started >= waitMs) return { kind: 'stop', reason: 'unexpected', detail: 'an order page without the paste control' };
    await new Promise(done => setTimeout(done, 250));
  }
  const lines: CartLine[] = [];
  for (const key of keys) {
    const holders = [...document.querySelectorAll('a,span,div,td')].filter(node => node.children.length === 0 && (node.textContent || '').trim().toUpperCase() === key);
    let quantity = 0, found = false;
    for (const holder of holders) {
      const row = holder.closest('tr,[role="row"],li,[class*="line" i],[class*="row" i]');
      const box = row?.querySelector('input:not([type="hidden"]):not([type="checkbox"])') as HTMLInputElement | null;
      if (!box) continue;
      const value = Number(box.value);
      if (!Number.isFinite(value)) return { kind: 'stop', reason: 'unexpected', detail: 'an order line with no quantity' };
      quantity += value; found = true;
    }
    if (found) lines.push({ key, quantity });
    else if (holders.length) return { kind: 'stop', reason: 'unexpected', detail: 'an order line this could not read' };
  }
  return lines;
}
/** Injected on the order page. Opens the paste box, enters one line and presses its ADD. It touches no other control, and checks that first. */
export async function mcmasterPasteLine(part: string, quantity: number): Promise<{ kind: 'sent' } | PageStop> {
  const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const never = /check\s?out|place (your )?order|submit order|buy|pay/i;
  const label = (node: Element) => `${node.textContent || ''} ${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
  const opener = [...document.querySelectorAll('a,button,[role="button"],span,div')].filter(node => shown(node) && /^paste part numbers and quantities$/i.test((node.textContent || '').replace(/\s+/g, ' ').trim())).pop() as HTMLElement | undefined;
  if ([...document.querySelectorAll('input[type="password"]')].some(shown)) return { kind: 'stop', reason: 'login', detail: 'a sign-in page', notSent: true };
  if (!opener || never.test(label(opener))) return { kind: 'stop', reason: 'unexpected', detail: 'an order page without the paste control', notSent: true };
  opener.click();
  let box: HTMLTextAreaElement | undefined;
  for (let tries = 0; tries < 25 && !box; tries++) {
    box = [...document.querySelectorAll('textarea')].find(shown);
    if (!box) await wait(200);
  }
  if (!box) return { kind: 'stop', reason: 'unexpected', detail: 'the paste box did not open', notSent: true };
  // The page's own framework watches for input events, so the value goes in the way a paste would and the event follows.
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, `${part}\t${quantity}`);
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  const area = box.closest('form,[role="dialog"],section') ?? box.parentElement?.parentElement ?? box.parentElement;
  const add = [...(area?.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a') ?? [])].find(node => shown(node) && /^add$/i.test(((node as HTMLInputElement).value || node.textContent || '').trim()) && !never.test(label(node))) as HTMLElement | undefined;
  if (!add) return { kind: 'stop', reason: 'unexpected', detail: 'the paste box has no ADD button', notSent: true };
  add.click();
  await wait(1500);
  return { kind: 'sent' };
}

export const mcmaster: StoreMethod = {
  id: 'mcmaster', label: 'McMaster', badge: 'item', badgeHelp: 'Pastes one line at a time into the order page',
  origins: [`${HOME}/*`], hosts: ['www.mcmaster.com', 'mcmaster.com'], startUrl: `${HOME}/orders/`, cartUrl: `${HOME}/orders/`,
  requiredFields: ['quantity'],
  missing: order => mcmasterPart(order) ? [] : ['a part number, in the link or the SKU'],
  steps: {
    foreground: true,
    async resolveLine(order) {
      const part = mcmasterPart(order)!;
      return { key: part, addAs: part };
    },
    async readCart(tab, keys) { return stopIf(await tab.run(mcmasterReadCart, keys)); },
    async addLine(tab, target, quantity) { stopIf(await tab.run(mcmasterPasteLine, target.addAs, quantity)); },
  },
};
