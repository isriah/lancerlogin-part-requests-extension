# Robotics Part Requests

A personal, unpacked Chrome extension that turns the product you are viewing into a reviewed Notion part request. It supports the 20 fixed vendors in the team's ordering form. It creates requests; the coach still handles purchasing and receiving.

The implementation includes a review popup, settings, guest-recipient lookup, vendor readers, persistent drafts, and submission recovery. It uses Manifest V3, TypeScript, Vite, vanilla HTML/CSS, and Vitest. No server or AI service is required.

## Install

1. Open `chrome://extensions` in Chrome 120 or newer.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this project's **dist** folder.
4. Pin **Robotics Part Requests** from Chrome's extensions menu.
5. Open its **Options** page and follow the [coach setup guide](docs/SETUP.md).

The supplied `dist` folder is ready to load. It contains no credentials. Keep it in place while the extension is installed. After rebuilding, click **Reload** on the extension's card in Chrome.

## Use

Open one supported product and choose its options first. Click the extension, review the captured values, choose your team and recipient, and create the request. NORMAL requests require a description, supported URL, team, recipient, quantity, and USD unit price. SKU is optional. Incomplete requests can omit everything except the description and supported URL.

Quantity is the number of units or packs sold at the displayed unit price. For a pack of 50 screws priced at $21.40, quantity 1 means one pack. The preview excludes shipping and tax; Notion computes its own Extension field.

Edits are saved locally per tab and original URL. Reopening the popup restores them. **Discard** removes edits and recaptures the current page. Success clears the draft and retains a receipt with **Open in Notion** and **New request** actions. A new browser tab is a separate draft.

If a request times out, it may already exist in Notion. The extension will not resend it automatically. Check the database before acknowledging a retry. It does not search for duplicate orders.

## Verification status

- Automated regression suite: **137 tests pass**, including all 20 adapter fixtures, Notion mocks, worker persistence, and popup interactions.
- Browser end-to-end run (`npm run e2e`): **48 checks pass** against the built extension with a simulated Notion API and live product pages. It cannot prove Chrome's toolbar-click permission grant.
- Live product-reader checks on 2026-11-08: see the [vendor matrix](docs/VENDORS.md).
- Authenticated connection and schema validation passed on 2026-11-08 against the test database. NORMAL (REV) and Incomplete (McMaster) requests created through the toolbar in that database matched their product pages on 2026-11-08. Rapid clicks on real Notion created no duplicate; each extra request needed a deliberate New request click. One genuine pilot request remains pending.

The complete [vendor support matrix](docs/VENDORS.md) records representative URLs, observed values, limitations, and maintenance guidance. Treat this as a pilot build until the [acceptance checklist](docs/DEVELOPMENT.md#pilot-acceptance) is completed.

## Develop

Use Node.js 22.12+ or 24 LTS and npm. From the project directory:

```powershell
npm ci --cache .npm-cache
npm test
npm run build
```

`npm run check` runs tests and the production build. `npm run e2e` drives the built extension in a real browser; set `E2E_CHANNEL=msedge` where unsigned browser builds are blocked. `npm run dev` serves the layouts locally, but Chrome extension APIs are available only after loading `dist` as an extension. The regular web preview reports that setup requirement.

See [setup and troubleshooting](docs/SETUP.md), [architecture and acceptance](docs/DEVELOPMENT.md), and [vendor maintenance](docs/VENDORS.md).

V1 excludes unsupported stores, the Other vendor option, team distribution, Chrome Web Store publication, OAuth, RUSH/SLOW requests, bulk capture, actual purchases, and subsequent order management.
