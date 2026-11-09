import { VENDORS, vendorForUrl } from './vendors';
import type { Configuration, Field, Person, PropertyMapping, RequestDraft, Schema } from './types';

export const NOTION_VERSION = '2026-03-11';
export class AppError extends Error {
  constructor(message: string, public code = 'validation', public uncertain = false, public details?: unknown) { super(message); }
}
type Json = Record<string, any>;
const FIELDS: Record<Field, { name: string; types: string[] }> = {
  description: { name: 'Item Description', types: ['title'] },
  status: { name: 'Status', types: ['status', 'select'] },
  vendor: { name: 'Vendor', types: ['select'] },
  team: { name: 'Team', types: ['select', 'multi_select'] },
  recipient: { name: 'Orderer/Recipient', types: ['people'] },
  sku: { name: 'SKU', types: ['rich_text'] },
  url: { name: 'Product URL', types: ['url'] },
  quantity: { name: 'Qty', types: ['number'] },
  price: { name: 'Unit Price', types: ['number'] },
  total: { name: 'Extension', types: ['formula', 'rollup'] },
};
export function notionId(input: string): string {
  let path = input.trim();
  if (/^https?:/i.test(path)) {
    let u: URL;
    try { u = new URL(path); } catch { throw new AppError('Enter a valid Notion URL or ID.'); }
    if (u.protocol !== 'https:' || u.username || u.password || !['notion.so', 'notion.com', 'notion.site'].some(h => u.hostname === h || u.hostname.endsWith(`.${h}`))) throw new AppError('Use a Notion page or database URL.');
    path = u.pathname; // Deliberately ignore ?v=, which identifies a view.
  }
  const match = path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})(?:\/)?$/i)?.[1];
  if (!match) throw new AppError('The URL must contain a Notion page or database ID. Copy its full link from Notion.');
  const h = match.replaceAll('-', '');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function mapSchema(source: Json, databaseId: string, previous?: Schema): Schema {
  const properties = {} as Record<Field, PropertyMapping>;
  for (const [field, expected] of Object.entries(FIELDS) as [Field, typeof FIELDS[Field]][]) {
    const values = Object.values(source.properties || {}) as Json[];
    const old = previous?.properties[field];
    const prop = (old && values.find(p => p.id === old.id)) || source.properties?.[expected.name];
    if (!prop || !expected.types.includes(prop.type)) throw new AppError(`Notion property "${expected.name}" must exist with type ${expected.types.join(' or ')}. Check the source database; no properties were changed.`, 'schema');
    const options = prop[prop.type]?.options?.map((o: Json) => ({ id: o.id, name: o.name }));
    properties[field] = { id: prop.id, type: prop.type, ...(options ? { options } : {}) };
  }
  for (const status of ['NORMAL Request', 'Incomplete Request']) if (!properties.status.options?.some(o => o.name === status)) throw new AppError(`Add or restore the existing "${status}" status in Notion before connecting.`, 'schema');
  const missing = VENDORS.filter(v => !properties.vendor.options?.some(o => o.name === v.label));
  if (missing.length) throw new AppError(`Vendor options missing from Notion: ${missing.map(v => v.label).join(', ')}. Select the team's ordering database with all 20 vendor options.`, 'schema');
  if (!properties.team.options?.length) throw new AppError('The Team property needs at least one existing option.', 'schema');
  return { dataSourceId: source.id, databaseId, properties };
}
export function validateDraft(draft: RequestDraft, config: Configuration): string[] {
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
  if (draft.team && !config.schema.properties.team.options?.some(t => t.id === draft.team)) errors.push('The selected team is no longer available. Refresh settings.');
  if (full && !draft.recipient) errors.push('Choose an orderer/recipient.');
  if (draft.recipient && !config.people.some(p => p.id === draft.recipient)) errors.push('Choose a saved Notion person, or add them in settings.');
  if (full && draft.quantity === null) errors.push('Enter a quantity.');
  if (draft.quantity !== null && (typeof draft.quantity !== 'number' || !Number.isFinite(draft.quantity) || draft.quantity <= 0)) errors.push('Quantity must be greater than zero.');
  if (full && draft.price === null) errors.push('Enter a unit price in USD.');
  if (draft.price !== null && (typeof draft.price !== 'number' || !Number.isFinite(draft.price) || draft.price < 0)) errors.push('Unit price must be zero or greater.');
  if (draft.price !== null && draft.currencyConfirmed !== true) errors.push('Confirm that the unit price you entered is in USD.');
  return errors;
}
export function pagePayload(draft: RequestDraft, config: Configuration): Json {
  const errors = validateDraft(draft, config);
  if (errors.length) throw new AppError(errors.join(' '));
  const p = config.schema.properties;
  const rich = (value: string) => [{ type: 'text', text: { content: value.trim() } }];
  const choice = (prop: PropertyMapping, id: string) => ({ [prop.type]: prop.type === 'multi_select' ? [{ id }] : { id } });
  const vendor = vendorForUrl(draft.url)!;
  const vendorOption = p.vendor.options?.find(o => o.name === vendor.label);
  const status = p.status.options?.find(o => o.name === draft.status);
  if (!vendorOption || !status) throw new AppError('Notion options changed. Refresh the connection in settings.', 'schema');
  const properties: Json = {
    [p.description.id]: { title: rich(draft.description) },
    [p.status.id]: choice(p.status, status.id),
    [p.vendor.id]: choice(p.vendor, vendorOption.id),
    [p.url.id]: { url: draft.url.trim() },
  };
  if (draft.team) properties[p.team.id] = choice(p.team, draft.team);
  if (draft.recipient) properties[p.recipient.id] = { people: [{ object: 'user', id: draft.recipient }] };
  if (draft.sku.trim()) properties[p.sku.id] = { rich_text: rich(draft.sku) };
  if (draft.quantity !== null) properties[p.quantity.id] = { number: draft.quantity };
  if (draft.price !== null) properties[p.price.id] = { number: draft.price };
  return { parent: { type: 'data_source_id', data_source_id: config.schema.dataSourceId }, properties };
}
export class NotionClient {
  // The wrapper matters: Chrome throws "Illegal invocation" if native fetch is called as a method of this class.
  constructor(private token: string, private transport: typeof fetch = (input, init) => fetch(input, init)) {}
  async request(path: string, method = 'GET', body?: unknown): Promise<Json> {
    if (!/^\/(?:databases|data_sources|pages|users)(?:\/|\?|$)/.test(path)) throw new AppError('Unsupported Notion operation.');
    let response: Response;
    try {
      response = await this.transport(`https://api.notion.com/v1${path}`, {
        method, headers: { Authorization: `Bearer ${this.token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      console.warn('Notion request failed before a response:', error instanceof Error ? error.name : 'unknown error');
      throw new AppError('Could not confirm the Notion response. Check your connection.', 'network', method === 'POST' && path === '/pages');
    }
    if (!response.ok) {
      const status = response.status;
      const message = status === 401 ? 'The Notion token is invalid or expired. Replace it in settings.'
        : status === 403 ? 'The connection lacks permission. Ask the coach to check content and user capabilities.'
        : status === 404 ? 'Notion cannot access that database or page. Share the source database with the connection and check its URL.'
        : status === 429 ? `Notion is rate limiting requests. Wait ${response.headers.get('Retry-After') || 'a few'} seconds before trying again.`
        : status === 400 ? 'Notion rejected the request. Check required fields and refresh the database schema in settings.'
        : status === 409 ? 'Notion reported a conflict. Check the database before trying again.'
        : 'Notion did not confirm the operation. Check the database before trying again.';
      throw new AppError(message, `notion_${status}`, method === 'POST' && path === '/pages' && (status >= 500 || status === 409));
    }
    try { return await response.json(); } catch { throw new AppError('Notion returned an unreadable response.', 'response', method === 'POST' && path === '/pages'); }
  }
  async connect(databaseUrl: string, dataSourceId?: string, previous?: Schema): Promise<Schema> {
    const id = notionId(databaseUrl);
    const db = await this.request(`/databases/${id}`);
    const sources: { id: string; name: string }[] = db.data_sources || [];
    if (!sources.length) throw new AppError('No data source was found. Use the original database link, not a page containing a linked view.', 'schema');
    const selected = dataSourceId ? sources.find(s => s.id === dataSourceId) : sources.length === 1 ? sources[0] : undefined;
    if (!selected) throw new AppError('This database has multiple data sources. Select the ordering data source.', 'data_source', false, sources);
    const source = await this.request(`/data_sources/${selected.id}`);
    return mapSchema(source, id, previous?.dataSourceId === source.id ? previous : undefined);
  }
  async members(): Promise<Person[]> {
    const people: Person[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request(`/users?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
      for (const u of page.results || []) if (u.type === 'person') people.push({ id: u.id, name: u.name || 'Unnamed Notion user' });
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
    return people;
  }
  /** Everyone named as a recipient on existing requests. Notion's user list leaves out guests; this finds them. */
  async recipientsFromRequests(schema: Schema, maxPages = 20): Promise<{ people: Person[]; requests: number }> {
    const recipientId = schema.properties.recipient.id;
    const decoded = (id: unknown) => { try { return decodeURIComponent(String(id)); } catch { return String(id); } };
    const found = new Map<string, string>();
    let cursor: string | undefined;
    let requests = 0;
    for (let page = 0; page < maxPages; page++) {
      const result = await this.request(`/data_sources/${schema.dataSourceId}/query`, 'POST', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      for (const row of result.results || []) {
        requests++;
        const prop = (Object.values(row.properties || {}) as Json[]).find(p => decoded(p.id) === decoded(recipientId));
        for (const user of prop?.people || []) if (user.id && user.type !== 'bot' && !found.get(user.id)) found.set(user.id, user.name || '');
      }
      cursor = result.has_more ? result.next_cursor : undefined;
      if (!cursor) break;
    }
    const people: Person[] = [];
    for (const [id, name] of found) {
      // One at a time: an unresolved name costs a request, and Notion rate limits bursts.
      if (name) { people.push({ id, name }); continue; }
      try { people.push({ id, name: (await this.request(`/users/${id}`)).name || 'Unnamed Notion user' }); }
      catch { people.push({ id, name: 'Unnamed Notion user' }); }
    }
    return { people, requests };
  }
  async peopleFromPage(pageUrl: string, schema: Schema): Promise<Person[]> {
    const page = await this.request(`/pages/${notionId(pageUrl)}`);
    if (page.parent?.data_source_id !== schema.dataSourceId && page.parent?.database_id !== schema.databaseId) throw new AppError('Use a request from the configured ordering database.');
    const prop = (Object.values(page.properties || {}) as Json[]).find(p => p.id === schema.properties.recipient.id);
    if (!prop || prop.type !== 'people') throw new AppError('The request does not have the expected Orderer/Recipient property.');
    let users: Json[] = prop.people || [];
    if (prop.has_more || users.length >= 25) {
      users = []; let cursor: string | undefined;
      do {
        const r = await this.request(`/pages/${page.id}/properties/${encodeURIComponent(prop.id)}${cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : ''}`);
        users.push(...(r.results || []).map((x: Json) => x.people).filter(Boolean));
        cursor = r.has_more ? r.next_cursor : undefined;
      } while (cursor);
    }
    if (!users.length) throw new AppError('Set Orderer/Recipient on this request in Notion first, then try again.');
    return Promise.all(users.map(async u => {
      const detail = u.name ? u : await this.request(`/users/${u.id}`);
      return { id: u.id, name: detail.name || 'Unnamed Notion user' };
    }));
  }
  async create(draft: RequestDraft, config: Configuration): Promise<string> {
    const page = await this.request('/pages', 'POST', pagePayload(draft, config));
    try {
      const u = new URL(page.url);
      if (u.protocol === 'https:' && ['notion.so', 'notion.com'].some(h => u.hostname === h || u.hostname.endsWith(`.${h}`))) return u.href;
    } catch { /* Never display an arbitrary link from an unexpected response. */ }
    throw new AppError('Notion accepted the request, but did not return a valid page link. Check the database.', 'response', true);
  }
}
