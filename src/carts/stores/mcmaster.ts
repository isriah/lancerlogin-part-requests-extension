// McMaster's order page: "Paste part numbers and quantities" opens #bulk-lines-textarea, its Add makes a line, and a line is two input boxes, not text. These
// shapes come from the owner's signed-in browser, with one line added by hand. A fresh browser gets a login wall, which stops the store like any other wall.
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
 * Injected on the order page. A line is an input holding the part number and another holding its quantity, with the same trailing number in their ids, and
 * only the lines asked for are handed back. The order page has to be recognizable, so that "not on the page" can mean "not in the cart" and not "the page
 * changed". It draws itself after loading, so this waits for the order page or a sign-in, then for its lines to hold still. A sign-in stops the store here,
 * because the check after loading runs too soon to see it.
 */
export async function mcmasterReadCart(keys: string[], waitMs = 10_000, settleMs = 1000): Promise<CartLine[] | PageStop> {
  const started = Date.now();
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  // What a person can see, so that words in the page's scripts don't count. The sign-in is checked first, because it can sit over a hidden order page.
  const visibleText = () => document.body?.innerText ?? document.body?.textContent ?? '';
  let last = '', since = Date.now();
  for (;;) {
    const text = visibleText();
    if ([...document.querySelectorAll('input[type="password"]')].some(shown) || /please log in|log in to continue/i.test(text)) return { kind: 'stop', reason: 'login', detail: 'a sign-in page' };
    // The words go once the paste box is open, and a page with lines may read differently, so the boxes count too.
    const recognized = /paste part numbers/i.test(text) || [...document.querySelectorAll('#bulk-lines-textarea,.new-line-part-number-input,.line-part-number-input')].some(shown);
    let drawing = false;
    if (recognized) {
      // An empty new row is new-line-part-number-input-N, and never a line.
      const parts = ([...document.querySelectorAll('.line-part-number-input')] as HTMLInputElement[]).filter(box => !box.classList.contains('new-line-part-number-input') && !box.id.startsWith('new-line-'));
      const amounts = ([...document.querySelectorAll('.line-quantity-input')] as HTMLInputElement[]).filter(box => !box.classList.contains('new-line-quantity-input') && !box.id.startsWith('new-line-'));
      const lines = new Map<string, number>();
      let problem = '';
      for (const part of parts) {
        const key = part.value.trim().toUpperCase();
        if (!keys.includes(key)) continue;
        const number = /-(\d+)$/.exec(part.id)?.[1];
        const boxes = number === undefined ? [] : amounts.filter(box => /-(\d+)$/.exec(box.id)?.[1] === number);
        if (boxes.length !== 1) { problem = 'an order line with no quantity box'; continue; }
        if (!/^\d+$/.test(boxes[0].value.trim())) { problem = 'an order line with no quantity'; continue; }
        lines.set(key, (lines.get(key) ?? 0) + Number(boxes[0].value));
      }
      // A total with no lines means the lines haven't drawn yet, or are somewhere this can't see. That can't read as zero, which would double a retry.
      const total = Number(/merchandise\s*\$\s*([\d,]*\.?\d+)/i.exec(text)?.[1]?.replaceAll(',', '') ?? 0);
      drawing = total > 0 && !parts.some(part => part.value.trim());
      const state = JSON.stringify([parts.map(part => part.value), amounts.map(box => box.value), problem]);
      if (state !== last) { last = state; since = Date.now(); }
      if (!drawing && Date.now() - since >= settleMs) {
        if (problem) return { kind: 'stop', reason: 'unexpected', detail: problem };
        return keys.filter(key => lines.has(key)).map(key => ({ key, quantity: lines.get(key)! }));
      }
    }
    if (Date.now() - started >= waitMs) return { kind: 'stop', reason: 'unexpected', detail: !recognized ? 'an order page without the paste control' : drawing ? 'an order total with no lines to read' : 'an order page that kept changing' };
    await new Promise(done => setTimeout(done, 100));
  }
}
/**
 * Injected on the order page. Opens the paste box if it isn't open, enters one line in that box and no other, and presses its Add. It touches no other control,
 * and checks that first. The page also shows a feedback box, #message-input, which comes first in the document, so "the first text box" would be the wrong one.
 */
export async function mcmasterPasteLine(part: string, quantity: number): Promise<{ kind: 'sent' } | PageStop> {
  const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const never = /check\s?out|place (your )?order|submit order|buy|pay/i;
  const label = (node: Element) => `${node.textContent || ''} ${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
  const stop = (detail: string): PageStop => ({ kind: 'stop', reason: 'unexpected', detail, notSent: true });
  const pasteBox = () => { const box = document.getElementById('bulk-lines-textarea') as HTMLTextAreaElement | null; return box?.tagName === 'TEXTAREA' && shown(box) ? box : null; };
  if ([...document.querySelectorAll('input[type="password"]')].some(shown)) return { kind: 'stop', reason: 'login', detail: 'a sign-in page', notSent: true };
  let box = pasteBox();
  if (!box) {
    const openers = [...document.querySelectorAll('button.switch-mode-link')].filter(node => shown(node) && /^paste part numbers and quantities$/i.test((node.textContent || '').replace(/\s+/g, ' ').trim())) as HTMLElement[];
    if (openers.length !== 1 || never.test(label(openers[0]))) return stop('an order page without the paste control');
    openers[0].click();
    for (let tries = 0; tries < 25 && !box; tries++) {
      box = pasteBox();
      if (!box) await wait(200);
    }
    if (!box) return stop('the paste box did not open');
  }
  // The page's own framework watches for input events, so the value goes in the way a paste would and the event follows.
  const line = `${part}\t${quantity}`;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, line);
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(200);
  if (box.value !== line) return stop('the paste box did not keep this line');
  // It isn't inside a form or a section, so it's found by its own classes, and still has to say Add and nothing about checkout.
  const adds = [...document.querySelectorAll('button.button-primary.button-add-bulk-lines')].filter(shown) as HTMLButtonElement[];
  const address = adds.length === 1 ? `${adds[0].getAttribute('formaction') ?? ''} ${adds[0].closest('form')?.getAttribute('action') ?? ''}` : '';
  if (adds.length !== 1 || !/^add$/i.test((adds[0].textContent || '').trim()) || never.test(label(adds[0])) || /check\s?out|\bbuy\b|\bpay\b|place.?order/i.test(address) || adds[0].disabled) return stop('the paste box has no ADD button');
  adds[0].click();
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
