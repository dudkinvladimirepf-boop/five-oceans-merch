
/*
  Клуб «5 океанов» — панель разработчиков

  - Защищённый вход
  - Ручная синхронизация Pages CMS -> D1
  - Редактирование остатков
  - Удаление любой позиции с подтверждением
  - Защита резервов и истории заказов
  - Исключения для повторной синхронизации
  - Восстановление удалённых позиций
*/

const COOKIE = "__Host-fo-admin";
const SESSION_SECONDS = 8 * 3600;
const MAX_STOCK = 1000000;
const encoder = new TextEncoder();

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function number(value) {
  return Number(value || 0).toLocaleString("ru-RU");
}

function pageResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, private",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; " +
        "style-src 'unsafe-inline'; " +
        "form-action 'self'; " +
        "base-uri 'none'; " +
        "frame-ancestors 'none'"
    }
  });
}

function getSecret(env) {
  return typeof env.ADMIN_PASSWORD === "string"
    && env.ADMIN_PASSWORD.length
    ? env.ADMIN_PASSWORD
    : null;
}

function database(env) {
  if (!env.DB) {
    throw new Error("Cloudflare D1 не подключена.");
  }

  return env.DB;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function encode64(bytes) {
  let binary = "";

  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decode64(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded = base64.padEnd(
    Math.ceil(base64.length / 4) * 4,
    "="
  );

  return Uint8Array.from(
    atob(padded),
    c => c.charCodeAt(0)
  );
}

async function sign(secret, message) {
  const key = await hmacKey(secret);

  return encode64(new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(message)
    )
  ));
}

async function verify(secret, message, token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || "")) {
    return false;
  }

  try {
    const key = await hmacKey(secret);

    return await crypto.subtle.verify(
      "HMAC",
      key,
      decode64(token),
      encoder.encode(message)
    );
  } catch {
    return false;
  }
}

function cookieValue(request) {
  const prefix = COOKIE + "=";

  const found = (request.headers.get("Cookie") || "")
    .split(";")
    .map(x => x.trim())
    .find(x => x.startsWith(prefix));

  return found ? found.slice(prefix.length) : "";
}

function setCookie(value) {
  return COOKIE + "=" + value +
    "; Path=/; HttpOnly; Secure; SameSite=Strict" +
    "; Max-Age=" + SESSION_SECONDS;
}

function clearCookie() {
  return COOKIE +
    "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

function redirect(cookie) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/developers",
      "Set-Cookie": cookie,
      "Cache-Control": "no-store"
    }
  });
}

async function passwordMatches(input, secret) {
  const hashes = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(input)),
    crypto.subtle.digest("SHA-256", encoder.encode(secret))
  ]);

  const a = new Uint8Array(hashes[0]);
  const b = new Uint8Array(hashes[1]);
  let diff = 0;

  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
}

async function createSession(secret) {
  const expiry = String(
    Math.floor(Date.now() / 1000) + SESSION_SECONDS
  );

  return expiry + "." + await sign(secret, expiry);
}

async function authorized(request, secret) {
  const value = cookieValue(request);
  const parts = value.split(".");

  if (parts.length !== 2) return false;

  const [expiry, signature] = parts;

  if (!/^\d{10,12}$/.test(expiry)) return false;

  const now = Math.floor(Date.now() / 1000);
  const end = Number(expiry);

  if (
    end <= now ||
    end > now + SESSION_SECONDS
  ) {
    return false;
  }

  return verify(secret, expiry, signature);
}

async function csrfToken(request, secret) {
  return sign(
    secret,
    "developers-action:" + cookieValue(request)
  );
}

async function checkCsrf(request, secret, token) {
  return verify(
    secret,
    "developers-action:" + cookieValue(request),
    token
  );
}

function hidden(name, value) {
  return `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;
}

function sizesOf(product) {
  const sizes = Array.isArray(product.sizes)
    ? [...new Set(product.sizes
        .map(x => String(x ?? "").trim())
        .filter(Boolean))]
    : [];

  return sizes.length ? sizes : [""];
}

async function productsFromCMS(context) {
  if (!context.env.ASSETS) {
    throw new Error("Каталог Pages CMS недоступен.");
  }

  const url = new URL(
    "/data/products.json",
    context.request.url
  );

  const result = await context.env.ASSETS.fetch(
    new Request(url.toString())
  );

  if (!result.ok) {
    throw new Error("Не удалось загрузить products.json.");
  }

  const products = await result.json();

  if (!Array.isArray(products)) {
    throw new Error("Неверный формат каталога.");
  }

  return products;
}

async function inventoryRows(env) {
  const result = await database(env).prepare(
    `SELECT product_slug, product_id, size,
            total_quantity, reserved_quantity,
            total_quantity - reserved_quantity
              AS available_quantity
     FROM inventory
     ORDER BY product_slug, size`
  ).all();

  return result.results || [];
}

async function excludedRows(env) {
  const result = await database(env).prepare(
    `SELECT product_slug, product_id, size, deleted_at
     FROM inventory_exclusions
     ORDER BY deleted_at DESC
     LIMIT 500`
  ).all();

  return result.results || [];
}

async function recentOrders(env, filters = {}) {
  const number = String(filters.order_number || "");
  const status = String(filters.order_status || "");
  const shipping = String(filters.order_shipping || "");
  const product = String(filters.order_product || "");
  const source = String(filters.order_source || "");
  const result = await database(env).prepare(
    `SELECT
       o.order_id,
       o.status,
       o.source,
       o.shipping_status,
       o.created_at,
       o.updated_at,
       i.product_slug,
       i.product_title,
       i.size,
       i.quantity,
       i.unit_price
     FROM (
       SELECT order_id, status, source, shipping_status, created_at, updated_at
       FROM orders
       WHERE (? = '' OR instr(lower(order_id), lower(?)) > 0)
         AND (? = '' OR status = ?)
         AND (? = '' OR shipping_status = ?)
         AND (? = '' OR source = ?)
         AND (? = '' OR EXISTS (
           SELECT 1 FROM order_items AS matched
           WHERE matched.order_id = orders.order_id
             AND matched.product_title = ?
         ))
       ORDER BY created_at DESC, order_id DESC
       LIMIT 100
     ) AS o
     LEFT JOIN order_items AS i
       ON i.order_id = o.order_id
     ORDER BY o.created_at DESC, o.order_id DESC,
              i.product_slug, i.size`
  ).bind(number, number, status, status, shipping, shipping, source, source, product, product).all();

  const orders = [];
  const byId = new Map();
  for (const row of result.results || []) {
    let order = byId.get(row.order_id);
    if (!order) {
      order = {
        order_id: row.order_id, status: row.status,
        source: row.source === "telegram" ? "telegram" : "site",
        shipping_status: row.shipping_status,
        created_at: row.created_at, updated_at: row.updated_at,
        items: [], total: 0
      };
      orders.push(order);
      byId.set(row.order_id, order);
    }
    if (row.product_slug !== null && row.product_slug !== undefined) {
      const quantity = Number(row.quantity);
      const unitPrice = Number(row.unit_price);
      const sum = quantity * unitPrice;
      order.items.push({
        title: row.product_title, slug: row.product_slug,
        size: row.size, quantity, unit_price: unitPrice, total: sum
      });
      order.total += sum;
    }
  }
  return orders;
}

function moneyRub(amount) { return number(amount) + " ₽"; }

function orderStatusLabel(status) {
  const known = {
    pending: "Новый", reserved: "В резерве",
    sold: "Оплачен", cancelled: "Отменён",
    expired: "Истёк"
  };
  return known[status] || String(status || "Неизвестен");
}

async function changeOrderStatus(context, form) {
  const orderId = String(form.get("order_id") || "");
  const action = String(form.get("action") || "");
  if (!/^FO-\d{8}-[0-9A-F]{12}$/.test(orderId)) {
    throw new Error("Некорректный номер заказа.");
  }
  if (!["order-reserve", "order-paid", "order-cancel"].includes(action)) {
    throw new Error("Неизвестное действие с заказом.");
  }

  const db = database(context.env);
  const existing = await db.prepare(
    "SELECT status FROM orders WHERE order_id = ? LIMIT 1"
  ).bind(orderId).first();

  if (!existing) {
    throw new Error("Заказ не найден.");
  }
  const from = existing.status;
  if (!["pending", "reserved"].includes(from)) {
    throw new Error(
      "Этот заказ уже завершён или отменён. Изменять его нельзя."
    );
  }
  if (action === "order-reserve" && from !== "pending") {
    throw new Error("Заказ уже в резерве.");
  }

  const to = action === "order-reserve"
    ? "reserved"
    : action === "order-paid"
      ? "sold"
      : "cancelled";

  const changesStock = action !== "order-cancel" || from === "reserved";
  const needsAvailable = action === "order-reserve" ||
    (action === "order-paid" && from === "pending");

  const stockCheck = needsAvailable
    ? "i.total_quantity - i.reserved_quantity < oi.quantity"
    : "i.reserved_quantity < oi.quantity OR i.total_quantity < oi.quantity";

  /*
    The conditional status UPDATE is a transactional guard:
    - it checks the prior status and all order lines;
    - if a required stock line is missing / insufficient,
      its CASE chooses an INVALID status rejected by orders.status CHECK.
    This aborts the D1 batch, leaving the order and inventory unchanged.
    Stock updates in the same batch therefore cannot be partial.
  */
  const requirements = changesStock
    ? `EXISTS (
          SELECT 1 FROM order_items AS oi
          WHERE oi.order_id = orders.order_id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM order_items AS oi
         LEFT JOIN inventory AS i
           ON i.product_slug = oi.product_slug
          AND i.size = oi.size
         WHERE oi.order_id = orders.order_id
           AND (i.product_slug IS NULL OR ${stockCheck})
       )`
    : "1 = 1";

  const updateOrder = db.prepare(
    `UPDATE orders
     SET status = CASE
       WHEN status = ? AND (${requirements})
         THEN ?
       ELSE '__invalid_status__'
     END,
     updated_at = CURRENT_TIMESTAMP
     WHERE order_id = ?`
  ).bind(from, to, orderId);

  const statements = [updateOrder];

  if (changesStock) {
    const qty = `(SELECT oi.quantity FROM order_items AS oi
       WHERE oi.order_id = ?
         AND oi.product_slug = inventory.product_slug
         AND oi.size = inventory.size)`;

    let changeFields;
    let qtyBindings;

    if (action === "order-reserve") {
      changeFields = `reserved_quantity = reserved_quantity + ${qty}`;
      qtyBindings = [orderId];
    } else if (action === "order-paid" && from === "pending") {
      changeFields = `total_quantity = total_quantity - ${qty}`;
      qtyBindings = [orderId];
    } else if (action === "order-paid" && from === "reserved") {
      changeFields =
        `total_quantity = total_quantity - ${qty},
         reserved_quantity = reserved_quantity - ${qty}`;
      qtyBindings = [orderId, orderId];
    } else {
      changeFields = `reserved_quantity = reserved_quantity - ${qty}`;
      qtyBindings = [orderId];
    }

    statements.push(db.prepare(
      `UPDATE inventory
       SET ${changeFields},
           updated_at = CURRENT_TIMESTAMP
       WHERE EXISTS (
         SELECT 1 FROM order_items AS oi
         WHERE oi.order_id = ?
           AND oi.product_slug = inventory.product_slug
           AND oi.size = inventory.size
       )`
    ).bind(...qtyBindings, orderId));
  }

  try {
    const results = await db.batch(statements);

    if (results[0]?.meta?.changes !== 1) {
      throw new Error("Не удалось изменить статус заказа.");
    }
  } catch (error) {
    console.error("Order transition rejected", error);
    throw new Error(
      "Не удалось выполнить действие: статус заказа или остатки " +
      "изменились, либо товара недостаточно на складе. " +
      "Обновите страницу и проверьте заказ."
    );
  }

  const label = to === "reserved"
    ? "В резерве"
    : to === "sold"
      ? "Оплачен"
      : "Отменён";

  return "Заказ " + orderId + ": " + label + ".";
}

function renderOrderButton(order, csrf, action, label, colorClass, formAction = "/developers") {
  return `
    <form method="POST" action="${esc(formAction)}#orders">
      ${hidden("action", action)}
      ${hidden("csrf", csrf)}
      ${hidden("order_id", order.order_id)}
      <button type="submit" class="${colorClass}">
        ${esc(label)}
      </button>
    </form>
  `;
}


/*
  Независимая визуальная отметка отправки.
  Обновляет ТОЛЬКО orders.shipping_status:
  не меняет основной статус, резерв, оплаты, остатки.
*/
async function changeShippingStatus(context, form) {
  const orderId = String(form.get("order_id") || "");
  const expected = String(form.get("expected_shipping_status") || "");
  const next = String(form.get("shipping_status") || "");

  if (!/^FO-\d{8}-[0-9A-F]{12}$/.test(orderId)) {
    throw new Error("Некорректный номер заказа.");
  }

  if (
    !["not_shipped", "shipped"].includes(expected) ||
    !["not_shipped", "shipped"].includes(next) ||
    expected === next
  ) {
    throw new Error("Некорректный статус отправки.");
  }

  const db = database(context.env);

  // Проверяем предыдущее значение для защиты от устаревшей формы.
  const result = await db.prepare(
    `UPDATE orders
     SET shipping_status = ?
     WHERE order_id = ?
       AND shipping_status = ?`
  ).bind(next, orderId, expected).run();

  if (Number(result.meta?.changes || 0) === 1) {
    return "Заказ " + orderId + ": " +
      (next === "shipped" ? "Отправлено." : "Не отправлено.");
  }

  const current = await db.prepare(
    "SELECT shipping_status FROM orders WHERE order_id = ?"
  ).bind(orderId).first();

  if (!current) {
    throw new Error("Заказ не найден.");
  }

  if (current.shipping_status === next) {
    // Повторная отправка той же формы не меняет данные повторно.
    return "Заказ " + orderId + " уже имеет статус «" +
      (next === "shipped" ? "Отправлено" : "Не отправлено") + "».";
  }

  throw new Error(
    "Статус отправки изменился в другой вкладке. " +
    "Обновите страницу и попробуйте ещё раз."
  );
}

function renderShippingButton(order, csrf, current, formAction = "/developers") {
  const target = current === "shipped" ? "not_shipped" : "shipped";
  const label = target === "shipped"
    ? "Отметить отправленным"
    : "Вернуть в «Не отправлено»";

  return `
    <form method="POST" action="${esc(formAction)}#orders">
      ${hidden("action", "order-shipping")}
      ${hidden("csrf", csrf)}
      ${hidden("order_id", order.order_id)}
      ${hidden("expected_shipping_status", current)}
      ${hidden("shipping_status", target)}
      <button type="submit" class="shipping-button">
        ${esc(label)}
      </button>
    </form>
  `;
}

function renderOrders(orders, csrf, formAction = "/developers") {
  if (!orders.length) {
    return '<p class="muted">По выбранным условиям заказов не найдено.</p>';
  }
  return orders.map(order => {
    const status = String(order.status || "pending");
    const shippingStatus = order.shipping_status === "shipped"
      ? "shipped"
      : "not_shipped";
    const cssStatus = [
      "pending", "reserved", "sold", "cancelled", "expired"
    ].includes(status) ? status : "unknown";

    const rows = order.items.map(item => `
      <tr>
        <td>
          <strong>${esc(item.title || item.slug)}</strong>
          <small>${esc(item.slug)}</small>
        </td>
        <td>${esc(item.size || "Без размера")}</td>
        <td class="num">${number(item.quantity)}</td>
        <td class="num">${moneyRub(item.unit_price)}</td>
        <td class="num">${moneyRub(item.total)}</td>
      </tr>
    `).join("");

    return `
      <details class="order-card">
        <summary class="order-summary">
          <span class="order-title">${esc(order.order_id)}</span>
          <span class="status-pill source-${order.source === "telegram" ? "telegram" : "site"}">
            ${order.source === "telegram" ? "Telegram" : "Сайт"}
          </span>
          <span class="status-pill status-${cssStatus}">
            ${esc(orderStatusLabel(status))}
          </span>
          <span class="status-pill shipping-${shippingStatus === "shipped" ? "sent" : "unsent"}">
            ${shippingStatus === "shipped" ? "Отправлено" : "Не отправлено"}
          </span>
          <span class="order-meta">
            ${esc(String(order.created_at || ""))} UTC
          </span>
          <strong class="order-total">${moneyRub(order.total)}</strong>
        </summary>
        <div class="order-body">
          <p class="muted">
            Позиции и цены сохранены при оформлении.
            ${status === "pending"
              ? "Заказ ещё не обработан, товары не зарезервированы."
              : status === "reserved"
                ? "Товары зарезервированы; доступное количество уменьшено."
                : status === "sold"
                  ? "Оплата отмечена; товары списаны со склада."
                  : "Заказ закрыт, активного резерва нет."}
          </p>
          <div class="table-wrap">
            <table class="orders-table">
              <thead>
                <tr>
                  <th>Товар</th><th>Размер</th>
                  <th class="num">Штук</th>
                  <th class="num">Цена</th><th class="num">Сумма</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div class="order-bottom">
            <span>${number(order.items.length)} позиций</span>
            <strong>Итого: ${moneyRub(order.total)}</strong>
          </div>
          ${status === "pending" || status === "reserved" ? `
            <div class="order-actions">
              ${status === "pending"
                ? renderOrderButton(order, csrf, "order-reserve", "В резерв", "blue-button", formAction)
                : ""}
              ${renderOrderButton(order, csrf, "order-paid", "Оплачено", "paid-button", formAction)}
              ${renderOrderButton(order, csrf, "order-cancel", "Отменить", "cancel-button", formAction)}
            </div>
            <p class="order-help">
              ${status === "pending"
                ? "В резерв — блокирует количество. Оплачено — сразу списывает со склада."
                : "Оплачено — списывает товар и снимает резерв. Отменить — освобождает резерв."}
            </p>
          ` : ""}
          <div class="shipping-actions">
            <span class="shipping-label">Отправка</span>
            ${renderShippingButton(order, csrf, shippingStatus, formAction)}
          </div>

        </div>
      </details>
    `;
  }).join("");
}

function readDashboardFilters(request) {
  const p = new URL(request.url).searchParams;
  const value = (name, max) => String(p.get(name) || "").slice(0, max).trim();
  return {
    stock_product: value("stock_product", 300),
    stock_size: value("stock_size", 110),
    stock_reserved: value("stock_reserved", 10),
    order_number: value("order_number", 80),
    order_status: value("order_status", 30),
    order_shipping: value("order_shipping", 30),
    order_source: value("order_source", 30),
    order_product: value("order_product", 300)
  };
}

function filteredQuery(filters) {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) p.set(key, value);
  }
  return p.toString();
}

function optionHtml(items, selected, allLabel) {
  const opts = [`<option value="">${esc(allLabel)}</option>`];
  for (const item of items) {
    const value = String(item.value);
    opts.push(
      `<option value="${esc(value)}"${value === selected ? " selected" : ""}>` +
      `${esc(item.label)}</option>`
    );
  }
  return opts.join("");
}

function retainFilters(filters, prefix) {
  return Object.entries(filters).filter(([key, value]) =>
    !key.startsWith(prefix) && value
  ).map(([key, value]) => hidden(key, value)).join("\n");
}

function filterStockRows(rows, products, filters) {
  const product = filters.stock_product;
  const size = filters.stock_size;
  const reserve = filters.stock_reserved;
  return rows.filter(item =>
    (!product || String(item.product_slug) === product) &&
    (!size || ("size:" + String(item.size || "")) === size) &&
    (reserve !== "yes" || Number(item.reserved_quantity) > 0) &&
    (reserve !== "no" || Number(item.reserved_quantity) === 0)
  );
}

function renderStockFilters(rows, products, filters) {
  const names = productNames(products);
  const bySlug = new Map();
  const sizes = new Set();

  for (const item of rows) {
    const slug = String(item.product_slug);
    if (!bySlug.has(slug)) {
      bySlug.set(slug, getProductTitle(item, names));
    }
    sizes.add(String(item.size || ""));
  }
  const productsList = [...bySlug].map(([value, title]) => ({
    value, label: title
  })).sort((a, b) =>
    a.label.localeCompare(b.label, "ru") ||
    a.value.localeCompare(b.value, "ru")
  );
  const sizeList = [...sizes].map(size => ({
    value: "size:" + size,
    label: size || "Без размера"
  })).sort((a, b) => a.label.localeCompare(b.label, "ru"));

  return `
    <form method="GET" action="/developers#stock" class="filters-form">
      ${retainFilters(filters, "stock_")}
      <div class="filters-grid">
        <div class="filter-field">
          <label for="stock-product">Товар</label>
          <select id="stock-product" name="stock_product">
            ${optionHtml(productsList, filters.stock_product, "Все товары")}
          </select>
        </div>
        <div class="filter-field">
          <label for="stock-size">Размер</label>
          <select id="stock-size" name="stock_size">
            ${optionHtml(sizeList, filters.stock_size, "Все размеры")}
          </select>
        </div>
        <div class="filter-field">
          <label for="stock-reserved">Резерв</label>
          <select id="stock-reserved" name="stock_reserved">
            ${optionHtml([
              {value:"yes", label:"Есть резерв"},
              {value:"no", label:"Без резерва"}
            ], filters.stock_reserved, "Любой резерв")}
          </select>
        </div>
        <div class="filter-controls">
          <button type="submit" class="blue-button">Найти</button>
          <a href="/developers#stock" class="filter-reset">Сбросить все</a>
        </div>
      </div>
    </form>
  `;
}

function renderOrderFilters(options, filters) {
  return `
    <form method="GET" action="/developers#orders" class="filters-form">
      ${retainFilters(filters, "order_")}
      <div class="filters-grid">
        <div class="filter-field">
          <label for="order-number">Номер заказа</label>
          <input id="order-number" type="search" name="order_number"
            value="${esc(filters.order_number)}" maxlength="80"
            placeholder="Например, FO-2026…">
        </div>
        <div class="filter-field">
          <label for="order-status">Статус заказа</label>
          <select id="order-status" name="order_status">
            ${optionHtml(options.statuses.map(status => ({
              value: status, label: orderStatusLabel(status)
            })), filters.order_status, "Любой статус")}
          </select>
        </div>
        <div class="filter-field">
          <label for="order-source">Источник заказа</label>
          <select id="order-source" name="order_source">
            ${optionHtml(options.sources.map(source => ({
              value: source,
              label: source === "site" ? "Сайт" :
                source === "telegram" ? "Telegram" : source
            })), filters.order_source, "Любой источник")}
          </select>
        </div>
        <div class="filter-field">
          <label for="order-shipping">Статус отправки</label>
          <select id="order-shipping" name="order_shipping">
            ${optionHtml(options.shipping.map(status => ({
              value: status,
              label: status === "shipped" ? "Отправлено" :
                status === "not_shipped" ? "Не отправлено" : status
            })), filters.order_shipping, "Любая отправка")}
          </select>
        </div>
        <div class="filter-field">
          <label for="order-product">Товар в заказе</label>
          <select id="order-product" name="order_product">
            ${optionHtml(options.products.map(title => ({
              value: title, label: title
            })), filters.order_product, "Все товары")}
          </select>
        </div>
        <div class="filter-controls">
          <button type="submit" class="blue-button">Найти</button>
          <a href="/developers#orders" class="filter-reset">Сбросить все</a>
        </div>
      </div>
    </form>
  `;
}

async function orderFilterOptions(env) {
  const db = database(env);
  const [statuses, shipping, products, sources] = await Promise.all([
    db.prepare("SELECT DISTINCT status FROM orders ORDER BY status").all(),
    db.prepare("SELECT DISTINCT shipping_status FROM orders ORDER BY shipping_status").all(),
    db.prepare(
      "SELECT DISTINCT product_title FROM order_items ORDER BY product_title"
    ).all(),
    db.prepare("SELECT DISTINCT source FROM orders ORDER BY source").all()
  ]);
  return {
    statuses: (statuses.results || []).map(x => String(x.status)),
    shipping: (shipping.results || []).map(x => String(x.shipping_status)),
    sources: (sources.results || []).map(x => String(x.source)),
    products: (products.results || []).map(x => String(x.product_title))
  };
}

/* РУЧНАЯ СИНХРОНИЗАЦИЯ */

async function syncCatalog(context) {
  const db = database(context.env);
  const products = await productsFromCMS(context);

  const report = {
    created: 0,
    linked: 0,
    updated: 0,
    unchanged: 0,
    excluded: 0,
    warnings: []
  };

  const usedIds = new Map();
  const usedSlugs = new Map();
  const positions = [];

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  for (const product of products) {
    const slug = String(product?.slug || "").trim();
    const id = String(product?.product_id || "")
      .trim().toLowerCase();

    const title = String(product?.title || slug);

    if (!slug || !uuidPattern.test(id)) {
      report.warnings.push(
        "Пропущен товар «" + title +
        "»: отсутствует slug или product_id."
      );
      continue;
    }

    if (
      (usedIds.has(id) && usedIds.get(id) !== slug) ||
      (usedSlugs.has(slug) && usedSlugs.get(slug) !== id)
    ) {
      throw new Error(
        "Обнаружены повторяющиеся идентификаторы товаров."
      );
    }

    usedIds.set(id, slug);
    usedSlugs.set(slug, id);

    for (const size of sizesOf(product)) {
      positions.push({ slug, id, size });
    }
  }

  for (const item of positions) {
    const { slug, id, size } = item;

    // Удалённую вручную позицию не возвращаем.

    const excluded = await db.prepare(
      `SELECT 1
       FROM inventory_exclusions
       WHERE (product_slug = ? AND size = ?)
          OR (product_id = ? AND size = ?)
       LIMIT 1`
    ).bind(slug, size, id, size).first();

    if (excluded) {
      report.excluded++;
      continue;
    }

    const byId = await db.prepare(
      `SELECT product_slug
       FROM inventory
       WHERE product_id = ? AND size = ?
       LIMIT 1`
    ).bind(id, size).first();

    if (byId) {
      if (byId.product_slug === slug) {
        report.unchanged++;
        continue;
      }

      const occupied = await db.prepare(
        `SELECT 1 FROM inventory
         WHERE product_slug = ? AND size = ?`
      ).bind(slug, size).first();

      if (occupied) {
        report.warnings.push(
          "Конфликт адреса: " + slug + " / " + size
        );
        continue;
      }

      const update = await db.prepare(
        `UPDATE inventory
         SET product_slug = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE product_id = ? AND size = ?
           AND product_slug = ?`
      ).bind(slug, id, size, byId.product_slug).run();

      report.updated += Number(update.meta?.changes || 0);
      continue;
    }

    const bySlug = await db.prepare(
      `SELECT product_id FROM inventory
       WHERE product_slug = ? AND size = ?
       LIMIT 1`
    ).bind(slug, size).first();

    if (bySlug) {
      const oldId = String(
        bySlug.product_id || ""
      ).toLowerCase();

      if (oldId && oldId !== id) {
        report.warnings.push(
          "Конфликт product_id: " + slug + " / " + size
        );
        continue;
      }

      if (!oldId) {
        const update = await db.prepare(
          `UPDATE inventory
           SET product_id = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE product_slug = ? AND size = ?
             AND product_id IS NULL`
        ).bind(id, slug, size).run();

        report.linked += Number(update.meta?.changes || 0);
      } else {
        report.unchanged++;
      }

      continue;
    }

    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO inventory (
         product_slug, product_id, size,
         total_quantity, reserved_quantity
       ) VALUES (?, ?, ?, 0, 0)`
    ).bind(slug, id, size).run();

    report.created += Number(inserted.meta?.changes || 0);
  }

  return report;
}

/* ИЗМЕНЕНИЕ ОСТАТКА */

function parseQuantity(value) {
  const raw = String(value ?? "");

  if (!/^(0|[1-9]\d{0,6})$/.test(raw)) {
    throw new Error("Некорректное количество.");
  }

  const qty = Number(raw);

  if (qty > MAX_STOCK) {
    throw new Error("Количество не может превышать 1 000 000.");
  }

  return qty;
}

function parsePosition(form) {
  const slug = String(form.get("product_slug") || "");
  const size = String(form.get("size") || "");

  if (!slug || slug.length > 300 || size.length > 100) {
    throw new Error("Некорректная складская позиция.");
  }

  return { slug, size };
}

async function saveStock(context, form) {
  const db = database(context.env);
  const { slug, size } = parsePosition(form);

  const quantity = parseQuantity(form.get("quantity"));
  const expected = parseQuantity(form.get("expected_total"));

  const result = await db.prepare(
    `UPDATE inventory
     SET total_quantity = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE product_slug = ? AND size = ?
       AND total_quantity = ?
       AND reserved_quantity <= ?`
  ).bind(
    quantity, slug, size, expected, quantity
  ).run();

  if (result.meta?.changes !== 1) {
    throw new Error(
      "Не удалось сохранить остаток. " +
      "Возможно, он уже изменился или превышен резерв. " +
      "Обновите страницу."
    );
  }

  return "Остаток сохранён: " + slug +
    " / " + (size || "Без размера") +
    " — " + quantity + " шт.";
}

async function saveStockBulk(context, form) {
  const entries = form.getAll("stock_item");
  const inputs = form.getAll("stock_quantity");

  if (
    !entries.length ||
    entries.length !== inputs.length ||
    entries.length > 1000
  ) {
    throw new Error("Некорректный список остатков. Обновите страницу.");
  }

  const updated = [];
  const unique = new Set();

  for (let i = 0; i < entries.length; i++) {
    let record;

    try {
      record = JSON.parse(String(entries[i]));
    } catch {
      throw new Error("Ошибка чтения складских позиций.");
    }

    if (!Array.isArray(record) || record.length !== 3) {
      throw new Error("Некорректная складская позиция.");
    }

    const [slug, size, previous] = record;

    if (
      typeof slug !== "string" ||
      !slug ||
      slug.length > 300 ||
      typeof size !== "string" ||
      size.length > 100
    ) {
      throw new Error("Некорректный товар или размер.");
    }

    const key = JSON.stringify([slug, size]);

    if (unique.has(key)) {
      throw new Error("Складская позиция повторяется в форме.");
    }

    unique.add(key);

    const expected = parseQuantity(previous);
    const quantity = parseQuantity(inputs[i]);

    if (expected !== quantity) {
      updated.push([slug, size, expected, quantity]);
    }
  }

  if (!updated.length) {
    return "Изменений остатков нет.";
  }

  const db = database(context.env);

  /*
    One SQLite UPDATE statement updates ALL edited rows or NONE.
    The WHERE guard verifies, inside the same atomic statement:
    - every edited slug/size still exists;
    - each previous total still matches (no lost updates);
    - no new total falls below reserved_quantity.
    No stock is changed on validation failure.
  */
  const result = await db.prepare(
    `WITH edits AS (
       SELECT
         json_extract(value, '$[0]') AS slug,
         json_extract(value, '$[1]') AS size,
         json_extract(value, '$[2]') AS previous,
         json_extract(value, '$[3]') AS quantity
       FROM json_each(?)
     )
     UPDATE inventory
     SET total_quantity = (
       SELECT e.quantity FROM edits AS e
       WHERE e.slug = inventory.product_slug
         AND e.size = inventory.size
     ),
     updated_at = CURRENT_TIMESTAMP
     WHERE EXISTS (
       SELECT 1 FROM edits AS e
       WHERE e.slug = inventory.product_slug
         AND e.size = inventory.size
     )
     AND (
       SELECT COUNT(*)
       FROM edits AS e
       JOIN inventory AS i
         ON i.product_slug = e.slug
        AND i.size = e.size
       WHERE i.total_quantity = e.previous
         AND i.reserved_quantity <= e.quantity
     ) = (SELECT COUNT(*) FROM edits)`
  ).bind(JSON.stringify(updated)).run();

  if (Number(result.meta?.changes) !== updated.length) {
    throw new Error(
      "Остатки не сохранены: одна из позиций изменилась или " +
      "новое количество меньше резерва. Обновите страницу и повторите."
    );
  }

  return "Сохранено складских позиций: " + updated.length + ".";
}

/* ДВУХЭТАПНОЕ УДАЛЕНИЕ */

function confirmationMessage(
  request, slug, size, total, expiry
) {
  return JSON.stringify([
    "delete-inventory",
    cookieValue(request),
    slug,
    size,
    total,
    expiry
  ]);
}

async function deletionConfirmation(
  context, secret, form
) {
  const { slug, size } = parsePosition(form);
  const db = database(context.env);

  const item = await db.prepare(
    `SELECT total_quantity, reserved_quantity
     FROM inventory
     WHERE product_slug = ? AND size = ?
     LIMIT 1`
  ).bind(slug, size).first();

  if (!item) {
    throw new Error("Складская позиция не найдена.");
  }

  if (Number(item.reserved_quantity) > 0) {
    throw new Error(
      "Позиция находится в резерве. " +
      "Сначала необходимо снять резерв."
    );
  }

  const linked = await db.prepare(
    `SELECT order_id FROM order_items
     WHERE product_slug = ? AND size = ?
     LIMIT 1`
  ).bind(slug, size).first();

  if (linked) {
    throw new Error(
      "Позиция связана с заказом. " +
      "Удаление запрещено для сохранения истории."
    );
  }

  const total = Number(item.total_quantity);
  const expiry = Math.floor(Date.now() / 1000) + 300;

  const token = await sign(
    secret,
    confirmationMessage(
      context.request, slug, size, total, expiry
    )
  );

  const csrf = await csrfToken(context.request, secret);

  return `
    <h2>Подтверждение удаления</h2>

    <div class="danger-panel">
      <strong>Удалить складскую позицию?</strong>

      <p>Товар: <b>${esc(slug)}</b></p>
      <p>Размер: <b>${esc(size || "Без размера")}</b></p>
      <p>Текущий остаток: <b>${number(total)} шт.</b></p>

      <p>
        Позиция будет удалена из таблицы inventory.
        Если остаток больше нуля, его значение будет
        потеряно. Товар останется в Pages CMS,
        но станет недоступным для заказа.
      </p>

      <p>
        Ручная синхронизация не создаст
        эту позицию повторно.
      </p>
    </div>

    <form method="POST" action="/developers">
      ${hidden("action", "stock-delete-confirm")}
      ${hidden("csrf", csrf)}
      ${hidden("product_slug", slug)}
      ${hidden("size", size)}
      ${hidden("expected_total", total)}
      ${hidden("expires", expiry)}
      ${hidden("confirm_token", token)}

      <button class="danger-button" type="submit">
        Да, удалить позицию
      </button>
    </form>

    <a class="back-link" href="/developers">
      ← Отмена, вернуться на склад
    </a>
  `;
}

async function deleteStock(context, secret, form) {
  const { slug, size } = parsePosition(form);
  const total = parseQuantity(form.get("expected_total"));

  const expiry = Number(form.get("expires"));
  const token = String(form.get("confirm_token") || "");
  const now = Math.floor(Date.now() / 1000);

  if (
    !Number.isSafeInteger(expiry) ||
    expiry <= now ||
    expiry > now + 300
  ) {
    throw new Error(
      "Время подтверждения истекло. Повтори удаление."
    );
  }

  const valid = await verify(
    secret,
    confirmationMessage(
      context.request, slug, size, total, expiry
    ),
    token
  );

  if (!valid) {
    throw new Error(
      "Ошибка подтверждения удаления."
    );
  }

  const db = database(context.env);

  /*
    Обе операции выполняются в одной транзакции:
    1. Запоминаем исключение.
    2. Удаляем запись из inventory.

    Проверки резервов, количества и заказов
    выполняются непосредственно в SQL.
  */

  const statements = [
    db.prepare(
      `INSERT INTO inventory_exclusions (
         product_slug, size, product_id
       )
       SELECT product_slug, size, product_id
       FROM inventory
       WHERE product_slug = ?
         AND size = ?
         AND total_quantity = ?
         AND reserved_quantity = 0
         AND NOT EXISTS (
           SELECT 1 FROM order_items AS oi
           WHERE oi.product_slug = inventory.product_slug
             AND oi.size = inventory.size
         )
       ON CONFLICT(product_slug, size)
       DO UPDATE SET
         product_id = excluded.product_id,
         deleted_at = CURRENT_TIMESTAMP`
    ).bind(slug, size, total),

    db.prepare(
      `DELETE FROM inventory
       WHERE product_slug = ?
         AND size = ?
         AND total_quantity = ?
         AND reserved_quantity = 0
         AND EXISTS (
           SELECT 1 FROM inventory_exclusions AS ex
           WHERE ex.product_slug = inventory.product_slug
             AND ex.size = inventory.size
         )
         AND NOT EXISTS (
           SELECT 1 FROM order_items AS oi
           WHERE oi.product_slug = inventory.product_slug
             AND oi.size = inventory.size
         )`
    ).bind(slug, size, total)
  ];

  const results = await db.batch(statements);

  if (
    results[0]?.meta?.changes !== 1 ||
    results[1]?.meta?.changes !== 1
  ) {
    throw new Error(
      "Удаление не выполнено. " +
      "Возможно, остаток или резерв изменился. " +
      "Обнови страницу."
    );
  }

  return "Удалена позиция: " + slug +
    " / " + (size || "Без размера") + ".";
}

/* ВОССТАНОВЛЕНИЕ ИСКЛЮЧЕНИЯ */

async function restoreStock(context, form) {
  const { slug, size } = parsePosition(form);

  const result = await database(context.env).prepare(
    `DELETE FROM inventory_exclusions
     WHERE product_slug = ? AND size = ?`
  ).bind(slug, size).run();

  if (result.meta?.changes !== 1) {
    throw new Error("Исключение уже отсутствует.");
  }

  return (
    "Исключение снято. Нажми «Синхронизировать " +
    "с Pages CMS», чтобы создать позицию с остатком 0."
  );
}

/* ОТОБРАЖЕНИЕ ДАННЫХ */

function productNames(products) {
  const byId = new Map();
  const bySlug = new Map();

  for (const product of products) {
    const title = String(
      product?.title || product?.slug || "Товар"
    );

    if (product?.product_id) {
      byId.set(
        String(product.product_id).toLowerCase(),
        title
      );
    }

    if (product?.slug) {
      bySlug.set(String(product.slug), title);
    }
  }

  return { byId, bySlug };
}

function getProductTitle(item, names) {
  return names.byId.get(
    String(item.product_id || "").toLowerCase()
  ) || names.bySlug.get(item.product_slug)
    || item.product_slug;
}

function renderInventory(rows, products, csrf, formAction = "/developers") {
  if (!rows.length) {
    return `<p class="muted">По выбранным условиям складских позиций не найдено.</p>`;
  }

  const names = productNames(products);
  const body = rows.map(item => {
    const slug = String(item.product_slug);
    const size = String(item.size || "");
    const title = getProductTitle(item, names);
    const total = Number(item.total_quantity);

    return `
      <tr>
        <td>
          <strong>${esc(title)}</strong>
          <small>${esc(slug)}</small>
        </td>

        <td>${esc(size || "Без размера")}</td>
        <td class="num">${number(item.reserved_quantity)}</td>
        <td class="num green">${number(item.available_quantity)}</td>
        <td>
          <input type="hidden" form="stock-bulk-form"
                 name="stock_item"
                 value="${esc(JSON.stringify([slug, size, total]))}">
          <input type="number" form="stock-bulk-form"
                 class="stock-bulk-quantity"
                 name="stock_quantity"
                 min="0" max="${MAX_STOCK}" step="1"
                 value="${total}" required
                 aria-label="На складе: ${esc(title)}, ${esc(size || "Без размера")}">
        </td>
        <td>
          <form method="POST" action="${esc(formAction)}">
            ${hidden("action", "stock-delete-request")}
            ${hidden("csrf", csrf)}
            ${hidden("product_slug", slug)}
            ${hidden("size", size)}
            <button class="outline-danger" type="submit">
              Удалить
            </button>
          </form>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <form id="stock-bulk-form" method="POST"
          action="${esc(formAction)}#stock">
      ${hidden("action", "stock-bulk-save")}
      ${hidden("csrf", csrf)}
    </form>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Товар</th>
            <th>Размер</th>
            <th class="num">Резерв</th>
            <th class="num">Доступно</th>
            <th>На складе / изменить</th>
            <th>Удаление</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <div class="stock-bulk-actions">
      <button type="submit" form="stock-bulk-form"
              class="blue-button">Сохранить изменения</button>
      <p class="muted">
        Измените количество у нескольких товаров и сохраните одним нажатием.
        Сохраняются только изменённые строки.
        Если выбран фильтр, сохраняются только видимые позиции.
      </p>
    </div>
  `;
}

function renderExcluded(rows, products, csrf, formAction = "/developers") {
  if (!rows.length) return "";

  const names = productNames(products);

  const body = rows.map(item => `
    <tr>
      <td>
        <strong>${esc(getProductTitle(item, names))}</strong>
        <small>${esc(item.product_slug)}</small>
      </td>
      <td>${esc(item.size || "Без размера")}</td>
      <td>
        <form method="POST" action="${esc(formAction)}">
          ${hidden("action", "stock-restore")}
          ${hidden("csrf", csrf)}
          ${hidden("product_slug", item.product_slug)}
          ${hidden("size", item.size)}

          <button class="blue-button" type="submit">
            Восстановить
          </button>
        </form>
      </td>
    </tr>
  `).join("");

  return `
    <section class="section">
      <h3>Удалённые складские позиции</h3>
      <p class="muted">
        Эти позиции отсутствуют в inventory.
        Синхронизация с Pages CMS их пропускает.
      </p>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th>Размер</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderReport(report) {
  if (!report) return "";

  return `
    <div class="success">
      ✓ Синхронизация завершена.
      Создано: ${report.created}.
      Привязано: ${report.linked}.
      Обновлено: ${report.updated}.
      Без изменений: ${report.unchanged}.
      Исключено: ${report.excluded}.
    </div>

    ${report.warnings.length ? `
      <div class="warning">
        <strong>Предупреждения:</strong>
        <ul>${report.warnings.map(
          x => `<li>${esc(x)}</li>`
        ).join("")}</ul>
      </div>
    ` : ""}
  `;
}

async function dashboard(context, secret, options = {}) {
  let stock = [];
  let excluded = [];
  let products = [];
  let orders = [];
  let orderChoices = { statuses: [], shipping: [], sources: [], products: [] };
  const filters = readDashboardFilters(context.request);
  const query = filteredQuery(filters);
  const formAction = "/developers" + (query ? "?" + query : "");
  const problems = [];

  try {
    stock = await inventoryRows(context.env);
    excluded = await excludedRows(context.env);
  } catch (error) {
    console.error(error);
    problems.push(
      "Не удалось прочитать складские данные."
    );
  }

  try {
    products = await productsFromCMS(context);
  } catch (error) {
    console.error(error);
    problems.push("Не удалось прочитать каталог Pages CMS.");
  }

  try {
    orders = await recentOrders(context.env, filters);
    orderChoices = await orderFilterOptions(context.env);
  } catch (error) {
    console.error(error);
    problems.push("Не удалось загрузить список заказов.");
  }

  const total = stock.reduce(
    (sum, x) => sum + Number(x.total_quantity),
    0
  );

  const reserved = stock.reduce(
    (sum, x) => sum + Number(x.reserved_quantity),
    0
  );

  const csrf = await csrfToken(context.request, secret);

  return `
    <div class="success">✓ Вы авторизованы</div>

    <h2>Склад</h2>

    <div class="stats">
      <div class="stat">
        <span>На складе</span>
        <strong>${number(total)}</strong>
      </div>

      <div class="stat">
        <span>В резерве</span>
        <strong>${number(reserved)}</strong>
      </div>

      <div class="stat">
        <span>Доступно</span>
        <strong class="green">${number(total - reserved)}</strong>
      </div>
    </div>

    ${options.message ? `
      <div class="success">✓ ${esc(options.message)}</div>
    ` : ""}

    ${options.error ? `
      <div class="error">${esc(options.error)}</div>
    ` : ""}

    ${problems.map(x =>
      `<div class="error">${esc(x)}</div>`
    ).join("")}

    ${renderReport(options.report)}

    <section class="section" id="stock">
      <h3>Складские остатки</h3>
      <p class="muted">
        Фильтры обновляются из текущего склада и каталога товаров.
        Названия и размеры появятся автоматически после синхронизации.
      </p>
      ${renderStockFilters(stock, products, filters)}
      <p class="muted">
        Найдено позиций: ${number(filterStockRows(stock, products, filters).length)}.
        Показатели «На складе / В резерве / Доступно» выше — общие,
        без учёта фильтра.
      </p>

      <div class="sync-area">
        <p class="muted">
          Синхронизация с Pages CMS выполняется вручную.
          Удалённые позиции не создаются повторно.
        </p>

        <form method="POST" action="${esc(formAction)}#stock">
          ${hidden("action", "sync")}
          ${hidden("csrf", csrf)}

          <button class="blue-button" type="submit">
            ↻ Синхронизировать с Pages CMS
          </button>
        </form>
      </div>

      ${renderInventory(filterStockRows(stock, products, filters), products, csrf, formAction)}

      <p class="muted">
        Удаление требует подтверждения.
        Если позиция находится в резерве
        или связана с заказом, удалить её нельзя.
      </p>
    </section>

    ${renderExcluded(excluded, products, csrf, formAction)}

    <section class="section" id="orders">
      <div class="order-header">
        <h3>Заказы (${orders.length})</h3>
        <a class="order-refresh" href="${esc(formAction)}#orders">↻ Обновить</a>
      </div>
      <p class="muted">
        Поиск и фильтры работают по всей базе заказов.
        Показаны до 100 последних совпадений.
        Список статусов и товаров составляется из D1 автоматически.
      </p>
      ${renderOrderFilters(orderChoices, filters)}
      <p class="muted">Найдено и показано заказов: ${number(orders.length)}.</p>
      ${renderOrders(orders, csrf, formAction)}
    </section>

    <form method="POST" action="/developers">
      ${hidden("action", "logout")}
      ${hidden("csrf", csrf)}

      <button class="logout" type="submit">
        Выйти из панели
      </button>
    </form>
  `;
}

function loginForm(error = "") {
  return `
    <p class="muted">
      Закрытый раздел магазина Клуба «5 океанов».
    </p>

    ${error ? `<div class="error">${esc(error)}</div>` : ""}

    <form method="POST" action="/developers">
      ${hidden("action", "login")}

      <label for="password">Пароль администратора</label>

      <input id="password"
        name="password"
        type="password"
        maxlength="256"
        autocomplete="current-password"
        required>

      <button class="login-button" type="submit">
        Войти
      </button>
    </form>
  `;
}

function layout(content, loggedIn = false) {
  return `
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Для разработчиков — 5 океанов</title>
<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: Arial, sans-serif;
  background: #f5f7fa;
  color: #14283a;
}
header {
  background: #102c43;
  padding: 22px 5%;
}
header a {
  color: white;
  text-decoration: none;
  font-size: 20px;
  font-weight: bold;
}
main {
  max-width: ${loggedIn ? "1250px" : "560px"};
  margin: 48px auto;
  padding: 20px;
}
.card {
  background: white;
  border-radius: 16px;
  padding: 30px;
  box-shadow: 0 5px 25px #102c4312;
}
h1 { font-size: 28px; margin: 0 0 15px; }
h2 { font-size: 24px; margin: 30px 0 18px; }
h3 { font-size: 19px; margin: 0 0 15px; }
.muted {
  color: #71808e;
  font-size: 14px;
  line-height: 1.6;
}
.success, .error, .warning {
  padding: 13px 16px;
  margin: 15px 0;
  border-radius: 9px;
  font-size: 14px;
  line-height: 1.6;
}
.success { background: #eaf7ee; color: #28734a; }
.error { background: #fff0f0; color: #a03b3b; }
.warning { background: #fff6df; color: #765510; }
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
  margin: 20px 0 30px;
}
.stat {
  padding: 20px;
  background: #f5f7fa;
  border-radius: 12px;
}
.stat span {
  display: block;
  color: #71808e;
  font-size: 14px;
}
.stat strong {
  display: block;
  margin-top: 10px;
  font-size: 30px;
}
.green { color: #28734a; font-weight: bold; }
.section {
  border: 1px solid #e0e7ed;
  border-radius: 12px;
  padding: 25px;
  margin: 25px 0;
}
.sync-area {
  background: #f5f9fc;
  border: 1px solid #dbe8ef;
  border-radius: 10px;
  padding: 15px;
  margin-bottom: 20px;
}
button {
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
}
.blue-button, .login-button {
  color: white;
  background: #146789;
  border: none;
  border-radius: 8px;
  padding: 11px 15px;
}
.blue-button:hover { background: #10516d; }
.login-button {
  width: 100%;
  margin-top: 20px;
  padding: 15px;
}
label {
  display: block;
  margin: 22px 0 10px;
  font-size: 14px;
  font-weight: bold;
}
input[type="password"] {
  width: 100%;
  padding: 14px;
  border: 1px solid #cbd5df;
  border-radius: 8px;
  font-size: 16px;
}
.table-wrap { overflow-x: auto; }
table {
  width: 100%;
  min-width: 790px;
  border-collapse: collapse;
}
th, td {
  padding: 14px 10px;
  text-align: left;
  border-bottom: 1px solid #e8edf1;
  font-size: 14px;
}
th {
  color: #71808e;
  font-size: 12px;
}
td strong { display: block; }
td small {
  display: block;
  margin-top: 5px;
  color: #93a0aa;
  font-size: 11px;
  word-break: break-all;
}
.num { text-align: right; }
.inline-form {
  display: flex;
  gap: 7px;
  align-items: center;
}
.inline-form input[type="number"] {
  width: 77px;
  padding: 10px 7px;
  border: 1px solid #cbd5df;
  border-radius: 8px;
}
.stock-bulk-quantity {
  width: 95px;
  padding: 10px 8px;
  border: 1px solid #cbd5df;
  border-radius: 8px;
}
.stock-bulk-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-top: 20px;
}
.stock-bulk-actions .muted {
  margin: 0;
  flex: 1 1 240px;
}
.outline-danger {
  padding: 10px 14px;
  border: 1px solid #efb8b8;
  border-radius: 8px;
  color: #ad3636;
  background: #fff3f3;
}
.outline-danger:hover { background: #ffe4e4; }
.danger-panel {
  padding: 20px;
  border: 1px solid #efb8b8;
  border-radius: 12px;
  background: #fff4f4;
  color: #7a3030;
  line-height: 1.6;
  margin: 25px 0;
}
.danger-button {
  border: 0;
  border-radius: 9px;
  background: #b53636;
  color: white;
  padding: 14px 20px;
}
.back-link {
  display: block;
  margin-top: 22px;
  color: #146789;
  text-decoration: none;
}
.logout {
  width: 100%;
  background: white;
  border: 1px solid #cbd5df;
  border-radius: 9px;
  padding: 14px;
}
.filters-form {
  background: #f7fafc;
  border: 1px solid #dce5eb;
  border-radius: 10px;
  padding: 16px;
  margin: 14px 0;
}
.filters-grid {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 12px;
}
.filter-field { flex: 1 1 160px; min-width: 145px; }
.filter-field label {
  display: block;
  margin: 0 0 6px;
  font-size: 12px;
  color: #506574;
}
.filter-field select, .filter-field input[type="search"] {
  width: 100%;
  min-height: 40px;
  padding: 8px 9px;
  border: 1px solid #cbd5df;
  border-radius: 8px;
  background: #fff;
  color: #14283a;
  font: inherit;
  font-size: 14px;
}
.filter-controls {
  display: flex;
  gap: 9px;
  align-items: center;
  flex-wrap: wrap;
  padding-bottom: 1px;
}
.filter-reset {
  color: #146789;
  text-decoration: none;
  font-size: 13px;
}
.order-header { display: flex; gap: 12px; align-items: center; justify-content: space-between; }
.order-refresh { color: #146789; text-decoration: none; font-size: 14px; }
.order-card { border: 1px solid #dce5eb; border-radius: 10px; margin: 12px 0; overflow: hidden; background: #fff; }
.order-summary { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 16px; cursor: pointer; list-style-position: inside; }
.order-title { font-weight: bold; overflow-wrap: anywhere; }
.order-meta { color: #71808e; font-size: 13px; }
.order-total { margin-left: auto; white-space: nowrap; }
.order-body { border-top: 1px solid #dce5eb; padding: 16px; }
.orders-table { min-width: 680px; }
.order-bottom { display: flex; justify-content: space-between; gap: 12px; padding-top: 14px; font-size: 14px; }
.status-pill { padding: 5px 9px; border-radius: 20px; font-size: 12px; font-weight: bold; white-space: nowrap; }
.source-telegram { background: #e4efff; color: #1957a0; }
.source-site { background: #f2f4f6; color: #506574; }
.status-pending { background: #edf1f5; color: #506574; }
.status-reserved { background: #e7f0ff; color: #2458a5; }
.status-sold { background: #eaf7ee; color: #28734a; }
.status-cancelled, .status-expired { background: #fff0f0; color: #a03b3b; }
.status-unknown { background: #edf1f5; color: #506574; }
.shipping-unsent { background: #f0f1f3; color: #64717b; }
.shipping-sent { background: #e2f5e9; color: #246842; }
.shipping-actions {
  margin-top: 18px;
  padding-top: 15px;
  border-top: 1px solid #e8edf1;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.shipping-actions form { margin: 0; }
.shipping-label { font-size: 13px; color: #71808e; }
.shipping-button {
  background: #edf1f5;
  border: 1px solid #cbd5df;
  color: #14283a;
  padding: 10px 14px;
  border-radius: 8px;
}
.shipping-button:hover { background: #e1eaf1; }
.order-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 19px; padding-top: 17px; border-top: 1px solid #dce5eb; }
.order-actions form { margin: 0; }
.order-actions button { padding: 11px 15px; border-radius: 8px; font-size: 14px; }
.paid-button { background: #28734a; border: 0; color: white; }
.paid-button:hover { background: #1b5937; }
.cancel-button { background: #fff3f3; border: 1px solid #efb8b8; color: #ad3636; }
.cancel-button:hover { background: #ffe4e4; }
.order-help { color: #71808e; font-size: 12px; line-height: 1.5; margin: 10px 0 0; }

@media (max-width: 650px) {
  main { margin: 20px auto; padding: 12px; }
  .card { padding: 18px; }
  h1 { font-size: 24px; }
  .section { padding: 15px; }
  .stats { gap: 8px; }
  .stat { padding: 12px; }
  .stat span { font-size: 11px; }
  .stat strong { font-size: 23px; }
}
</style>
</head>
<body>
<header><a href="/">5 ОКЕАНОВ</a></header>
<main>
  <div class="card">
    <h1>Для разработчиков</h1>
    ${content}
  </div>
</main>
</body>
</html>
`;
}

export async function onRequestGet(context) {
  const secret = getSecret(context.env);

  if (!secret) {
    return pageResponse(
      layout(loginForm("Пароль не настроен.")),
      503
    );
  }

  if (!(await authorized(context.request, secret))) {
    return pageResponse(layout(loginForm()));
  }

  return pageResponse(
    layout(await dashboard(context, secret), true)
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const secret = getSecret(env);

  if (!secret) {
    return pageResponse(
      layout(loginForm("Пароль не настроен.")),
      503
    );
  }

  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return new Response("Forbidden", { status: 403 });
  }

  const contentLength = Number(
    request.headers.get("Content-Length") || "0"
  );

  if (!Number.isFinite(contentLength) || contentLength > 200000) {
    return new Response("Request too large", {
      status: 413
    });
  }

  let form;

  try {
    form = await request.formData();
  } catch {
    return pageResponse(
      layout(loginForm("Ошибка чтения формы.")),
      400
    );
  }

  const action = String(form.get("action") || "");

  if (action === "login") {
    const password = String(
      form.get("password") || ""
    );

    if (
      !password ||
      password.length > 256 ||
      !(await passwordMatches(password, secret))
    ) {
      return pageResponse(
        layout(loginForm("Неверный пароль.")),
        401
      );
    }

    return redirect(
      setCookie(await createSession(secret))
    );
  }

  if (!(await authorized(request, secret))) {
    return pageResponse(layout(loginForm()), 401);
  }

  const csrf = String(form.get("csrf") || "");

  if (!(await checkCsrf(request, secret, csrf))) {
    return pageResponse(
      layout(
        `<div class="error">
           Ошибка проверки запроса.
           Обнови страницу и попробуй снова.
         </div>
         <a href="/developers">Вернуться</a>`,
        true
      ),
      403
    );
  }

  if (action === "logout") {
    return redirect(clearCookie());
  }

  if (action === "stock-delete-request") {
    try {
      const content = await deletionConfirmation(
        context, secret, form
      );

      return pageResponse(layout(content, true));
    } catch (error) {
      return pageResponse(layout(
        await dashboard(context, secret, {
          error: error.message
        }), true
      ));
    }
  }

  let message = "";
  let errorMessage = "";
  let report = null;

  try {
    switch (action) {
      case "order-shipping":
        message = await changeShippingStatus(context, form);
        break;

      case "order-reserve":
      case "order-paid":
      case "order-cancel":
        message = await changeOrderStatus(context, form);
        break;

      case "sync":
        report = await syncCatalog(context);
        break;

      case "stock-bulk-save":
        message = await saveStockBulk(context, form);
        break;

      case "stock-save":
        message = await saveStock(context, form);
        break;

      case "stock-delete-confirm":
        message = await deleteStock(
          context, secret, form
        );
        break;

      case "stock-restore":
        message = await restoreStock(context, form);
        break;

      default:
        throw new Error("Неизвестное действие.");
    }
  } catch (error) {
    console.error(error);
    errorMessage = error.message;
  }

  return pageResponse(
    layout(
      await dashboard(context, secret, {
        message,
        error: errorMessage,
        report
      }),
      true
    )
  );
}
