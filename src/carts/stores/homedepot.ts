// Home Depot is a checklist on purpose. There is no published add address or cart API, and a fresh browser gets a 403 from the cart page, so an add
// could never be read back. It has no steps and no store access, and the person gets links and quantities. Home Depot's pages can ask for a store or a
// delivery choice, which is the person's to make. To do more, a signed-in browser would have to show a cart page that loads in the extension's tab with
// each line's item number and quantity readable, and an add that takes a quantity and never picks a store or delivery option for the person.
import { allowedInTab } from '../safety';
import type { StoreMethod } from '../store-method';
import type { CartOrder } from '../types';
import { checklistStore } from './checklist';

const HOME = 'https://www.homedepot.com';
const HOSTS = ['homedepot.com', 'www.homedepot.com', 'm.homedepot.com', 'mobile.homedepot.com'];

/** The item number from a product link: /p/<name>/<number> or /p/<number>. Reviews, questions and category pages have none. */
export function homedepotItem(productUrl: string | null | undefined): string | null {
  if (!productUrl || !allowedInTab({ hosts: HOSTS }, productUrl)) return null;
  return /^\/p\/(?:[^/]+\/)?(\d+)\/?$/.exec(new URL(productUrl).pathname)?.[1] ?? null;
}

export const homedepot: StoreMethod = {
  ...checklistStore('Home Depot', HOSTS, `${HOME}/cart`),
  id: 'homedepot',
  badgeHelp: 'A list for you to add yourself, because nothing is automated here. Home Depot may ask you to choose a store or delivery.',
  // A blank link is already reported from requiredFields. A link to anything but one product would leave the person guessing which item was meant.
  missing: (order: CartOrder) => !order.productUrl || homedepotItem(order.productUrl) ? [] : ['a product link on homedepot.com'],
};
