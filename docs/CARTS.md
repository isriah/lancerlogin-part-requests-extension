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
| Never checkout, `action=buy`, Amazon's `/gp/buy` or `/cart/<id>:<qty>`, and never leave the store. One exception: Harbor Freight's cart page is at `/checkout/cart`, so exactly `https://www.harborfreight.com/checkout/cart` is allowed. Another host, a trailing slash, a query, a fragment or any other `/checkout` path stays refused | `safety.ts`, enforced by `chrome-tab.ts` on every address and after every load |
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

All tested 2026-11-09, live, in throwaway Edge profiles that were deleted afterwards, signed out. "Built extension" means the whole extension with a simulated plugin. **Only REV, Pololu, WCP and McMaster's stop ran that way.** The other stores ran their own store code or raw requests from a script, so `chrome-tab.ts`, Chrome's injection and the Carts screen have not been used against those real stores. `npm run e2e:carts` still uses synthetic copies of the first four stores.

| Store | Badge | Method | How it ran | Result |
|---|---|---|---|---|
| REV | Direct | `/cart.php?action=add&sku=&qty=` in the tab, read back from `/api/storefront/carts` | Built extension | Real add confirmed, quantity 2. Retry added nothing. |
| Pololu | Item by item | `/cart` Quick add `quick_add`, lines like `2136,2`, read from the cart rows | Built extension | Real add confirmed, quantity 2. Discovery confirmed that adds accumulate. Retry added nothing. |
| WCP | Direct | `/products/<handle>.js`, `/cart.js`, `POST /cart/add.js`, `/cart.js` | Built extension | Real add confirmed, quantity 2, with a saved `?variant=` and a confirmed SKU. Retry added nothing. |
| McMaster | Item by item | Order page paste, written from the research | Built extension | **Unproven.** A fresh profile gets a login wall, and it stopped there. Nothing was typed or added. |
| Ambrosia Filament | Direct | Shared Shopify method | The same requests, from a script | Real add confirmed, quantity 1, SKU `AMB4605STAREF`. Retry added nothing. The store answered `429` to rapid requests from outside a browser. |
| AndyMark | Direct | Shopify, with a required SKU matched inside the link's product, because SKUs repeat across products | Store steps through `buildStore` | Real add confirmed, quantity 2, SKU `am-1775`. Retry added nothing. Bundles and a real repeated SKU are synthetic only. |
| CTRE | Direct | Shared Shopify method | The same requests, from a script | Real add confirmed, quantity 1, SKU `WCP-1508`. Retry added nothing. An "(8-Pack)" item was not added live. |
| FerrulesDirect | Direct | Shared Shopify method | The same requests, from a script | Real add confirmed, quantity 2, SKU `FDSPP6`. Retry added nothing. |
| SDS | Direct | Shopify, with the variant from the saved link or an exact title in the description, because its variants have no SKUs | Store functions, from a script | Real add confirmed, quantity 2. Retry added nothing. Choosing by title on the real MK5n module was read-only. |
| Thrifty Bot | Direct | Shared Shopify method. A pack's quantity is packs | Store functions, from a script | Real add confirmed, quantity 1 pack, SKU `TTB-0004`. Retry added nothing. A "Pre-Order:" item was not added. |
| V-Belt Guys | Direct | Shared Shopify method, always matched inside the link's product | Store functions, from a script | Real add confirmed, quantity 1, SKU `AK26.5`. Retry added nothing. |
| West3D | Direct | Shopify, plus a page check that refuses kits with custom options | Store steps through `buildStore` | Real add confirmed, quantity 1, SKU `QID2573`. Retry added nothing. A real kit with options was refused with nothing added. The 4.5 second wait for the options is a guess. |
| Swyft | Item by item | The product page's own options, + control and Add to Cart, read back from the site's `swyft.cart.v2` in localStorage | Store code in the page, from a script | Real adds confirmed: quantity 3, top-ups to 5 and 7, and 1 in a new browser, each matching the site's own cart page. Retries added nothing. Eight refusal cases on real pages added nothing. A live test found a race that restored an old count while the server kept the add, so Add now waits for the page's on-load answer. Whether it works in a tab behind others is unknown, so the tab comes to the front. |
| BambuLab | Item by item | `?id=` link, published option list, main quantity box, Add to Cart, read back from the `/cart` row | Raw probes only. **The store's code never ran on the live site** | **Unproven through the real runner.** Two raw adds landed at quantity 1 and showed how the quantity box works. A Cloudflare check then appeared on every page, and that stopped the testing. |
| Amazon | Item by item | Add link, its confirm button when shown, then the cart page, from public descriptions | One signed-out look, from a script | **Unproven.** Signed out, the cart page and the add link both reach a sign-in, which `amazonWall` stops at. The shared page check can't see that sign-in. Nothing was typed, pressed or added. |
| Online Metals | Item by item | The length radio matching the SKU, the quantity, Add To Cart, then `/en/cart` | One look, from a script | **Unproven.** The product page's form was read, then `/en/cart` answered Cloudflare's `403`. Nothing was added. The cart page's shape has never been seen. |
| Harbor Freight | Item by item | `/search?q=<SKU>`, confirm the product, its quantity box and Add to Cart, then `/checkout/cart` | Two looks, from a script | **Unproven.** One run crashed with no report, and the next got a `403` Press & Hold bot check on the home page. Search, product and cart pages were never seen, and nothing was added. |
| PowerWerx | Item by item | Quick Entry: paste `SKU, quantity`, Match Items, the grid's add button, then the review window's add button | One match attempt, from a script | **Unproven.** The match got a Cloudflare challenge. Only Match Items was ever pressed live. The grid and review window come from the page's own script. |
| Home Depot | Checklist | Nothing automated. Links and quantities | Page loads only | No add could be read back: `/cart` answers `403` in a fresh browser, and no add address or cart API is published. |
| Ali Express | Checklist | Nothing automated. Links and quantities | Page loads only | A robot check showed on the cart and on one of two product pages, so no add was tried and no cart line was seen. Orders hold no saved options to compare with a listing. |

Short stock, a store's refusal, walls other than those named above and the checkout rule are proven only on synthetic pages, so they haven't been seen from a real store.

### Things to know about particular stores

- **Harbor Freight's pickup or shipping choice** (owner decision, 2026-11-09): a choice that's already selected is kept and never changed, and the line is flagged with the choice's name if the add lands. A choice with nothing selected fails the line. So does a store or ZIP prompt, including an empty ZIP box beside Add to Cart. A line reported as short stock or a quantity mismatch has its own flag, which doesn't name the choice.
- **Swyft keeps a separate cart on each host.** `www.swyftrobotics.com` doesn't redirect to `swyftrobotics.com`, and each keeps its own cart in the browser. Builds and the "Open Swyft cart" link always use `swyftrobotics.com`, so lines someone added on `www.` won't show there, and a build can't see them.
- **Swyft's read-back is the browser's copy of the cart.** A difference on the server from any cause other than the race above wouldn't show.
- **Amazon's total:** `amazonReadCart` also hands the page the active cart's total unit count, to catch an add landing under another ASIN. It stays in memory and never goes to the plugin.

The API is checked separately: the built extension against the `carts-backend` plugin on real Core and D1 in a local preview, with Notion stubbed and stores synthetic. Pairing, the real `/orders` list including a real `202`, `skippedRows`, another device's mark, this device's marks, the Admin's switch and its `403` all passed. Core's Pages proxy was stood in for there, because the preview had no port for it.

### What the owner needs to check in a signed-in browser

Use one cheap item, and remove it afterwards. Any mismatch below should stop the store or fail the line, not add the wrong thing. Tell the coordinator what each page does.

1. **McMaster, all of it:** load the extension, turn on Carts and build one cheap part. The paste format (`part<tab>quantity`), the ADD button's label and where it sits, and how lines read back are all guesses from a page nobody could see signed in. Any mismatch stops the store as "a page this didn't expect" and leaves a link, with nothing added.
2. **Amazon:** one in-stock item, quantity 2, with the cart otherwise empty.
   - **Add link:** does it show a confirm page or add straight away, and is a link with no associate tag accepted?
   - **Signed-in re-prompt:** the redirect carries `max_auth_age=3600`, so an account signed in over an hour ago may be asked for its password again. It should stop there. Note how often, because it could make Amazon mostly a checklist.
   - **Confirm page:** the button's exact label (only "Add to Cart" variants are accepted), the page's address, and whether the form itself holds the ASIN as `ASIN.1`, `data-asin` or a `/dp/` link. After the press, which address does it land on? Accepted: `/gp/cart/view.html`, `/cart/...` and `/gp/huc/...`.
   - **Row attributes:** do cart rows carry `.sc-list-item[data-asin]`, `data-quantity`, `data-price` and `data-itemtype="active"`, and does `#sc-subtotal-label-activecart` read "Subtotal (N items)"? An item in Saved for Later must read as not in the cart.
   - **Build twice:** the second build should add nothing. Also try a cart with other items, and one with an item unticked.
   - **Parent ASIN:** does a parent or variation link get refused, or land under a child ASIN? The second should stop and flag. A further build could then add it again, so check the cart first.
   - **Seller and tabs:** a link's seller isn't carried over, so check the seller in the cart. Does the flow work behind other tabs?
3. **Online Metals:** does `/en/cart` load at all in a real browser? If Cloudflare challenges real sessions too, the store stops every time and should probably become a checklist. Does the cart page use the assumed `form[action*="/cart/update"]` rows with `productCode` and `quantity`, and say when it's empty? Does the page's script accept the length radio and quantity, and what does the button do when it reads "Item In Cart"? Its terms and `agents.md` answered `403`, so they are unread.
4. **Harbor Freight:** does a real browser get past the bot check at all? Check the search redirect, the "SKU n" wording, the "Add to Cart" label, the quantity box's name, the cart rows and the empty-cart wording, all guessed from the research. Does `/checkout/cart` load at exactly that address? A redirect that adds anything to it stops the store. If the Add to Cart form posts to an address with "checkout" in it, such as `/checkout/cart/add`, the store stops and that rule needs a decision. Does a preselected pickup or shipping choice show the flag? Does the cart page say "sign in to continue", which would stop the store by mistake? Short stock may show as "quantity box would not take n". Its terms answered `403`, so they are unread.
5. **PowerWerx:** build one cheap part. Does Match Items get through in a real browser? Check the grid and review window, known only from the page's script, including the commit button's label. Is `.apt-cell-sku` right on `/cart`? If not, the store stops, the add may already have landed, and the item is flagged to check. This uses `.apt-qe-gridreview` and `[data-review-commit]`, not `.apt-qe-addall`, because the page's script shows that button is for the separate Search & Add rows. Its terms and `agents.md` answered `403`, so they are unread.
6. **BambuLab, one full live run:** it has never run through the real runner. Once any Cloudflare check has cleared, build `https://us.store.bambulab.com/products/pla-basic-filament?id=40475106771080`, quantity 2, twice. The quantity box only commits on input, change and focusout together, and the store refuses to press Add unless the page's own summary shows ×N, so a wrong quantity should fail the line. Check that the second build adds nothing, that longer product names match their cart rows, and whether single-option products show the summary.
7. **Home Depot, currently Checklist:** to upgrade it, a signed-in browser has to show all of these: `/cart` loads in a tab the extension opened, with no "Oops" page. Each line shows a readable item number and quantity, and an empty cart can be recognized. An add takes a quantity and doesn't pick a store or delivery option for the person. A fresh browser already shows a store and ZIP from its location, which an add could silently inherit. Product pages stay readable across several lines. A person has read the Terms of Use.
8. **Ali Express, currently Checklist:** to upgrade it, a signed-in browser has to answer these: does the robot check or a slider appear in normal use? Does Add to cart work, and does it open a dialog or another page? How does a cart line show its item and options, and can it be read without the rest of the cart? Do adds accumulate, and how is short stock capped? How do a saved link and `sku_id` relate to the selected options, and do `.com` links redirect to `.us`? Are prices in USD on the team's accounts? Automatic adds would also need a saved-options field on orders. For the checklist itself, check that the row, links, tooltip and cart link look right.
9. **Real sign-ins:** a signed-in account at the stores that passed signed out, to see that a saved cart reads back the same way.
10. **The built extension against the real stores:** run the stores that passed from a script through the built extension, as `npm run live:carts` does for the first four.
11. **Chrome itself:** these ran in Edge. Chrome 137 and newer ignores `--load-extension`, so automation can't load it there. Load `dist` by hand and repeat one store.
