import { validateDraft } from './validate';
import { vendorForUrl } from './vendors';
import type { CaptureResult, DeviceOptions, ExpressReason, Repeat, RequestDraft } from './types';

const OPTIONAL = /^SKU was not confirmed/;
const COVERED = /^Unit price needs your review|^Price is in |^Currency could not be confirmed|^Confirm the unit price in USD/;
const OPTION_ISSUE = /^Select all product options/;
const VARIANT_ISSUE = /^(Select a stock length|Confirm the selected printer|Custom kit options|Select exactly one part)/;
export const VARIANT_REASON = 'Options aren\'t selected on the store page. Select them and reopen this, or enter the variant and price here.';

/**
 * Why Express addition must not send this page by itself, leaving out only the checks that need the network. An empty answer means
 * everything was read from the page. Anything unknown stops the send: the student gets the form, which is always the safe side.
 */
export function pageReasons(capture: CaptureResult, draft: RequestDraft, options: DeviceOptions | undefined): ExpressReason[] {
  const reasons: ExpressReason[] = [];
  const variant = capture.issues.filter(i => OPTION_ISSUE.test(i) || VARIANT_ISSUE.test(i));
  if (!capture.description.trim() || !draft.description.trim()) reasons.push({ code: 'description', text: 'No description was found on this page. Enter one.' });
  if (capture.kind !== 'product' || !vendorForUrl(draft.url)) reasons.push({ code: 'issue', text: 'This isn\'t one product from a supported store.' });
  for (const issue of variant) reasons.push({ code: 'variant', text: OPTION_ISSUE.test(issue) ? VARIANT_REASON : issue });
  // An unselected option blanks the price on purpose, so that reason already covers a missing price.
  if (!variant.length && !(typeof capture.price === 'number' && capture.price > 0)) reasons.push({ code: 'price', text: 'No price was found on this page. Enter the USD price.' });
  if (capture.currency !== 'USD' && (capture.currency || capture.price !== null)) {
    const shown = capture.price === null ? '' : ` ${capture.price.toFixed(2)}`;
    reasons.push({ code: 'currency', text: capture.currency ? `The page shows ${capture.currency}${shown}, not USD. Enter the USD price and confirm it.` : 'The currency on this page could not be confirmed. Enter the USD price and confirm it.' });
  }
  for (const issue of capture.issues) if (!OPTIONAL.test(issue) && !COVERED.test(issue) && !variant.includes(issue)) reasons.push({ code: 'issue', text: issue });
  const knownTeam = !!draft.team && !!options?.teams.some(t => t.id === draft.team);
  const knownPerson = !!draft.recipient && !!options?.recipients.some(p => p.id === draft.recipient);
  if (!knownTeam || !knownPerson) reasons.push({ code: 'defaults', text: draft.team && draft.recipient ? 'Your default team or Notion name is no longer on the list. Choose again here, or in Settings.' : 'No default team or Notion name is saved. Choose them here, or in Settings.' });
  if (draft.status !== 'NORMAL Request' || draft.quantity !== 1) reasons.push({ code: 'issue', text: 'Express addition only sends a NORMAL request for quantity 1.' });
  // The same rules a form send has to pass, in case they ever say more than the checks above.
  if (!reasons.length) for (const error of validateDraft(draft, options)) reasons.push({ code: 'issue', text: error });
  return reasons;
}
export const repeatReason = (repeats: Repeat[]): ExpressReason => ({ code: 'repeat', text: 'This was requested recently. You can still send yours.', repeats });
export const CHECK_FAILED: ExpressReason = { code: 'check-failed', text: 'The check for recent requests could not run, so this wasn\'t sent. Look it over and send it here.' };
export const ALREADY_SENT: ExpressReason = { code: 'already-sent', text: 'This page was already sent from this browser. Open Notion to check, or send it again here.' };
