import { createShopifyStore } from './shopify';

// CTRE sells some WCP- SKUs and "(8-Pack)" items. The vendor comes from the request, never the SKU prefix, and the quantity is packs as listed, never converted.
export const ctre = createShopifyStore({ id: 'ctre', label: 'CTRE', home: 'https://store.ctr-electronics.com', hosts: ['store.ctr-electronics.com', 'www.store.ctr-electronics.com'], origins: ['https://store.ctr-electronics.com/*'] });
