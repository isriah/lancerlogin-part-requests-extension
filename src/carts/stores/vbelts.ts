import { createShopifyStore } from './shopify';

export const vbelts = createShopifyStore({ id: 'vbelts', label: 'V-Belt Guys', home: 'https://www.vbeltguys.com', hosts: ['www.vbeltguys.com', 'vbeltguys.com'], origins: ['https://www.vbeltguys.com/*'] });
