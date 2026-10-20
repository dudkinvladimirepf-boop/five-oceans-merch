
/*
  Клуб «5 океанов»
  Панель разработчиков

  Функции:
  - Защищённый вход
  - Просмотр складских остатков
  - Ручная синхронизация Pages CMS -> D1
  - Редактирование количества
  - Удаление устаревших пустых позиций

  Остатки хранятся в Cloudflare D1.
*/

const COOKIE_NAME = "__Host-fo-admin";
const SESSION_SECONDS = 8 * 3600;
const MAX_STOCK = 1000000;
const encoder = new TextEncoder();

/* ==============================
   ОСНОВНЫЕ ФУНКЦИИ
============================== */

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
      "Cache-Control": "private, no-store",
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
      Location: "/developers",
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

function getDatabase(env) {
  if (!env.DB) {
    throw new Error("База данных D1 не подключена.");
  }

  return env.DB;
}

/* ==============================
   АВТОРИЗАЦИЯ
============================== */

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

  return Uint8Array.from(
    atob(padded),
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
  const raw = request.headers.get("Cookie") || "";
  const prefix = COOKIE_NAME + "=";

  const entry = raw
    .split(";")
    .map(item => item.trim())
    .find(item => item.startsWith(prefix));

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

  if (!cookie) {
    return false;
  }

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

/* ==============================
   CSRF-ЗАЩИТА
============================== */

async function createCsrfToken(request, secret) {
  const cookie = getCookie(request);

  if (!cookie) {
    return "";
  }

  const key = await sessionKey(secret);

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode("developers-action:" + cookie)
  );

  return toBase64Url(
    new Uint8Array(signature)
  );
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
      encoder.encode("developers-action:" + cookie)
    );
  } catch {
    return false;
  }
}

/* ==============================
   ЧТЕНИЕ PAGES CMS
============================== */

async function loadProducts(context) {
  if (!context.env.ASSETS) {
    throw new Error(
      "Опубликованный каталог недоступен."
    );
  }

  const url = new URL(
    "/data/products.json",
    context.request.url
  );

  const response = await context.env.ASSETS.fetch(
    new Request(url.toString(), {
      headers: {
        "Cache-Control": "no-cache"
      }
    })
  );

  if (!response.ok) {
    throw new Error(
      "Не удалось загрузить каталог Pages CMS."
    );
  }

  const products = await response.json();

  if (!Array.isArray(products)) {
    throw new Error(
      "Неверный формат файла products.json."
    );
  }

  return products;
}

function productSizes(product) {
  const sizes = Array.isArray(product.sizes)
    ? [
        ...new Set(
          product.sizes
            .map(size => String(size ?? "").trim())
            .filter(Boolean)
        )
      ]
    : [];

  return sizes.length ? sizes : [""];
}

function positionKey(value, size) {
  return JSON.stringify([
    String(value),
    String(size)
  ]);
}

/* ==============================
   АКТУАЛЬНЫЕ ПОЗИЦИИ КАТАЛОГА
============================== */

function buildActiveIndex(products) {
  const slugs = new Set();
  const ids = new Set();

  for (const product of products) {
    if (
      !product ||
      typeof product !== "object"
    ) {
      throw new Error(
        "Обнаружена некорректная запись каталога."
      );
    }

    const slug = String(
      product.slug || ""
    ).trim();

    const id = String(
      product.product_id || ""
    ).trim().toLowerCase();

    if (!slug) {
      throw new Error(
        "В каталоге есть товар без slug."
      );
    }

    for (const size of productSizes(product)) {
      slugs.add(positionKey(slug, size));

      if (id) {
        ids.add(positionKey(id, size));
      }
    }
  }

  return { slugs, ids };
}

function isCurrentPosition(item, active) {
  const slugKey = positionKey(
    item.product_slug,
    item.size
  );

  if (active.slugs.has(slugKey)) {
    return true;
  }

  if (item.product_id) {
    const idKey = positionKey(
      String(item.product_id).toLowerCase(),
      item.size
    );

    if (active.ids.has(idKey)) {
      return true;
    }
  }

  return false;
}

/* ==============================
   ЧТЕНИЕ СКЛАДА
============================== */

async function loadInventory(env) {
  const db = getDatabase(env);

  const result = await db.prepare(
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
  ).all();

  return result.results || [];
}

/* ==============================
   РУЧНАЯ СИНХРОНИЗАЦИЯ
============================== */

function prepareCatalog(products) {
  const positions = [];
  const warnings = [];

  const usedIds = new Map();
  const usedSlugs = new Map();

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  for (const product of products) {
    if (
      !product ||
      typeof product !== "object"
    ) {
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
        "»: отсутствует корректный product_id."
      );
      continue;
    }

    if (
      usedIds.has(id) &&
      usedIds.get(id) !== slug
    ) {
      throw new Error(
        "Одинаковый product_id у товаров: " +
        usedIds.get(id) + " и " + slug
      );
    }

    if (
      usedSlugs.has(slug) &&
      usedSlugs.get(slug) !== id
    ) {
      throw new Error(
        "Повторяется slug товара: " + slug
      );
    }

    usedIds.set(id, slug);
    usedSlugs.set(slug, id);

    for (const size of productSizes(product)) {
      positions.push({
        product_id: id,
        product_slug: slug,
        size
      });
    }
  }

  if (positions.length > 1000) {
    throw new Error(
      "Превышено количество позиций для синхронизации."
    );
  }

  return { positions, warnings };
}

async function synchronizeCatalog(context) {
  const db = getDatabase(context.env);
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

  for (const position of positions) {
    const {
      product_id,
      product_slug,
      size
    } = position;

    // Сначала ищем по постоянному ID.

    const byId = await db.prepare(
      `SELECT product_slug
       FROM inventory
       WHERE product_id = ?
         AND size = ?
       LIMIT 1`
    ).bind(
      product_id,
      size
    ).first();

    if (byId) {
      if (byId.product_slug === product_slug) {
        summary.unchanged++;
        continue;
      }

      const conflict = await db.prepare(
        `SELECT product_id
         FROM inventory
         WHERE product_slug = ?
           AND size = ?
         LIMIT 1`
      ).bind(
        product_slug,
        size
      ).first();

      if (conflict) {
        summary.warnings.push(
          "Конфликт адреса: " +
          product_slug + " / " +
          (size || "Без размера")
        );
        continue;
      }

      const update = await db.prepare(
        `UPDATE inventory
         SET product_slug = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE product_id = ?
           AND size = ?
           AND product_slug = ?`
      ).bind(
        product_slug,
        product_id,
        size,
        byId.product_slug
      ).run();

      if (update.meta?.changes === 1) {
        summary.renamed++;
      }

      continue;
    }

    // Затем ищем старую запись по slug.

    const bySlug = await db.prepare(
      `SELECT product_id
       FROM inventory
       WHERE product_slug = ?
         AND size = ?
       LIMIT 1`
    ).bind(
      product_slug,
      size
    ).first();

    if (bySlug) {
      const previousId = String(
        bySlug.product_id || ""
      ).trim().toLowerCase();

      if (
        previousId &&
        previousId !== product_id
      ) {
        summary.warnings.push(
          "Конфликт ID: " +
          product_slug + " / " +
          (size || "Без размера")
        );
        continue;
      }

      if (!previousId) {
        const update = await db.prepare(
          `UPDATE inventory
           SET product_id = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE product_slug = ?
             AND size = ?
             AND product_id IS NULL`
        ).bind(
          product_id,
          product_slug,
          size
        ).run();

        if (update.meta?.changes === 1) {
          summary.linked++;
        }

      } else {
        summary.unchanged++;
      }

      continue;
    }

    // Новая позиция: нулевой остаток.

    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO inventory (
         product_slug,
         product_id,
         size,
         total_quantity,
         reserved_quantity
       )
       VALUES (?, ?, ?, 0, 0)`
    ).bind(
      product_slug,
      product_id,
      size
    ).run();

    if (inserted.meta?.changes === 1) {
      summary.created++;
    } else {
      summary.unchanged++;
    }
  }

  return summary;
}

/* ==============================
   ПРОВЕРКА КОЛИЧЕСТВА
============================== */

function parseQuantity(raw) {
  const text = String(raw ?? "");

  if (!/^(0|[1-9]\d{0,6})$/.test(text)) {
    throw new Error(
      "Количество должно быть целым числом от 0 до " +
      MAX_STOCK + "."
    );
  }

  const value = Number(text);

  if (value > MAX_STOCK) {
    throw new Error(
      "Максимальное количество: " + MAX_STOCK + "."
    );
  }

  return value;
}

function parsePosition(form) {
  const slug = String(
    form.get("product_slug") ?? ""
  );

  const size = String(
    form.get("size") ?? ""
  );

  if (
    !slug ||
    slug.length > 300 ||
    size.length > 100
  ) {
    throw new Error(
      "Некорректные данные складской позиции."
    );
  }

  return { slug, size };
}

/* ==============================
   ИЗМЕНЕНИЕ ОСТАТКА
============================== */

async function saveStock(context, form) {
  const db = getDatabase(context.env);
  const { slug, size } = parsePosition(form);

  const quantity = parseQuantity(
    form.get("quantity")
  );

  const expectedTotal = parseQuantity(
    form.get("expected_total")
  );

  const row = await db.prepare(
    `SELECT
       total_quantity,
       reserved_quantity
     FROM inventory
     WHERE product_slug = ?
       AND size = ?
     LIMIT 1`
  ).bind(
    slug,
    size
  ).first();

  if (!row) {
    throw new Error(
      "Складская позиция не найдена. Обновите страницу."
    );
  }

  if (Number(row.total_quantity) !== expectedTotal) {
    throw new Error(
      "Остаток уже изменился в другом окне. " +
      "Обновите страницу и повторите действие."
    );
  }

  if (quantity < Number(row.reserved_quantity)) {
    throw new Error(
      "Нельзя установить остаток меньше резерва (" +
      row.reserved_quantity + " шт.)."
    );
  }

  if (quantity === Number(row.total_quantity)) {
    return "Количество не изменилось.";
  }

  const result = await db.prepare(
    `UPDATE inventory
     SET total_quantity = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE product_slug = ?
       AND size = ?
       AND total_quantity = ?
       AND reserved_quantity <= ?`
  ).bind(
    quantity,
    slug,
    size,
    expectedTotal,
    quantity
  ).run();

  if (result.meta?.changes !== 1) {
    throw new Error(
      "Не удалось сохранить остаток. " +
      "Возможно, данные изменились. Обновите страницу."
    );
  }

  return (
    "Остаток сохранён: " +
    slug + " / " +
    (size || "Без размера") +
    " — " + quantity + " шт."
  );
}

/* ==============================
   УДАЛЕНИЕ УСТАРЕВШЕЙ ПОЗИЦИИ
============================== */

async function deleteStock(context, form) {
  const db = getDatabase(context.env);
  const { slug, size } = parsePosition(form);

  /*
    Каждый раз заново читаем каталог.
    Нельзя доверять отметке из HTML.
  */

  const products = await loadProducts(context);
  const active = buildActiveIndex(products);

  const row = await db.prepare(
    `SELECT
       product_slug,
       product_id,
       size,
       total_quantity,
       reserved_quantity
     FROM inventory
     WHERE product_slug = ?
       AND size = ?
     LIMIT 1`
  ).bind(
    slug,
    size
  ).first();

  if (!row) {
    throw new Error(
      "Позиция уже удалена или не найдена."
    );
  }

  if (isCurrentPosition(row, active)) {
    throw new Error(
      "Нельзя удалить актуальную позицию товара. " +
      "Её сначала нужно убрать из Pages CMS " +
      "или изменить список размеров."
    );
  }

  if (
    Number(row.total_quantity) !== 0 ||
    Number(row.reserved_quantity) !== 0
  ) {
    throw new Error(
      "Удалять можно только позиции " +
      "с нулевым остатком и без резерва."
    );
  }

  /*
    Если позиция встречается в заказах,
    сохраняем её для истории.
  */

  const linkedOrder = await db.prepare(
    `SELECT order_id
     FROM order_items
     WHERE product_slug = ?
       AND size = ?
     LIMIT 1`
  ).bind(
    slug,
    size
  ).first();

  if (linkedOrder) {
    throw new Error(
      "Позиция связана с заказом. " +
      "Удаление заблокировано для сохранения истории."
    );
  }

  /*
    Проверки остатков и заказов
    повторяем непосредственно в DELETE.
  */

  const result = await db.prepare(
    `DELETE FROM inventory
     WHERE product_slug = ?
       AND size = ?
       AND total_quantity = 0
       AND reserved_quantity = 0
       AND NOT EXISTS (
         SELECT 1
         FROM order_items AS oi
         WHERE oi.product_slug = inventory.product_slug
           AND oi.size = inventory.size
       )`
  ).bind(
    slug,
    size
  ).run();

  if (result.meta?.changes !== 1) {
    throw new Error(
      "Не удалось удалить позицию. " +
      "Обновите страницу и проверьте её состояние."
    );
  }

  return (
    "Складская позиция удалена: " +
    slug + " / " +
    (size || "Без размера") + "."
  );
}

/* ==============================
   ТАБЛИЦА СКЛАДА
============================== */

function renderInventory(
  inventory,
  products,
  csrf,
  catalogAvailable
) {
  if (!inventory.length) {
    return `
      <p class="muted">
        Склад пуст. Создайте товары в Pages CMS
        и выполните синхронизацию.
      </p>
    `;
  }

  const namesById = new Map();
  const namesBySlug = new Map();

  for (const product of products) {
    if (!product || typeof product !== "object") {
      continue;
    }

    const title = String(
      product.title || product.slug || "Товар"
    );

    if (product.product_id) {
      namesById.set(
        String(product.product_id).toLowerCase(),
        title
      );
    }

    if (product.slug) {
      namesBySlug.set(product.slug, title);
    }
  }

  let active = null;

  if (catalogAvailable) {
    try {
      active = buildActiveIndex(products);
    } catch (error) {
      console.error(error);
    }
  }

  const rows = inventory.map(item => {
    const slug = String(item.product_slug);
    const size = String(item.size || "");

    const title =
      namesById.get(
        String(item.product_id || "").toLowerCase()
      ) ||
      namesBySlug.get(slug) ||
      slug;

    const total = Number(item.total_quantity);
    const reserved = Number(item.reserved_quantity);

    const current = active
      ? isCurrentPosition(item, active)
      : true;

    const obsolete = Boolean(active && !current);
    const empty = total === 0 && reserved === 0;

    let status = `
      <span class="tag-active">
        В каталоге
      </span>
    `;

    if (!active) {
      status = `
        <span class="tag-unknown">
          Не проверено
        </span>
      `;
    } else if (obsolete) {
      status = `
        <span class="tag-old">
          Устаревшая
        </span>
      `;
    }

    const deletion = obsolete
      ? (
          empty
            ? `
              <form method="POST" action="/developers">
                <input type="hidden"
                  name="action" value="stock-delete">

                <input type="hidden"
                  name="csrf" value="${escapeHtml(csrf)}">

                <input type="hidden"
                  name="product_slug"
                  value="${escapeHtml(slug)}">

                <input type="hidden"
                  name="size" value="${escapeHtml(size)}">

                <button type="submit" class="delete-button">
                  Удалить
                </button>
              </form>
            `
            : `
              <span class="action-note">
                Для удаления обнулите остаток
                и снимите резерв
              </span>
            `
        )
      : `<span class="dash">—</span>`;

    return `
      <tr>
        <td>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(slug)}</small>
          ${status}
        </td>

        <td>
          ${escapeHtml(size || "Без размера")}
        </td>

        <td class="number">
          ${formatNumber(reserved)}
        </td>

        <td class="number available">
          ${formatNumber(item.available_quantity)}
        </td>

        <td>
          <form
            method="POST"
            action="/developers"
            class="stock-form"
          >
            <input type="hidden"
              name="action" value="stock-save">

            <input type="hidden"
              name="csrf"
              value="${escapeHtml(csrf)}">

            <input type="hidden"
              name="product_slug"
              value="${escapeHtml(slug)}">

            <input type="hidden"
              name="size"
              value="${escapeHtml(size)}">

            <input type="hidden"
              name="expected_total"
              value="${total}">

            <input
              type="number"
              name="quantity"
              min="0"
              max="${MAX_STOCK}"
              step="1"
              value="${total}"
              aria-label="Остаток ${escapeHtml(title)} ${escapeHtml(size || "Без размера")}"
              required
            >

            <button class="save-button" type="submit">
              Сохранить
            </button>
          </form>
        </td>

        <td>
          ${deletion}
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
            <th class="number">Резерв</th>
            <th class="number">Доступно</th>
            <th>На складе / изменить</th>
            <th>Удаление</th>
          </tr>
        </thead>

        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

/* ==============================
   ОТЧЁТ СИНХРОНИЗАЦИИ
============================== */

function renderSyncSummary(summary) {
  if (!summary) {
    return "";
  }

  const warnings = summary.warnings.length
    ? `
      <div class="warning">
        <strong>Требуется внимание:</strong>

        <ul>
          ${summary.warnings.map(
            message =>
              `<li>${escapeHtml(message)}</li>`
          ).join("")}
        </ul>
      </div>
    `
    : "";

  return `
    <div class="success">
      ✓ Синхронизация завершена
    </div>

    <p class="sync-report">
      Создано: <strong>${summary.created}</strong>
      · Привязано: <strong>${summary.linked}</strong>
      · Обновлено: <strong>${summary.renamed}</strong>
      · Без изменений: <strong>${summary.unchanged}</strong>
    </p>

    ${warnings}
  `;
}

/* ==============================
   ПАНЕЛЬ РАЗРАБОТЧИКОВ
============================== */

async function renderDashboard(
  context,
  secret,
  options = {}
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
      "Не удалось загрузить склад из D1.";
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

  const message = options.message
    ? `
      <div class="success">
        ✓ ${escapeHtml(options.message)}
      </div>
    `
    : "";

  const operationError = options.error
    ? `
      <div class="error">
        ${escapeHtml(options.error)}
      </div>
    `
    : "";

  return `
    <div class="success">
      ✓ Вы авторизованы
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
          Синхронизация выполняется вручную.
          Новые товары и размеры добавляются
          с остатком 0 шт.
          Существующие остатки сохраняются.
        </p>

        <form method="POST" action="/developers">
          <input type="hidden"
            name="action" value="sync">

          <input type="hidden"
            name="csrf"
            value="${escapeHtml(csrf)}">

          <button class="sync-button" type="submit">
            ↻ Синхронизировать с Pages CMS
          </button>
        </form>
      </div>

      ${message}
      ${operationError}
      ${renderSyncSummary(options.summary)}
      
      ${inventoryError
        ? `<div class="error">${escapeHtml(inventoryError)}</div>`
        : ""}

      ${catalogError
        ? `<div class="warning">${escapeHtml(catalogError)}</div>`
        : ""}

      ${inventoryError
        ? ""
        : renderInventory(
            inventory,
            products,
            csrf,
            !catalogError
          )
      }

      <p class="table-help">
        <strong>Как пользоваться:</strong>
        укажи количество в поле «На складе»
        напротив нужного размера и нажми
        «Сохранить». Доступное количество
        рассчитывается с учётом резерва.
      </p>

      <p class="table-help">
        Удаление доступно только для
        устаревших складских позиций.
        Позиции с остатками, резервами
        или связанными заказами защищены.
      </p>
    </div>

    <div class="section">
      <h3>Заказы</h3>

      <p class="muted">
        На следующем этапе здесь появится
        управление заказами: «В резерв»,
        «Оплачено» и «Отменить».
      </p>
    </div>

    <form method="POST" action="/developers">
      <input type="hidden"
        name="action" value="logout">

      <input type="hidden"
        name="csrf"
        value="${escapeHtml(csrf)}">

      <button class="logout" type="submit">
        Выйти из панели
      </button>
    </form>
  `;
}

/* ==============================
   ФОРМА ВХОДА
============================== */

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
      <input type="hidden"
        name="action" value="login">

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

/* ==============================
   ДИЗАЙН СТРАНИЦЫ
============================== */

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
  max-width: ${loggedIn ? "1250px" : "560px"};
  margin: 50px auto;
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
  font-size: 14px;
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
  line-height: 1.5;
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
}

.sync-button:hover {
  background: #10516d;
}

.sync-report {
  font-size: 14px;
  line-height: 1.7;
}

.table-scroll {
  overflow-x: auto;
}

table {
  width: 100%;
  min-width: 850px;
  border-collapse: collapse;
}

th, td {
  padding: 15px 12px;
  border-bottom: 1px solid #e8edf1;
  text-align: left;
  font-size: 14px;
  vertical-align: middle;
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

.tag-active,
.tag-old,
.tag-unknown {
  display: inline-block;
  margin-top: 7px;
  padding: 4px 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: bold;
}

.tag-active {
  color: #28734a;
  background: #eaf7ee;
}

.tag-old {
  color: #95611c;
  background: #fff3d9;
}

.tag-unknown {
  color: #71808e;
  background: #edf0f3;
}

.stock-form {
  display: flex;
  align-items: center;
  gap: 7px;
}

.stock-form input[type="number"] {
  width: 76px;
  min-width: 76px;
  padding: 10px 7px;
  border: 1px solid #cbd5df;
  border-radius: 8px;
  font-size: 14px;
}

.save-button {
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  color: white;
  background: #146789;
}

.save-button:hover {
  background: #10516d;
}

.delete-button {
  padding: 10px 12px;
  border: 1px solid #edc4c4;
  border-radius: 8px;
  background: #fff2f2;
  color: #b03a3a;
}

.delete-button:hover {
  background: #ffe0e0;
}

.action-note {
  display: block;
  max-width: 150px;
  color: #8a6a35;
  font-size: 11px;
  line-height: 1.4;
}

.dash {
  color: #adb7c0;
}

.table-help {
  margin: 20px 0 0;
  color: #71808e;
  font-size: 13px;
  line-height: 1.6;
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

/* ==============================
   GET — ОТКРЫТИЕ ПАНЕЛИ
============================== */

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

/* ==============================
   POST — ДЕЙСТВИЯ ПАНЕЛИ
============================== */

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

  /* ВХОД */

  if (action === "login") {
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

  /* ВСЕ ОСТАЛЬНЫЕ ДЕЙСТВИЯ
     ТРЕБУЮТ АВТОРИЗАЦИИ */

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

  /* ВЫХОД */

  if (action === "logout") {
    return redirectWithCookie(
      expiredCookie()
    );
  }

  /* СИНХРОНИЗАЦИЯ */

  if (action === "sync") {
    let summary = null;
    let errorMessage = "";

    try {
      summary = await synchronizeCatalog(context);
    } catch (error) {
      console.error(error);

      errorMessage =
        "Синхронизация не завершена: " +
        error.message;
    }

    const dashboard = await renderDashboard(
      context,
      secret,
      {
        summary,
        error: errorMessage
      }
    );

    return htmlResponse(
      renderPage(dashboard, true)
    );
  }

  /* СОХРАНЕНИЕ ОСТАТКА */

  if (action === "stock-save") {
    let message = "";
    let errorMessage = "";

    try {
      message = await saveStock(context, form);
    } catch (error) {
      console.error(error);
      errorMessage = error.message;
    }

    const dashboard = await renderDashboard(
      context,
      secret,
      {
        message,
        error: errorMessage
      }
    );

    return htmlResponse(
      renderPage(dashboard, true)
    );
  }

  /* УДАЛЕНИЕ ПОЗИЦИИ */

  if (action === "stock-delete") {
    let message = "";
    let errorMessage = "";

    try {
      message = await deleteStock(context, form);
    } catch (error) {
      console.error(error);
      errorMessage = error.message;
    }

    const dashboard = await renderDashboard(
      context,
      secret,
      {
        message,
        error: errorMessage
      }
    );

    return htmlResponse(
      renderPage(dashboard, true)
    );
  }

  return htmlResponse(
    renderPage(
      "<p>Неизвестное действие.</p>",
      true
    ),
    400
  );
}


