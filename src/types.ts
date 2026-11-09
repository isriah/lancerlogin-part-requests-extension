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
}
export interface Choice { id: string; name: string }
/** The plugin's GET /options answer, cached so the popup opens without waiting on the network. */
export interface DeviceOptions {
  memberName: string;
  teams: Choice[];
  recipients: Choice[];
  defaultRecipientId: string | null;
  recipientsUpdatedMs: number | null;
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
export interface DraftRecord {
  key: string;
  submissionId: string;
  draft: RequestDraft;
  capture: CaptureResult;
  updatedAt: number;
}
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
}
/** What the pages may know about pairing. The device key never appears here. */
export interface SettingsView {
  pairing: 'unpaired' | 'paired' | 'expired';
  origin?: string;
  memberName?: string;
  deviceLabel?: string;
  options?: DeviceOptions;
  defaultTeam: string;
}
export type Message =
  | { type: 'capture'; tabId: number }
  | { type: 'settings' }
  | { type: 'pair'; origin: string; pin: string; deviceLabel: string }
  | { type: 'unpair' }
  | { type: 'refresh-options' }
  | { type: 'save-defaults'; defaultTeam: string; defaultRecipient: string }
  | { type: 'check-repeats'; url: string; sku: string }
  | { type: 'save-draft'; record: DraftRecord }
  | { type: 'discard'; key: string }
  | { type: 'submission'; id: string }
  | { type: 'submit'; key: string; submissionId: string }
  | { type: 'restart'; key: string; acknowledgeUncertain: boolean };
