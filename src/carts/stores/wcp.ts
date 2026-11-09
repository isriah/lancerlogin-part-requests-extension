import { createShopifyStore } from './shopify';

export const wcp = createShopifyStore({ id: 'wcp', label: 'WCP', home: 'https://wcproducts.com', hosts: ['wcproducts.com', 'www.wcproducts.com'], origins: ['https://wcproducts.com/*'] });
