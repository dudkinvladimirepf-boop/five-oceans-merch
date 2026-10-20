
/*
  Клуб «5 океанов»
  Раздел «Для разработчиков»

  Вход по паролю Cloudflare ADMIN_PASSWORD.
  Сессия действует 8 часов.

  Новая функция:
  синхронизация каталога Pages CMS с D1.

  - Новые позиции создаются с остатком 0
  - Существующие остатки сохраняются
  - Привязка по постоянному product_id
  - Старые записи по slug связываются с ID
  - Удалённые из каталога размеры
    не удаляются автоматически
*/

const COOKIE_NAME = "__Host-fo-admin";
const SESSION_SECONDS = 8 * 3600;
const encoder = new TextEncoder();

/* ОБЩИЕ ФУНКЦИИ */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("ru-RU");
}

function htmlResponse(body, status = 200) {
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

function redirectWithCookie(cookie) {
  return new Response(null, {
    status: 303,
    headers: {
      "Location": "/developers",
      "Set-Cookie": cookie,
      "Cache-Control": "no-store"
    }
  });
}

function getSecret(env) {
  return typeof env.ADMIN_PASSWORD === "string" &&
    env.ADMIN_PASSWORD.length > 0
      ? env.ADMIN_PASSWORD
      : null;
}

/* ПАРОЛЬ И СЕССИЯ */

async function passwordsMatch(input, secret) {
  const [aHash, bHash] = await Promise.all([
    crypto.subtle.digest(
      "SHA-256",
      encoder.encode(input)
    ),
    crypto.subtle.digest(
      "SHA-256",
      encoder.encode(secret)
    )
  ]);

  const a = new Uint8Array(aHash);
  const b = new Uint8Array(bHash);

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

async function sessionKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded = base64.padEnd(
    Math.ceil(base64.length / 4) * 4,
    "="
  );

  const binary = atob(padded);

  return Uint8Array.from(
    binary,
    char => char.charCodeAt(0)
  );
}

async function createSession(secret) {
  const expiry = String(
    Math.floor(Date.now() / 1000) +
    SESSION_SECONDS
  );

  const key = await sessionKey(secret);

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(expiry)
  );

  return expiry + "." +
    toBase64Url(new Uint8Array(signature));
}

function getCookie(request) {
  const raw = request.headers.get("Cookie") || "";
  const prefix = COOKIE_NAME + "=";

  const entry = raw
    .split(";")
    .map(item => item.trim())
    .find(item => item.startsWith(prefix));

  return entry ? entry.slice(prefix.length) : null;
}

function sessionCookie(value) {
  return (
    COOKIE_NAME + "=" + value +
    "; Path=/" +
    "; HttpOnly" +
    "; Secure" +
    "; SameSite=Strict" +
    "; Max-Age=" + SESSION_SECONDS
  );
}

function expiredCookie() {
  return (
    COOKIE_NAME + "=" +
    "; Path=/" +
    "; HttpOnly" +
    "; Secure" +
    "; SameSite=Strict" +
    "; Max-Age=0"
  );
}

async function isAuthorized(request, secret) {
  const cookie = getCookie(request);

  if (!cookie) return false;

  try {
    const parts = cookie.split(".");

    if (parts.length !== 2) return false;

    const [expiry, signature] = parts;

    if (
      !/^\d{10,12}$/.test(expiry) ||
      !/^[A-Za-z0-9_-]{43}$/.test(signature)
    ) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Number(expiry);

    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now ||
      expiresAt > now + SESSION_SECONDS
    ) {
      return false;
    }

    const key = await sessionKey(secret);

    return crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      encoder.encode(expiry)
    );

  } catch {
    return false;
  }
}

/* ЗАЩИТА КНОПКИ СИНХРОНИЗАЦИИ */

async function createCsrfToken(request, secret) {
  const cookie = getCookie(request);

  if (!cookie) return "";

  const key = await sessionKey(secret);

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode("catalog-sync:" + cookie)
  );

  return toBase64Url(new Uint8Array(signature));
}

async function verifyCsrfToken(
  request,
  secret,
  submittedToken
) {
  const cookie = getCookie(request);

  if (
    !cookie ||
    !/^[A-Za-z0-9_-]{43}$/.test(submittedToken)
  ) {
    return false;
  }

  try {
    const key = await sessionKey(secret);

    return crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(submittedToken),
      encoder.encode("catalog-sync:" + cookie)
    );
  } catch {
    return false;
  }
}

/* ЧТЕНИЕ КАТАЛОГА PAGES CMS */

async function loadProducts(context) {
  if (!context.env.ASSETS) {
    throw new Error(
      "Не удалось получить опубликованный каталог."
    );
  }

  const url = new URL(
    "/data/products.json",
    context.request.url
  );

  const response = await context.env.ASSETS.fetch(
    new Request(url.toString(), {
      headers: { "Cache-Control": "no-cache" }
    })
  );

  if (!response.ok) {
    throw new Error(
      "Каталог недоступен: HTTP " + response.status
    );
  }

  const products = await response.json();

  if (!Array.isArray(products)) {
    throw new Error(
      "Неверный формат data/products.json."
    );
  }

  return products;
}

/* ЧТЕНИЕ СКЛАДА D1 */

async function loadInventory(env) {
  if (!env.DB) {
    throw new Error("База D1 не подключена.");
  }

  const result = await env.DB
    .prepare(
      `SELECT
         product_slug,
         product_id,
         size,
         total_quantity,
         reserved_quantity,
         total_quantity - reserved_quantity
           AS available_quantity,
         updated_at
       FROM inventory
       ORDER BY product_slug, size
       LIMIT 500`
    )
    .all();

  return result.results || [];
}

/* ПОДГОТОВКА ПОЗИЦИЙ КАТАЛОГА */

function prepareCatalog(products) {
  const positions = [];
  const warnings = [];

  const usedIds = new Map();
  const usedSlugs = new Map();

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  for (const product of products) {
    if (!product || typeof product !== "object") {
      continue;
    }

    const title = String(
      product.title || "Без названия"
    );

    const slug = String(
      product.slug || ""
    ).trim();

    const id = String(
      product.product_id || ""
    ).trim().toLowerCase();

    if (!slug) {
      warnings.push(
        "Пропущен товар «" + title +
        "»: отсутствует slug."
      );
      continue;
    }

    if (!uuidPattern.test(id)) {
      warnings.push(
        "Пропущен товар «" + title +
        "»: отсутствует сохранённый product_id."
      );
      continue;
    }

    if (
      usedIds.has(id) &&
      usedIds.get(id) !== slug
    ) {
      throw new Error(
        "Одинаковый product_id у разных товаров: " +
        usedIds.get(id) + " и " + slug
      );
    }

    if (
      usedSlugs.has(slug) &&
      usedSlugs.get(slug) !== id
    ) {
      throw new Error(
        "Одинаковый slug у разных товаров: " + slug
      );
    }

    usedIds.set(id, slug);
    usedSlugs.set(slug, id);

    const sizes = Array.isArray(product.sizes)
      ? [...new Set(
          product.sizes
            .map(size => String(size ?? "").trim())
            .filter(Boolean)
        )]
      : [];

    if (!sizes.length) {
      sizes.push("");
    }

    for (const size of sizes) {
      positions.push({
        product_id: id,
        product_slug: slug,
        size
      });
    }
  }

  if (positions.length > 1000) {
    throw new Error(
      "Слишком много складских позиций для одной синхронизации."
    );
  }

  return { positions, warnings };
}

/* СИНХРОНИЗАЦИЯ СКЛАДА */

async function synchronizeCatalog(context) {
  const db = context.env.DB;

  if (!db) {
    throw new Error("База D1 не подключена.");
  }

  const products = await loadProducts(context);

  const { positions, warnings } =
    prepareCatalog(products);

  const summary = {
    created: 0,
    linked: 0,
    renamed: 0,
    unchanged: 0,
    warnings
  };

  /*
    Каждую складскую позицию связываем
    сначала по product_id, затем по slug.

    Остатки и резервы НЕ обнуляем.
  */

  for (const position of positions) {
    const { product_id, product_slug, size } =
      position;

    /* 1. Уже есть запись с таким ID и размером */

    const byId = await db
      .prepare(
        `SELECT product_slug
         FROM inventory
         WHERE product_id = ?
           AND size = ?
         LIMIT 1`
      )
      .bind(product_id, size)
      .first();

    if (byId) {
      if (byId.product_slug === product_slug) {
        summary.unchanged++;
        continue;
      }

      /*
        Если slug изменился, сначала проверяем,
        что новый адрес свободен.
      */

      const conflict = await db
        .prepare(
          `SELECT product_id
           FROM inventory
           WHERE product_slug = ?
             AND size = ?
           LIMIT 1`
        )
        .bind(product_slug, size)
        .first();

      if (conflict) {
        summary.warnings.push(
          "Конфликт адреса товара: " +
          product_slug + ", размер " +
          (size || "без размера")
        );
        continue;
      }

      await db
        .prepare(
          `UPDATE inventory
           SET product_slug = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE product_id = ?
             AND size = ?
             AND product_slug = ?`
        )
        .bind(
          product_slug,
          product_id,
          size,
          byId.product_slug
        )
        .run();

      summary.renamed++;
      continue;
    }

    /* 2. Ищем старую запись по slug и размеру */

    const bySlug = await db
      .prepare(
        `SELECT product_id
         FROM inventory
         WHERE product_slug = ?
           AND size = ?
         LIMIT 1`
      )
      .bind(product_slug, size)
      .first();

    if (bySlug) {
      const previousId =
        String(bySlug.product_id || "")
          .trim()
          .toLowerCase();

      if (previousId && previousId !== product_id) {
        summary.warnings.push(
          "Конфликт product_id: " +
          product_slug + ", размер " +
          (size || "без размера")
        );
        continue;
      }

      if (!previousId) {
        await db
          .prepare(
            `UPDATE inventory
             SET product_id = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE product_slug = ?
               AND size = ?`
          )
          .bind(product_id, product_slug, size)
          .run();

        summary.linked++;
      } else {
        summary.unchanged++;
      }

      continue;
    }

    /* 3. Новая позиция: создаём с остатком 0 */

    await db
      .prepare(
        `INSERT OR IGNORE INTO inventory (
           product_slug,
           product_id,
           size,
           total_quantity,
           reserved_quantity
         )
         VALUES (?, ?, ?, 0, 0)`
      )
      .bind(product_slug, product_id, size)
      .run();

    summary.created++;
  }

  return summary;
}

/* ОТОБРАЖЕНИЕ ТАБЛИЦЫ */

function renderInventory(inventory, products) {
  if (!inventory.length) {
    return `
      <p class="muted">
        Склад пока пуст.
      </p>
    `;
  }

  const byId = new Map();
  const bySlug = new Map();

  for (const product of products) {
    if (!product) continue;

    if (product.product_id) {
      byId.set(
        String(product.product_id).toLowerCase(),
        product.title
      );
    }

    if (product.slug) {
      bySlug.set(product.slug, product.title);
    }
  }

  const rows = inventory.map(item => {
    const title =
      byId.get(
        String(item.product_id || "").toLowerCase()
      ) ||
      bySlug.get(item.product_slug) ||
      item.product_slug;

    const size = item.size || "Без размера";

    return `
      <tr>
        <td>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(item.product_slug)}</small>
        </td>

        <td>${escapeHtml(size)}</td>

        <td class="number">
          ${formatNumber(item.total_quantity)}
        </td>

        <td class="number">
          ${formatNumber(item.reserved_quantity)}
        </td>

        <td class="number available">
          ${formatNumber(item.available_quantity)}
        </td>
      </tr>
    `;
  }).join("");

  return `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Товар</th>
            <th>Размер</th>
            <th class="number">На складе</th>
            <th class="number">Резерв</th>
            <th class="number">Доступно</th>
          </tr>
        </thead>

        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

/* СООБЩЕНИЕ О СИНХРОНИЗАЦИИ */

function renderSyncSummary(summary) {
  if (!summary) return "";

  const warningBlock = summary.warnings.length
    ? `
      <div class="warning">
        <strong>Требуется внимание:</strong>

        <ul>
          ${summary.warnings.map(
            text => `<li>${escapeHtml(text)}</li>`
          ).join("")}
        </ul>

        <p>
          Для товаров без product_id открой
          карточку в Pages CMS, проверь
          поле ID и сохрани товар.
        </p>
      </div>
    `
    : "";

  return `
    <div class="success">
      ✓ Синхронизация завершена
    </div>

    <p class="sync-report">
      Новых складских позиций:
      <strong>${summary.created}</strong>

      <span>·</span>

      Привязано существующих:
      <strong>${summary.linked}</strong>

      <span>·</span>

      Обновлено адресов:
      <strong>${summary.renamed}</strong>
    </p>

    ${warningBlock}
  `;
}

/* ПАНЕЛЬ АДМИНИСТРАТОРА */

async function renderDashboard(
  context,
  secret,
  summary = null,
  operationError = ""
) {
  let inventory = [];
  let products = [];
  let inventoryError = "";
  let catalogError = "";

  try {
    inventory = await loadInventory(context.env);
  } catch (error) {
    console.error(error);
    inventoryError =
      "Не удалось загрузить остатки склада.";
  }

  try {
    products = await loadProducts(context);
  } catch (error) {
    console.error(error);
    catalogError =
      "Не удалось загрузить каталог Pages CMS.";
  }

  const total = inventory.reduce(
    (sum, item) =>
      sum + Number(item.total_quantity || 0),
    0
  );

  const reserved = inventory.reduce(
    (sum, item) =>
      sum + Number(item.reserved_quantity || 0),
    0
  );

  const csrf = await createCsrfToken(
    context.request,
    secret
  );

  return `
    <div class="success">
      ✓ Вход выполнен
    </div>

    <h2>Склад</h2>

    <div class="stats">

      <div class="stat">
        <span>На складе</span>
        <strong>${formatNumber(total)}</strong>
      </div>

      <div class="stat">
        <span>В резерве</span>
        <strong>${formatNumber(reserved)}</strong>
      </div>

      <div class="stat">
        <span>Доступно</span>
        <strong class="green">
          ${formatNumber(total - reserved)}
        </strong>
      </div>

    </div>

    <div class="section">

      <div class="section-header">
        <h3>Складские остатки</h3>

        <a href="/developers" class="refresh">
          ↻ Обновить
        </a>
      </div>

      <div class="sync-area">
        <p class="muted">
          Добавление новых товаров и размеров
          из Pages CMS без сброса остатков.
        </p>

        <form
          method="POST"
          action="/developers"
        >
          <input
            type="hidden"
            name="action"
            value="sync"
          >

          <input
            type="hidden"
            name="csrf"
            value="${escapeHtml(csrf)}"
          >

          <button
            class="sync-button"
            type="submit"
          >
            ↻ Синхронизировать с Pages CMS
          </button>
        </form>
      </div>

      ${renderSyncSummary(summary)}

      ${operationError
        ? `<div class="error">${escapeHtml(operationError)}</div>`
        : ""}

      ${inventoryError
        ? `<div class="error">${escapeHtml(inventoryError)}</div>`
        : ""}

      ${catalogError
        ? `<div class="warning">${escapeHtml(catalogError)}</div>`
        : ""}

      ${inventoryError
        ? ""
        : renderInventory(inventory, products)
      }

    </div>

    <div class="section">
      <h3>Заказы</h3>

      <p class="muted">
        Здесь появятся заказы, кнопки
        «В резерв», «Оплачено» и «Отменить».
      </p>
    </div>

    <form method="POST" action="/developers">
      <input
        type="hidden"
        name="action"
        value="logout"
      >

      <button class="logout" type="submit">
        Выйти из панели
      </button>
    </form>
  `;
}

/* ФОРМА ВХОДА */

function renderLogin(error = "") {
  return `
    <p class="muted">
      Закрытый раздел управления магазином
      Клуба «5 океанов».
    </p>

    ${error
      ? `<div class="error">${escapeHtml(error)}</div>`
      : ""
    }

    <form method="POST" action="/developers">

      <input
        type="hidden"
        name="action"
        value="login"
      >

      <label for="password">
        Пароль администратора
      </label>

      <input
        id="password"
        type="password"
        name="password"
        autocomplete="current-password"
        maxlength="256"
        required
      >

      <button class="login" type="submit">
        Войти
      </button>

    </form>
  `;
}

/* ОБЩАЯ СТРАНИЦА */

function renderPage(body, loggedIn) {
  return `
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1"
>

<meta
  name="robots"
  content="noindex, nofollow"
>

<title>Для разработчиков — 5 океанов</title>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f5f7fa;
  color: #14283a;
  font-family: Arial, sans-serif;
}

a {
  color: inherit;
  text-decoration: none;
}

header {
  background: #102c43;
  padding: 22px 5%;
  color: white;
}

header a {
  color: white;
  font-size: 20px;
  font-weight: bold;
}

main {
  max-width: ${loggedIn ? "1150px" : "560px"};
  margin: 55px auto;
  padding: 20px;
}

.card {
  padding: 30px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 5px 25px #102c4312;
}

h1 {
  margin: 0 0 12px;
  font-size: 28px;
}

h2 {
  margin: 35px 0 20px;
  font-size: 24px;
}

h3 {
  margin: 0;
  font-size: 19px;
}

.muted {
  color: #71808e;
  line-height: 1.6;
}

label {
  display: block;
  margin: 25px 0 10px;
  font-size: 14px;
  font-weight: bold;
}

input[type="password"] {
  display: block;
  width: 100%;
  padding: 15px;
  border: 1px solid #cbd5df;
  border-radius: 9px;
  font-size: 16px;
}

button {
  cursor: pointer;
  font-size: 15px;
  font-weight: bold;
}

.login {
  width: 100%;
  padding: 16px;
  margin-top: 20px;
  border: none;
  border-radius: 9px;
  background: #146789;
  color: white;
}

.success {
  padding: 13px 16px;
  margin: 15px 0;
  border-radius: 9px;
  background: #eaf7ee;
  color: #28734a;
  font-size: 14px;
  font-weight: bold;
}

.error {
  padding: 15px;
  margin: 15px 0;
  border-radius: 9px;
  background: #fff0f0;
  color: #a03b3b;
  line-height: 1.5;
}

.warning {
  padding: 15px;
  margin: 15px 0;
  border-radius: 9px;
  background: #fff6df;
  color: #765510;
  font-size: 14px;
  line-height: 1.6;
}

.warning ul {
  padding-left: 20px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
  margin-bottom: 30px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 22px;
  background: #f5f7fa;
  border-radius: 12px;
}

.stat span {
  color: #71808e;
  font-size: 14px;
}

.stat strong {
  font-size: 30px;
  font-variant-numeric: tabular-nums;
}

.green {
  color: #28734a;
}

.section {
  padding: 25px;
  margin-bottom: 25px;
  border: 1px solid #e0e7ed;
  border-radius: 12px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
  margin-bottom: 20px;
}

.refresh {
  color: #146789;
  font-size: 14px;
  font-weight: bold;
  white-space: nowrap;
}

.sync-area {
  padding: 18px;
  margin-bottom: 18px;
  border: 1px solid #dbe8ef;
  border-radius: 12px;
  background: #f5f9fc;
}

.sync-area p {
  margin-top: 0;
  font-size: 14px;
}

.sync-button {
  padding: 13px 18px;
  border: 0;
  border-radius: 9px;
  background: #146789;
  color: white;
  font-size: 14px;
}

.sync-button:hover {
  background: #10516d;
}

.sync-report {
  font-size: 14px;
  line-height: 1.7;
}

.sync-report span {
  color: #93a0aa;
  padding: 0 5px;
}

.table-scroll {
  overflow-x: auto;
}

table {
  width: 100%;
  min-width: 650px;
  border-collapse: collapse;
}

th, td {
  padding: 15px 12px;
  border-bottom: 1px solid #e8edf1;
  text-align: left;
  font-size: 14px;
}

th {
  color: #71808e;
  font-size: 12px;
}

td strong {
  display: block;
  margin-bottom: 5px;
}

td small {
  display: block;
  color: #93a0aa;
  font-size: 11px;
  word-break: break-all;
}

.number {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.available {
  color: #28734a;
  font-weight: bold;
}

.logout {
  width: 100%;
  padding: 14px;
  margin-top: 15px;
  border: 1px solid #cbd5df;
  border-radius: 9px;
  background: white;
  color: #102c43;
}

@media (max-width: 650px) {
  main {
    margin: 25px auto;
    padding: 12px;
  }

  .card {
    padding: 20px;
  }

  h1 {
    font-size: 24px;
  }

  .stats {
    gap: 8px;
  }

  .stat {
    padding: 12px;
  }

  .stat span {
    font-size: 11px;
  }

  .stat strong {
    font-size: 23px;
  }

  .section {
    padding: 15px;
  }

  .sync-button {
    width: 100%;
  }
}
</style>

</head>
<body>

<header>
  <a href="/">5 ОКЕАНОВ</a>
</header>

<main>
  <div class="card">
    <h1>Для разработчиков</h1>
    ${body}
  </div>
</main>

</body>
</html>
`;
}

/* GET — ОТКРЫТИЕ ПАНЕЛИ */

export async function onRequestGet(context) {
  const { request, env } = context;
  const secret = getSecret(env);

  if (!secret) {
    return htmlResponse(
      renderPage(
        renderLogin(
          "Пароль администратора не настроен."
        ),
        false
      ),
      503
    );
  }

  if (!(await isAuthorized(request, secret))) {
    return htmlResponse(
      renderPage(renderLogin(), false)
    );
  }

  const dashboard = await renderDashboard(
    context,
    secret
  );

  return htmlResponse(
    renderPage(dashboard, true)
  );
}

/* POST — ВХОД, ВЫХОД, СИНХРОНИЗАЦИЯ */

export async function onRequestPost(context) {
  const { request, env } = context;
  const secret = getSecret(env);

  if (!secret) {
    return htmlResponse(
      renderPage(
        renderLogin(
          "Пароль администратора не настроен."
        ),
        false
      ),
      503
    );
  }

  const fetchSite = request.headers.get(
    "Sec-Fetch-Site"
  );

  if (fetchSite === "cross-site") {
    return new Response("Forbidden", {
      status: 403
    });
  }

  const contentLength = Number(
    request.headers.get("Content-Length") || "0"
  );

  if (contentLength > 4096) {
    return new Response("Request too large", {
      status: 413
    });
  }

  let form;

  try {
    form = await request.formData();
  } catch {
    return htmlResponse(
      renderPage(
        renderLogin("Ошибка чтения формы."),
        false
      ),
      400
    );
  }

  const action = String(
    form.get("action") || ""
  );

  /* ВЫХОД */

  if (action === "logout") {
    if (!(await isAuthorized(request, secret))) {
      return htmlResponse(
        renderPage(renderLogin(), false),
        401
      );
    }

    return redirectWithCookie(
      expiredCookie()
    );
  }

  /* СИНХРОНИЗАЦИЯ */

  if (action === "sync") {
    if (!(await isAuthorized(request, secret))) {
      return htmlResponse(
        renderPage(renderLogin(), false),
        401
      );
    }

    const csrf = String(
      form.get("csrf") || ""
    );

    if (
      !(await verifyCsrfToken(
        request,
        secret,
        csrf
      ))
    ) {
      return htmlResponse(
        renderPage(
          "<p>Ошибка проверки запроса. " +
          "Обновите страницу и попробуйте снова.</p>",
          true
        ),
        403
      );
    }

    let summary = null;
    let operationError = "";

    try {
      summary = await synchronizeCatalog(context);
    } catch (error) {
      console.error(
        "Ошибка синхронизации:",
        error
      );

      operationError =
        "Синхронизация не завершена: " +
        error.message;
    }

    const dashboard = await renderDashboard(
      context,
      secret,
      summary,
      operationError
    );

    return htmlResponse(
      renderPage(dashboard, true)
    );
  }

  /* ВХОД */

  if (action !== "login") {
    return htmlResponse(
      renderPage(
        renderLogin("Неизвестное действие."),
        false
      ),
      400
    );
  }

  const password = String(
    form.get("password") || ""
  );

  if (
    !password ||
    password.length > 256 ||
    !(await passwordsMatch(password, secret))
  ) {
    return htmlResponse(
      renderPage(
        renderLogin("Неверный пароль."),
        false
      ),
      401
    );
  }

  const session = await createSession(secret);

  return redirectWithCookie(
    sessionCookie(session)
  );
}


