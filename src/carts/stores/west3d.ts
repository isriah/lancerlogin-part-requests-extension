// West3D is a Shopify store, so lines are added with the shared /cart/add.js method. Its kits also carry a YMQ "Product Options" app: dropdowns drawn
// by the page (ymq-dropdown) whose choices add extra options and charges that a plain variant add would miss. A line for such a product would be
// a different kit than the one asked for, so it is refused as a LineProblem for the person to handle. A plain item (a pack of screws, a part) is added as usual.
import { LineProblem, stopIf, type PageStop, type StoreMethod } from '../store-method';
import { createShopifyStore, shopifyLink } from './shopify';

const HOME = 'https://west3d.com';
const base = createShopifyStore({ id: 'west3d', label: 'West3D', home: HOME, hosts: ['west3d.com', 'www.west3d.com'], origins: [`${HOME}/*`] });

export type OptionsAnswer = { kind: 'plain' } | { kind: 'custom'; names: string[] } | { kind: 'unreadable' };
/**
 * Injected on a product page. The YMQ app draws its option boxes into a <ymq-option> element after the page loads, and removes that element when the
 * product has no custom options, so wait up to waitMs using what the page shows. Boxes that only mirror the product's own variants
 * (ymq-shopify-option-box) are the native variant picker, not custom. "Plain" needs positive evidence: a product page, the app's style tag
 * (it ran), and no options element. An element still empty at the deadline, or a page that isn't a product page, is unreadable and never plain.
 */
export async function west3dCustomOptions(waitMs: number): Promise<OptionsAnswer | PageStop> {
  const host = (): Element | null => document.querySelector('ymq-option');
  const drawn = (): boolean => host()?.querySelector('.ymq-options-box, .ymq-dropdown, select, input') != null;
  const product = (): boolean => document.querySelector('meta[property="og:type"]')?.getAttribute('content') === 'product' && document.querySelector('form[action*="/cart/add"]') !== null;
  const appRan = (): boolean => document.querySelector('#ymq-option-app-style') !== null;
  const removed = (): boolean => host() === null && product() && appRan();
  const pause = (ms: number) => new Promise(done => setTimeout(done, ms));
  const until = Date.now() + waitMs;
  while (Date.now() < until && !drawn() && !removed()) await pause(250);
  await pause(400); // Let the rest of the boxes finish drawing, or confirm the element stays gone.
  if (drawn()) {
    const names = [...host()!.querySelectorAll('.ymq-options-box')]
      .filter(box => !box.classList.contains('ymq-shopify-option-box'))
      .map(box => (box.querySelector('.ymq-option-title-right-name, .ymq-option-title')?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60) || 'an option');
    const loose = host()!.querySelector('.ymq-dropdown:not(.ymq-shopify-option-box *)') !== null;
    if (names.length || loose) return { kind: 'custom', names: names.length ? names : ['an option'] };
    return { kind: 'plain' }; // Only the native variant picker was drawn.
  }
  return removed() ? { kind: 'plain' } : { kind: 'unreadable' };
}

/** How long a product page gets to draw its options. A plain product draws none, so it always waits this long. */
export const optionsWait = { ms: 4500 };

export const west3d: StoreMethod = {
  ...base,
  badgeHelp: 'Adds to the store\'s cart directly, one line at a time. Kits with custom options are left for the person',
  steps: {
    ...base.steps!,
    async resolveLine(order, tab) {
      const target = await base.steps!.resolveLine(order, tab);
      const link = shopifyLink(order.productUrl);
      if (!link) throw new LineProblem('This needs a product link on West3D\'s site.');
      await tab.goto(`${HOME}/products/${encodeURIComponent(link.handle)}`);
      const answer = stopIf(await tab.run(west3dCustomOptions, optionsWait.ms));
      if (answer.kind === 'custom') throw new LineProblem(`This West3D item has custom options (${answer.names.slice(0, 3).join(', ')}) that the request doesn't say how to choose, so it wasn't added. Choose them on the product page.`);
      if (answer.kind === 'unreadable') throw new LineProblem('The product page wasn\'t in the shape expected, so its custom options couldn\'t be checked. Add it from the product page.');
      return target;
    },
  },
};
