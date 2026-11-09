import { vendorForUrl } from './vendors';
import type { DeviceOptions, RequestDraft } from './types';

const LARGEST_NUMBER = 1_000_000_000;
/** The same rules as the plugin, so a student sees problems before sending. The server still decides. */
export function validateDraft(draft: RequestDraft, options: DeviceOptions | undefined): string[] {
  const errors: string[] = [];
  if (!draft || typeof draft !== 'object') return ['The request is missing.'];
  const vendor = typeof draft.url === 'string' && vendorForUrl(draft.url);
  if (!vendor) errors.push('Use a product URL from one of the 20 supported stores.');
  if (typeof draft.description !== 'string' || !draft.description.trim()) errors.push('Enter an item description.');
  if (!['NORMAL Request', 'Incomplete Request'].includes(draft.status)) errors.push('Choose NORMAL Request or Incomplete Request.');
  for (const [label, value] of [['Description', draft.description], ['SKU', draft.sku], ['URL', draft.url]] as const) {
    if (typeof value !== 'string' || value.length > 2000) errors.push(`${label} must be text of at most 2,000 characters.`);
  }
  const full = draft.status === 'NORMAL Request';
  if (full && !draft.team) errors.push('Choose a team.');
  if (draft.team && options && !options.teams.some(t => t.id === draft.team)) errors.push('The selected team is no longer available. Choose again.');
  if (full && !draft.recipient) errors.push('Choose an orderer/recipient.');
  if (draft.recipient && options && !options.recipients.some(p => p.id === draft.recipient)) errors.push('Choose a person from the list.');
  if (full && draft.quantity === null) errors.push('Enter a quantity.');
  if (draft.quantity !== null && (typeof draft.quantity !== 'number' || !Number.isFinite(draft.quantity) || draft.quantity <= 0 || draft.quantity > LARGEST_NUMBER)) errors.push('Quantity must be greater than zero.');
  if (full && draft.price === null) errors.push('Enter a unit price in USD.');
  if (draft.price !== null && (typeof draft.price !== 'number' || !Number.isFinite(draft.price) || draft.price < 0 || draft.price > LARGEST_NUMBER)) errors.push('Unit price must be zero or greater.');
  if (draft.price !== null && draft.currencyConfirmed !== true) errors.push('Confirm that the unit price you entered is in USD.');
  return errors;
}
