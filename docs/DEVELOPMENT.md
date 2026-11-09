# Development and acceptance

## Structure

| File | Responsibility |
|---|---|
| `public/manifest.json` | Manifest V3 permissions, popup, options, module worker, CSP |
| `src/vendors.ts` | Fixed allowlist and 20 VendorAdapter registrations |
| `src/reader.ts` | Self-contained function serialized into the clicked page |
| `src/types.ts` | Capture, draft, settings view, message, and submission models |
| `src/pairing.ts` | Site address and PIN normalization, the API address |
| `src/client.ts` | The plugin's device API: transport, one outcome per documented result |
| `src/validate.ts` | Draft checks shown before sending. The plugin checks again. |
| `src/submissions.ts` | Persist-before-POST submission queue |
| `src/background.ts` | Trusted message boundary, the device key, local drafts and receipts, capture, submit and retries |
| `src/popup.ts`, `popup.html` | Review, totals, autosave, repeat warning, pairing prompt, result and recovery UI |
| `src/options.ts`, `options.html` | Pairing, Chrome's permission prompt, unpairing and defaults |
| `scripts/package.mjs` | The zip for students |
| `tests/fixtures/vendors.ts` | Sanitized representative product DOM and expected capture fields |

Vite builds static extension pages and a module service worker into `dist`. The reader has no imports or external variables inside its function body because Chrome serializes that function when injecting it. Keep new helper functions inside `capturePage` or pass plain configuration data.

The service worker is the only component that performs network requests, and the only one that reads the device key. It calls `<site origin>/api/public/part-requests/...`, which is Core's generated Pages proxy in front of the plugin's routes. The contract is in the plugin's README. The manifest's `connect-src https:` can't name a site chosen at run time, so Chrome's per-site host permission is what limits where this can reach.

## Pairing

The Pair click calls `chrome.permissions.request` for `<origin>/*` synchronously, because Chrome only allows it during a user gesture. That is why pairing lives on the Options page: a toolbar popup closes when Chrome's prompt takes focus. The popup only prompts and opens settings.

After a grant, the worker exchanges the PIN for a key with `POST /pair`, and saves the key and the site in `chrome.storage.local`. A refusal only the plugin could give (such as a wrong PIN) keeps the grant. Anything else may be a mistyped address, so the grant is removed.

`401 pair_again` on any call forgets the key, marks the site as expired and keeps the lists and every draft. The same member's device can then pair again and send those drafts.

## Persistence and duplicate-click protection

The draft key is `<source tab ID>:<original URL>`. Editing Product URL changes the request destination field and derived Vendor without moving that draft to another source key. Edits are sent immediately and serialized by the worker; monotonically increasing timestamps prevent older messages replacing newer edits.

A draft has a UUID submission ID. Before any create request, the worker persists a pending submission record. Its queue serializes the check-and-write step. Repeated messages return the recorded result. A restarted worker treats durable pending state as unknown and never replays its POST.

Success persists a receipt keyed by the source tab/URL and removes the form draft. If the worker stops between success persistence and draft cleanup, the saved success state still prevents another create. If saving the receipt fails, the earlier pending record protects against automatic replay. Creation failures preserve edits.

The same submission ID goes to the server, which allows one create per ID whatever happens here. Clearing browser data, reinstalling, opening another tab, or choosing New request creates a new ID, and the plugin's repeat warning is the only thing that notices those.

## What each result does

`client.ts` turns every response into one outcome. `background.ts` acts on it.

| Plugin's answer | Outcome | What happens |
|---|---|---|
| `201`, or `200` replayed | created | Receipt saved, draft cleared. |
| `202 pending` | pending | Asks `GET /requests/<id>` every 2 seconds for up to a minute. Never resends. |
| `202 uncertain` | uncertain | Recorded. Never resent. The student checks Notion, ticks the box and retries with a new ID. |
| `502 failed` | failed | Recorded. Trying again needs a new ID. |
| `409 submission_conflict` | conflict | Treated as uncertain, because a request with that ID exists. New ID after the check. |
| `400`, `429`, `503` needing an Admin, other refusals | refused | Nothing was recorded. The local record is dropped, the draft stays open with the same ID, and the message is shown. |
| `401 pair_again` | refused | As above, and the device goes to pair-again. |
| `503 update_maintenance` | maintenance | Waits `Retry-After` (1 to 120 seconds), then resends the same ID and draft, up to 4 times. Then as refused. |
| Network failure, `500`, unreadable body | no answer | Uncertain, not recorded. Never resent by itself. |

While a send runs, the worker updates the record every 5 seconds, which keeps Chrome from stopping it during a long wait and tells the popup it is still alive. A pending record 30 seconds old with no running send, or an uncertain record with no recorded result, is checked with `GET /requests/<id>`, which only reads. If the site has no record, the student can send again. Because no result was recorded, a retry the student chooses keeps the same ID, so the server still protects against a first request that did land. A retry after a recorded result uses a new ID.

## Tests

```powershell
npm ci --cache .npm-cache
npm run check
```

The suite covers all 20 adapters, selected variants, missing metadata, live DOM changes, packs, sale/range/installment prices, foreign currency, unsafe text, lookalike hosts, edited URLs, every documented API result, maintenance retries, pairing, repeated clicks, worker restart, storage failure, immediate autosave, receipt restoration, and total preview. It also checks what ships: the manifest's permissions, and that no Notion client is left.

API tests use a transport mock. Fixture keys and people IDs are deliberately fake. No unit test contacts a site or a vendor. Mocks cannot catch browser-only failures, which is how an `Illegal invocation` on every request reached the first live run, so run the end-to-end check as well:

```powershell
npm run build
npm run e2e
```

`e2e/extension.e2e.mjs` loads `dist` in a real browser with a simulated plugin API routed at the site's origin, so the service worker's real `fetch`, host permission and CSP are all exercised. It covers pairing, Deny and Allow, capture, draft persistence, rejected pages, twelve real clicks at one spot, pending and uncertain results, request payloads, a revoked device, maintenance retries with the same ID, the repeat warning, layout size, and CSP errors. `E2E_SCREENSHOTS=<folder>` saves screenshots, and `E2E_LIVE_STORES=1` uses real store pages instead of synthetic copies.

On Windows it opens a headed Edge and presses Chrome's real permission prompt through `e2e/press-prompt-button.ps1`, which only looks at that browser's own windows, so don't use the mouse during that part. Set `E2E_PROMPT=stub` or use another platform to simulate the prompt instead, which proves less. Set `E2E_CHANNEL` or `E2E_BROWSER` to choose a browser. Its copy of the manifest lists the test stores as `host_permissions`, because automation cannot click the toolbar, so it does not prove the toolbar permission grant. Http and localhost are never in the production manifest. A test build against a local preview adds them to its own copy. Never place a real credential, personal address, account header, cart, or complete authenticated page dump in fixtures.

## Acceptance on a real site

Use the plugin on a dev site with a test database. Enter credentials only where the plugin's setup asks for them.

1. Run `npm run package`, unzip the result and load that folder in Chrome. Open Options and check layout at normal and narrow window widths. Verify the extension reports no worker or CSP errors.
2. Run `/ordering-pin` in Discord and pair with the address and PIN from the reply. Try Deny, then Allow. Save a team and a person.
3. Use each representative page in the [vendor matrix](VENDORS.md), including a real Ali Express product. Select variants, open the toolbar popup, and compare title, options, SKU, price, currency, and URL with the page. Complete any bot or login prompts yourself.
4. Check unsupported, lookalike, category, cart, and multi-product pages. Confirm no creation is possible. Change the review URL to another supported vendor and verify the derived Vendor.
5. On a product, edit quantity, team, and description. Close and reopen the popup. Verify exact edits persist. Change the product's variant, Discard the draft, and check fresh capture.
6. Create one NORMAL test request and one Incomplete test request. Confirm the exact fields in Notion, formula total, people, status, and working product link. Check that no page template or body content was added.
7. Rapidly click submit and close/reopen the popup while submission is pending. Confirm one page was created. Repeat offline. For an uncertain result, inspect Notion before any retry.
8. Revoke the device on the Admin page with a draft open. Confirm the prompt to pair again, that the draft is kept, and that it sends after pairing again.

Record browser version, date, vendor/URL, expected and observed values, and remaining limitations in the matrix. A vendor's acceptance is complete only after both fixture tests and a representative live toolbar check pass. Do not label Ali Express verified based on its synthetic fixture.
