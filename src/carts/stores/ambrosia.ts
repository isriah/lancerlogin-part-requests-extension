import { createShopifyStore } from './shopify';

export const ambrosia = createShopifyStore({ id: 'ambrosia', label: 'Ambrosia Filament', home: 'https://ambrosiafilament.com', hosts: ['ambrosiafilament.com', 'www.ambrosiafilament.com'], origins: ['https://ambrosiafilament.com/*'] });
