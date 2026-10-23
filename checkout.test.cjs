const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { webcrypto } = require("node:crypto");
const source = fs.readFileSync("cart.html", "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
const CART = "five-oceans-cart-v1";
const RECEIPT = "five-oceans-recent-order-v1";
const item = { slug: "shirt", size: "L", quantity: 1 };
const product = { ...item, title: "Футболка", published: true, available: true, price: 1000, sizes: ["L"] };

function browser(storage = new Map([[CART, JSON.stringify([item])]])) {
  const nodes = new Map();
  function node() {
    return {
      hidden: true, value: "", textContent: "", disabled: false, handlers: {},
      appendChild() {}, replaceChildren() {}, querySelectorAll() { return []; },
      focus() {}, select() {},
      addEventListener(type, fn) { this.handlers[type] = fn; }
    };
  }
  const state = { calls: [], orders: new Map(), fail: false, clipboard: true, now: 1000, events: [], timers: new Map() };
  const context = vm.createContext({
    console, Intl, crypto: webcrypto, Event,
    Date: { now: () => state.now },
    setTimeout(fn, delay) { const id = {}; state.timers.set(id, { fn, at: state.now + delay }); return id; },
    clearTimeout(id) { state.timers.delete(id); },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) {
        if (state.failStorage === key) throw Error("Storage unavailable");
        storage.set(key, value);
      },
      removeItem: key => storage.delete(key)
    },
    document: {
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
      createElement: node, addEventListener() {}, execCommand: () => false
    },
    window: {
      isSecureContext: true, addEventListener() {},
      dispatchEvent(event) { state.events.push(event.type); },
      location: { assign(url) { state.redirect = url; } }
    },
    navigator: { clipboard: { async writeText(text) {
      if (!state.clipboard) throw Error("Denied");
      state.copied = text;
    } } },
    async fetch(url, options) {
      if (!options?.method) return { ok: true, json: async () => [product] };
      const payload = JSON.parse(options.body);
      state.calls.push(payload);
      if (!state.orders.has(payload.checkout_key)) {
        state.orders.set(payload.checkout_key, {
          success: true, order_id: "FO-" + (state.orders.size + 1),
          items: [{ ...product, unit_price: 1000 }], total: 1000
        });
      }
      if (state.fail) throw Error("Response lost");
      if (state.duringRequest) state.duringRequest();
      return { ok: true, json: async () => state.orders.get(payload.checkout_key) };
    }
  });
  vm.runInContext(source.replace(/\ninit\(\);/, ""), context);
  return { state, storage, nodes, run: code => vm.runInContext(code, context) };
}

test("successful order clears cart and badge; same product can get a new order", async () => {
  const b = browser();
  await b.run("init()");
  await b.run("handleCheckout(false)");
  assert.equal(b.storage.get(CART), "[]");
  assert.ok(b.state.events.includes("five-oceans-cart-updated"));
  assert.equal(b.nodes.get("recent-order").hidden, false);
  assert.match(b.nodes.get("recent-order-preview").value, /FO-1/);
  assert.equal(b.nodes.get("checkout").hidden, true);
  await b.nodes.get("recent-order-copy").handlers.click();
  assert.equal(b.state.calls.length, 1);
  b.storage.set(CART, JSON.stringify([item]));
  await b.run("init();");
  await b.run("handleCheckout(false)");
  assert.equal(b.state.orders.size, 2);
  assert.notEqual(b.state.calls[0].checkout_key, b.state.calls[1].checkout_key);
});

test("lost response retains cart and retries with the same key", async () => {
  const b = browser();
  await b.run("init()");
  b.state.fail = true;
  await b.run("handleCheckout(false)");
  assert.notEqual(b.storage.get(CART), "[]");
  b.state.fail = false;
  await b.run("handleCheckout(false)");
  assert.equal(b.state.orders.size, 1);
  assert.equal(b.state.calls[0].checkout_key, b.state.calls[1].checkout_key);
  assert.equal(b.storage.get(CART), "[]");
});

test("receipt survives reload, expires at ten minutes, and does not delete server order", async () => {
  const b = browser();
  await b.run("init()");
  await b.run("handleCheckout(false)");
  const reloaded = browser(b.storage);
  reloaded.state.now = 600999;
  reloaded.run("restoreRecentOrder()");
  assert.equal(reloaded.nodes.get("recent-order").hidden, false);
  assert.equal(JSON.parse(b.storage.get(RECEIPT)).expiresAt, 601000);
  reloaded.state.now = 601000;
  for (const timer of [...reloaded.state.timers.values()]) timer.fn();
  assert.equal(reloaded.nodes.get("recent-order").hidden, true);
  assert.equal(b.storage.has(RECEIPT), false);
  assert.equal(b.state.orders.size, 1);
  assert.equal(reloaded.state.calls.length, 0);
});

test("clipboard denial still clears cart and retains a manually copyable receipt", async () => {
  const b = browser();
  await b.run("init()");
  b.state.clipboard = false;
  await b.run("handleCheckout(true)");
  assert.equal(b.storage.get(CART), "[]");
  assert.match(b.nodes.get("recent-order-status").textContent, /вручную/);
  assert.match(b.nodes.get("recent-order-preview").value, /FO-1/);
});

test("double click submits once; stale tab does not submit a cleared cart", async () => {
  const b = browser();
  await b.run("init()");
  await Promise.all([b.run("handleCheckout(false)"), b.run("handleCheckout(false)")]);
  assert.equal(b.state.calls.length, 1);
  const stale = browser();
  await stale.run("init()");
  stale.storage.set(CART, "[]");
  await stale.run("handleCheckout(false)");
  assert.equal(stale.state.calls.length, 0);
});

test("cart changed in another tab during submission is preserved", async () => {
  const b = browser();
  await b.run("init()");
  b.state.duringRequest = () => b.storage.set(CART, JSON.stringify([{ ...item, quantity: 2 }]));
  await b.run("handleCheckout(false)");
  assert.equal(JSON.parse(b.storage.get(CART))[0].quantity, 2);
  assert.equal(b.nodes.get("recent-order").hidden, false);
});

test("receipt storage failure preserves cart; retry does not post a second order", async () => {
  const b = browser();
  await b.run("init()");
  b.state.failStorage = RECEIPT;
  await b.run("handleCheckout(false)");
  assert.notEqual(b.storage.get(CART), "[]");
  assert.match(b.nodes.get("order-status").textContent, /FO-1/);
  b.state.failStorage = null;
  await b.run("handleCheckout(false)");
  assert.equal(b.state.calls.length, 1);
  assert.equal(b.storage.get(CART), "[]");
});
