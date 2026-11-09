# Carts

Carts lists the team's open orders by store and, after a person clicks **Build carts**, fills that store's cart in this browser. It never checks out. The person reviews each cart and places the order on the store's own site. The extension doesn't use AI.

The plugin's README has the API (`GET /orders`, `POST /orders/marks`). `src/client.ts` maps every answer to one outcome.

## How a build runs

1. **Options** has the Carts switch, off by default. Turning it on asks Chrome for every built store's origin, from that click. Saying no still turns Carts on, as a checklist. Turning it off, or unpairing, gives the origins back.
2. **`carts.html`** opens as a full tab from the popup or Options. It asks the worker for the orders, because the device key stays in the worker. The page polls by itself for `refreshing`, for `202` and for rate limits, a limited number of times.
3. **Build carts** runs in that page, never in the service worker. For each store with ticked items, one at a time, it opens a new tab at the store's start page, works through one line at a time, then closes the tab. Each store's confirmed lines are marked before the next store starts.

Closing the Carts tab ends a build. A second build is always safe, because every line starts with a read.

## The rules, and where they live

A store's file can't get around these.

| Rule | Where |
|---|---|
| Never checkout, `action=buy` or `/cart/<id>:<qty>`, and never leave the store | `safety.ts`, enforced by `chrome-tab.ts` on every address and after every load |
| Stop at a login wall, CAPTCHA, bot check or unexpected page, with no attempt to get past it | `page-check.ts` after every load, plus each store's own answers. `StoreStop` in `runner.ts` turns the rest into checklist items |
| One store and one line at a time, at a modest pace | `page.ts` and `runner.ts`, with `paceMs` |
| Read before adding, so a retry never doubles | `buildStore` in `runner.ts` |
| Read back after adding, and report short stock or any mismatch | `buildStore` |
| Mark only what a read-back confirmed | `marksFor` in `runner.ts`. Marks hold an order's ID and its quantity, nothing else |
| Cart contents stay in the store's tab, apart from the lines asked for | Each store's `readCart` filters inside the injected function |
| No cookies, no changed user agent, no false identification | The manifest has no such permission. A unit test checks the sources |

### What a read-back means

The target is what this run needs the cart to hold: the requested quantity, plus any earlier order in this run for the same line. Only the difference is added.

| Cart before, cart after | Result | Mark? |
|---|---|---|
| Reached the target, and the cart was empty | Added | Yes |
| Reached the target, and the cart already held some | Flagged: already in the cart | Yes |
| Already at the target, nothing sent | Flagged: already in the cart | Yes |
| Already above the target, nothing sent | Flagged: the cart holds more than requested | Yes |
| Reached the target at a new price | Flagged: price changed | Yes |
| Went up, but short of the target | Flagged: short stock | No |
| Unchanged | Failed, with the store's own message when it gave one | No |
| Above the target, or went down | Flagged: quantity mismatch | No |
| Sent, then couldn't read back | Flagged, and the store stops | No |

This differs from the approved mockup in one way. The mockup says "Your cart has 2 of these. Building adds 4 more," ending at 6. Adds accumulate and a retry can't be told from an earlier cart, so this adds only the difference, ending at 4, and flags it. The row can't warn ahead of the build either, because no store is read before the click.

## Store guide

Each store is one file. A subagent adding a store touches only these, and the coordinator adds one line to `src/carts/registry.ts`:

- `src/carts/stores/<id>.ts`, which exports a `StoreMethod`
- `tests/carts/<id>.test.ts`
- `e2e/carts/<id>.mjs` if it needs a synthetic page

Don't edit `store-method.ts`, `runner.ts`, `safety.ts`, `page-check.ts`, `chrome-tab.ts`, `registry.ts` or `selection.ts`. If the interface doesn't fit a store, say so to the coordinator.

```ts
export const example: StoreMethod = {
  id: 'example',                    // lowercase
  label: 'Example',                 // exactly the plugin's vendor label
  badge: 'direct',                  // 'direct' | 'item' | 'checklist'
  badgeHelp: 'One short line for the heading',
  origins: ['https://www.example.com/*'], // only what the build needs: this is what Chrome's prompt lists
  hosts: ['www.example.com', 'example.com'], // where a product link can be, and the tab may be
  startUrl: 'https://www.example.com/cart',
  cartUrl: 'https://www.example.com/cart',
  requiredFields: ['sku', 'quantity'],
  missing: order => [],             // optional: anything else, as phrases to follow "needs"
  steps: {
    async resolveLine(order, tab) { return { key: order.sku!, addAs: order.sku! }; },
    async readCart(tab, keys) { return stopIf(await tab.run(readCartInTab, keys)); },
    async addLine(tab, target, quantity) { stopIf(await tab.run(addInTab, target.addAs, quantity)); },
  },
};
```

- **Shopify stores** are two lines: `createShopifyStore({ id, label, home, hosts, origins })`, as in `stores/wcp.ts`. Check the store's `/cart.js` and `/products/<handle>.js` answer first. SDS variants sampled have no SKUs, which `chooseVariant` handles from the saved link.
- **Injected functions** are serialized by Chrome. They have no imports and use nothing from outside their own body and arguments. They run in the isolated world. Keep them exported so a unit test can call them.
- **`resolveLine`** throws `LineProblem` when this one order can't be added, and the store carries on. Set `available: false` to fail a line without trying.
- **`readCart`** filters inside the injected function, and hands back only the keys asked for. Compare keys the way the store writes them. Leave out a key that isn't in the cart. Return `{ kind: 'stop', reason, detail }` from anything that isn't the page you expected, and never guess zero from a page you can't recognize.
- **`addLine`** asks once. It doesn't decide the outcome: the runner reads back. Throw `LineProblem` with the store's own words for a refusal, and read back still happens. Add `notSent: true` to a stop only when nothing can have reached the store.
- **Pages that draw themselves after loading:** the check after each load runs too soon to see a wall they draw later. Wait in your injected function for the page you expect or a wall, whichever comes first, using what a person can see (`innerText`), as `mcmasterReadCart` does. Text in scripts or hidden markup misled that check once.
- **Page controls:** only ever act on the one control you named, by its exact label. Refuse anything whose label or address mentions checkout, buy, pay or placing an order. Set `foreground: true` if a page won't work behind other tabs.
- **Never:** answer a challenge, type into a sign-in, retry past a refusal, set a user agent, read `document.cookie`, or send anything to another host.

### Testing a store

Test the injected functions in jsdom against a synthetic page, including one with other lines in the cart, a wall and an unexpected page. Then add the store to `e2e/carts.live.mjs` and check it live: one real item, in a throwaway profile, using Edge or Chrome, and stop at any wall. Report what you saw, including the read-back, as evidence. A store isn't accepted on synthetic tests alone.

## Evidence

Tested 2026-11-09, live, in throwaway Edge profiles that were deleted afterwards, through the built extension with a simulated plugin. Each build was run twice: the second added nothing.

| Store | Method | Result |
|---|---|---|
| REV | `/cart.php?action=add&sku=&qty=` in the tab, read back from `/api/storefront/carts` | Real add confirmed, quantity 2. Retry added nothing. |
| Pololu | `/cart` Quick add `quick_add`, lines like `2136,2`, read from the cart rows | Real add confirmed, quantity 2. Discovery confirmed that adds accumulate. Retry added nothing. |
| WCP | `/products/<handle>.js`, `/cart.js`, `POST /cart/add.js`, `/cart.js` | Real add confirmed, quantity 2, with a saved `?variant=` and a confirmed SKU. Retry added nothing. |
| McMaster | Order page paste, written from the research | **Unproven.** A fresh profile gets a login wall, and it stopped there. Nothing was typed or added. |

Short stock, a store's refusal, walls other than McMaster's and the checkout rule are proven only on synthetic pages, so they haven't been seen from a real store.

The API is checked separately: the built extension against the `carts-backend` plugin on real Core and D1 in a local preview, with Notion stubbed and stores synthetic. Pairing, the real `/orders` list including a real `202`, `skippedRows`, another device's mark, this device's marks, the Admin's switch and its `403` all passed. Core's Pages proxy was stood in for there, because the preview had no port for it.

### What the owner needs to check in a signed-in browser

1. **McMaster, all of it:** load the extension, turn on Carts and build one cheap part. The paste format (`part<tab>quantity`), the ADD button's label and where it sits, and how lines read back are all guesses from a page nobody could see signed in. Any mismatch stops the store as "a page this didn't expect" and leaves a link, with nothing added. Tell the coordinator what the page does.
2. **Real sign-ins:** a signed-in REV, Pololu and WCP account, to see that a saved cart reads back the same way.
3. **Chrome itself:** these ran in Edge. Chrome 137 and newer ignores `--load-extension`, so automation can't load it there. Load `dist` by hand and repeat one store.
