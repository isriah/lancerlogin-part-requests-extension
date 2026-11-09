// BambuLab is unsupported in Carts (owner decision, 2026-11-09): its orders are a checklist, so Carts never opens, scripts or asks for access to its site.
// The toolbar's request capture is separate, in src/vendors.ts and src/reader.ts, and still handles its product pages.
import { checklistStore } from './checklist';

export const bambu = checklistStore('BambuLab', ['us.store.bambulab.com', 'www.us.store.bambulab.com'], 'https://us.store.bambulab.com/cart');
