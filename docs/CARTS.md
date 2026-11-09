# Carts

Carts lists the team's open orders by store and, after a person clicks **Build carts**, fills that store's cart in this browser. It never checks out. The person reviews each cart and places the order on the store's own site. The extension doesn't use AI.

The plugin's README has the API (`GET /orders`, `POST /orders/marks`). `src/client.ts` maps every answer to one outcome.

## How a build runs

1. **Options** has the Carts switch, off by default. Turning it on asks Chrome for every built store's origin, from that click. Saying no still turns Carts on, as a checklist. Turning it off, or unpairing, gives the origins back.
2. **`carts.html`** opens as a full tab from the popup or Options. It asks the worker for the orders, because the device key stays in the worker. The page polls by itself for `refreshing`, for `202` and for rate limits, a limited number of times.
3. **Build carts** runs in that page, never in the service worker. For each store with ticked items, one at a time, it opens a new tab at the store's start page, works through one line at a time, then, if anything was sent, reads the cart one last time once its page has settled, closes the tab, and marks what's still confirmed before the next store starts.

Closing the Carts tab ends a build. A second build is always safe, because every line starts with a read.

The results account for every open order. A store that stopped says why, on a second line: "What it saw: a cart line with no SKU". Those words are the store code's fixed `detail` strings, so they hold nothing from a cart. Anything not in the build, such as a row left unticked or one that can't be added yet, is under **Not in this build**, with the reason. A row the extension can't read at all counts in the "rows left out" notice.

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
| Mark only what a read-back confirmed and the final read didn't change, and only after that read. A line rounded up to the store's multiple counts as confirmed, and is marked at the order's own quantity | `marksFor` in `runner.ts`, called by `page.ts` once `buildStore` returns. Marks hold an order's ID and its quantity, nothing else |
| Cart contents stay in the store's tab, apart from the lines asked for | Each store's `readCart` filters inside the injected function |
| No cookies, no changed user agent, no false identification | The manifest has no such permission. A unit test checks the sources |

### What a read-back means

The target is what this run needs the cart to hold: the requested quantity, plus any earlier order in this run for the same line. Only the difference is added. On a retry of two orders for one line, the first can look above its target until the second is reached, so it's marked after all if the orders together account for the cart.

A store can say a line is sold only in multiples, with `soldIn` on its `LineTarget`. The target is then the run's orders for that line, added up and rounded up to the next multiple. See [AndyMark](#things-to-know-about-particular-stores), the only store that does.

| Cart before, cart after | Result | Mark? |
|---|---|---|
| Reached the target, and the cart was empty | Added | Yes |
| Reached the target, and the cart already held some | Flagged: already in the cart | Yes |
| Already at the target, nothing sent | Flagged: already in the cart | Yes |
| Reached or already at a target rounded up to the store's multiple | Flagged: rounded up, in its own highlighted group, naming both numbers | Yes, at the quantity requested |
| Already above the target, nothing sent | Flagged: the cart holds more than requested. A mark means the cart holds what was asked for, so this has none | No |
| Reached the target at a new price | Flagged: price changed | Yes |
| Went up, but short of the target | Flagged: short stock | No |
| Unchanged | Failed, with the store's own message when it gave one | No |
| Above the target, or went down | Flagged: quantity mismatch | No |
| Sent, then couldn't read back | Flagged, and the store stops. The store's message says to check the cart, not to add it | No |
| Any of these, then the final read differs | Flagged: the store changed it, naming both numbers | No |
| Any of these, then the final read couldn't run | The earlier result stands, with a note on the store's card | As before |

### The final read

A store's own cart page can change a line after the read-back, as AndyMark's does. So once a store's lines are done, if at least one was sent, `buildStore` loads the store's `cartUrl` (only if `allowedInTab` passes), waits `CART_SETTLE_MS` (3 seconds), and reads every line this build handled with one `readCart`. It compares each with the last read of that line.

- **A line that moved** is flagged and loses its mark: "The store changed this to 25 after it was added; you asked for 1. Check the cart before ordering." The results card puts these in their own highlighted group, and counts them in the card's pills and the summary. The higher number is only ever reported. Nothing is sent to bring it back.
- **A wall or an error during this read** keeps the earlier results and their marks, and adds a note to the card that the final check couldn't run. It's never a failure, and nothing is retried.
- **A wall during the lines** ends that store's pages, so this read isn't tried, and the same note appears if anything was sent. **Stop** doesn't skip it, since it sends nothing and the lines already sent still need it.
- **Nothing sent** means no final read, so a retry that adds nothing costs no extra time. Stores with no steps never get here.
- **One load, one wait.** If the store's own `readCart` loaded `cartUrl` and nothing has navigated since, the final read doesn't load it first, and just waits. `readCart` then loads it again itself, seeing whatever the first load's scripts did. The runner sees this from the addresses `readCart` asks for, so a store declares nothing.
- **No store skips it outright**, because none yet reads a page that has had this long. Pololu reads about 300 ms after a load, McMaster reads once its lines have held still for 1 second, and Home Depot and Ali Express read once rows have held still for 1.5 seconds. A store that read only after 3 seconds could skip it, but that wait would then be on every read of every line. The cost as it is: about 3 seconds and one page load per store.

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
- **`resolveLine`** throws `LineProblem` when this one order can't be added, and the store carries on. Set `available: false` to fail a line without trying. Set `soldIn` when the store sells this line only in whole multiples above 1, and the runner rounds up to it and flags that.
- **`resultNote`** on a store is one line shown in its results once anything has been added, for something true of its cart as a whole.
- **`readCart`** filters inside the injected function, and hands back only the keys asked for. It also gets called with several keys for the final read, from the store's `cartUrl` page. Compare keys the way the store writes them. Leave out a key that isn't in the cart. Return `{ kind: 'stop', reason, detail }` from anything that isn't the page you expected, and never guess zero from a page you can't recognize. People read `detail` as "What it saw", so make it plain, fixed words, never anything read from the page.
- **`addLine`** asks once. It doesn't decide the outcome: the runner reads back. Throw `LineProblem` with the store's own words for a refusal, and read back still happens. Add `notSent: true` to a stop only when nothing can have reached the store.
- **Pages that draw themselves after loading:** the check after each load runs too soon to see a wall they draw later. Wait in your injected function for the page you expect or a wall, whichever comes first, using what a person can see (`innerText`), as `mcmasterReadCart` does. Text in scripts or hidden markup misled that check once.
- **Page controls:** only ever act on the one control you named, by its exact label. Refuse anything whose label or address mentions checkout, buy, pay or placing an order. Set `foreground: true` if a page won't work behind other tabs.
- **Never:** answer a challenge, type into a sign-in, retry past a refusal, set a user agent, read `document.cookie`, or send anything to another host.

### Testing a store

Test the injected functions in jsdom against a synthetic page, including one with other lines in the cart, a wall and an unexpected page. Then add the store to `e2e/carts.live.mjs` and check it live: one real item, in a throwaway profile, using Edge or Chrome, and stop at any wall. Report what you saw, including the read-back, as evidence. A store isn't accepted on synthetic tests alone.

## Evidence

All tested 2026-11-09, live, in throwaway Edge profiles that were deleted afterwards, signed out. "Built extension" means the whole extension with a simulated plugin. REV, Pololu, WCP and nine more stores have now run that way, each with one cheap item and a second build. BambuLab, Amazon, Online Metals, Harbor Freight, PowerWerx, Home Depot, Ali Express and McMaster aren't run from automated profiles, because bot checks and walls appeared there. They're for the owner's browser. `npm run e2e:carts` uses synthetic copies of seven stores, including Home Depot, Ali Express and AndyMark's cart page rule.

Those eight then had their first real run, on 2026-11-09, through version 0.7.0 in the owner's signed-in Chrome. Home Depot worked end to end. PowerWerx's add landed. The others stopped at a read or a check, and version 0.7.1 changes those from what the pages showed, with fixtures in `tests/carts/real-run.test.ts`. **Version 0.7.1 itself hasn't run on a real store**, so "fixed" below means on synthetic copies of the real markup.

| Store | Badge | Method | How it ran | Result |
|---|---|---|---|---|
| REV | Direct | `/cart.php?action=add&sku=&qty=` in the tab, read back from `/api/storefront/carts` | Built extension | Real add confirmed, quantity 2. Retry added nothing. |
| Pololu | Item by item | `/cart` Quick add `quick_add`, lines like `2136,2`, read from the cart rows | Built extension | Real add confirmed, quantity 2. Discovery confirmed that adds accumulate. Retry added nothing. |
| WCP | Direct | `/products/<handle>.js`, `/cart.js`, `POST /cart/add.js`, `/cart.js` | Built extension | Real add confirmed, quantity 2, with a saved `?variant=` and a confirmed SKU. Retry added nothing. |
| McMaster | Item by item | `/orders/` paste box, its Add, then the line's part and quantity boxes | Owner's Chrome, 0.7.0, and one line by hand | **Unproven through 0.7.1.** The run typed in the wrong box, the page's feedback box, so nothing reached the store. By hand, the real paste box and Add added a line, which showed the shapes this now uses. |
| Ambrosia Filament | Direct | Shared Shopify method | Built extension | Real add confirmed, quantity 1, SKU `AMB4605STAREF`. Retry added nothing. An earlier script run got `429` from rapid requests outside a browser. |
| AndyMark | Direct | Shopify, with a required SKU matched inside the link's product, because SKUs repeat across products | Built extension | Real add confirmed, quantity 1 of `am-1417` (sold in 1s), with no flag, and the retry added nothing. Quantity 1 of `am-1775` (sold in 25s) sent 25, and the cart read back 25 after the store's own `/cart` page ran. The results flagged it as rounded up, it was marked at quantity 1, and the retry added nothing. A request of 30, which rounds to 50, is synthetic only. See below. Bundles and a real repeated SKU are synthetic only. |
| CTRE | Direct | Shared Shopify method | Built extension | Real add confirmed, quantity 1, SKU `WCP-1508`. Retry added nothing. An "(8-Pack)" item was not added live. |
| FerrulesDirect | Direct | Shared Shopify method | Built extension | Real add confirmed, quantity 1, SKU `FDSPP6`. Retry added nothing. |
| SDS | Direct | Shopify, with the variant from the saved link or an exact title in the description, because its variants have no SKUs | Built extension | Real add confirmed, quantity 1, from a saved `?variant=`. Retry added nothing. Choosing by title on the real MK5n module was read-only, from a script. |
| Thrifty Bot | Direct | Shared Shopify method. A pack's quantity is packs | Built extension | Real add confirmed, quantity 1 pack, SKU `TTB-0004`. Retry added nothing. A "Pre-Order:" item was not added. |
| V-Belt Guys | Direct | Shared Shopify method, always matched inside the link's product | Built extension | Real add confirmed, quantity 1, SKU `AK26.5`. Retry added nothing. |
| West3D | Direct | Shopify, plus a page check that refuses kits with custom options | Built extension | Real add confirmed, quantity 1, SKU `QID2573`. Retry added nothing. A real kit with options was refused with nothing added, from a script earlier. The 4.5 second wait for the options is a guess. |
| Swyft | Item by item | The product page's own options, + control and Add to Cart, read back from the site's `swyft.cart.v2` in localStorage | Built extension: quantity 1 and a retry. Store code from a script: the rest | Real add confirmed through the built extension, quantity 1, and the retry added nothing. From a script earlier: quantity 3, top-ups to 5 and 7, each matching the site's own cart page, and eight refusal cases on real pages that added nothing. A live test found a race that restored an old count while the server kept the add, so Add now waits for the page's on-load answer. The tab comes to the front. |
| BambuLab | Item by item | `?id=` link, published option list, main quantity box, Add to Cart, read back from the `/cart` row | Owner's Chrome, 0.7.0. Raw probes earlier | **Unproven through 0.7.1.** The run refused the line in a window under about 1000px wide, where the quantity box is hidden. Two raw adds landed at quantity 1 earlier. A Cloudflare check on every page stopped that testing. |
| Amazon | Item by item | Add link, its confirm button when shown, then the cart page's rows and `#sc-subtotal-label-buybox` | Owner's Chrome, 0.7.0 | **Unproven through 0.7.1.** The first read stopped at a renamed subtotal, so the add link and confirm page still haven't been seen. A signed-out browser reaches a sign-in, which `amazonWall` stops at. |
| Online Metals | Item by item | The length radio matching the SKU, the quantity, Add To Cart, then `/en/cart` | Owner's Chrome, 0.7.0, and one add by hand | **Unproven through 0.7.1.** `/en/cart` loads signed in, and the run stopped on its empty-cart wording. By hand, the radio and Add To Cart added a line, which showed the filled cart's form. A fresh browser gets Cloudflare's `403` there. |
| Harbor Freight | Item by item | `/search?q=<SKU>`, confirm the product, its quantity box and Add to Cart, then `/checkout/cart` | Two looks, from a script. Not in the owner's first run's results | **Unproven.** One run crashed with no report, and the next got a `403` Press & Hold bot check on the home page. Search, product and cart pages were never seen, and nothing was added. Its row wasn't in the first real run's results. Nothing in the code drops a valid row, and an unticked one is now listed under Not in this build. |
| PowerWerx | Item by item | Quick Entry: paste `SKU, quantity`, Match Items, the grid's add button, then the review window's add button | Owner's Chrome, 0.7.0 | **The add is proven, the read-back isn't.** Paste, Match Items and both add buttons worked through this code, and the item landed. The read of `/cart` then stopped on the row's SKU. That's fixed for the shape seen, and the read-back hasn't run since. A fresh browser gets a Cloudflare challenge at the match. |
| Home Depot | Item by item | The product page's own quantity box and Add to Cart, then the `/cart` rows | Owner's Chrome, 0.7.0 | **Proven end to end.** The line was added once and flagged Delivery, as designed. A fresh automated profile gets a `403` "Oops" page, which stops the store. |
| Ali Express | Item by item | The option named in the request, the quantity box and Add to cart, then the cart page's rows | Owner's Chrome, 0.7.0, and one add by hand before that | **Unproven through 0.7.1.** The run refused the line because the price selector matched nothing, though the option's shape was as expected. The add and cart read haven't run through this code. Automated profiles got robot checks. |

Short stock, a store's refusal, walls other than those named above and the checkout rule are proven only on synthetic pages, so they haven't been seen from a real store.

### Things to know about particular stores

- **McMaster's order page has two text boxes.** The feedback box, `#message-input`, comes first in the document. This types only in `#bulk-lines-textarea`, and stops if that's absent. A line isn't text. It's `.line-part-number-input` and `.line-quantity-input`, matched by the number ending their ids, and `new-line-...` rows never count. A Merchandise total above $0.00 with no lines can't read as an empty order, so that waits, then stops.
- **BambuLab in a narrow window** (this code's choice, for the owner to check): under about 1000px wide, there's one Add to Cart on a bottom bar and the main quantity boxes are hidden, with more than one of them. This uses only the hidden box in the button's own form. If the button has no form, or the form holds no such box or several, the line fails with nothing pressed. A quantity above 1 is set in that hidden box with the usual events, and refused if it doesn't stay. It also still needs the page's "Selected ... × N" summary when a product has options.
- **Harbor Freight's pickup or shipping choice** (owner decision, 2026-11-09): a choice that's already selected is kept and never changed, and the line is flagged with the choice's name if the add lands. A choice with nothing selected fails the line. So does a store or ZIP prompt, including an empty ZIP box beside Add to Cart. A line reported as short stock or a quantity mismatch has its own flag, which doesn't name the choice.
- **Home Depot's pickup or delivery choice** (owner decision, 2026-11-09): the same rule. A selected `deliveryTile` or `pickupTile` is kept and named in the flag, and neither tile is ever clicked. Neither selected, both selected, no tiles at all, or a store or ZIP prompt fails the line. Option pills saying "Please Select" can sit beside a selected one, so they aren't read: the page's own button has to be enabled, and the read-back decides. How a tile shows it's selected wasn't seen, so this looks for `aria-pressed`, `aria-checked`, `aria-selected`, `aria-current`, `data-selected` or a checked input. If the real tile uses none of those, every line fails with "no pickup or delivery choice selected", with nothing added.
- **Home Depot's cart rows load late, and Saved For Later is on the same page.** A read waits until the rows stop changing and agree with the header's cart count, either as rows or as units. If they never agree, the store stops instead of reading a wrong zero. A row under the "Saved For Later" heading, or one offering "Move to Cart", doesn't count. A row under that heading still offering "Save For Later" stops the store.
- **Ali Express's option** (owner decision, 2026-11-09): a line goes ahead only when its description exactly names a listing option, which is how the reader saves it: `Title - Size: 0.8mm (5Meter) / Color: Black`. Letter case counts, and words merely inside a title don't. No match, two matches in one row, or a sold-out match fails the line with nothing clicked. Two choices are this code's own, for the owner to check: a row with one option, already selected, needn't be named, and a listing with no options at all has nothing to match. An option already selected isn't clicked, because a second click can undo it.
- **Ali Express's cart rows** are matched on both the listing and the option, because one listing can hold several options in a cart. A row of the listing that names none of its known options could be this line written differently, so it stops the store instead of reading as zero.
- **Ali Express ticks a newly added item for checkout by itself.** Nothing here touches those ticks, and the results say so.
- **Ali Express is USD only.** A price that isn't `$` or `US $` fails the line, checked before reading the cart and again once the option is selected. Builds always use the `.us` listing, whichever site the link was saved from.
- **AndyMark's cart page can change a quantity on its own.** Seen on `am-1775`, a $0.05 screw: `/cart/add.js` accepted quantity 1 and `/cart.js` read 1. About a second after `/cart` next loaded, the page's own script sent `/cart/update.js` with `{"updates":[25]}`, and the cart held 25. A build now sends the multiple itself, as below, so the page has nothing to change. If the value can't be read, the quantity goes as asked and the final read catches a change in the same build: the line is flagged, naming both numbers, with no mark. The extension doesn't change it back, because that's for the person to decide in the cart. A later build adds nothing, says the cart already holds more than was asked for, and doesn't mark it either.
  - **The cause** is AndyMark's theme. `roundAndApplyAutomaticCodes` in `empire.min.js` runs when the cart page loads and sends every line through `max(floor(quantity / n) * n, n)`, where `n` is that variant's `orderedInQuantity`, read from `#variant_metafield_data` on the page. So 1 becomes 25, and 30 would go down to 25. It then posts `/cart/update.js` once for the quantities and once for discount codes.
  - **It depends on the item's own setting**, not its price or the cart's total: neither is in that code. `am-1775` at $0.05 went to 25 ($1.25), and `am-1552_black` at $0.08 went to 100 ($8.00), in the same cart.
  - **How often:** 181 of 1,970 products carry the tag `Ordered In Quantity Higher Than One`: 91 of 125 under $0.25, 86 of 219 from $0.25 to $1, 4 of 447 from $1 to $5, and none of 1,179 at $5 or more. The tag misses some, because `am-1775` doesn't have it. In a read-only sample of 40 product pages, 36 showed a value. The 9 above 1 were all under $1 (10 or 25), and the 21 at $1 or more all showed 1. It's mostly small hardware, which is a large share of what a team orders. The rest of the catalog isn't checked.
  - **A build rounds up and flags it** (owner decision, 2026-11-09, replacing an earlier refusal). `andymarkOrderedIn` reads the chosen option's value from `#variant_metafield_data` on the product page, with a fetch that leaves the tab where it is. The target is the smallest multiple at or above the request. At multiples of 25, 1 sends 25, 30 sends 50, because the store's own rule would leave the team short at 25, and 25 sends 25 with no flag. The results put a rounded line in its own highlighted group, with a pill and a line in the summary: "AndyMark sells this in multiples of 25, so the cart holds 25, not the 1 requested." The estimate on the orders screen is still the requested quantity, because the value is only read during a build. A missing or unreadable value sends the quantity as asked, and the final read still catches a change. The rest of the read-before, read-after and wall rules are unchanged.
  - **Retries:** the target doesn't depend on what's in the cart, so a second build finds 25, adds nothing, and stays flagged as rounded. It isn't reported as a mismatch.
  - **Marks:** a rounded line is marked for the order at its requested quantity, so a teammate doesn't buy it twice. The final read can still take that away. A cart holding more than the rounded amount adds nothing and has no mark, as with any other store. The mark's quantity shows the order's own number, so a row can say "qty 1" for a cart that holds 25.
  - **Two orders of one part** (this code's choice, for the owner to check): the build rounds their total, not each order, so it never buys a multiple it doesn't need. Orders of 1 and 1 add 25 once, orders of 10 and 15 add 25 once, and orders of 20 and 10 add 25 twice, reaching 50. Every order on a rounded line is flagged with the one total: "The 2 orders for this part total 2, so the cart holds 25 for them together." A retry of both adds nothing and marks both. A later build of a new order of 1, with 25 already in the cart, adds nothing and says so, because a retry can't be told from an earlier cart. A later order the cart can't cover, such as 30 with 25 there, adds another multiple and flags it. So does a whole-multiple order beside a rounded one: 25 and 1 reach 50.
- **Swyft keeps a separate cart on each host.** `www.swyftrobotics.com` doesn't redirect to `swyftrobotics.com`, and each keeps its own cart in the browser. Builds and the "Open Swyft cart" link always use `swyftrobotics.com`, so lines someone added on `www.` won't show there, and a build can't see them.
- **Swyft's read-back is the browser's copy of the cart.** A difference on the server from any cause other than the race above wouldn't show.
- **Amazon's total:** `amazonReadCart` also hands the page the active cart's total unit count, to catch an add landing under another ASIN. It stays in memory and never goes to the plugin.
- **Amazon's rows:** a real cart had 3 active rows and 10 saved, all `.sc-list-item[data-asin]` with `data-itemtype`. Saved rows don't count, by that attribute and by `#sc-active-cart`. The real page's label is `#sc-subtotal-label-buybox`, and `#sc-subtotal-label-activecart` stays as a fallback.
- **PowerWerx's cart row** writes its SKU as `SKU: <sku>` in `.apt-row-sku`, compared exactly once that prefix is off. The price cell's markup wasn't seen, so a row without `[data-unit-price]` has no price, and a changed price can't be flagged there.

The API is checked separately: the built extension against the `carts-backend` plugin on real Core and D1 in a local preview, with Notion stubbed and stores synthetic. Pairing, the real `/orders` list including a real `202`, `skippedRows`, another device's mark, this device's marks, the Admin's switch and its `403` all passed. Core's Pages proxy was stood in for there, because the preview had no port for it.

### What the owner needs to check in a signed-in browser

Use one cheap item, and remove it afterwards. Any mismatch below should stop the store or fail the line, not add the wrong thing. Tell the coordinator what each page does.

1. **McMaster:** build one cheap part, then build again. The second build should add nothing. Does the line read back from its boxes, and only from the paste box's own Add? Is the paste box still open for a second line, or does the opener come back? Does a page with lines hold the same shapes after a reload? Any mismatch stops the store and says what it saw, with nothing added beyond what's flagged.
2. **Amazon:** one in-stock item, quantity 2, with the cart otherwise empty.
   - **Add link:** does it show a confirm page or add straight away, and is a link with no associate tag accepted?
   - **Signed-in re-prompt:** the redirect carries `max_auth_age=3600`, so an account signed in over an hour ago may be asked for its password again. It should stop there. Note how often, because it could make Amazon mostly a checklist.
   - **Confirm page:** the button's exact label (only "Add to Cart" variants are accepted), the page's address, and whether the form itself holds the ASIN as `ASIN.1`, `data-asin` or a `/dp/` link. After the press, which address does it land on? Accepted: `/gp/cart/view.html`, `/cart/...` and `/gp/huc/...`.
   - **Rows:** seen: `.sc-list-item[data-asin]` with `data-quantity`, `data-price` and `data-itemtype`, and `#sc-subtotal-label-buybox` reading "Subtotal (3 items):". Not seen: whether the rows sit inside `#sc-active-cart`, because the first read stopped before saying. If they don't, a cart with items stops the store as "a cart page this could not read".
   - **Build twice:** the second build should add nothing. Also try a cart with other items, and one with an item unticked.
   - **Parent ASIN:** does a parent or variation link get refused, or land under a child ASIN? The second should stop and flag. A further build could then add it again, so check the cart first.
   - **Seller and tabs:** a link's seller isn't carried over, so check the seller in the cart. Does the flow work behind other tabs?
3. **Online Metals:** build one cheap length. The empty cart and the filled cart's form were seen, but not through this code. Is the quantity input inside `updateCartForm0`? If it's elsewhere on the page, this accepts only a box tied to that form or the one box beside it. Does the page's script accept this flow's radio and quantity, and what does the button do when it reads "Item In Cart"? Its terms and `agents.md` answered `403`, so they are unread.
4. **Harbor Freight:** tick it, and see that it appears in the results, as a card or under Not in this build. Does a real browser get past the bot check at all? Check the search redirect, the "SKU n" wording, the "Add to Cart" label, the quantity box's name, the cart rows and the empty-cart wording, all guessed from the research. Does `/checkout/cart` load at exactly that address? A redirect that adds anything to it stops the store. If the Add to Cart form posts to an address with "checkout" in it, such as `/checkout/cart/add`, the store stops and that rule needs a decision. Does a preselected pickup or shipping choice show the flag? Does the cart page say "sign in to continue", which would stop the store by mistake? Short stock may show as "quantity box would not take n". Its terms answered `403`, so they are unread.
5. **PowerWerx:** remove the earlier test line, then build one cheap part twice. The add has worked, so this is about the read-back: does `/cart` read as added, and does the second build add nothing? What does the price cell look like, so a changed price can be flagged? Its terms and `agents.md` answered `403`, so they are unread.
6. **BambuLab, one full live run:** once any Cloudflare check has cleared, build `https://us.store.bambulab.com/products/pla-basic-filament?id=40475106771080`, quantity 2, twice, in a wide window and in one under 1000px. The quantity box only commits on input, change and focusout together, and the store refuses to press Add unless the page's own summary shows ×N, so a wrong quantity should fail the line. In the narrow window, is the bottom bar's Add to Cart inside a form with one main box? Does a hidden box take 2, and is 2 what lands? If 1 lands, it reads as short stock. Check that the second build adds nothing, that longer product names match their cart rows, and whether single-option products show the summary.
7. **Home Depot, after its first signed-in run, which added once and flagged Delivery:** build the hex nut, `https://www.homedepot.com/p/Everbilt-1-4-in-20-Zinc-Plated-Hex-Nut-801736/204647886`, quantity 2, then build again. The second build should add nothing.
   - **Opening in the extension's tab:** do `/cart` and the product page load with no "Oops" page? If they do show it, the store stops, which is right, and it may need to stay a checklist.
   - **Lazy cart rows:** with something else already in the cart, does the read wait for all the rows? Does `header-cart-count` count rows or units, and does it agree with what's on the page? If it never agrees, the store stops as "a page this didn't expect". An add may already have landed, so look at the cart.
   - **Saved For Later:** save the hex nut for later, then build it. It should add a new line and report added, not "already in the cart". Check the "Saved For Later" heading's exact wording, and whether those rows carry `data-component^="cart-item:CartItem"`.
   - **The choice:** does the flag name Delivery? Try an item with Pickup selected. What attribute shows a tile is selected? If none of those listed above, every line fails with "no pickup or delivery choice selected", and that needs a one-line fix.
   - **A prompt:** does a store or ZIP prompt fail the line with nothing added? Does the empty-cart page read as empty?
   - **The panel:** did it press only the page's own button, with nothing under "Don't Forget These"? Were two `add-to-cart` blocks ever on one page? That refuses the line.
   - **Prices:** does the toolbar popup capture 14 ¢ as $0.14 on the hex nut, and $2.97 on a normal item? A person has still to read the Terms of Use.
8. **Ali Express, the first run that gets past its price:** use the $0.46 item, `https://www.aliexpress.us/item/3256802967050384.html`, with a request saved from the toolbar, quantity 2, then build again. The second build should add nothing. The price is seen in a `price-default--current...` class, and this reads the option rows from `[data-sku-row]` and `[data-sku-col]`. If those aren't on the page, the line fails with nothing added.
   - **The description:** does the toolbar save the option the way this needs, as in `... - Size: 0.8mm (5Meter)`? If not, every line with options fails with "doesn't exactly name", and that needs a fix before it's useful.
   - **Selecting:** does the option get selected and stay selected, and does `[class*="selected"]` show it? Is one option at a time the only thing that reads as selected?
   - **Quantity and press:** does the box take 2? Is there only one visible "Add to cart", with no sticky copy? Two refuses the line. Buy now must stay untouched.
   - **Timing:** there's no dialog after adding, so this waits 3 seconds before leaving the page. Did the add land every time?
   - **Rows:** add two options of the listing. Are they counted apart? Is the option in the row's text? A row where it isn't stops the store. Does `Cart (N)` count rows or units, and is it where this looks, in the page title or a heading?
   - **Ticks:** the new item comes up ticked, others stay as they were, and the results say so.
   - **Walls:** does a robot check or sign-in stop the store? How often does one appear? Does a saved `.com` link or `sku_id` cause any trouble?
   - Remove the item afterwards with the row's trash icon and "Remove". That's by hand: nothing here removes anything.
9. **Real sign-ins:** a signed-in account at the stores that passed signed out, to see that a saved cart reads back the same way.
10. **AndyMark's "ordered in" quantities:** build a small screw, quantity 1. The cart should hold 25, the results should say "AndyMark sells this in multiples of 25, so the cart holds 25, not the 1 requested", and building again should add nothing. Does the cart page keep it at 25? If an item's value can't be read and its quantity still changes on the cart page, the results flag it and the extension doesn't change it back, so the quantity is the person's to fix in the cart before ordering.
11. **Chrome itself:** these ran in Edge. Chrome 137 and newer ignores `--load-extension`, so automation can't load it there. Load `dist` by hand and repeat one store.
