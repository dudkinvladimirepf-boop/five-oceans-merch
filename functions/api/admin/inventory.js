
/*
  Клуб «5 океанов»
  Закрытый API складских остатков

  Адрес:
  /api/admin/inventory

  Доступ только с действующей
  административной сессией.
*/

const COOKIE_NAME = "__Host-fo-admin";
const SESSION_SECONDS = 8 * 3600;

const encoder = new TextEncoder();

/* JSON-ОТВЕТ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Vary": "Cookie"
    }
  });
}

/* ЧТЕНИЕ COOKIE */

function getSessionCookie(request) {

  const cookies = request.headers.get("Cookie") || "";
  const prefix = COOKIE_NAME + "=";

  const entry = cookies
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(prefix));

  return entry
    ? entry.slice(prefix.length)
    : null;
}

/* ДЕКОДИРОВАНИЕ ПОДПИСИ */

function decodeBase64Url(value) {

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
    character => character.charCodeAt(0)
  );
}

/* ПРОВЕРКА АДМИНИСТРАТИВНОЙ СЕССИИ */

async function isAuthorized(request, secret) {

  const cookie = getSessionCookie(request);

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

    /*
      Проверяем ту же HMAC-подпись,
      которую создаёт developers.js.
    */

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["verify"]
    );

    return await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(signature),
      encoder.encode(expiry)
    );

  } catch (error) {

    console.error("Ошибка проверки сессии:", error);

    return false;
  }
}

/* ПОЛУЧЕНИЕ СКЛАДСКИХ ОСТАТКОВ */

export async function onRequestGet({ request, env }) {

  /* Проверяем серверный секрет */

  const secret = env.ADMIN_PASSWORD;

  if (
    typeof secret !== "string" ||
    secret.length === 0
  ) {
    return json(
      { error: "Администратор не настроен" },
      503
    );
  }

  /* Проверяем авторизацию */

  const authorized = await isAuthorized(
    request,
    secret
  );

  if (!authorized) {
    return json(
      { error: "Требуется авторизация" },
      401
    );
  }

  /* Проверяем подключение базы */

  if (!env.DB) {
    return json(
      { error: "База данных не подключена" },
      503
    );
  }

  try {

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

    return json({
      success: true,
      inventory: result.results || []
    });

  } catch (error) {

    console.error("Ошибка получения склада:", error);

    return json(
      { error: "Ошибка загрузки склада" },
      500
    );
  }
}
