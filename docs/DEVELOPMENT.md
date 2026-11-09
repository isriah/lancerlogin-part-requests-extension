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
| `src/version.ts` | Numeric version comparison for the update notice |
| `src/validate.ts` | Draft checks shown before sending. The plugin checks again. |
| `src/brand.ts` | Validates the site's colors and name, and works out readable tokens with tested contrast math |
| `src/appearance.ts`, `public/appearance-boot.js` | Applies the theme and team tokens. The boot file reads a synchronous copy before the page paints. |
| `src/express.ts` | What stops an Express send, leaving out the checks that need the network |
| `src/styles.css`, `src/fonts.css` | Dashboard tokens and components, from the approved mockup, and the bundled fonts |
| `src/submissions.ts` | Persist-before-POST submission queue |
| `src/background.ts` | Trusted message boundary, the device key, local drafts and receipts, capture, submit and retries |
| `src/popup.ts`, `popup.html` | Review, totals, autosave, repeat warning, pairing prompt, result and recovery UI |
| `src/options.ts`, `options.html` | Pairing, Chrome's permission prompt, unpairing and defaults |
| `src/carts/`, `carts.html` | The Carts page, the store interface and the stores. See [Carts](CARTS.md) |
| `scripts/package.mjs` | The zip for students |
| `tests/fixtures/vendors.ts` | Sanitized representative product DOM and expected capture fields |

Vite builds static extension pages and a module service worker into `dist`. The reader has no imports or external variables inside its function body because Chrome serializes that function when injecting it. Keep new helper functions inside `capturePage` or pass plain configuration data.

The service worker is the only component that performs network requests, and the only one that reads the device key. It calls `<site origin>/api/public/part-requests/...`, which is Core's generated Pages proxy in front of the plugin's routes. The contract is in the plugin's README. The manifest's `connect-src https:` can't name a site chosen at run time, so Chrome's per-site host permission is what limits where this can reach.

## Pairing

The Pair click calls `chrome.permissions.request` for `<origin>/*` synchronously, because Chrome only allows it during a user gesture. That is why pairing lives on the Options page: a toolbar popup closes when Chrome's prompt takes focus. The popup only prompts and opens settings.

After a grant, the worker exchanges the PIN for a key with `POST /pair`, and saves the key and the site in `chrome.storage.local`. A refusal only the plugin could give (such as a wrong PIN) keeps the grant. Anything else may be a mistyped address, so the grant is removed.

`401 pair_again` on any call forgets the key, marks the site as expired and keeps the lists and every draft. The same member's device can then pair again and send those drafts.

Unpair calls `POST /devices/self/revoke` first, with a 10-second limit and no retry, then forgets the key, the site and Chrome's permission whatever the answer was. Only a `200 { revoked: true }` counts as removed from the site. Every other answer, and no answer, gets the wording that an Admin may need to remove the device.

## What comes with the lists

`GET /options` also brings three values, which are saved with the lists.

- **`minimumExtensionVersion` and `updateUrl`:** Options and the popup show a notice with the link when the manifest's version is below the minimum, comparing number by number. It never blocks anything. In the popup it gives way to any message that needs acting on now, so the form still fits, and Options always shows it. A value that isn't a version shows no notice, and a link that isn't `https` is dropped, leaving the notice without one.
- **`databaseLink`:** after an uncertain result, the popup offers **Check ordering database**. The worker and the popup both pass it through `safePageUrl`, the same check as created page links, so only `https` links on `notion.so` and `notion.com` are ever opened.

`/options` answers `503` while the plugin's Notion connection is down. The extension keeps using what it saved.

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

## Styling

`src/styles.css` carries the dashboard's tokens and component rules, through the owner-approved mockup, without Carts. Keep to the tokens. Two things are easy to trip over:

- **Chrome's extension stylesheet** sets `body` to a system font at 75%. `html.app body` overrides it, and an end-to-end check guards it.
- **The CSP refuses inline scripts,** so the flash protection is a separate file, included once in `<head>` and once right after the name in the header. `applyAppearance` writes its `localStorage` copy from what the worker reports.

`brandTokens` gives `--on-primary`, `--on-secondary`, `--accent-text`, `--primary-edge` and `--ui-focus`, meeting 4.5:1 for text and 3:1 for edges and focus. The stylesheet's unpaired defaults are that calculation's output for #B80100 and #EEB822, and a test checks they match. Status pills use the fixed `--ui-*` tones and never team colors.

Exception to the dashboard's UI standard, recorded at review: popup labels are .8125rem rather than 1rem, because Chrome caps a toolbar popup at 600 tall. Controls stay 44px.

## Express addition

When the toolbar opens the popup, it sends `capture` with `auto: true`. Anything done inside the popup uses `auto: false`, which can't send. `captureTab` in the worker runs one at a time per tab, so rapid reopening shares one draft and one submission ID. It stops at a receipt or an existing submission. Otherwise, with the switch on and a paired device, it reads the page, refreshes the lists, works out the reasons and asks `/check`.

- **Any reason:** the draft is marked `fallback` with its reasons, and the form lists them. Reopening looks again, with the same ID, until a student edits the draft. That's how "select the option and reopen" works.
- **No reasons:** the draft is marked `attempted` before anything is sent, then `startExpressSend` goes through the same `SubmissionManager`, `sendOnce` and submission ID as a click. If the worker stops at any point, the mark means the student gets the form or the saved result, never a second send.
- **Results:** success writes the usual receipt. Uncertain and no answer use the usual read-only reconcile, and retrying needs the usual confirmation, which marks the draft `manual`. A recorded refusal mints a new ID and returns to the form with the error. A refusal with nothing recorded keeps the ID and returns to the form. Neither sends again by itself.
- **Marks that stop it for good:** an edit, `attempted`, or `manual`. A click on Create request, Discard, New request and Review and retry all mark `manual`.

`/check` covers the whole team for 7 days. "Already sent" also scans this browser's receipts and unsettled submissions for the same URL from any tab, with no time limit, and only sends the student to the form.

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

`e2e/extension.e2e.mjs` loads `dist` in a real browser with a simulated plugin API routed at the site's origin, so the service worker's real `fetch`, host permission and CSP are all exercised. It also covers Express addition (off by default, every fallback reason, one send despite closing and rapid reopening, uncertain and no answer never resent), team colors (valid, malformed, failed fetch keeps the last good, Unpair clears), both themes, layout sizes in each state, CSP errors and no remote font requests. Set `E2E_SCREENSHOTS` to a folder to save `built-v2-*.png` there for comparing with the mockup. It covers pairing, Deny and Allow, capture, draft persistence, rejected pages, twelve real clicks at one spot, pending and uncertain results, request payloads, a revoked device, Unpair online, offline and with an expired key, the update notice, the ordering database link, maintenance retries with the same ID, the repeat warning, layout size, and CSP errors. `E2E_SCREENSHOTS=<folder>` saves screenshots, and `E2E_LIVE_STORES=1` uses real store pages instead of synthetic copies.

On Windows it opens a headed Edge and presses Chrome's real permission prompt through `e2e/press-prompt-button.ps1`, which only looks at that browser's own windows, so don't use the mouse during that part. Set `E2E_PROMPT=stub` or use another platform to simulate the prompt instead, which proves less. Set `E2E_CHANNEL` or `E2E_BROWSER` to choose a browser. Its copy of the manifest lists the test stores as `host_permissions`, because automation cannot click the toolbar, so it does not prove the toolbar permission grant. Http and localhost are never in the production manifest. A test build against a local preview adds them to its own copy. Never place a real credential, personal address, account header, cart, or complete authenticated page dump in fixtures.

### Carts

`npm run e2e:carts` needs a build. It loads `dist` in the same way, with the simulated plugin and synthetic copies of the four stores routed at their real addresses. It presses Chrome's real prompt for the Carts switch, covers every `/orders` answer, the selection rules, Incomplete flags, retries, read-back mismatch, short stock, walls, marks only for confirmed lines and the disabled switches, and asserts that no request reaches a checkout address and none leaves for another site. `E2E_SCREENSHOTS=<folder>` saves `built-carts-*.png`. Playwright doesn't intercept a redirect's target, so synthetic stores answer in place instead of redirecting.

`npm run live:carts` adds real items to throwaway profiles. See [Carts](CARTS.md#testing-a-store) before running it. `LIVE_ONLY=rev-pololu,wcp,mcmaster` chooses which.

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
9. Click **Unpair this device**. Confirm the Admin page shows it as revoked and the member has one more free slot. Repeat offline and confirm the wording says an Admin may need to remove it.

Record browser version, date, vendor/URL, expected and observed values, and remaining limitations in the matrix. A vendor's acceptance is complete only after both fixture tests and a representative live toolbar check pass. Do not label Ali Express verified based on its synthetic fixture.
