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
export interface Person { id: string; name: string }
export interface Choice { id: string; name: string }
export interface PropertyMapping { id: string; type: string; options?: Choice[] }
export type Field = 'description' | 'status' | 'vendor' | 'team' | 'recipient' | 'sku' | 'url' | 'quantity' | 'price' | 'total';
export interface Schema {
  dataSourceId: string;
  databaseId: string;
  properties: Record<Field, PropertyMapping>;
}
export interface Configuration {
  databaseUrl: string;
  schema: Schema;
  people: Person[];
  defaultTeam: string;
  defaultRecipient: string;
}
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
}
export type Message =
  | { type: 'capture'; tabId: number }
  | { type: 'settings' }
  | { type: 'connect'; token: string; databaseUrl: string; dataSourceId?: string }
  | { type: 'save-settings'; defaultTeam: string; defaultRecipient: string }
  | { type: 'refresh-people' }
  | { type: 'import-people'; pageUrl: string }
  | { type: 'disconnect' }
  | { type: 'save-draft'; record: DraftRecord }
  | { type: 'discard'; key: string }
  | { type: 'submission'; id: string }
  | { type: 'submit'; key: string; submissionId: string }
  | { type: 'restart'; key: string; acknowledgeUncertain: boolean };
