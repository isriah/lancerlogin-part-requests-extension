# Vendor support matrix

The list is fixed in `src/vendors.ts`. Every row has a passing fixture. Root, `www`, `m`, and `mobile` shopping hosts are allowlisted for ordinary vendors. BambuLab accepts only its US store host and its `www` equivalent; CTRE accepts only its store host and its `www` equivalent. Unrelated subdomains and lookalike domains are rejected. The Other option is never mapped.

Live checks dated **2026-09-21** read the current product DOM in Chrome and executed the product reader. Values below are observed test examples, not current purchasing quotes. Installed-extension toolbar acceptance remains pending for every vendor.

Rechecked **2026-11-08** with the current reader:
- **West3D:** the store now publishes a ProductGroup plus a base product, which the reader wrongly reported as several products. Fixed; selected variant captured as LDO0803, $1,199.
- **Ali Express:** US shoppers land on `aliexpress.us`, which is now allowlisted. Real item pages captured title, price and USD; SKU stays blank. Still needs a toolbar check.
- **Ambrosia Filament, BambuLab:** captured correctly, but the default variant differs from the example below.
- **McMaster:** a toolbar request in a normal Chrome session captured every field correctly. A fresh automated profile gets no part details, so check on a new student's browser during rollout.
- **Home Depot:** the old price selectors no longer match, and product metadata ($1.18) disagreed with the displayed price ($2.97). The reader now uses the displayed price and never falls back to metadata for this store. The automated profile gets an error page, which is now reported as blocked.
- **Amazon:** the automated profile got a challenge page. A normal Chrome session shows the product and the elements the reader uses ($11.98).
- **WCP:** still correctly requires checking one part first.
- All other vendors: the captured price was compared with the price displayed on the live page and matched.

| Exact Notion label | Representative product | Observed extraction / limitation | Live reader |
|---|---|---|---|
| Amazon | [Panel cable](https://www.amazon.com/JSADZKJ-Ultra-Thin-3-1Type-Extension-11-8inch/dp/B0FQNPK1SQ) | ASIN B0FQNPK1SQ; $11.98. Uses the current price's screen-reader text; ignores crossed-out amounts. | Passed |
| Ali Express | Use a real `/item/<id>.html` page during pilot | Synthetic fixture tests selected-option text, price and foreign currency. No real product URL could be verified. Missing SKU is left blank. | **Blocked by site policy** |
| Ambrosia Filament | [PHA filament](https://ambrosiafilament.com/products/ambrosia-pha-filament-1kg-1-75mm-earth-friendly-filament-for-everyone) | Fog White; BEY3628GRE1KG; $34.99. Hidden variant ID matched to published product JSON. | Passed |
| AndyMark | [Robits Hex Shafts](https://andymark.com/products/robits-hex-shafts?variant=44493415678124) | Selected 4 in.; am-5003-0400; $6.30. Unselected $5.30-$11.00 range is left blank. | Passed |
| BambuLab | [P1S](https://us.store.bambulab.com/products/p1s) | P1S AMS Combo; 732843418674327562; $499. Selected card matched to ProductGroup variant metadata. Unresolved selections require manual values. | Passed |
| CTRE | [FIM bundle](https://store.ctr-electronics.com/products/fim-swerve-bundle-2025) | BDL-FIMX2i; sale $1,729.99. Ignores crossed-out $2,033.55. | Passed |
| FerrulesDirect | [FD25P](https://www.ferrulesdirect.com/products/fd25p) | FD25P; $221. Quantity dropdown excluded from the description. | Passed |
| Harbor Freight | [Modular toolbox](https://www.harborfreight.com/modular-2-drawer-toolbox-71125.html) | 71125; $69.99. Uses exact product price metadata. | Passed |
| Home Depot | [15-pack screws](https://www.homedepot.com/p/6-32-x-3-4-in-Combo-Round-Head-Zinc-Plated-Machine-Screw-15-Pack-804322/204282804) | 613302; $2.97 per sold 15-pack on 2026-11-08. Pack quantity remains in description. | Passed |
| McMaster | [Socket head screws](https://www.mcmaster.com/91251A051/) | 91251A051; $21.40 per pack of 50; full part dimensions. Open the individual part-number link, not a search or catalog table. | Passed |
| Online Metals | [Aluminum angle](https://www.onlinemetals.com/en/buy/aluminum/0-5-x-0-5-x-0-062-aluminum-angle-6063-t52/pid/17854) | Selected 12-inch length; 17854_12_0_DV; $3.15 each. Custom cuts without a selected stock length require manual description/price. | Passed |
| Pololu | [Current sensor](https://www.pololu.com/product/5780) | 5780; $19.95. Product offer metadata excludes unrelated comparison prices. | Passed |
| PowerWerx | [QUADcrimp](https://powerwerx.com/quadcrimp-quick-swap-powerpole-crimping-tool) | QUADcrimp; $59.99. Product-specific SKU and price scope. | Passed |
| REV | [NEO 550](https://www.revrobotics.com/rev-21-1651/) | REV-21-1651; $30. BigCommerce product/options scope. | Passed |
| SDS | [MK5n module](https://www.swervedrivespecialties.com/products/mk5n-swerve-module) | Kraken X60 / Molded Spike Grip / Unassembled; $395. No confirmed SKU; blank is intentional. | Passed |
| Swyft | [SWYFT Servos](https://www.swyftrobotics.com/motion/swyft-servos) | Speed V1.1: SR-Servo-01, $54.99. Switching to Servo Programmer USB Dongle changed capture to SR-Servo-10, $12.99 and preserved the variant query. | Passed |
| Thrifty Bot | [Pulsar 775](https://www.thethriftybot.com/products/pulsar-775) | TTB-0350; $60; retains pre-order title. | Passed |
| V-Belt Guys | [6515271 belt](https://www.vbeltguys.com/products/6515271-bobcat-oem-equivalent-variable-speed-belt) | VBL15167 air 2926V616 AIR 2926V616; sale $67.64. Handles duplicate review/product metadata. | Passed |
| WCP | [#25 sprockets](https://wcproducts.com/products/25-sprockets) | Check exactly one part: WCP-1019, 10t Steel Double Hub, $9.99. Zero or multiple selections block capture. No cart action needed. | Passed |
| West3D | [LDO Trident](https://west3d.com/products/ldo-trident-kit) | 250mm Black; LDO0803; $1,199. Captures kit option labels. Changed custom kit add-ons require manual configured price; review sorting is ignored. | Passed |

## Maintaining adapters

1. Open a representative product in Chrome and select the intended variant. Inspect the rendered product heading, selected controls, active price, SKU, and published Product/Offer metadata. Do not read account information, cart contents, cookies, or private application state.
2. Add a sanitized reduced DOM fixture with its real representative URL and exact expected fields. Reproduce the selection state with `selected` or `checked`; exclude unrelated product recommendations and personal data. Label synthetic fixtures clearly.
3. Update that vendor's selector configuration or add a narrowly scoped branch in the self-contained reader. Prefer visible product-specific controls for variant selection. Treat ranges, installments, conflicting products, unknown currencies, and uncertain SKUs as missing values.
4. Preserve the original browser URL, including query parameters and fragments. Never swap in canonical metadata that loses the selection. Test a changed variant and missing metadata, not only the default page.
5. Run `npm run check`, reload the unpacked extension, and compare a fresh toolbar capture against the live page. Update the matrix with date, URL, observed fields, and outstanding constraints.

Adding a Vendor option in Notion cannot enable a new website. A code change, explicit host allowlist entry, adapter fixtures, and a live check are required. Do not extend selectors to search results, carts, or unrelated metadata simply to obtain a non-empty price.
