# Carts

Carts lists the team's open orders by store and, after a person clicks **Build carts**, fills that store's cart in this browser. It never checks out. The person reviews each cart and places the order on the store's own site. The extension doesn't use AI.

The plugin's README has the API (`GET /orders`, `POST /orders/marks`). `src/client.ts` maps every answer to one outcome.

## How a build runs

1. **Options** has the Carts switch, off by default. Turning it on asks Chrome for every built store's origin, from that click. Saying no still turns Carts on, as a checklist. Turning it off, or unpairing, gives the origins back.
2. **`carts.html`** opens as a full tab from the popup or Options. It asks the worker for the orders, because the device key stays in the worker. The page polls by itself for `refreshing`, for `202` and for rate limits, a limited number of times.
3. **Build carts** runs in that page, never in the service worker. For each store with ticked items, one at a time, it opens a new tab at the store's start page, works through one line at a time, then, if anything was sent, reads the cart one last time once its page has settled, closes the tab, and marks what's still confirmed before the next store starts.

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
| After the lines, read once more with the cart page settled. Report a change, and never change it back | `recheckLines` in `runner.ts`, with `CART_SETTLE_MS` in `safety.ts` |
| Mark only what a read-back confirmed and the final read didn't change, and only after that read | `marksFor` in `runner.ts`, called by `page.ts` once `buildStore` returns. Marks hold an order's ID and its quantity, nothing else |
| Cart contents stay in the store's tab, apart from the lines asked for | Each store's `readCart` filters inside the injected function |
| No cookies, no changed user agent, no false identification | The manifest has no such permission. A unit test checks the sources |

### What a read-back means

The target is what this run needs the cart to hold: the requested quantity, plus any earlier order in this run for the same line. Only the difference is added. On a retry of two orders for one line, the first can look above its target until the second is reached, so it's marked after all if the orders together account for the cart.

| Cart before, cart after | Result | Mark? |
|---|---|---|
| Reached the target, and the cart was empty | Added | Yes |
| Reached the target, and the cart already held some | Flagged: already in the cart | Yes |
| Already at the target, nothing sent | Flagged: already in the cart | Yes |
| Already above the target, nothing sent | Flagged: the cart holds more than requested. A mark means the cart holds what was asked for, so this has none | No |
| Reached the target at a new price | Flagged: price changed | Yes |
| Went up, but short of the target | Flagged: short stock | No |
| Unchanged | Failed, with the store's own message when it gave one | No |
| Above the target, or went down | Flagged: quantity mismatch | No |
| Sent, then couldn't read back | Flagged, and the store stops | No |
| Any of these, then the final read differs | Flagged: the store changed it, naming both numbers | No |
| Any of these, then the final read couldn't run | The earlier result stands, with a note on the store's card | As before |

### The final read

A store's own cart page can change a line after the read-back, as AndyMark's does. So once a store's lines are done, if at least one was sent, `buildStore` loads the store's `cartUrl` (only if `allowedInTab` passes), waits `CART_SETTLE_MS` (3 seconds), and reads every line this build handled with one `readCart`. It compares each with the last read of that line.

- **A line that moved** is flagged and loses its mark: "The store changed this to 25 after it was added; you asked for 1. Check the cart before ordering." The results card puts these in their own highlighted group, and counts them in the card's pills and the summary. The higher number is only ever reported. Nothing is sent to bring it back.
- **A wall or an error during this read** keeps the earlier results and their marks, and adds a note to the card that the final check couldn't run. It's never a failure, and nothing is retried.
- **A wall during the lines** ends that store's pages, so this read isn't tried, and the same note appears if anything was sent. **Stop** doesn't skip it, since it sends nothing and the lines already sent still need it.
- **Nothing sent** means no final read, so a retry that adds nothing costs no extra time. Stores with no steps never get here.
- **One load, one wait.** If the store's own `readCart` loaded `cartUrl` and nothing has navigated since, the final read doesn't load it first, and just waits. `readCart` then loads it again itself, seeing whatever the first load's scripts did. The runner sees this from the addresses `readCart` asks for, so a store declares nothing.
- **No store skips it outright**, because none yet reads a page that has had this long. Pololu reads about 300 ms after a load, McMaster reads the page showing as soon as it recognizes it, and Home Depot and Ali Express read once rows have held still for 1.5 seconds. A store that read only after 3 seconds could skip it, but that wait would then be on every read of every line. The cost as it is: about 3 seconds and one page load per store.

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
- **`resultNote`** on a store is one line shown in its results once anything has been added, for something true of its cart as a whole.
- **`readCart`** filters inside the injected function, and hands back only the keys asked for. It also gets called with several keys for the final read, from the store's `cartUrl` page. Compare keys the way the store writes them. Leave out a key that isn't in the cart. Return `{ kind: 'stop', reason, detail }` from anything that isn't the page you expected, and never guess zero from a page you can't recognize.
- **`addLine`** asks once. It doesn't decide the outcome: the runner reads back. Throw `LineProblem` with the store's own words for a refusal, and read back still happens. Add `notSent: true` to a stop only when nothing can have reached the store.
- **Pages that draw themselves after loading:** the check after each load runs too soon to see a wall they draw later. Wait in your injected function for the page you expect or a wall, whichever comes first, using what a person can see (`innerText`), as `mcmasterReadCart` does. Text in scripts or hidden markup misled that check once.
- **Page controls:** only ever act on the one control you named, by its exact label. Refuse anything whose label or address mentions checkout, buy, pay or placing an order. Set `foreground: true` if a page won't work behind other tabs.
- **Never:** answer a challenge, type into a sign-in, retry past a refusal, set a user agent, read `document.cookie`, or send anything to another host.

### Testing a store

Test the injected functions in jsdom against a synthetic page, including one with other lines in the cart, a wall and an unexpected page. Then add the store to `e2e/carts.live.mjs` and check it live: one real item, in a throwaway profile, using Edge or Chrome, and stop at any wall. Report what you saw, including the read-back, as evidence. A store isn't accepted on synthetic tests alone.

## Evidence

All tested 2026-11-09, live, in throwaway Edge profiles that were deleted afterwards, signed out. "Built extension" means the whole extension with a simulated plugin. REV, Pololu, WCP and nine more stores have now run that way, each with one cheap item and a second build. BambuLab, Amazon, Online Metals, Harbor Freight, PowerWerx, Home Depot, Ali Express and McMaster aren't run from automated profiles, because bot checks and walls appeared there. They're for the owner's browser. `npm run e2e:carts` uses synthetic copies of six stores, including Home Depot and Ali Express.

| Store | Badge | Method | How it ran | Result |
|---|---|---|---|---|
| REV | Direct | `/cart.php?action=add&sku=&qty=` in the tab, read back from `/api/storefront/carts` | Built extension | Real add confirmed, quantity 2. Retry added nothing. |
| Pololu | Item by item | `/cart` Quick add `quick_add`, lines like `2136,2`, read from the cart rows | Built extension | Real add confirmed, quantity 2. Discovery confirmed that adds accumulate. Retry added nothing. |
| WCP | Direct | `/products/<handle>.js`, `/cart.js`, `POST /cart/add.js`, `/cart.js` | Built extension | Real add confirmed, quantity 2, with a saved `?variant=` and a confirmed SKU. Retry added nothing. |
| McMaster | Item by item | Order page paste, written from the research | Built extension | **Unproven.** A fresh profile gets a login wall, and it stopped there. Nothing was typed or added. |
| Ambrosia Filament | Direct | Shared Shopify method | Built extension | Real add confirmed, quantity 1, SKU `AMB4605STAREF`. Retry added nothing. An earlier script run got `429` from rapid requests outside a browser. |
| AndyMark | Direct | Shopify, with a required SKU matched inside the link's product, because SKUs repeat across products | Built extension | Real add confirmed, quantity 1 of `am-1417` (sold in 1s), and the retry added nothing. Quantity 1 of `am-1775` (sold in 25s) was refused before adding, with nothing in the cart and no mark, on the build and the retry. Before that refusal existed, the same item read back as 1, the store's own `/cart` page raised it to 25, and the final read flagged it in the same build. See below. Bundles and a real repeated SKU are synthetic only. |
| CTRE | Direct | Shared Shopify method | Built extension | Real add confirmed, quantity 1, SKU `WCP-1508`. Retry added nothing. An "(8-Pack)" item was not added live. |
| FerrulesDirect | Direct | Shared Shopify method | Built extension | Real add confirmed, quantity 1, SKU `FDSPP6`. Retry added nothing. |
| SDS | Direct | Shopify, with the variant from the saved link or an exact title in the description, because its variants have no SKUs | Built extension | Real add confirmed, quantity 1, from a saved `?variant=`. Retry added nothing. Choosing by title on the real MK5n module was read-only, from a script. |
| Thrifty Bot | Direct | Shared Shopify method. A pack's quantity is packs | Built extension | Real add confirmed, quantity 1 pack, SKU `TTB-0004`. Retry added nothing. A "Pre-Order:" item was not added. |
| V-Belt Guys | Direct | Shared Shopify method, always matched inside the link's product | Built extension | Real add confirmed, quantity 1, SKU `AK26.5`. Retry added nothing. |
| West3D | Direct | Shopify, plus a page check that refuses kits with custom options | Built extension | Real add confirmed, quantity 1, SKU `QID2573`. Retry added nothing. A real kit with options was refused with nothing added, from a script earlier. The 4.5 second wait for the options is a guess. |
| Swyft | Item by item | The product page's own options, + control and Add to Cart, read back from the site's `swyft.cart.v2` in localStorage | Built extension: quantity 1 and a retry. Store code from a script: the rest | Real add confirmed through the built extension, quantity 1, and the retry added nothing. From a script earlier: quantity 3, top-ups to 5 and 7, each matching the site's own cart page, and eight refusal cases on real pages that added nothing. A live test found a race that restored an old count while the server kept the add, so Add now waits for the page's on-load answer. The tab comes to the front. |
| BambuLab | Item by item | `?id=` link, published option list, main quantity box, Add to Cart, read back from the `/cart` row | Raw probes only. **The store's code never ran on the live site** | **Unproven through the real runner.** Two raw adds landed at quantity 1 and showed how the quantity box works. A Cloudflare check then appeared on every page, and that stopped the testing. |
| Amazon | Item by item | Add link, its confirm button when shown, then the cart page, from public descriptions | One signed-out look, from a script | **Unproven.** Signed out, the cart page and the add link both reach a sign-in, which `amazonWall` stops at. The shared page check can't see that sign-in. Nothing was typed, pressed or added. |
| Online Metals | Item by item | The length radio matching the SKU, the quantity, Add To Cart, then `/en/cart` | One look, from a script | **Unproven.** The product page's form was read, then `/en/cart` answered Cloudflare's `403`. Nothing was added. The cart page's shape has never been seen. |
| Harbor Freight | Item by item | `/search?q=<SKU>`, confirm the product, its quantity box and Add to Cart, then `/checkout/cart` | Two looks, from a script | **Unproven.** One run crashed with no report, and the next got a `403` Press & Hold bot check on the home page. Search, product and cart pages were never seen, and nothing was added. |
| PowerWerx | Item by item | Quick Entry: paste `SKU, quantity`, Match Items, the grid's add button, then the review window's add button | One match attempt, from a script | **Unproven.** The match got a Cloudflare challenge. Only Match Items was ever pressed live. The grid and review window come from the page's own script. |
| Home Depot | Item by item | The product page's own quantity box and Add to Cart, then the `/cart` rows | The steps ran on synthetic pages through the built extension. The selectors come from one add by hand in the owner's signed-in Chrome | **Unproven through this code.** A fresh automated profile gets a `403` "Oops" page, which stops the store. The first real run is the owner's. |
| Ali Express | Item by item | The option named in the request, the quantity box and Add to cart, then the cart page's rows | The steps ran on synthetic pages through the built extension. The selectors come from one add by hand in the owner's signed-in Chrome | **Unproven through this code.** Automated profiles got robot checks, so it isn't run from them. The first real run is the owner's. |

Short stock, a store's refusal, walls other than those named above and the checkout rule are proven only on synthetic pages, so they haven't been seen from a real store.

### Things to know about particular stores

- **Harbor Freight's pickup or shipping choice** (owner decision, 2026-11-09): a choice that's already selected is kept and never changed, and the line is flagged with the choice's name if the add lands. A choice with nothing selected fails the line. So does a store or ZIP prompt, including an empty ZIP box beside Add to Cart. A line reported as short stock or a quantity mismatch has its own flag, which doesn't name the choice.
- **Home Depot's pickup or delivery choice** (owner decision, 2026-11-09): the same rule. A selected `deliveryTile` or `pickupTile` is kept and named in the flag, and neither tile is ever clicked. Neither selected, both selected, no tiles at all, or a store or ZIP prompt fails the line. Option pills saying "Please Select" can sit beside a selected one, so they aren't read: the page's own button has to be enabled, and the read-back decides. How a tile shows it's selected wasn't seen, so this looks for `aria-pressed`, `aria-checked`, `aria-selected`, `aria-current`, `data-selected` or a checked input. If the real tile uses none of those, every line fails with "no pickup or delivery choice selected", with nothing added.
- **Home Depot's cart rows load late, and Saved For Later is on the same page.** A read waits until the rows stop changing and agree with the header's cart count, either as rows or as units. If they never agree, the store stops instead of reading a wrong zero. A row under the "Saved For Later" heading, or one offering "Move to Cart", doesn't count. A row under that heading still offering "Save For Later" stops the store.
- **Ali Express's option** (owner decision, 2026-11-09): a line goes ahead only when its description exactly names a listing option, which is how the reader saves it: `Title - Size: 0.8mm (5Meter) / Color: Black`. Letter case counts, and words merely inside a title don't. No match, two matches in one row, or a sold-out match fails the line with nothing clicked. Two choices are this code's own, for the owner to check: a row with one option, already selected, needn't be named, and a listing with no options at all has nothing to match. An option already selected isn't clicked, because a second click can undo it.
- **Ali Express's cart rows** are matched on both the listing and the option, because one listing can hold several options in a cart. A row of the listing that names none of its known options could be this line written differently, so it stops the store instead of reading as zero.
- **Ali Express ticks a newly added item for checkout by itself.** Nothing here touches those ticks, and the results say so.
- **Ali Express is USD only.** A price that isn't `$` or `US $` fails the line, checked before reading the cart and again once the option is selected. Builds always use the `.us` listing, whichever site the link was saved from.
- **AndyMark's cart page can raise a quantity on its own.** Seen on `am-1775`, a $0.05 screw: `/cart/add.js` accepted quantity 1 and `/cart.js` read 1. About a second after `/cart` next loaded, the page's own script sent `/cart/update.js` with `{"updates":[25]}`, and the cart held 25. This code never asks for that. A build now refuses such a quantity before adding, as below. If that check can't read the value, the final read catches the change in the same build: the line is flagged, naming 25 and 1, with no mark. The extension doesn't change it back, because that's for the person to decide in the cart. A later build adds nothing, says the cart already holds more than was asked for, and doesn't mark it either.
  - **The cause** is AndyMark's theme. `roundAndApplyAutomaticCodes` in `empire.min.js` runs when the cart page loads and sends every line through `max(floor(quantity / n) * n, n)`, where `n` is that variant's `orderedInQuantity`, read from `#variant_metafield_data` on the page. So 1 becomes 25, and 30 would go down to 25. It then posts `/cart/update.js` once for the quantities and once for discount codes.
  - **It depends on the item's own setting**, not its price or the cart's total: neither is in that code. `am-1775` at $0.05 went to 25 ($1.25), and `am-1552_black` at $0.08 went to 100 ($8.00), in the same cart.
  - **How often:** 181 of 1,970 products carry the tag `Ordered In Quantity Higher Than One`: 91 of 125 under $0.25, 86 of 219 from $0.25 to $1, 4 of 447 from $1 to $5, and none of 1,179 at $5 or more. The tag misses some, because `am-1775` doesn't have it. In a read-only sample of 40 product pages, 36 showed a value. The 9 above 1 were all under $1 (10 or 25), and the 21 at $1 or more all showed 1. It's mostly small hardware, which is a large share of what a team orders. The rest of the catalog isn't checked.
  - **A build refuses it before adding** (owner decision, 2026-11-09). `andymarkOrderedIn` reads the chosen option's value from `#variant_metafield_data` on the product page, with a fetch that leaves the tab where it is. A quantity that isn't a whole multiple fails that one line, with nothing added: "AndyMark sells this in multiples of 25, so it would change 1 to 25. Fix the quantity in Notion, or add it by hand." The rest of the store carries on, and the row can still be ticked, because the value is only read during a build. A whole multiple adds normally. A missing or unreadable value proceeds as before, and the final read still catches a change. Each order is checked by itself, so orders of 10 and 15 for an item sold in 25s both fail, even though together they'd hold.
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
7. **Home Depot, the first signed-in Build carts run:** build the hex nut, `https://www.homedepot.com/p/Everbilt-1-4-in-20-Zinc-Plated-Hex-Nut-801736/204647886`, quantity 2, then build again. The second build should add nothing.
   - **Opening in the extension's tab:** do `/cart` and the product page load with no "Oops" page? If they do show it, the store stops, which is right, and it may need to stay a checklist.
   - **Lazy cart rows:** with something else already in the cart, does the read wait for all the rows? Does `header-cart-count` count rows or units, and does it agree with what's on the page? If it never agrees, the store stops as "a page this didn't expect". An add may already have landed, so look at the cart.
   - **Saved For Later:** save the hex nut for later, then build it. It should add a new line and report added, not "already in the cart". Check the "Saved For Later" heading's exact wording, and whether those rows carry `data-component^="cart-item:CartItem"`.
   - **The choice:** does the flag name Delivery? Try an item with Pickup selected. What attribute shows a tile is selected? If none of those listed above, every line fails with "no pickup or delivery choice selected", and that needs a one-line fix.
   - **A prompt:** does a store or ZIP prompt fail the line with nothing added? Does the empty-cart page read as empty?
   - **The panel:** did it press only the page's own button, with nothing under "Don't Forget These"? Were two `add-to-cart` blocks ever on one page? That refuses the line.
   - **Prices:** does the toolbar popup capture 14 ¢ as $0.14 on the hex nut, and $2.97 on a normal item? A person has still to read the Terms of Use.
8. **Ali Express, the first signed-in Build carts run:** use the $0.46 item, `https://www.aliexpress.us/item/3256802967050384.html`, with a request saved from the toolbar, quantity 2, then build again. The second build should add nothing.
   - **The description:** does the toolbar save the option the way this needs, as in `... - Size: 0.8mm (5Meter)`? If not, every line with options fails with "doesn't exactly name", and that needs a fix before it's useful.
   - **Selecting:** does the option get selected and stay selected, and does `[class*="selected"]` show it? Is one option at a time the only thing that reads as selected?
   - **Quantity and press:** does the box take 2? Is there only one visible "Add to cart", with no sticky copy? Two refuses the line. Buy now must stay untouched.
   - **Timing:** there's no dialog after adding, so this waits 3 seconds before leaving the page. Did the add land every time?
   - **Rows:** add two options of the listing. Are they counted apart? Is the option in the row's text? A row where it isn't stops the store. Does `Cart (N)` count rows or units, and is it where this looks, in the page title or a heading?
   - **Ticks:** the new item comes up ticked, others stay as they were, and the results say so.
   - **Walls:** does a robot check or sign-in stop the store? How often does one appear? Does a saved `.com` link or `sku_id` cause any trouble?
   - Remove the item afterwards with the row's trash icon and "Remove". That's by hand: nothing here removes anything.
9. **Real sign-ins:** a signed-in account at the stores that passed signed out, to see that a saved cart reads back the same way.
10. **AndyMark's "ordered in" quantities:** build a small screw, quantity 1. The line should fail with "sells this in multiples of 25", with nothing added. If an item's value can't be read and its quantity still changes on the cart page, the results flag it and the extension doesn't change it back, so the quantity is the person's to fix in the cart before ordering.11. **Chrome itself:** these ran in Edge. Chrome 137 and newer ignores `--load-extension`, so automation can't load it there. Load `dist` by hand and repeat one store.
