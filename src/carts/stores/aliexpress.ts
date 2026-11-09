// Ali Express is a checklist for now: nothing here touches the store, and it asks Chrome for no access. The owner chose automatic adds, but nothing
// that would make them safe could be confirmed. A fresh browser got a robot check on the cart, no add was ever tried, so how cart lines read back is
// unknown, and a guessed read-back could double a retry. An order also has no saved options to compare with the listing's. docs/CARTS.md has the rules.
import { isOnStore } from '../safety';
import type { StoreMethod } from '../store-method';
import type { CartOrder } from '../types';

const HOSTS = ['aliexpress.com', 'www.aliexpress.com', 'm.aliexpress.com', 'mobile.aliexpress.com', 'aliexpress.us', 'www.aliexpress.us', 'm.aliexpress.us'];

/** A link to one listing. Anything else, such as a search or a shop page, can't say which item was meant. */
export const isAliexpressListing = (raw: string): boolean => isOnStore({ hosts: HOSTS }, raw) && /^\/item\/\d+\.html$/.test(new URL(raw).pathname);

export const aliexpress: StoreMethod = {
  id: 'aliexpress', label: 'Ali Express', badge: 'checklist', badgeHelp: 'A list for you to add yourself. Check each listing\'s length, pack size and currency against the request',
  origins: [], hosts: HOSTS, cartUrl: 'https://www.aliexpress.us/p/shoppingcart/index.html', requiredFields: ['productUrl', 'quantity'],
  missing: (order: CartOrder) => order.productUrl && !isAliexpressListing(order.productUrl) ? ['a link to one Ali Express listing'] : [],
};
