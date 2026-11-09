import { createShopifyStore } from './shopify';

// ferrulesdirect.com redirects to www. Every product sampled has one variant, and a spool or length is its own product with its own SKU.
export const ferrules = createShopifyStore({
  id: 'ferrules', label: 'FerrulesDirect', home: 'https://www.ferrulesdirect.com',
  hosts: ['ferrulesdirect.com', 'www.ferrulesdirect.com'], origins: ['https://www.ferrulesdirect.com/*'],
});
