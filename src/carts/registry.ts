// The coordinator's file. Adding a store is one import and one entry in STORES. A store nobody has built yet falls back to a checklist.
import { VENDORS, vendorForUrl } from '../vendors';
import { checklistStore } from './stores/checklist';
import { mcmaster } from './stores/mcmaster';
import { pololu } from './stores/pololu';
import { rev } from './stores/rev';
import { wcp } from './stores/wcp';
import type { StoreMethod } from './store-method';
import type { CartOrder } from './types';

export const STORES: StoreMethod[] = [mcmaster, pololu, rev, wcp];

export const OTHER_STORE = 'Other store';
const fold = (name: string) => name.trim().toLowerCase();
export function storeNamed(name: string | null | undefined): StoreMethod {
  if (!name?.trim()) return checklistStore(OTHER_STORE);
  const built = STORES.find(s => fold(s.label) === fold(name));
  if (built) return built;
  const vendor = VENDORS.find(v => fold(v.label) === fold(name));
  return checklistStore(vendor?.label ?? name.trim(), vendor?.hosts ?? []);
}
const linkVendor = (order: CartOrder): string | undefined => order.productUrl ? vendorForUrl(order.productUrl)?.label : undefined;
/** Which store's group an order belongs in. The link wins, because that's what an add would act on. selection.ts blocks a disagreement. */
export const storeForOrder = (order: CartOrder): StoreMethod => storeNamed(order.urlVendor ?? linkVendor(order) ?? order.vendor);
/** Everything Chrome is asked for when Carts is turned on, and everything taken back when it's turned off. */
export const allStoreOrigins = (): string[] => STORES.flatMap(s => s.origins);
