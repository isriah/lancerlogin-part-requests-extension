// Small synthetic copies of six stores, routed at their real addresses so no request leaves the computer. Each keeps a cart and a log.
// What the pages look like comes from the research and from live checks of REV, Pololu and WCP. McMaster's copies the shapes seen in the owner's signed-in
// browser, including the feedback box that comes first in the document, but passing here still says nothing about the real page.
const page = (title, body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;
const LOGIN = page('Log in', '<h1>Log in</h1><p>To continue browsing, please log in</p><input type="email"><input type="password"><button>Log in</button>');
const CHALLENGE = page('Just a moment...', '<h1>Checking your browser</h1><div id="challenge-stage" style="width:300px;height:80px">Verify you are human</div>');

export function createStores() {
  const state = {
    log: [], checkoutHits: [], addTimes: [],
    wcp: { cart: new Map(), stock: new Map(), mode: 'ok', products: new Map() },
    rev: { cart: new Map(), stock: new Map(), mode: 'ok', known: new Set(['TEST-3001', 'TEST-3002', 'TEST-3003']) },
    pololu: { cart: new Map(), mode: 'ok' },
    mcmaster: { cart: new Map(), mode: 'ok' },
    homedepot: { cart: new Map(), mode: 'ok', otherPresses: 0 },
    aliexpress: { cart: new Map(), mode: 'ok', otherPresses: 0 },
    andymark: { cart: new Map(), mode: 'ok' },
    reset() {
      this.log.length = 0; this.checkoutHits.length = 0; this.addTimes.length = 0;
      for (const store of [this.wcp, this.rev, this.pololu, this.mcmaster, this.homedepot, this.aliexpress, this.andymark]) { store.cart.clear(); store.mode = 'ok'; store.stock?.clear(); }
    },
    adds() { return this.log.filter(entry => entry.add); },
  };
  state.wcp.products.set('test-hex-shaft', { variants: [{ id: 1001, sku: 'WCP-1001', price: 630, available: true }, { id: 1002, sku: 'WCP-1002', price: 730, available: true }] });
  state.wcp.products.set('test-wheel', { variants: [{ id: 2001, sku: 'WCP-2001', price: 950, available: true }] });
  state.wcp.products.set('test-sold-out', { variants: [{ id: 3001, sku: 'WCP-3001', price: 950, available: false }] });

  const note = (store, request, extra = {}) => { const entry = { store, method: request.method(), url: request.url(), at: Date.now(), ...extra }; state.log.push(entry); if (extra.add) state.addTimes.push(entry.at); return entry; };
  const html = (route, body, headers = {}) => route.fulfill({ status: 200, contentType: 'text/html', headers: { 'Set-Cookie': 'synthetic_store_session=secret-store-cookie; Path=/', ...headers }, body });
  const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'text/javascript; charset=utf-8', body: JSON.stringify(value) });
  const wall = (route, mode) => mode === 'login' ? html(route, LOGIN) : mode === 'challenge' ? html(route, CHALLENGE) : null;
  const checkout = (route, store) => { state.checkoutHits.push(`${store} ${route.request().url()}`); return html(route, page('Checkout', '<h1>Checkout</h1>')); };

  // AndyMark's product data and cart page, as live checks saw them: each variant's "ordered in" value sits in the product page, and the cart page's own
  // script sends every line through max(floor(quantity / n) * n, n) when it loads. This one's values are synthetic.
  const AM_SOLD_IN = { 7001: 25, 7002: 1 };
  async function andymark(route) {
    const request = route.request(), url = new URL(request.url()), s = state.andymark;
    if (/checkout/i.test(url.pathname) || /^\/cart\/\d+:\d+/.test(url.pathname)) return checkout(route, 'andymark');
    if (url.pathname === '/cart/add.js' && request.method() === 'POST') {
      const body = request.postDataJSON();
      note('andymark', request, { add: true, body });
      const [{ id, quantity }] = body.items;
      s.cart.set(id, (s.cart.get(id) ?? 0) + quantity);
      return json(route, { items: [{ id, quantity }] });
    }
    if (url.pathname === '/cart/update.js' && request.method() === 'POST') {
      const { updates } = request.postDataJSON();
      const moved = [...s.cart.keys()].some((id, index) => s.cart.get(id) !== updates[index]);
      note('andymark', request, { pageUpdate: true, moved });
      [...s.cart.keys()].forEach((id, index) => s.cart.set(id, updates[index]));
      return json(route, { items: [] });
    }
    note('andymark', request);
    if (url.pathname === '/cart.js') return json(route, { items: [...s.cart].map(([variant_id, quantity]) => ({ variant_id, quantity, price: variant_id === 7002 ? 40 : 5, title: 'A synthetic line' })) });
    if (url.pathname === '/products/test-screw.js') return json(route, { handle: 'test-screw', variants: [{ id: 7001, sku: 'AM-TEST-25', price: 5, available: true }, { id: 7002, sku: 'AM-TEST-1', price: 40, available: true }] });
    if (url.pathname === '/products/test-screw') return html(route, page('A test screw', `<h1>A test screw</h1><script id="variant_metafield_data" type="application/json">{ ${Object.entries(AM_SOLD_IN).map(([id, n]) => `"${id}" : { "availabilityText": "", "orderedInQuantity": "${n}", "maxPerOrder": "0" }`).join(' , ')} }</script>`));
    if (url.pathname === '/cart') return html(route, page('Your cart', '<h1>Your cart</h1>', `fetch('/cart.js').then(reply => reply.json()).then(({ items }) => { if (items.length) fetch('/cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates: items.map(item => { const n = ${JSON.stringify(AM_SOLD_IN)}[item.variant_id]; return Math.max(Math.floor(item.quantity / n) * n, n); }) }) }); });`));
    return route.fulfill({ status: 404, contentType: 'text/html', body: 'Not found' });
  }

  async function wcp(route) {
    const request = route.request(), url = new URL(request.url()), s = state.wcp;
    if (/checkout/i.test(url.pathname) || /^\/cart\/\d+:\d+/.test(url.pathname)) return checkout(route, 'wcp');
    if (url.pathname === '/cart/add.js' && request.method() === 'POST') {
      const body = request.postDataJSON();
      note('wcp', request, { add: true, body });
      if (s.mode === 'block-add') return route.fulfill({ status: 403, contentType: 'text/html', body: 'Forbidden' });
      const [{ id, quantity }] = body.items;
      const held = s.cart.get(id) ?? 0, stock = s.stock.get(id) ?? Infinity;
      if (held >= stock) return json(route, { status: 422, description: `All ${stock} are in your cart.` }, 422);
      const next = Math.min(held + quantity, stock);
      s.cart.set(id, s.mode === 'double' ? held + quantity * 2 : next);
      return json(route, { items: [{ id, quantity }] });
    }
    // What AndyMark's cart page was seen doing by itself. The extension has no such step, so `pageUpdate` entries come only from the page's script below.
    if (url.pathname === '/cart/update.js' && request.method() === 'POST') {
      const { updates } = request.postDataJSON();
      note('wcp', request, { pageUpdate: true });
      s.cart.set([...s.cart.keys()][0], updates[0]);
      return json(route, { items: [] });
    }
    note('wcp', request);
    if (url.pathname === '/cart' && s.mode === 'wall-after-add' && s.cart.size) return html(route, CHALLENGE);
    if (url.pathname === '/cart' && s.mode === 'raises-on-page' && s.cart.size) return html(route, page('Your cart', '<h1>Your cart</h1>', `setTimeout(() => fetch('/cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates: [25] }) }), 1000);`));
    if (url.pathname === '/cart.js') {
      if (s.mode === 'block-read') return route.fulfill({ status: 429, contentType: 'text/html', body: 'Too many requests' });
      if (s.mode === 'challenge-read') return route.fulfill({ status: 200, contentType: 'text/html', body: CHALLENGE });
      const items = [...s.cart].map(([variant_id, quantity]) => ({ variant_id, quantity, price: 630, title: 'A synthetic line' }));
      items.push({ variant_id: 999999, quantity: 3, price: 1, title: 'Private other line' });
      return json(route, { total_price: 12345, note: 'private cart note', items });
    }
    const product = /^\/products\/([^/]+)\.js$/.exec(url.pathname)?.[1];
    if (product) return s.products.has(product) ? json(route, s.products.get(product)) : route.fulfill({ status: 404, body: 'Not found' });
    return wall(route, s.mode) ?? html(route, page('Your cart', '<h1>Your cart</h1><a href="/checkout">Check out</a>'));
  }
  async function rev(route) {
    const request = route.request(), url = new URL(request.url()), s = state.rev;
    if (/checkout/i.test(url.pathname) || url.searchParams.get('action') === 'buy') return checkout(route, 'rev');
    if (url.pathname === '/api/storefront/carts') {
      note('rev', request);
      const physicalItems = [...s.cart].map(([sku, quantity]) => ({ sku, quantity, salePrice: 30, name: 'A synthetic line' }));
      physicalItems.push({ sku: 'OTHER-LINE', quantity: 1, salePrice: 1, name: 'Private other line' });
      return json(route, [{ email: 'synthetic@example.test', lineItems: { physicalItems, digitalItems: [] } }]);
    }
    if (url.pathname === '/cart.php' && url.searchParams.get('action') === 'add') {
      const sku = url.searchParams.get('sku'), quantity = Number(url.searchParams.get('qty'));
      note('rev', request, { add: true, body: { sku, quantity } });
      if (s.mode === 'login') return html(route, LOGIN);
      if (!s.known.has(sku)) return html(route, page('REV Robotics - Shopping Cart', '<div class="alertBox alertBox--error">Unfortunately this product is not available for purchase.</div><h1>Your cart</h1>'));
      s.cart.set(sku, Math.min((s.cart.get(sku) ?? 0) + quantity, s.stock.get(sku) ?? Infinity));
      // The real store redirects here. Playwright doesn't intercept a redirect's target, which would reach the real site, so this answers in place.
      return html(route, page('REV Robotics - Shopping Cart', '<h1>Your cart</h1>'));
    }
    note('rev', request);
    return wall(route, s.mode) ?? html(route, page('REV Robotics - Shopping Cart', '<h1>Your cart</h1><a href="/checkout.php">Check out</a>'));
  }
  const polCart = s => page('Pololu - Shopping Cart', `<div id="content"><table>${[...s.cart].map(([n, q]) => `<tr class="cart-product"><td class="name"><a href="/product/${n}">#${n} Test part</a></td><td class="quantity"><input name="1J${n}[quantity]" type="number" value="${q}"></td><td class="product-info price">$15.95</td></tr>`).join('')}</table>
    <form action="/checkout" method="post"><input type="hidden" name="session_id" value="abc"><button type="submit">Checkout</button></form>
    <form action="/cart/update" method="post"><textarea name="quick_add" style="display:none"></textarea><input type="hidden" name="session_id" value="abc"><button type="submit" name="Add to cart" value="Add to cart" style="display:none">Add to cart</button></form></div>`);
  async function pololu(route) {
    const request = route.request(), url = new URL(request.url()), s = state.pololu;
    if (/checkout/i.test(url.pathname)) return checkout(route, 'pololu');
    if (url.pathname === '/cart/update' && request.method() === 'POST') {
      const line = new URLSearchParams(request.postData() ?? '').get('quick_add') ?? '';
      note('pololu', request, { add: true, body: line });
      const [number, quantity] = line.split(',');
      s.cart.set(number, (s.cart.get(number) ?? 0) + Number(quantity));
      // As above: the real store redirects to /cart.
      return html(route, polCart(s));
    }
    note('pololu', request);
    if (s.mode === 'unexpected') return html(route, page('Scheduled maintenance', '<h1>Down for maintenance</h1>'));
    return wall(route, s.mode) ?? html(route, polCart(s));
  }
  const mcmLine = ([part, q], index) => `<div><input id="line-part-number-input-${index + 1}" class="line-part-number-input" value="${part}"><input id="line-quantity-input-${index + 1}" class="line-quantity-input" value="${q}"></div>`;
  const mcmNewLine = n => `<div><input id="new-line-part-number-input-${n}" class="new-line-part-number-input"><input id="new-line-quantity-input-${n}" class="new-line-quantity-input"></div>`;
  const mcmCart = s => page('Current Order | McMaster-Carr', `<textarea id="message-input" placeholder="Let us know what you need."></textarea>
    <button id="paste" class="switch-mode-link" type="button">Paste part numbers and quantities</button>
    <div id="box" hidden><textarea id="bulk-lines-textarea" placeholder="3313N116  2"></textarea></div>
    <div id="add-holder" hidden><button id="add" class="button-primary button-add-bulk-lines" type="button">Add</button></div>
    <button id="checkout" type="button">Place Order</button>
    <div id="lines">${[...s.cart].map(mcmLine).join('')}${mcmNewLine([...s.cart].length + 1)}</div>`, `
    document.getElementById('paste').addEventListener('click', () => { document.getElementById('box').hidden = false; document.getElementById('add-holder').hidden = false; document.getElementById('paste').hidden = true; });
    document.getElementById('message-input').addEventListener('input', () => fetch('/synthetic-feedback', { method: 'POST', body: document.getElementById('message-input').value }));
    document.getElementById('checkout').addEventListener('click', () => { location.href = '/checkout'; });
    document.getElementById('add').addEventListener('click', async () => {
      const value = document.getElementById('bulk-lines-textarea').value;
      const answer = await (await fetch('/synthetic-add', { method: 'POST', body: value })).json();
      document.getElementById('lines').innerHTML = answer.map(([part, q], index) => '<div><input id="line-part-number-input-' + (index + 1) + '" class="line-part-number-input" value="' + part + '"><input id="line-quantity-input-' + (index + 1) + '" class="line-quantity-input" value="' + q + '"></div>').join('') + '<div><input id="new-line-part-number-input-' + (answer.length + 1) + '" class="new-line-part-number-input"><input id="new-line-quantity-input-' + (answer.length + 1) + '" class="new-line-quantity-input"></div>';
      document.getElementById('bulk-lines-textarea').value = '';
    });`);
  async function mcmaster(route) {
    const request = route.request(), url = new URL(request.url()), s = state.mcmaster;
    if (/checkout/i.test(url.pathname)) return checkout(route, 'mcmaster');
    if (url.pathname === '/synthetic-feedback') { note('mcmaster', request, { add: true, body: `feedback: ${request.postData() ?? ''}` }); return route.fulfill({ status: 204 }); }
    if (url.pathname === '/synthetic-add') {
      const line = request.postData() ?? '';
      note('mcmaster', request, { add: true, body: line });
      const [part, quantity] = line.split('\t');
      s.cart.set(part, (s.cart.get(part) ?? 0) + Number(quantity));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([...s.cart]) });
    }
    note('mcmaster', request);
    return wall(route, s.mode) ?? html(route, mcmCart(s));
  }
  // Home Depot and Ali Express, from what was seen in a signed-in browser. The cart rows arrive late, as the real ones do.
  const report = (path, body) => `fetch('${path}', { method: 'POST', body: ${body} })`;
  const hdProduct = () => page('Test Hex Nut', `<span data-testid="header-cart-count">0</span><h1>Test hex nut</h1><div data-component="price:Price:v1">14 ¢</div>
    <button data-testid="deliveryTile" aria-pressed="true">Delivery</button><button data-testid="pickupTile" aria-pressed="false">Pickup</button><button>Please Select</button>
    <div data-component="add-to-cart:AddToCart:v1"><input id="qty" type="text" class="sui-input-base-input" value="1"><button id="add">Add to Cart</button></div>
    <aside><button id="rec">Add to Cart</button></aside><div id="panel"></div>`, `
    document.getElementById('rec').addEventListener('click', () => ${report('/synthetic-other', "'rec'")});
    document.getElementById('add').addEventListener('click', async () => {
      await ${report('/synthetic-add', "document.getElementById('qty').value")};
      document.getElementById('panel').innerHTML = '<div role="dialog"><h2>Added to Cart</h2><h3>Do not forget these</h3><div data-component="add-to-cart:Upsell"><button id="upsell">Add to Cart</button></div></div>';
      document.getElementById('upsell').addEventListener('click', () => ${report('/synthetic-other', "'upsell'")});
    });`);
  const hdRows = s => [...s.cart].map(([item, q]) => `<div data-component="cart-item:CartItem:v2"><a href="/p/Test/${item}">Thing</a><input class="sui-input-base-input" value="${q}"><button>Save For Later</button></div>`).join('') + (s.cart.size ? '' : '<p>Your cart is empty</p>') + '<h2>Saved For Later</h2><div data-component="cart-item:CartItem:v2"><a href="/p/Saved/999999999">Private saved line</a><button>Move to Cart</button></div>';
  const hdCart = s => page('Cart', `<span data-testid="header-cart-count">${[...s.cart.values()].reduce((a, b) => a + b, 0)}</span><h1>Cart</h1><div id="rows"></div>`, `
    setTimeout(() => { document.getElementById('rows').innerHTML = ${JSON.stringify(hdRows(s))}; }, 700);`);
  const OOPS = page('Error Page', '<h1>Oops!! Something went wrong.</h1><p>Please refresh page</p><button>Refresh</button>');
  async function homedepot(route) {
    const request = route.request(), url = new URL(request.url()), s = state.homedepot;
    if (/checkout/i.test(url.pathname)) return checkout(route, 'homedepot');
    if (url.pathname === '/synthetic-add') {
      const quantity = Number(request.postData());
      note('homedepot', request, { add: true, body: quantity });
      s.cart.set('204647886', (s.cart.get('204647886') ?? 0) + quantity);
      return route.fulfill({ status: 200, body: 'ok' });
    }
    if (url.pathname === '/synthetic-other') { s.otherPresses++; return route.fulfill({ status: 200, body: 'ok' }); }
    note('homedepot', request);
    if (s.mode === 'oops') return route.fulfill({ status: 403, contentType: 'text/html', body: OOPS });
    return html(route, url.pathname === '/cart' ? hdCart(s) : hdProduct());
  }
  const aliListing = () => page('Test wire', `<h1>Test wire</h1><div class="price--current--x">$0.46</div>
    <div data-sku-row="14"><div data-sku-col="14-1" title="0.8mm (5Meter)" class="sku-item--text--x"><span>0.8mm (5Meter)</span></div><div data-sku-col="14-2" title="1.0mm (5Meter)" class="sku-item--text--x sku-item--selected--x"><span>1.0mm (5Meter)</span></div></div>
    <input class="comet-v2-input-number-input" value="1"><button id="buy">Buy now</button><button id="add"><span>Add to cart</span></button><div class="cart-product"><a href="/item/3256800000000009.html">Mini-cart row</a><input class="comet-v2-input-number-input" value="4"></div>`, `
    document.querySelectorAll('[data-sku-col]').forEach(col => col.addEventListener('click', () => {
      document.querySelectorAll('[data-sku-col]').forEach(other => { other.className = 'sku-item--text--x'; });
      col.className = 'sku-item--text--x sku-item--selected--x';
    }));
    document.getElementById('buy').addEventListener('click', () => ${report('/synthetic-other', "'buy'")});
    document.getElementById('add').addEventListener('click', () => ${report('/synthetic-add', "JSON.stringify([document.querySelector('[data-sku-col][class*=selected]').title, document.querySelector('input').value])")});`);
  const aliRows = s => [...s.cart].map(([name, q]) => `<div class="cart-product"><a href="//www.aliexpress.us/item/3256800000000001.html">Test wire</a><div>${name}</div><input class="comet-v2-input-number-input" value="${q}"></div>`).join('');
  const aliCart = s => page(`Cart (${s.cart.size})`, `<h1>Cart (${s.cart.size})</h1><div id="rows"></div><button id="pay">Checkout</button>`, `
    setTimeout(() => { document.getElementById('rows').innerHTML = ${JSON.stringify(aliRows(s))}; }, 700);`);
  async function aliexpress(route) {
    const request = route.request(), url = new URL(request.url()), s = state.aliexpress;
    if (/checkout/i.test(url.pathname)) return checkout(route, 'aliexpress');
    if (url.pathname === '/synthetic-add') {
      const [name, quantity] = JSON.parse(request.postData());
      note('aliexpress', request, { add: true, body: [name, quantity] });
      s.cart.set(name, (s.cart.get(name) ?? 0) + Number(quantity));
      return route.fulfill({ status: 200, body: 'ok' });
    }
    if (url.pathname === '/synthetic-other') { s.otherPresses++; return route.fulfill({ status: 200, body: 'ok' }); }
    note('aliexpress', request);
    return html(route, url.pathname === '/p/shoppingcart/index.html' ? aliCart(s) : aliListing());
  }
  return {
    state,
    async install(context) {
      await context.route('https://wcproducts.com/**', wcp);
      await context.route('https://andymark.com/**', andymark);
      await context.route('https://www.revrobotics.com/**', rev);
      await context.route('https://www.pololu.com/**', pololu);
      await context.route('https://www.mcmaster.com/**', mcmaster);
      await context.route('https://www.homedepot.com/**', homedepot);
      await context.route('https://www.aliexpress.us/**', aliexpress);
    },
  };
}
