
/*
  Клуб «5 океанов»
  Раздел «Для разработчиков»

  Функции:
  - Вход по паролю из Cloudflare Secret
  - Защищённая сессия на 8 часов
  - Просмотр склада из Cloudflare D1
  - Названия товаров из Pages CMS
  - Выход из административной панели

  Адрес: /developers

  Пока только просмотр склада.
  Изменения остатков не предусмотрены.
*/

const COOKIE_NAME = "__Host-fo-admin";
const SESSION_SECONDS = 8 * 3600;

const encoder = new TextEncoder();

/* ======================================
   ОБЩИЕ ФУНКЦИИ
====================================== */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value) {
  return Number(value || 0)
    .toLocaleString("ru-RU");
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

/* ======================================
   ПОЛУЧЕНИЕ ПАРОЛЯ
====================================== */

function getSecret(env) {
  const secret = env.ADMIN_PASSWORD;

  return (
    typeof secret === "string" &&
    secret.length > 0
  ) ? secret : null;
}

/* ======================================
   СРАВНЕНИЕ ПАРОЛЕЙ
====================================== */

async function passwordsMatch(input, secret) {

  const [inputHash, secretHash] =
    await Promise.all([
      crypto.subtle.digest(
        "SHA-256",
        encoder.encode(input)
      ),
      crypto.subtle.digest(
        "SHA-256",
        encoder.encode(secret)
      )
    ]);

  const a = new Uint8Array(inputHash);
  const b = new Uint8Array(secretHash);

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

/* ======================================
   АДМИНИСТРАТИВНАЯ СЕССИЯ
====================================== */

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

  return (
    expiry + "." +
    toBase64Url(new Uint8Array(signature))
  );
}

function getCookie(request) {

  const cookies =
    request.headers.get("Cookie") || "";

  const prefix = COOKIE_NAME + "=";

  const entry = cookies
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(prefix));

  return entry
    ? entry.slice(prefix.length)
    : null;
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

    if (parts.length !== 2) {
      return false;
    }

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

    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      encoder.encode(expiry)
    );

  } catch {
    return false;
  }
}

/* ======================================
   ЧТЕНИЕ СКЛАДА ИЗ CLOUDFLARE D1
====================================== */

async function loadInventory(env) {

  if (!env.DB) {
    throw new Error(
      "База данных D1 не подключена."
    );
  }

  const result = await env.DB
    .prepare(
      `SELECT
         product_slug,
         size,
         total_quantity,
         reserved_quantity,
         (
           total_quantity - reserved_quantity
         ) AS available_quantity,
         updated_at
       FROM inventory
       ORDER BY product_slug, size
       LIMIT 500`
    )
    .all();

  return Array.isArray(result.results)
    ? result.results
    : [];
}

/* ======================================
   НАЗВАНИЯ ТОВАРОВ ИЗ PAGES CMS

   Склад использует product_slug.
   Находим соответствующее название
   в data/products.json.

   Если каталог недоступен,
   показываем сам slug.
====================================== */

async function loadProductNames(context) {

  const names = new Map();

  try {

    if (!context.env.ASSETS) {
      return names;
    }

    const catalogUrl = new URL(
      "/data/products.json",
      context.request.url
    );

    const response = await context.env.ASSETS.fetch(
      new Request(catalogUrl.toString())
    );

    if (!response.ok) {
      return names;
    }

    const products = await response.json();

    if (!Array.isArray(products)) {
      return names;
    }

    for (const product of products) {

      if (
        product &&
        typeof product.slug === "string" &&
        typeof product.title === "string"
      ) {
        names.set(
          product.slug,
          product.title
        );
      }
    }

  } catch (error) {
    console.error(
      "Не удалось загрузить названия товаров:",
      error
    );
  }

  return names;
}

/* ======================================
   ОТРИСОВКА СКЛАДСКОЙ ТАБЛИЦЫ
====================================== */

function renderInventory(inventory, productNames) {

  if (!inventory.length) {
    return `
      <div class="empty">
        На складе пока нет товаров.
      </div>
    `;
  }

  const rows = inventory.map(item => {

    const title = productNames.get(
      item.product_slug
    ) || item.product_slug;

    const size = item.size || "Без размера";

    const total = Number(item.total_quantity) || 0;
    const reserved = Number(item.reserved_quantity) || 0;
    const available = Number(item.available_quantity) || 0;

    return `
      <tr>
        <td>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(item.product_slug)}</small>
        </td>

        <td>
          ${escapeHtml(size)}
        </td>

        <td class="number">
          ${formatNumber(total)}
        </td>

        <td class="number">
          ${formatNumber(reserved)}
        </td>

        <td class="number available-number">
          ${formatNumber(available)}
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

/* ======================================
   АДМИНИСТРАТИВНАЯ ПАНЕЛЬ
====================================== */

function renderDashboard(
  inventory,
  productNames,
  stockError
) {

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

  const available = total - reserved;

  const stockContent = stockError
    ? `
      <div class="error">
        ${escapeHtml(stockError)}
      </div>
    `
    : renderInventory(inventory, productNames);

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
          ${formatNumber(available)}
        </strong>
      </div>

    </div>

    <div class="section">

      <div class="section-header">
        <h3>Складские остатки</h3>

        <a class="refresh" href="/developers">
          ↻ Обновить
        </a>
      </div>

      ${stockContent}

    </div>

    <div class="section">

      <h3>Заказы</h3>

      <p class="muted">
        Здесь появятся заявки покупателей,
        а также кнопки «В резерв»,
        «Оплачено» и «Отменить».
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

/* ======================================
   ФОРМА ВХОДА
====================================== */

function renderLogin(error) {

  const errorBlock = error
    ? `
      <div class="error">
        ${escapeHtml(error)}
      </div>
    `
    : "";

  return `
    <p class="muted">
      Закрытый раздел управления магазином
      Клуба «5 океанов».
    </p>

    ${errorBlock}

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

/* ======================================
   ПОЛНАЯ HTML-СТРАНИЦА
====================================== */

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

/* ШАПКА */

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

/* ОСНОВНОЕ СОДЕРЖИМОЕ */

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

/* ВХОД */

.login {
  width: 100%;
  padding: 16px;
  margin-top: 20px;
  border: none;
  border-radius: 9px;
  background: #146789;
  color: white;
}

/* СООБЩЕНИЯ */

.success {
  padding: 13px 16px;
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

/* ОБЩАЯ СТАТИСТИКА */

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

/* СЕКЦИИ */

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

/* ТАБЛИЦА */

.table-scroll {
  overflow-x: auto;
}

table {
  width: 100%;
  min-width: 650px;
  border-collapse: collapse;
}

th,
td {
  padding: 15px 12px;
  text-align: left;
  border-bottom: 1px solid #e8edf1;
  font-size: 14px;
}

th {
  color: #71808e;
  font-size: 12px;
  font-weight: bold;
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

.available-number {
  color: #28734a;
  font-weight: bold;
}

.empty {
  padding: 30px 0;
  text-align: center;
  color: #71808e;
}

/* ВЫХОД */

.logout {
  width: 100%;
  padding: 14px;
  margin-top: 15px;
  border: 1px solid #cbd5df;
  border-radius: 9px;
  background: white;
  color: #102c43;
}

/* МОБИЛЬНАЯ ВЕРСИЯ */

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

/* ======================================
   GET — ОТКРЫТИЕ СТРАНИЦЫ
====================================== */

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

  const authorized = await isAuthorized(
    request,
    secret
  );

  /* НЕ АВТОРИЗОВАН */

  if (!authorized) {
    return htmlResponse(
      renderPage(
        renderLogin(""),
        false
      )
    );
  }

  /* АВТОРИЗОВАН — ЗАГРУЖАЕМ СКЛАД */

  let inventory = [];
  let stockError = "";

  try {
    inventory = await loadInventory(env);

  } catch (error) {
    console.error(
      "Ошибка загрузки склада:",
      error
    );

    stockError =
      "Не удалось загрузить складские остатки.";
  }

  const productNames =
    await loadProductNames(context);

  const dashboard = renderDashboard(
    inventory,
    productNames,
    stockError
  );

  return htmlResponse(
    renderPage(dashboard, true)
  );
}

/* ======================================
   POST — ВХОД И ВЫХОД
====================================== */

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

  /* БЛОКИРУЕМ МЕЖСАЙТОВЫЕ ЗАПРОСЫ */

  const fetchSite = request.headers.get(
    "Sec-Fetch-Site"
  );

  if (fetchSite === "cross-site") {
    return new Response(
      "Forbidden",
      { status: 403 }
    );
  }

  /* ОГРАНИЧЕНИЕ РАЗМЕРА ФОРМЫ */

  const contentLength = Number(
    request.headers.get("Content-Length") || "0"
  );

  if (contentLength > 4096) {
    return new Response(
      "Request too large",
      { status: 413 }
    );
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

    const authorized = await isAuthorized(
      request,
      secret
    );

    if (!authorized) {
      return htmlResponse(
        renderPage(renderLogin(""), false),
        401
      );
    }

    return redirectWithCookie(
      expiredCookie()
    );
  }

  /* НЕИЗВЕСТНОЕ ДЕЙСТВИЕ */

  if (action !== "login") {
    return htmlResponse(
      renderPage(
        renderLogin("Неизвестное действие."),
        false
      ),
      400
    );
  }

  /* ПРОВЕРКА ПАРОЛЯ */

  const password = String(
    form.get("password") || ""
  );

  if (
    !password ||
    password.length > 256
  ) {
    return htmlResponse(
      renderPage(
        renderLogin("Неверный пароль."),
        false
      ),
      401
    );
  }

  const valid = await passwordsMatch(
    password,
    secret
  );

  if (!valid) {
    return htmlResponse(
      renderPage(
        renderLogin("Неверный пароль."),
        false
      ),
      401
    );
  }

  /* СОЗДАЁМ АДМИНИСТРАТИВНУЮ СЕССИЮ */

  const session = await createSession(
    secret
  );

  return redirectWithCookie(
    sessionCookie(session)
  );
}

