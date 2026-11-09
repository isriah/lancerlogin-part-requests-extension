import type { StoreMethod } from '../store-method';

/** Any store with no method yet, known or not. Nothing is automated, and it needs no access: the person gets links and quantities. */
export function checklistStore(label: string, hosts: string[] = [], cartUrl: string | null = null): StoreMethod {
  return {
    id: `checklist:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, label, badge: 'checklist', badgeHelp: 'Shows a list for you to add yourself',
    origins: [], hosts, cartUrl, requiredFields: ['productUrl', 'quantity'],
  };
}
