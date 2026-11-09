// Home Depot: the product page's own quantity box and Add to Cart, then the /cart page's rows read back. The selectors were seen in a signed-in browser,
// one add of one item. Everything else is unproven, so anything unexpected stops the store or fails the line with nothing added. A fresh automated
// browser gets a 403 "Oops" page, so the first real run through this code is the owner's. docs/CARTS.md says what to check.
// Owner decision 2026-11-09: a pickup or delivery choice that's already selected is kept, and flags the line by name. None selected, or a store or ZIP prompt,
// fails the line. This never chooses for the person.
import { allowedInTab } from '../safety';
import { LineProblem, stopIf, type CartLine, type PageStop, type StoreMethod } from '../store-method';
import type { CartOrder } from '../types';

const HOME = 'https://www.homedepot.com';
const HOSTS = ['homedepot.com', 'www.homedepot.com', 'm.homedepot.com', 'mobile.homedepot.com'];

/** The item number from a product link: /p/<name>/<number> or /p/<number>. Reviews, questions and category pages have none. */
export function homedepotItem(productUrl: string | null | undefined): string | null {
  if (!productUrl || !allowedInTab({ hosts: HOSTS }, productUrl)) return null;
  return /^\/p\/(?:[^/]+\/)?(\d+)\/?$/.exec(new URL(productUrl).pathname)?.[1] ?? null;
}

/**
 * Injected on /cart, whose rows load after the page does. Waits until the rows have stopped changing and agree with the cart badge, because a row that
 * hasn't loaded yet would read as "not in the cart" and a retry would add it twice. Rows under "Saved For Later" are on the same page and don't count.
 * Only the lines asked for leave this function.
 */
export async function homedepotReadCart(keys: string[], waitMs = 20_000, settleMs = 1500): Promise<CartLine[] | PageStop> {
  const started = Date.now();
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const words = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  let last = '', since = Date.now();
  for (;;) {
    const text = words(document.body?.innerText ?? document.body?.textContent);
    if (/^error page\b/i.test(document.title) || (text.length < 2000 && /oops!* something went wrong/i.test(text))) return { kind: 'stop', reason: 'bot-check', detail: 'an access block' };
    if ([...document.querySelectorAll('#px-captcha,#challenge-form')].some(shown) || /access denied|are you a (robot|human)|verify you are (a )?human/i.test(document.title)) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check' };
    if ([...document.querySelectorAll('input[type="password"]')].some(shown)) return { kind: 'stop', reason: 'login', detail: 'a sign-in page' };
    if (location.pathname.replace(/\/$/, '') !== '/cart') return { kind: 'stop', reason: 'unexpected', detail: 'a page that isn\'t the cart' };
    const found = [...document.querySelectorAll('[data-component^="cart-item:CartItem"]')].filter(shown);
    const rows = found.filter(row => !found.some(other => other !== row && other.contains(row)));
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],div,span,p')].find(node => shown(node) && !rows.some(row => row.contains(node)) && /^saved for later(?:\s*\(\d+\))?$/i.test(words(node.textContent)));
    const lines = new Map<string, number>();
    let problem = '', active = 0, total = 0;
    for (const row of rows) {
      const rowText = words(row.textContent);
      const below = !!heading && !!(heading.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING);
      const movable = /move to cart/i.test(rowText);
      // Below the heading but offering to be saved, so one of the two signs is wrong. Which row counts can't be told.
      if (below && !movable && /save for later/i.test(rowText)) { problem = 'a cart line this could not place'; break; }
      if (below || movable) continue;
      const items = new Set([...row.querySelectorAll('a[href]')].map(link => /\/p\/(?:[^/?#]+\/)?(\d+)(?:[/?#]|$)/.exec(link.getAttribute('href') ?? '')?.[1]).filter(Boolean) as string[]);
      if (items.size !== 1) { problem = 'a cart line this could not read'; break; }
      const boxes = ([...row.querySelectorAll('input.sui-input-base-input')] as HTMLInputElement[]).filter(shown);
      if (boxes.length !== 1 || !/^\d+$/.test(boxes[0].value.trim()) || Number(boxes[0].value) < 1) { problem = 'a cart line with no quantity'; break; }
      const quantity = Number(boxes[0].value), item = [...items][0];
      lines.set(item, (lines.get(item) ?? 0) + quantity);
      active++; total += quantity;
    }
    const badgeText = words(document.querySelector('[data-testid="header-cart-count"]')?.textContent);
    const badge = /^\d+$/.test(badgeText) ? Number(badgeText) : null;
    let complete = false;
    if (!problem) {
      if (active) complete = badge === null || active >= badge || total === badge;
      else complete = badge === 0 || (badge === null && /(?:cart|bag) is (?:currently )?empty|empty cart/i.test(text));
    }
    const state = JSON.stringify([rows.length, !!heading, [...lines], badge]);
    if (state !== last) { last = state; since = Date.now(); }
    if (complete && Date.now() - since >= settleMs) return keys.filter(key => lines.has(key)).map(key => ({ key, quantity: lines.get(key)! }));
    if (Date.now() - started >= waitMs) return { kind: 'stop', reason: 'unexpected', detail: problem || 'a cart page this could not read' };
    await new Promise(done => setTimeout(done, 250));
  }
}

/**
 * Injected on the product page. Sets the quantity box beside the page's own Add to Cart and presses that button, once. The "Added to Cart" panel offers
 * more Add to Cart buttons under "Don't Forget These", and nothing here presses anything after the add. Option pills can say "Please Select" while one is
 * selected, so they aren't read: the button has to be enabled, and the read-back decides what happened.
 */
export async function homedepotPressAdd(item: string, quantity: number, waitMs = 15_000, settleMs = 8000): Promise<{ kind: 'sent'; kept?: string } | { kind: 'refused'; message: string; kept?: string } | PageStop> {
  const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
  const shown = (node: Element) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const words = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  const visibleText = () => words(document.body?.innerText ?? document.body?.textContent);
  const prompts = /zip|postal code|(?:choose|select|set|find|change|enter) (?:a |your |my )?(?:store|location)|(?:store|location) (?:is )?required/i;
  const prompt = () => [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog[open]')].find(node => shown(node) && prompts.test(node.textContent ?? ''));
  const refused = (message: string) => ({ kind: 'refused' as const, message });
  const askedForStore = 'Home Depot is asking for a store or ZIP code. That\'s your choice, so nothing was added.';
  const textBoxes = (block: Element) => ([...block.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')] as HTMLInputElement[]).filter(shown);
  // Only the button in a block that also has its quantity box is the page's own. A recommendation further down has neither that box nor this block.
  const addButtons = () => {
    const blocks = [...document.querySelectorAll('[data-component^="add-to-cart"]')].filter(shown);
    return [...new Set(blocks.flatMap(block => [...block.querySelectorAll('button')]))].filter(button => shown(button) && words(button.textContent) === 'Add to Cart');
  };
  const started = Date.now();
  for (;;) {
    const text = visibleText();
    if (/^error page\b/i.test(document.title) || (text.length < 2000 && /oops!* something went wrong/i.test(text))) return { kind: 'stop', reason: 'bot-check', detail: 'an access block', notSent: true };
    if ([...document.querySelectorAll('#px-captcha,#challenge-form')].some(shown) || /access denied|are you a (robot|human)|verify you are (a )?human/i.test(document.title)) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check', notSent: true };
    if ([...document.querySelectorAll('input[type="password"]')].some(shown)) return { kind: 'stop', reason: 'login', detail: 'a sign-in page', notSent: true };
    if (prompt()) return refused(askedForStore);
    if (addButtons().length) break;
    if (Date.now() - started >= waitMs) return refused('Home Depot shows no Add to Cart button for this item.');
    await wait(250);
  }
  if (!new RegExp(`/${item}/?$`).test(location.pathname)) return refused(`This page is not item ${item}, so nothing was added.`);
  const buttons = addButtons();
  if (buttons.length !== 1) return refused('The page doesn\'t show one clear Add to Cart for this item, so nothing was added.');
  const block = buttons[0].closest('[data-component^="add-to-cart"]')!;
  const emptyZip = textBoxes(block).find(node => !node.value.trim() && /zip|postal/i.test(`${node.name} ${node.id} ${node.placeholder} ${node.getAttribute('aria-label') ?? ''}`));
  if (emptyZip) return refused(askedForStore);
  // The page's two tiles. A tile with no sign of being selected isn't assumed to be, and neither one means the choice is still the person's to make.
  const isSelected = (tile: Element) => [tile, ...tile.querySelectorAll('*')].some(node => (node as HTMLInputElement).checked === true || ['aria-checked', 'aria-selected', 'aria-pressed', 'aria-current', 'data-selected'].some(name => node.getAttribute(name) === 'true'));
  const tilesNamed = (name: string) => [...document.querySelectorAll(`[data-testid*="${name}" i],[id*="${name}" i],[data-component*="${name}" i],[class*="${name}" i]`)].filter(shown);
  const choices = [['Delivery', tilesNamed('deliveryTile')], ['Pickup', tilesNamed('pickupTile')]] as const;
  const selected = choices.filter(([, tiles]) => tiles.some(isSelected)).map(([name]) => name);
  if (selected.length !== 1) return refused(selected.length ? 'Home Depot shows more than one pickup or delivery choice as selected, so nothing was added.' : 'Home Depot shows no pickup or delivery choice selected for this item. That\'s your choice, so nothing was added.');
  const kept = { kept: selected[0] };
  const unusable = (button: HTMLButtonElement) => button.disabled || button.getAttribute('aria-disabled') === 'true';
  if (unusable(buttons[0])) return refused('Home Depot shows Add to Cart as unavailable for this item, or a choice on the page still needs making. Nothing was added.');
  const boxes = textBoxes(block);
  if (boxes.length > 1 || (!boxes.length && quantity !== 1)) return refused('The page doesn\'t show one clear quantity box for this item, so nothing was added.');
  if (boxes.length && Number(boxes[0].value) !== quantity) {
    // The page's own framework watches for input events, so the value goes in the way typing would and the events follow.
    const box = boxes[0];
    box.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, String(quantity));
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
    box.blur();
    await wait(500);
    const again = textBoxes(block);
    if (again.length !== 1 || Number(again[0].value) !== quantity) return refused(`Home Depot's quantity box would not take ${quantity}, so nothing was added.`);
  }
  // The box may redraw the block, so look for the button again rather than pressing one that's gone.
  const ready = addButtons();
  if (ready.length !== 1 || unusable(ready[0])) return refused('Home Depot\'s Add to Cart changed after the quantity was set, so nothing was added.');
  const address = `${ready[0].getAttribute('formaction') ?? ''} ${ready[0].closest('form')?.getAttribute('action') ?? ''} ${ready[0].closest('a')?.getAttribute('href') ?? ''}`;
  if (/check\s?out|\bbuy\b|\bpay\b|place.?order/i.test(address)) return { kind: 'stop', reason: 'unexpected', detail: 'an Add to Cart that goes somewhere else', notSent: true };
  const count = () => words(document.querySelector('[data-testid="header-cart-count"]')?.textContent);
  const added = () => /added to cart/i.test(visibleText());
  const countBefore = count(), addedBefore = added();
  ready[0].click();
  const pressed = Date.now();
  while (Date.now() - pressed < settleMs) {
    await wait(200);
    if (prompt()) return { ...refused('Home Depot asked for a store or ZIP code after Add to Cart. That\'s your choice, so nothing more was done.'), ...kept };
    if ((!addedBefore && added()) || count() !== countBefore) break;
  }
  return { kind: 'sent', ...kept };
}

export const homedepot: StoreMethod = {
  id: 'homedepot', label: 'Home Depot', badge: 'item', badgeHelp: 'Presses Add to Cart on each product page, one line at a time. A pickup or delivery choice already selected is kept and flagged',
  origins: [`${HOME}/*`], hosts: HOSTS, startUrl: `${HOME}/cart`, cartUrl: `${HOME}/cart`,
  requiredFields: ['productUrl', 'quantity'],
  // A blank link is already reported from requiredFields. A link to anything but one product would leave the person guessing which item was meant.
  missing: (order: CartOrder) => !order.productUrl || homedepotItem(order.productUrl) ? [] : ['a product link on homedepot.com'],
  steps: {
    // Real clicks on a page that draws itself, seen working only in a tab that's showing.
    foreground: true,
    async resolveLine(order) {
      const item = homedepotItem(order.productUrl);
      if (!item) throw new LineProblem('This needs a link to one product on homedepot.com.');
      return { key: item, addAs: `${HOME}${new URL(order.productUrl!).pathname}` };
    },
    async readCart(tab, keys) {
      await tab.goto(`${HOME}/cart`);
      return stopIf(await tab.run(homedepotReadCart, keys));
    },
    async addLine(tab, target, quantity) {
      await tab.goto(target.addAs);
      const answer = stopIf(await tab.run(homedepotPressAdd, target.key, quantity));
      // The runner reads the note after its read-back, so this flags the line only if the add landed.
      if (answer.kept) target.note = `Home Depot's selected choice was kept: ${answer.kept}. Check it in the cart.`;
      if (answer.kind === 'refused') throw new LineProblem(answer.message);
    },
  },
};
