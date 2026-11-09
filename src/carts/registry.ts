// The coordinator's file. Adding a store is one import and one entry in STORES. A store nobody has built yet falls back to a checklist.
import { VENDORS, vendorForUrl } from '../vendors';
import { aliexpress } from './stores/aliexpress';
import { amazon } from './stores/amazon';
import { ambrosia } from './stores/ambrosia';
import { andymark } from './stores/andymark';
import { bambu } from './stores/bambu';
import { checklistStore } from './stores/checklist';
import { ctre } from './stores/ctre';
import { ferrules } from './stores/ferrules';
import { harborfreight } from './stores/harborfreight';
import { homedepot } from './stores/homedepot';
import { mcmaster } from './stores/mcmaster';
import { onlinemetals } from './stores/onlinemetals';
import { pololu } from './stores/pololu';
import { powerwerx } from './stores/powerwerx';
import { rev } from './stores/rev';
import { sds } from './stores/sds';
import { swyft } from './stores/swyft';
import { thrifty } from './stores/thrifty';
import { vbelts } from './stores/vbelts';
import { wcp } from './stores/wcp';
import { west3d } from './stores/west3d';
import type { StoreMethod } from './store-method';
import type { CartOrder } from './types';

export const STORES: StoreMethod[] = [
  aliexpress, amazon, ambrosia, andymark, bambu, ctre, ferrules, harborfreight, homedepot,
  mcmaster, onlinemetals, pololu, powerwerx, rev, sds, swyft, thrifty, vbelts, wcp, west3d,
];

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
