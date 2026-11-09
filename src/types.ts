import type { Brand, Theme } from './brand';
import type { MarkInput } from './carts/types';

export type RequestStatus = 'NORMAL Request' | 'Incomplete Request';
export interface AdapterConfig {
  id: string;
  label: string;
  hosts: string[];
  productPath: string;
  profile: 'shopify' | 'amazon' | 'aliexpress' | 'bigcommerce' | 'catalog';
  title: string[];
  price: string[];
  sku: string[];
  variants: string[];
  productMarker?: string[];
}
export interface CaptureResult {
  vendor: string;
  url: string;
  description: string;
  sku: string;
  price: number | null;
  currency: string;
  variants: string[];
  issues: string[];
  kind: 'product' | 'not-product' | 'blocked';
  /** A product page whose own choices don't name one item yet, such as WCP with no part or two parts ticked. */
  needsChoice?: boolean;
}
export interface Choice { id: string; name: string }
/** The plugin's GET /options answer, cached so the popup opens without waiting on the network. */
export interface DeviceOptions {
  memberName: string;
  teams: Choice[];
  recipients: Choice[];
  defaultRecipientId: string | null;
  recipientsUpdatedMs: number | null;
  /** Optional because lists cached by an earlier version, or sent by an earlier plugin, don't have them. */
  minimumExtensionVersion?: string | null;
  updateUrl?: string | null;
  databaseLink?: string | null;
  /** The Admin's Carts switch. False hides Carts. Absent from an earlier plugin. */
  cartsEnabled?: boolean;
}
/** A recent request for the same product, as the plugin reports it. */
export interface Repeat { memberName: string; createdMs: number; pageUrl: string | null; state: string }
export interface RequestDraft {
  description: string;
  status: RequestStatus;
  url: string;
  sku: string;
  team: string;
  recipient: string;
  quantity: number | null;
  price: number | null;
  currencyConfirmed: boolean;
}
/** Why Express addition did not send a page. `repeats` lets the popup name who asked and link to it. */
export interface ExpressReason { code: 'price' | 'variant' | 'currency' | 'description' | 'defaults' | 'repeat' | 'issue' | 'already-sent' | 'check-failed' | 'send-failed'; text: string; repeats?: Repeat[] }
/**
 * What Express addition has done with a draft. `fallback`: it stopped, for these reasons, and may look again if nobody edits the draft.
 * `attempted` or `manual`: a send was started, or a student chose the form, so it never sends this draft by itself again.
 */
export interface ExpressMark { state: 'fallback' | 'attempted' | 'manual'; reasons: ExpressReason[] }
export interface DraftRecord {
  key: string;
  submissionId: string;
  draft: RequestDraft;
  capture: CaptureResult;
  updatedAt: number;
  /** A student changed a field. Express addition never sends a draft someone has edited. */
  edited?: boolean;
  express?: ExpressMark;
}
/** What was sent, kept with the submission because the draft is gone once it succeeds. Names, not IDs: this is only for showing. */
export interface SubmissionFacts { description: string; store: string; quantity: number | null; price: number | null; team: string; recipient: string }
export interface Submission {
  id: string;
  draftKey: string;
  state: 'pending' | 'success' | 'failed' | 'uncertain';
  updatedAt: number;
  message?: string;
  pageUrl?: string;
  repeats?: Repeat[];
  /** The server stated this result, so its ID is used up and trying again needs a new one. Otherwise resending the same ID is safe. */
  recorded?: boolean;
  /** Sent by Express addition rather than a click on Create request. */
  express?: boolean;
  facts?: SubmissionFacts;
}
/** What the pages may know about pairing. The device key never appears here. */
export interface SettingsView {
  pairing: 'unpaired' | 'paired' | 'expired';
  origin?: string;
  memberName?: string;
  deviceLabel?: string;
  options?: DeviceOptions;
  defaultTeam: string;
  /** The team's last good colors and name. Absent means LancerLogin's defaults. */
  brand?: Brand;
  /** Optional so older callers and tests read as dark. */
  theme?: Theme;
  expressEnabled?: boolean;
  /** This device's Carts switch, off until someone turns it on. */
  cartsEnabled?: boolean;
}
/** What Unpair answers. `revokedOnSite` is true only when the site confirmed it, so the page knows what to say. */
export interface UnpairView extends SettingsView { revokedOnSite: boolean }
export type Message =
  /** `auto` is true only when the toolbar opened the popup. Only then may Express addition send. */
  | { type: 'capture'; tabId: number; auto?: boolean }
  | { type: 'settings' }
  | { type: 'pair'; origin: string; pin: string; deviceLabel: string }
  | { type: 'unpair' }
  | { type: 'refresh-options' }
  | { type: 'set-theme'; theme: Theme }
  | { type: 'set-express'; enabled: boolean }
  | { type: 'set-carts'; enabled: boolean }
  | { type: 'carts-orders'; refresh?: boolean }
  | { type: 'carts-marks'; marks: MarkInput[] }
  | { type: 'save-defaults'; defaultTeam: string; defaultRecipient: string }
  | { type: 'check-repeats'; url: string; sku: string }
  | { type: 'save-draft'; record: DraftRecord }
  | { type: 'discard'; key: string }
  | { type: 'submission'; id: string }
  | { type: 'submit'; key: string; submissionId: string }
  | { type: 'restart'; key: string; acknowledgeUncertain: boolean };
