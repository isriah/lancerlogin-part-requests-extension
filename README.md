# Robotics Part Requests

A Chrome extension that turns the product you are viewing into a reviewed part request in your team's Notion ordering database. It supports the 20 fixed vendors in the team's ordering form. It sends through your team's LancerLogin site, using the [Part Requests plugin](https://github.com/isriah/lancerlogin-part-requests), which holds the Notion connection. The extension holds no Notion token and never contacts Notion. It creates requests, and can help fill store carts. The coach still handles purchasing and receiving.

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

During a LancerLogin update, the extension waits and tries again by itself with the same request ID, a limited number of times, and the site allows one create per ID. If the result is ever unknown, it may already exist in Notion, so the extension will not resend it on its own. Use **Check ordering database** to look before choosing to try again.

**Unpair this device** in Options removes the device from your team's site, which frees one of your 5 device slots, then forgets the key and Chrome's permission for the site. If the site can't confirm it, the extension still unpairs on this computer and says an Admin may need to remove the device.

If your team's site asks for a newer version than this one, Options and the popup show a notice with a link to the update. It never blocks anything.

### Look and feel

The popup and Options use the LancerLogin dashboard's design, with Roboto and Bebas Neue bundled in the extension and nothing loaded from anywhere else. They start dark, and **Light mode** in Options changes that. Once paired, the extension uses your team's name and colors from its LancerLogin site. It reads them at pairing and at most once a day after that, keeps the last good colors if a read fails, and forgets them on Unpair. Until then it uses LancerLogin's default colors.

### Express addition

**Express addition** is a switch in Options, off by default. When it's on, clicking the toolbar icon still opens the popup, and the request is sent without another click if all of these hold:

- The page is one product from a supported store.
- The description and a USD price were read from the page, with no unselected options.
- The reader raised no issue, other than the optional SKU.
- A default team and Notion name are saved and still on the lists.
- `POST /check` answered and found no recent request for this product.
- This page hasn't already been sent from this browser.

It always sends quantity 1 as a NORMAL request. If anything doesn't hold, nothing is sent and the form lists why. A student who edits a draft, or presses **New request** or **Discard**, gets the form from then on.

The service worker owns the send, so closing the popup doesn't cancel it. It uses the same submission ID and duplicate protection as **Create request**: reopening shows the sending state or the receipt and never sends again, and an uncertain result is never resent. There is no undo, because the Notion connection can't delete pages, so the success screen says how to change or remove a request in Notion.

### Carts

**Carts** is a switch in Options, off by default. It lists your team's open orders by store, and after you click **Build carts** it adds the items you ticked to each store's cart in this browser. It never checks out. You review the cart and place every order yourself on the store's own site. The extension doesn't use AI.

NORMAL and RUSH start ticked. SLOW and Incomplete start unticked, and anything missing what its store needs can't be ticked. Every supported store has its own method, and [Carts](docs/CARTS.md#evidence) says which are proven. Any other store is a checklist of links and quantities. A login wall, CAPTCHA, bot check or unexpected page stops that store and leaves its items as links. See [Carts](docs/CARTS.md).

## Verification status

- Unit tests (`npm test`): 1195 pass, including all 20 adapter fixtures, the device API's results, version comparison, Unpair's outcomes, worker persistence, Express addition's conditions and sends, team color validation and contrast, and popup and Options interactions.
- Browser end-to-end run (`npm run e2e`): 283 checks against the built extension with a simulated plugin API and Chrome's real permission prompt. It cannot prove the toolbar-click permission grant.
- A pass against the real plugin in a local preview, with Notion stubbed, was last run on version 0.4.0, not 1.0.0, including team colors from Core's real status route; see [Development](docs/DEVELOPMENT.md#tests). Version 0.3.0 has not been run against real Notion, real Discord, real Cloudflare or Google Chrome itself, and Express addition has not been tried from a real toolbar click.
- Carts: `npm run e2e:carts` (181 checks) drives the built extension against synthetic copies of seven stores and a simulated plugin, and `npm run live:carts` adds one real item each in a throwaway profile. REV, Pololu, WCP, Ambrosia, CTRE, FerrulesDirect, SDS, Thrifty Bot, V-Belt Guys, West3D and Swyft passed live through the built extension. AndyMark passed too, including an item it sells only in multiples, which a build rounds up and flags. McMaster, Online Metals, PowerWerx and Home Depot have worked in the owner's signed-in browser. Amazon, Harbor Freight and Ali Express are unproven on version 1.0.0 and are for that browser too. BambuLab is unsupported in Carts: its orders are a checklist to add by hand, though the toolbar still saves requests from its pages. A pass against the real plugin on real Core in a local preview on version 0.4.0, with Notion stubbed and stores synthetic, covered `/orders`, marks and the Admin's switch. Carts has not run against real Notion. See [Carts](docs/CARTS.md#evidence).
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

See [setup and troubleshooting](docs/SETUP.md), [architecture and tests](docs/DEVELOPMENT.md), [Carts and adding a store](docs/CARTS.md), and [vendor maintenance](docs/VENDORS.md). Bundled font licenses are in [THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt). It ships inside the extension because the Open Font License requires that, and nothing in the UI links to it.

Not included: unsupported stores, the Other vendor option, Chrome Web Store publication, creating RUSH/SLOW requests, bulk capture, actual purchases, and subsequent order management.
