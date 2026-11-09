# Robotics Part Requests

A Chrome extension that turns the product you are viewing into a reviewed part request in your team's Notion ordering database. It supports the 20 fixed vendors in the team's ordering form. It sends through your team's LancerLogin site, using the [Part Requests plugin](https://github.com/isriah/lancerlogin-part-requests), which holds the Notion connection. The extension holds no Notion token and never contacts Notion. It creates requests; the coach still handles purchasing and receiving.

Students never sign in to LancerLogin. They pair the extension once, with a PIN from Discord.

It uses Manifest V3, TypeScript, Vite, vanilla HTML/CSS and Vitest.

**Students:** follow the [student guide](docs/STUDENT-GUIDE.md).

## Install

1. Open `chrome://extensions` in Chrome 120 or newer.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select the unzipped folder, or this project's **dist** folder after a build.
4. Pin **Robotics Part Requests** from Chrome's extensions menu.
5. Open its **Options** page and pair it. See [setup and troubleshooting](docs/SETUP.md).

Keep the folder in place while the extension is installed. After rebuilding, click **Reload** on the extension's card in Chrome.

## Use

Open one supported product and choose its options first. Click the extension, review the captured values, choose your team and recipient, and create the request. NORMAL requests require a description, supported URL, team, recipient, quantity, and USD unit price. SKU is optional. Incomplete requests can omit everything except the description and supported URL.

Quantity is the number of units or packs sold at the displayed unit price. For a pack of 50 screws priced at $21.40, quantity 1 means one pack. The preview excludes shipping and tax; Notion computes its own Extension field.

Edits are saved locally per tab and original URL. Reopening the popup restores them. **Discard** removes edits and recaptures the current page. Success clears the draft and retains a receipt with **Open in Notion** and **New request** actions. A new browser tab is a separate draft.

If someone asked for the same product in the last 7 days, the popup says who and when. It is only a warning, and you can still send.

During a LancerLogin update, the extension waits and tries again by itself with the same request ID, a limited number of times, and the site allows one create per ID. If the result is ever unknown, it may already exist in Notion, so the extension will not resend it on its own. Check the database before choosing to try again.

## Verification status

- Unit tests (`npm test`): 214 pass, including all 20 adapter fixtures, the device API's results, worker persistence, and popup and Options interactions.
- Browser end-to-end run (`npm run e2e`): 116 checks against the built extension with a simulated plugin API and Chrome's real permission prompt. It cannot prove the toolbar-click permission grant.
- A pass against the real plugin in a local preview, with Notion stubbed, has been run; see [Development](docs/DEVELOPMENT.md#tests). The extension has not yet been run against real Notion through the plugin, real Discord, real Cloudflare, or Google Chrome itself.
- Vendor reader checks: see the [vendor matrix](docs/VENDORS.md).

## Develop

Use Node.js 22.12+ or 24 LTS and npm. From the project directory:

```powershell
npm ci --cache .npm-cache
npm run check
npm run e2e
npm run package
```

`npm run check` runs tests and the production build. `npm run e2e` drives the built extension in a real browser. `npm run package` writes `release/robotics-part-requests-<version>.zip`, and refuses to package a build with test permissions. `npm run dev` serves the layouts locally, but extension APIs are available only after loading `dist` as an extension.

See [setup and troubleshooting](docs/SETUP.md), [architecture and tests](docs/DEVELOPMENT.md), and [vendor maintenance](docs/VENDORS.md).

Not included: unsupported stores, the Other vendor option, Chrome Web Store publication, RUSH/SLOW requests, bulk capture, actual purchases, and subsequent order management.
