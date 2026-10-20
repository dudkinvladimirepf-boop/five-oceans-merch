
/*
  Клуб «5 океанов»
  Закрытый раздел «Для разработчиков»

  Адрес:
  https://five-oceans-merch.pages.dev/developers

  Пароль хранится в Cloudflare:
  ADMIN_PASSWORD

  Сессия действует 8 часов.
*/

const COOKIE_NAME = "__Host-fo-admin";
const SESSION_HOURS = 8;
const SESSION_SECONDS = SESSION_HOURS * 3600;

const encoder = new TextEncoder();

/* =========================================
   ОБЩИЕ HTTP-ФУНКЦИИ
========================================= */

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
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

/* =========================================
   HTML СТРАНИЦЫ
========================================= */

function renderPage(loggedIn, error = "") {

  const pageContent = loggedIn
    ? `
      <div class="success">
        ✓ Вход выполнен
      </div>

      <h2>Панель управления</h2>

      <div class="panel">
        <div class="panel-title">
          Склад
        </div>

        <p>
          Здесь появятся складские остатки,
          размеры товаров, поступления
          и резервы.
        </p>
      </div>

      <div class="panel">
        <div class="panel-title">
          Заказы
        </div>

        <p>
          Здесь появятся заявки покупателей,
          а также действия:
          «В резерв», «Оплачено»
          и «Отменить».
        </p>
      </div>

      <form method="POST" action="/developers">

        <input
          type="hidden"
          name="action"
          value="logout"
        >

        <button
          class="logout"
          type="submit"
        >
          Выйти
        </button>

      </form>
    `
    : `
      <p class="description">
        Закрытый раздел управления
        магазином Клуба «5 океанов».
      </p>

      ${
        error
          ? '<div class="error">' + error + '</div>'
          : ''
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
          name="password"
          type="password"
          autocomplete="current-password"
          maxlength="256"
          required
        >

        <button
          class="login"
          type="submit"
        >
          Войти
        </button>

      </form>
    `;

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

/* ШАПКА */

header {
  background: #102c43;
  padding: 22px 5%;
  color: white;
}

header a {
  color: white;
  text-decoration: none;
  font-size: 20px;
  font-weight: bold;
}

/* ОСНОВНАЯ СТРАНИЦА */

main {
  max-width: 560px;
  margin: 70px auto;
  padding: 25px;
}

.card {
  background: white;
  border-radius: 16px;
  padding: 35px;
  box-shadow: 0 5px 25px #102c4312;
}

h1 {
  margin: 0 0 16px;
  font-size: 28px;
}

h2 {
  margin: 30px 0 20px;
  font-size: 21px;
}

.description {
  margin-bottom: 30px;
  color: #71808e;
  line-height: 1.6;
}

/* ФОРМА ВХОДА */

label {
  display: block;
  margin-bottom: 10px;
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
  border: 0;
  border-radius: 9px;
  background: #146789;
  color: white;
}

.login:hover {
  background: #10516d;
}

.logout {
  width: 100%;
  padding: 13px;
  margin-top: 30px;
  border: 1px solid #cbd5df;
  border-radius: 9px;
  background: white;
  color: #102c43;
}

.logout:hover {
  background: #e8f0f5;
}

/* СООБЩЕНИЯ */

.error {
  padding: 13px;
  margin-bottom: 20px;
  border-radius: 8px;
  background: #fff0f0;
  color: #a03b3b;
  font-size: 14px;
}

.success {
  padding: 13px;
  border-radius: 8px;
  background: #eaf7ee;
  color: #28734a;
  font-size: 15px;
  font-weight: bold;
}

/* ПАНЕЛЬ УПРАВЛЕНИЯ */

.panel {
  margin-bottom: 15px;
  padding: 20px;
  border: 1px solid #e0e7ed;
  border-radius: 12px;
}

.panel-title {
  font-size: 17px;
  font-weight: bold;
}

.panel p {
  color: #71808e;
  font-size: 14px;
  line-height: 1.6;
}

/* МОБИЛЬНАЯ ВЕРСИЯ */

@media (max-width: 600px) {

  main {
    margin: 30px auto;
    padding: 15px;
  }

  .card {
    padding: 25px;
  }

  h1 {
    font-size: 24px;
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

    ${pageContent}

  </div>

</main>

</body>
</html>
`;
}

/* =========================================
   ПОЛУЧЕНИЕ СЕКРЕТНОГО ПАРОЛЯ
========================================= */

function getSecret(env) {

  const password = env.ADMIN_PASSWORD;

  if (
    typeof password !== "string" ||
    password.length === 0
  ) {
    return null;
  }

  return password;
}

/* =========================================
   БЕЗОПАСНОЕ СРАВНЕНИЕ ПАРОЛЕЙ
========================================= */

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

/* =========================================
   ПОДПИСЬ АДМИНИСТРАТИВНОЙ СЕССИИ
========================================= */

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

/* ПРЕОБРАЗОВАНИЕ В BASE64URL */

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

  const encoded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded = encoded.padEnd(
    Math.ceil(encoded.length / 4) * 4,
    "="
  );

  const binary = atob(padded);

  return Uint8Array.from(
    binary,
    character => character.charCodeAt(0)
  );
}

/* =========================================
   СОЗДАНИЕ СЕССИИ
========================================= */

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
    expiry +
    "." +
    toBase64Url(new Uint8Array(signature))
  );
}

/* =========================================
   РАБОТА С COOKIE
========================================= */

function getCookie(request) {

  const header =
    request.headers.get("Cookie") || "";

  const prefix = COOKIE_NAME + "=";

  const part = header
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(prefix));

  return part
    ? part.slice(prefix.length)
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

/* =========================================
   ПРОВЕРКА АВТОРИЗАЦИИ
========================================= */

async function isAuthorized(request, secret) {

  const cookie = getCookie(request);

  if (!cookie) {
    return false;
  }

  try {

    const parts = cookie.split(".");

    if (parts.length !== 2) {
      return false;
    }

    const [expiry, signature] = parts;

    if (!/^\d+$/.test(expiry)) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);

    const expiryNumber = Number(expiry);

    if (
      !Number.isSafeInteger(expiryNumber) ||
      expiryNumber <= now ||
      expiryNumber > now + SESSION_SECONDS
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

  } catch (error) {

    console.error(
      "Ошибка проверки сессии:",
      error
    );

    return false;
  }
}

/* =========================================
   ПРОВЕРКА МЕЖСАЙТОВЫХ ЗАПРОСОВ

   Исправленная версия.

   Больше не сравниваем Origin
   с адресом Cloudflare.

   Вместо этого используем
   Sec-Fetch-Site, если браузер
   передаёт этот заголовок.
========================================= */

function isCrossSiteRequest(request) {

  const fetchSite = request.headers.get(
    "Sec-Fetch-Site"
  );

  return fetchSite === "cross-site";
}

/* =========================================
   GET — ОТКРЫТИЕ СТРАНИЦЫ
========================================= */

export async function onRequestGet(context) {

  const { request, env } = context;

  const secret = getSecret(env);

  if (!secret) {

    return htmlResponse(
      renderPage(
        false,
        "Пароль администратора не настроен в Cloudflare."
      ),
      503
    );
  }

  const loggedIn = await isAuthorized(
    request,
    secret
  );

  return htmlResponse(
    renderPage(loggedIn)
  );
}

/* =========================================
   POST — ВХОД И ВЫХОД
========================================= */

export async function onRequestPost(context) {

  const { request, env } = context;

  const secret = getSecret(env);

  if (!secret) {

    return htmlResponse(
      renderPage(
        false,
        "Пароль администратора не настроен в Cloudflare."
      ),
      503
    );
  }

  /*
    ИСПРАВЛЕНИЕ FORBIDDEN

    Блокируем явно межсайтовые
    запросы, не полагаясь на
    несовпадающие Origin.
  */

  if (isCrossSiteRequest(request)) {

    return new Response(
      "Forbidden",
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }

  /*
    Ограничиваем размер формы
    по заголовку Content-Length.
  */

  const contentLength = Number(
    request.headers.get("Content-Length") || "0"
  );

  if (contentLength > 4096) {

    return new Response(
      "Request too large",
      { status: 413 }
    );
  }

  /* ПОЛУЧАЕМ ДАННЫЕ ФОРМЫ */

  let form;

  try {

    form = await request.formData();

  } catch (error) {

    return htmlResponse(
      renderPage(
        false,
        "Не удалось прочитать форму."
      ),
      400
    );
  }

  const action = String(
    form.get("action") || ""
  );

  /* =====================================
     ВЫХОД
  ===================================== */

  if (action === "logout") {

    /*
      Выход разрешён только
      из действующей сессии.
    */

    const loggedIn = await isAuthorized(
      request,
      secret
    );

    if (!loggedIn) {

      return htmlResponse(
        renderPage(false),
        401
      );
    }

    return redirectWithCookie(
      expiredCookie()
    );
  }

  /* =====================================
     НЕИЗВЕСТНОЕ ДЕЙСТВИЕ
  ===================================== */

  if (action !== "login") {

    return htmlResponse(
      renderPage(
        false,
        "Неизвестное действие."
      ),
      400
    );
  }

  /* =====================================
     ВХОД ПО ПАРОЛЮ
  ===================================== */

  const password = String(
    form.get("password") || ""
  );

  if (
    password.length === 0 ||
    password.length > 256
  ) {

    return htmlResponse(
      renderPage(
        false,
        "Неверный пароль."
      ),
      401
    );
  }

  const correctPassword = await passwordsMatch(
    password,
    secret
  );

  if (!correctPassword) {

    return htmlResponse(
      renderPage(
        false,
        "Неверный пароль."
      ),
      401
    );
  }

  /* СОЗДАЁМ СЕССИЮ */

  const session = await createSession(
    secret
  );

  /* СОХРАНЯЕМ COOKIE И ОТКРЫВАЕМ ПАНЕЛЬ */

  return redirectWithCookie(
    sessionCookie(session)
  );
}
