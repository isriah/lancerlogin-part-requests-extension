// What the plugin's GET /orders and POST /orders/marks say, after client.ts has checked it. See the plugin's README, "Carts".
export type StatusGroup = 'NORMAL' | 'RUSH' | 'SLOW' | 'INCOMPLETE';
export interface CartMark { memberName: string; deviceLabel: string; quantity: number; markedMs: number; expiresMs: number; ownDevice: boolean }
export interface CartOrder {
  id: string;
  url: string | null;
  description: string | null;
  vendor: string | null;
  urlVendor: string | null;
  sku: string | null;
  productUrl: string | null;
  quantity: number | null;
  unitPrice: number | null;
  status: string;
  statusGroup: StatusGroup;
  teams: string[];
  requesters: string[];
  cartMarks: CartMark[];
}
export interface OrdersList {
  orders: CartOrder[];
  fetchedMs: number | null;
  stale: boolean;
  refreshing: boolean;
  refreshError: string | null;
  truncated: boolean;
  skippedRows: number;
}
/** One answer of GET /orders. Everything the README's table lists lands in exactly one of these. */
export type OrdersOutcome =
  | ({ kind: 'orders' } & OrdersList)
  /** 202: nothing to show yet, which does not mean there are no orders. */
  | { kind: 'refreshing'; retryAfterSeconds: number }
  | { kind: 'disabled'; message: string }
  /** 429, 502 and 503 from Notion's rate limit: try again after the wait. */
  | { kind: 'wait'; code: string; message: string; retryAfterSeconds: number }
  /** An Admin has to act. */
  | { kind: 'admin'; code: string; message: string }
  | { kind: 'error'; code: string; message: string };
export interface MarkInput { orderId: string; quantity: number }
export type MarksOutcome =
  | { kind: 'marked'; marked: number }
  | { kind: 'disabled'; message: string }
  /** 429, and Core's 503 during an update. Nothing was recorded, so the same marks can be sent again. */
  | { kind: 'wait'; code: string; message: string; retryAfterSeconds: number }
  | { kind: 'error'; code: string; message: string };
