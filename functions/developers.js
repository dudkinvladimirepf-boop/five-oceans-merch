
/*
  Клуб «5 океанов»
  Закрытый раздел «Для разработчиков»

  Адрес: /developers

  ADMIN_PASSWORD хранится исключительно
  в Cloudflare Variables and Secrets.
*/

const COOKIE_NAME = "__Host-fo-admin";
const SESSION_HOURS = 8;

const encoder = new TextEncoder();

/* ОТВЕТ HTML */

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

/* СТРАНИЦА ВХОДА И АДМИНИСТРАТОРА */

function renderPage(loggedIn, error = "") {

  const form = loggedIn
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
          Здесь появятся остатки товаров,
          размеры и резервы.
        </p>
      </div>

      <div class="panel">
        <div class="panel-title">
          Заказы
        </div>
        <p>
          Здесь появятся заявки, кнопки
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

        <button class="logout" type="submit">
          Выйти
        </button>
      </form>
    `
    : `
      <p class="description">
        Закрытый раздел управления магазином
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
          required
        >

        <button class="login" type="submit">
          Войти
        </button>

      </form>
    `;

  return `
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport"
      content="width=device-width, initial-scale=1">

<meta name="robots"
      content="noindex, nofollow">

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

main {
  max-width: 540px;
  margin: 70px auto;
  padding: 25px;
}

.card {
  padding: 35px;
  background: white;
  border-radius: 16px;
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
  color: #71808e;
  line-height: 1.6;
  margin-bottom: 30px;
}

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

.error {
  padding: 13px;
  margin-bottom: 20px;
  background: #fff0f0;
  border-radius: 8px;
  color: #a03b3b;
  font-size: 14px;
}

.success {
  padding: 13px;
  background: #eaf7ee;
  border-radius: 8px;
  color: #28734a;
  font-weight: bold;
}

.panel {
  padding: 20px;
  margin-bottom: 15px;
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

@media(max-width: 600px) {
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

    ${form}

  </div>
</main>

</body>
</html>
`;
}

/* ПРОВЕРКА ПАРОЛЯ */

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

/* ПОДПИСЬ СЕССИИ */

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
  const encoded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const binary = atob(
    encoded.padEnd(
      Math.ceil(encoded.length / 4) * 4,
      "="
    )
  );

  return Uint8Array.from(
    binary,
    character => character.charCodeAt(0)
  );
}

async function createSession(secret) {

  const expiry = String(
    Math.floor(Date.now() / 1000) +
    SESSION_HOURS * 3600
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

/* ЧТЕНИЕ COOKIE */

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

/* ПРОВЕРКА АВТОРИЗАЦИИ */

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
      expiryNumber > now + SESSION_HOURS * 3600
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

/* СОЗДАНИЕ COOKIE */

function sessionCookie(value) {
  return (
    COOKIE_NAME + "=" + value +
    "; Path=/" +
    "; HttpOnly" +
    "; Secure" +
    "; SameSite=Strict" +
    "; Max-Age=" + SESSION_HOURS * 3600
  );
}

/* УДАЛЕНИЕ COOKIE */

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

/* ПЕРЕХОД ПОСЛЕ ВХОДА */

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

/* ЕСЛИ СЕКРЕТ НЕ ПОДКЛЮЧЁН */

function getSecret(env) {
  return typeof env.ADMIN_PASSWORD === "string" &&
    env.ADMIN_PASSWORD.length > 0
      ? env.ADMIN_PASSWORD
      : null;
}

/* ОТКРЫТИЕ СТРАНИЦЫ */

export async function onRequestGet({ request, env }) {

  const secret = getSecret(env);

  if (!secret) {
    return htmlResponse(
      renderPage(
        false,
        "Пароль администратора не настроен."
      ),
      503
    );
  }

  const loggedIn =
    await isAuthorized(request, secret);

  return htmlResponse(
    renderPage(loggedIn)
  );
}

/* ОБРАБОТКА ВХОДА И ВЫХОДА */

export async function onRequestPost({ request, env }) {

  const secret = getSecret(env);

  if (!secret) {
    return htmlResponse(
      renderPage(
        false,
        "Пароль администратора не настроен."
      ),
      503
    );
  }

  /*
    Запрещаем отправку формы
    с постороннего сайта.
  */

  const origin = request.headers.get("Origin");
  const expectedOrigin = new URL(request.url).origin;

  if (origin && origin !== expectedOrigin) {
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
      renderPage(false, "Ошибка формы входа."),
      400
    );
  }

  const action = String(form.get("action") || "");

  /* ВЫХОД */

  if (action === "logout") {
    return redirectWithCookie(
      expiredCookie()
    );
  }

  if (action !== "login") {
    return htmlResponse(
      renderPage(false, "Неизвестное действие."),
      400
    );
  }

  /* ВХОД */

  const password = String(
    form.get("password") || ""
  );

  if (
    password.length > 256 ||
    !(await passwordsMatch(password, secret))
  ) {
    return htmlResponse(
      renderPage(false, "Неверный пароль."),
      401
    );
  }

  const session = await createSession(secret);

  return redirectWithCookie(
    sessionCookie(session)
  );
}
