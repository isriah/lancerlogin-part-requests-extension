// Harbor Freight: /search?q=<SKU> goes to the product, then its own quantity box and Add to Cart, then the cart page reads back. It has never run
// against the real pages, because a fresh browser gets a Press & Hold bot check, which stops the store like any other wall. So the page shapes here
// are from the research, and anything else stops or fails the line with nothing added. docs/CARTS.md says what the owner has to check.
// The cart page is /checkout/cart, which safety.ts allows by this exact address only. Any other address there stops the store.
// Owner decision 2026-11-09: a pickup or shipping choice that's already selected is kept, and flags the line. None selected, or a store or ZIP prompt, fails it.
import { LineProblem, stopIf, type CartLine, type PageStop, type StoreMethod } from '../store-method';
import type { CartOrder } from '../types';

const HOME = 'https://www.harborfreight.com';
const CART = `${HOME}/checkout/cart`;

/** The SKU from the SKU field or the link. A link can end in several numbers, and then only the SKU field can say which. `conflict` when they disagree. */
export function harborFreightSku(order: Pick<CartOrder, 'productUrl' | 'sku'>): { sku: string | null; conflict: boolean } {
  const raw = order.sku?.trim() ?? '';
  const fromField = /^(?:SKU\s*)?#?:?\s*(\d{3,7})$/i.exec(raw)?.[1] ?? null;
  let fromLink: string[] = [];
  try { fromLink = /((?:-\d{3,7})+)\.html$/.exec(new URL(order.productUrl ?? '').pathname)?.[1].split('-').filter(Boolean) ?? []; } catch { /* No number from this. */ }
  const conflict = (!!raw && !fromField) || (!!fromField && fromLink.length > 0 && !fromLink.includes(fromField));
  return { sku: fromField ?? (fromLink.length === 1 ? fromLink[0] : null), conflict };
}
export const harborFreightSearch = (sku: string): string => `${HOME}/search?q=${encodeURIComponent(sku)}`;

/**
 * Injected after the search. Waits for the product page it should have gone to, and confirms it's this SKU: the address has the number, and the first
 * SKU a person can see on the page is this one. The page draws itself after loading, so this also watches for a wall.
 */
export async function harborFreightReadProduct(sku: string, waitMs = 10_000): Promise<{ kind: 'ok'; path: string } | { kind: 'not-found'; message: string } | PageStop> {
  const started = Date.now();
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const inAddress = new RegExp(`(?:^|-)${sku}(?:-\\d+)*\\.html$`);
  for (;;) {
    const text = (document.body?.innerText ?? document.body?.textContent ?? '').replace(/\s+/g, ' ');
    if ([...document.querySelectorAll('#px-captcha')].some(shown) || /access to this page has been denied/i.test(document.title) || (text.length < 2000 && /press (&|and) hold|confirm you are a human/i.test(text))) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check' };
    if ([...document.querySelectorAll('input[type="password"]')].some(shown)) return { kind: 'stop', reason: 'login', detail: 'a sign-in page' };
    const first = /SKU\s*#?:?\s*(\d{3,7})(?!\d)/i.exec(text)?.[1];
    if (inAddress.test(location.pathname) && first === sku) return { kind: 'ok', path: location.pathname };
    if (first && first !== sku && location.pathname.endsWith('.html')) return { kind: 'not-found', message: `Searching for SKU ${sku} went to a page for SKU ${first}, so nothing was added.` };
    if (Date.now() - started >= waitMs) return { kind: 'not-found', message: `Searching for SKU ${sku} did not go to one product with that SKU, so nothing was added.` };
    await new Promise(done => setTimeout(done, 250));
  }
}
/**
 * Injected on the cart page. Each quantity control belongs to the one SKU around it, and only the lines asked for are handed back. No SKU, price or name
 * of any other line leaves this function. "Empty" has to hold for a moment, because a page that fills itself in can say so before it has read the cart,
 * and a wrong zero would add the line twice.
 */
export async function harborFreightReadCart(keys: string[], waitMs = 10_000, emptyHoldMs = 2000): Promise<CartLine[] | PageStop> {
  const started = Date.now();
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const isQuantity = (node: Element) => /qty|quantity/i.test(`${node.getAttribute('name') ?? ''} ${node.id} ${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('class') ?? ''} ${node.getAttribute('data-testid') ?? ''}`);
  let emptySince: number | null = null;
  for (;;) {
    const text = (document.body?.innerText ?? document.body?.textContent ?? '').replace(/\s+/g, ' ');
    if ([...document.querySelectorAll('#px-captcha')].some(shown) || /access to this page has been denied/i.test(document.title) || (text.length < 2000 && /press (&|and) hold|confirm you are a human/i.test(text))) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check' };
    if ([...document.querySelectorAll('input[type="password"]')].some(shown)) return { kind: 'stop', reason: 'login', detail: 'a sign-in page' };
    if (location.pathname === '/checkout/cart') {
      const lines = new Map<string, number>();
      const boxes = [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),select')].filter(node => shown(node) && isQuantity(node)) as (HTMLInputElement | HTMLSelectElement)[];
      for (const box of boxes) {
        let around: Element | null = box.parentElement, skus: string[] = [];
        while (around && !skus.length) {
          skus = [...new Set([...(around.textContent ?? '').matchAll(/SKU\s*#?:?\s*(\d{3,7})(?!\d)/gi)].map(match => match[1]))];
          around = around.parentElement;
        }
        if (skus.length !== 1) return { kind: 'stop', reason: 'unexpected', detail: 'a cart line this could not read' };
        const quantity = Number(box.value);
        if (box.value === '' || !Number.isFinite(quantity)) return { kind: 'stop', reason: 'unexpected', detail: 'a cart line with no quantity' };
        lines.set(skus[0], (lines.get(skus[0]) ?? 0) + quantity);
      }
      if (lines.size) {
        const missed = keys.find(key => !lines.has(key) && new RegExp(`SKU\\s*#?:?\\s*${key}(?!\\d)`, 'i').test(text));
        if (missed) return { kind: 'stop', reason: 'unexpected', detail: 'a cart line this could not read' };
        return keys.filter(key => lines.has(key)).map(key => ({ key, quantity: lines.get(key)! }));
      }
      if (/(?:cart|bag) is (?:currently )?empty/i.test(text)) {
        emptySince ??= Date.now();
        if (Date.now() - emptySince >= emptyHoldMs) return [];
      } else emptySince = null;
    }
    if (Date.now() - started >= waitMs) return { kind: 'stop', reason: 'unexpected', detail: 'a cart page this could not read' };
    await new Promise(done => setTimeout(done, 250));
  }
}
/**
 * Injected on the product page. Sets this product's own quantity box and presses its own Add to Cart, once. It refuses, with nothing pressed, on another
 * SKU, a pickup-or-ship choice with nothing selected, a store or ZIP prompt, more than one Add to Cart for the product, or a control that goes anywhere
 * else. A choice that's already selected is left alone and named in `kept`. It presses nothing after the add, so a "view cart" or "checkout" in the
 * confirmation stays untouched. Whether it landed is for the read-back to say.
 */
export async function harborFreightPressAdd(sku: string, quantity: number, waitMs = 10_000, settleMs = 8000): Promise<{ kind: 'sent'; kept?: string } | { kind: 'refused'; message: string; kept?: string } | PageStop> {
  const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const words = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  const visibleText = () => words(document.body?.innerText ?? document.body?.textContent);
  const addLabel = (node: Element) => words((node as HTMLInputElement).value || node.textContent || node.getAttribute('aria-label'));
  const addControls = () => [...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"]')].filter(node => shown(node) && /^add to cart$/i.test(addLabel(node)));
  const prompts = /zip|postal code|(?:choose|select|set|find|change|enter) (?:a |your |my )?(?:store|location)|(?:store|location) (?:is )?required/i;
  const prompt = () => [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog[open]')].find(node => shown(node) && prompts.test(node.textContent ?? ''));
  const refused = (message: string) => ({ kind: 'refused' as const, message });
  const started = Date.now();
  for (;;) {
    const text = visibleText();
    if ([...document.querySelectorAll('#px-captcha')].some(shown) || /access to this page has been denied/i.test(document.title) || (text.length < 2000 && /press (&|and) hold|confirm you are a human/i.test(text))) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check', notSent: true };
    if ([...document.querySelectorAll('input[type="password"]')].some(shown)) return { kind: 'stop', reason: 'login', detail: 'a sign-in page', notSent: true };
    if (prompt()) return refused('Harbor Freight is asking for a store or ZIP code. That\'s your choice, so nothing was added.');
    if (addControls().length) break;
    if (Date.now() - started >= waitMs) return refused('Harbor Freight shows no Add to Cart button for this item.');
    await wait(250);
  }
  const first = /SKU\s*#?:?\s*(\d{3,7})(?!\d)/i.exec(visibleText())?.[1];
  if (first !== sku) return refused(`This page is ${first ? `for SKU ${first}` : 'not clearly a product'}, not SKU ${sku}, so nothing was added.`);
  // The smallest part of the page holding both the title and an Add to Cart. Anything further out, such as a list of other products, doesn't count.
  const adds = addControls();
  let area = document.querySelector('h1')?.parentElement ?? null;
  while (area && !adds.some(node => area!.contains(node))) area = area.parentElement;
  const mine = area ? adds.filter(node => area!.contains(node)) : [];
  if (!area || mine.length !== 1) return refused('The page doesn\'t show one clear Add to Cart for this item, so nothing was added.');
  const scope = area, add = mine[0] as HTMLElement;
  const shownName = (node: Element) => words(`${(node as HTMLInputElement).labels ? [...(node as HTMLInputElement).labels!].map(item => item.textContent).join(' ') : ''} ${node.textContent ?? ''} ${node.getAttribute('aria-label') ?? ''}`);
  const choices = [...scope.querySelectorAll('input[type="radio"],[role="radio"],[role="tab"],[aria-pressed]')].filter(node => /pick\s?-?up|ship|deliver/i.test(`${shownName(node)} ${node.getAttribute('name') ?? ''} ${(node as HTMLInputElement).value ?? ''}`));
  const selected = choices.filter(node => (node as HTMLInputElement).checked === true || ['aria-checked', 'aria-selected', 'aria-pressed'].some(name => node.getAttribute(name) === 'true'));
  if (choices.length && !selected.length) return refused('Harbor Freight needs a pickup or shipping choice for this item, and none is selected. That\'s your choice, so nothing was added.');
  const zipBox = [...scope.querySelectorAll('input')].find(node => shown(node) && !node.value.trim() && /zip|postal/i.test(`${node.name} ${node.id} ${node.placeholder} ${node.getAttribute('aria-label') ?? ''}`));
  if (zipBox) return refused('Harbor Freight is asking for a store or ZIP code. That\'s your choice, so nothing was added.');
  const keptName = [...new Set(selected.map(node => shownName(node) || words((node as HTMLInputElement).value)))].filter(Boolean).join(', ').slice(0, 100);
  const kept = selected.length ? { kept: keptName || 'the one the page had selected' } : {};
  if ((add as HTMLButtonElement).disabled || add.getAttribute('aria-disabled') === 'true') return refused('Harbor Freight shows Add to Cart as unavailable for this item.');
  const address = `${add.getAttribute('href') ?? ''} ${add.getAttribute('formaction') ?? ''} ${add.closest('form')?.getAttribute('action') ?? ''}`;
  if (/check\s?out|\bbuy\b|\bpay\b|place.?order/i.test(address)) return { kind: 'stop', reason: 'unexpected', detail: 'an Add to Cart that goes somewhere else', notSent: true };
  const boxes = [...scope.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),select')].filter(node => shown(node) && /qty|quantity/i.test(`${node.getAttribute('name') ?? ''} ${node.id} ${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('class') ?? ''} ${node.getAttribute('data-testid') ?? ''}`)) as (HTMLInputElement | HTMLSelectElement)[];
  if (boxes.length > 1 || (!boxes.length && quantity !== 1)) return refused('The page doesn\'t show one clear quantity box for this item, so nothing was added.');
  if (boxes.length) {
    const box = boxes[0];
    if (Number(box.value) !== quantity) {
      // The page's own framework watches for input events, so the value goes in the way typing would and the events follow.
      const proto = box.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(box, String(quantity));
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(250);
    }
    if (Number(box.value) !== quantity) return refused(`Harbor Freight's quantity box would not take ${quantity}, so nothing was added.`);
  }
  const added = () => /added to (?:your )?cart/i.test(visibleText());
  const count = () => words([...document.querySelectorAll('a[href*="/checkout/cart"],[aria-label*="cart" i]')].filter(shown).map(node => node.textContent).join(' '));
  const countBefore = count(), addedBefore = added();
  add.click();
  const pressed = Date.now();
  while (Date.now() - pressed < settleMs) {
    await wait(200);
    if (!addedBefore && added()) return { kind: 'sent', ...kept };
    if (prompt()) return { ...refused('Harbor Freight asked for a store or ZIP code after Add to Cart. That\'s your choice, so nothing more was done.'), ...kept };
    if (count() !== countBefore) return { kind: 'sent', ...kept };
  }
  return { kind: 'sent', ...kept };
}

export const harborfreight: StoreMethod = {
  id: 'harborfreight', label: 'Harbor Freight', badge: 'item', badgeHelp: 'Presses Add to Cart on each product page, one line at a time',
  origins: [`${HOME}/*`], hosts: ['www.harborfreight.com', 'harborfreight.com'], startUrl: `${HOME}/`, cartUrl: CART,
  requiredFields: ['quantity'],
  missing(order) {
    const { sku, conflict } = harborFreightSku(order);
    if (conflict) return ['a SKU number that matches its product link'];
    return sku ? [] : ['a SKU number, in the SKU field or the link'];
  },
  steps: {
    foreground: true,
    async resolveLine(order, tab) {
      const { sku, conflict } = harborFreightSku(order);
      if (conflict) throw new LineProblem(`The SKU and the product link don't agree on a Harbor Freight item (SKU ${order.sku}).`);
      if (!sku) throw new LineProblem('Harbor Freight needs a SKU number.');
      await tab.goto(harborFreightSearch(sku));
      const product = stopIf(await tab.run(harborFreightReadProduct, sku));
      if (product.kind === 'not-found') throw new LineProblem(product.message);
      return { key: sku, addAs: `${HOME}${product.path}` };
    },
    async readCart(tab, keys) {
      await tab.goto(CART);
      return stopIf(await tab.run(harborFreightReadCart, keys));
    },
    async addLine(tab, target, quantity) {
      await tab.goto(target.addAs);
      const answer = stopIf(await tab.run(harborFreightPressAdd, target.key, quantity));
      // The runner reads the note after its read-back, so this flags the line only if the add landed.
      if (answer.kept) target.note = `Harbor Freight's selected pickup or shipping choice was kept: ${answer.kept}. Check it in the cart.`;
      if (answer.kind === 'refused') throw new LineProblem(answer.message);
    },
  },
};
