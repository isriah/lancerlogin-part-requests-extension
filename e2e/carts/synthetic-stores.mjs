// Small synthetic copies of the four stores, routed at their real addresses so no request leaves the computer. Each keeps a cart and a log.
// What the pages look like comes from the research and from live checks of REV, Pololu and WCP. McMaster's is a guess at a page nobody could see
// signed in, so passing here says nothing about the real one.
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
    reset() {
      this.log.length = 0; this.checkoutHits.length = 0; this.addTimes.length = 0;
      for (const store of [this.wcp, this.rev, this.pololu, this.mcmaster]) { store.cart.clear(); store.mode = 'ok'; store.stock?.clear(); }
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
    note('wcp', request);
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
  const mcmCart = s => page('Current Order | McMaster-Carr', `<a id="paste" href="#">Paste part numbers and quantities</a>
    <div id="box" hidden><section><textarea></textarea><button id="add" type="button">ADD</button></section></div>
    <button id="checkout" type="button">Place Order</button>
    <table id="lines">${[...s.cart].map(([part, q]) => `<tr><td>${part}</td><td><input value="${q}"></td></tr>`).join('')}</table>`, `
    document.getElementById('paste').addEventListener('click', e => { e.preventDefault(); document.getElementById('box').hidden = false; });
    document.getElementById('checkout').addEventListener('click', () => { location.href = '/checkout'; });
    document.getElementById('add').addEventListener('click', async () => {
      const value = document.querySelector('textarea').value;
      const answer = await (await fetch('/synthetic-add', { method: 'POST', body: value })).json();
      const lines = document.getElementById('lines'); lines.replaceChildren();
      for (const [part, q] of answer) { const row = lines.insertRow(); row.insertCell().textContent = part; const input = document.createElement('input'); input.value = q; row.insertCell().append(input); }
      document.getElementById('box').hidden = true;
    });`);
  async function mcmaster(route) {
    const request = route.request(), url = new URL(request.url()), s = state.mcmaster;
    if (/checkout/i.test(url.pathname)) return checkout(route, 'mcmaster');
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
  return {
    state,
    async install(context) {
      await context.route('https://wcproducts.com/**', wcp);
      await context.route('https://www.revrobotics.com/**', rev);
      await context.route('https://www.pololu.com/**', pololu);
      await context.route('https://www.mcmaster.com/**', mcmaster);
    },
  };
}
