# Development and acceptance

## Structure

| File | Responsibility |
|---|---|
| `public/manifest.json` | Manifest V3 permissions, popup, options, module worker, CSP |
| `src/vendors.ts` | Fixed allowlist and 20 VendorAdapter registrations |
| `src/reader.ts` | Self-contained function serialized into the clicked page |
| `src/types.ts` | Capture, draft, schema, configuration, message, and submission models |
| `src/notion.ts` | API transport, schema validation, guest lookup, payload validation |
| `src/submissions.ts` | Persist-before-POST submission queue |
| `src/background.ts` | Trusted message boundary, local configuration/drafts/receipts, capture and submit |
| `src/popup.ts`, `popup.html` | Review, totals, autosave, result and recovery UI |
| `src/options.ts`, `options.html` | Connection, schema, defaults, and guest settings |
| `tests/fixtures/vendors.ts` | Sanitized representative product DOM and expected capture fields |

Vite builds static extension pages and a module service worker into `dist`. The reader has no imports or external variables inside its function body because Chrome serializes that function when injecting it. Keep new helper functions inside `capturePage` or pass plain configuration data.

The service worker is the only component that performs network requests. It resolves the supplied database ID with `/v1/databases/{id}`, retrieves `/v1/data_sources/{id}`, and saves property and option IDs. Creation uses `POST /v1/pages`, `parent.data_source_id`, and table properties only. No page content, comments, files, or page template is sent. There are no duplicate-order checks or update/delete calls. The only query reads the Orderer/Recipient property of existing requests during setup, because Notion's user list excludes guests. It is capped at 2,000 requests, and a failure there does not block connecting.

## Persistence and duplicate-click protection

The draft key is `<source tab ID>:<original URL>`. Editing Product URL changes the request destination field and derived Vendor without moving that draft to another source key. Edits are sent immediately and serialized by the worker; monotonically increasing timestamps prevent older messages replacing newer edits.

A draft has a UUID submission ID. Before any create request, the worker persists a pending submission record. Its queue serializes the check-and-write step. Repeated messages return the recorded result. A restarted worker treats durable pending state as unknown and never replays its POST.

Success persists a receipt keyed by the source tab/URL and removes the form draft. If the worker stops between success persistence and draft cleanup, the saved success state still prevents another create. If saving the receipt fails, the earlier pending record protects against automatic replay. Creation failures preserve edits.

This is local duplicate-click prevention, with explicit recovery for uncertain network results. Clearing browser data, reinstalling, opening another tab, or choosing New request creates a new local request context. There is no server-side idempotency promise or search of existing orders.

## Tests

```powershell
npm ci --cache .npm-cache
npm run check
```

The suite covers all 20 adapters, selected variants, missing metadata, live DOM changes, packs, sale/range/installment prices, foreign currency, unsafe text, lookalike hosts, edited URLs, schema changes, guest import, Notion error classes, repeated clicks, worker restart, storage failure, immediate autosave, receipt restoration, and total preview.

API tests use a transport mock. Fixture tokens and people IDs are deliberately fake. No unit test contacts Notion or a vendor. Mocks cannot catch browser-only failures, which is how an `Illegal invocation` on every Notion request reached the first live run, so run the end-to-end check as well:

```powershell
npm run build
npm run e2e
```

`e2e/extension.e2e.mjs` loads `dist` in a real browser with a simulated Notion API and live product pages. It covers setup, capture, draft persistence, rejected pages, rapid clicks, pending and uncertain results, request payloads, and CSP errors. Its copy of the manifest replaces `activeTab` with host access because automation cannot click the toolbar, so it does not prove the toolbar permission grant. Set `E2E_CHANNEL=msedge` on machines that block unsigned browser builds. Never place a real credential, personal address, account header, cart, or complete authenticated page dump in fixtures.

The 2026-09-21 Chrome checks executed the reader against currently rendered public product DOM for 19 vendors. Ali Express was blocked by the browser's site policy. These checks did not install the extension or exercise Chrome's toolbar-to-worker permission boundary. Installed-extension acceptance remains required.

## Pilot acceptance

Use the coach's test database with the matching schema. Enter credentials only in the installed extension's Options page.

1. Load `dist` unpacked in Chrome. Open Options and check layout at normal and narrow window widths. Verify the extension reports no worker or CSP errors.
2. Connect the test database, verify the actual property types and IDs, and save a real team and recipient. Also exercise guest import if the pilot user is a guest.
3. Use each representative page in the [vendor matrix](VENDORS.md), including a real Ali Express product. Select variants, open the toolbar popup, and compare title, options, SKU, price, currency, and URL with the page. Complete any bot or login prompts yourself.
4. Check unsupported, lookalike, category, cart, and multi-product pages. Confirm no creation is possible. Change the review URL to another supported vendor and verify the derived Vendor.
5. On a product, edit quantity, team, and description. Close and reopen the popup. Verify exact edits persist. Change the product's variant, Discard the draft, and check fresh capture.
6. Create one NORMAL test request and one Incomplete test request. Confirm the exact mapped fields, formula total, people, status, and working product link. Check that no page template or body content was added.
7. In the test database only, rapidly click submit and close/reopen the popup while submission is pending. Confirm one page was created. Repeat with a stopped worker or offline connection. For an uncertain result, inspect Notion before any retry.
8. Restore the production database in Options and reselect defaults. With the coach, create one genuine needed part request and confirm it appears in the coach's expected Part Requests workflow.

Record browser version, date, vendor/URL, expected and observed values, and remaining limitations in the matrix. A vendor's acceptance is complete only after both fixture tests and a representative live toolbar check pass. Do not label Ali Express verified based on its synthetic fixture.

Authenticated acceptance and the genuine pilot are intentionally unrun until a coach supplies and configures the test connection/database. Development created no live Notion records.
