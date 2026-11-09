// Thrifty Bot runs on Shopify, so the shared Shopify method does the work. Its pack items ("QTY 10 - ...") are one variant sold as a pack: the
// quantity on an order is packs, and is never multiplied by the number in the title. Its "Pre-Order:" items are ordinary products with
// ordinary variants, so they take the same path.
import { createShopifyStore } from './shopify';

export const thrifty = createShopifyStore({
  id: 'thrifty', label: 'Thrifty Bot', home: 'https://www.thethriftybot.com',
  hosts: ['www.thethriftybot.com', 'thethriftybot.com'], origins: ['https://www.thethriftybot.com/*'],
});
