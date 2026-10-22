
/*
  FIVE OCEANS — создание заказа

  POST /api/orders/create

  Получает:
  {
    checkout_key: "UUID",
    items: [
      {slug: "product-slug", size: "L", quantity: 2}
    ]
  }

  Возвращает:
  {
    success: true,
    order_id: "FO-20261020-XXXXXXXX",
    status: "pending",
    items: [...],
    total: 1000
  }

  Заказ не резервирует товар.
  Резервирование будет выполняться администратором.
*/

const MAX_ITEMS = 40;
const MAX_QUANTITY = 100;
const MAX_BODY_LENGTH = 16000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function fail(message, status = 400) {
  return json({
    success: false,
    error: message
  }, status);
}

function validUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function normalizeItems(rawItems) {
  if (
    !Array.isArray(rawItems) ||
    !rawItems.length ||
    rawItems.length > MAX_ITEMS
  ) {
    throw new Error("Некорректный состав корзины.");
  }

  const merged = new Map();

  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Некорректная позиция корзины.");
    }

    const slug = String(raw.slug || "").trim();
    const size = String(raw.size ?? "").trim();
    const quantity = raw.quantity;

    if (
      !slug ||
      slug.length > 300 ||
      size.length > 100 ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      throw new Error(
        "Проверь товары, размеры и количество в корзине."
      );
    }

    const key = JSON.stringify([slug, size]);
    const old = merged.get(key);

    const nextQuantity =
      (old ? old.quantity : 0) + quantity;

    if (nextQuantity > MAX_QUANTITY) {
      throw new Error(
        "Слишком большое количество одного товара."
      );
    }

    merged.set(key, {
      slug,
      size,
      quantity: nextQuantity
    });
  }

  return [...merged.values()].sort((a, b) => {
    const ak = JSON.stringify([a.slug, a.size]);
    const bk = JSON.stringify([b.slug, b.size]);

    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
}

async function hashItems(items) {
  const text = JSON.stringify(items);

  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );

  return [...new Uint8Array(bytes)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadCatalog(env, request) {
  if (!env.ASSETS) {
    throw new Error("Каталог временно недоступен.");
  }

  const url = new URL(
    "/data/products.json",
    request.url
  );

  const response = await env.ASSETS.fetch(
    new Request(url.toString())
  );

  if (!response.ok) {
    throw new Error("Не удалось прочитать каталог.");
  }

  const products = await response.json();

  if (!Array.isArray(products)) {
    throw new Error("Ошибка формата каталога.");
  }

  return products;
}

function productSizes(product) {
  const list = values => Array.isArray(values)
    ? [...new Set(values.map(value => String(value ?? "").trim()).filter(Boolean))]
    : [];
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (!variants.length) return [];
  const allowed = [];
  const codes = new Set();
  for (const variant of variants) {
    const code = String(variant?.code || "").trim();
    if (!/^[a-z0-9][a-z0-9-]{0,24}$/.test(code) || codes.has(code)) {
      throw new Error("Неверная конфигурация цвета товара.");
    }
    codes.add(code);
    if (variant.available !== true) continue;
    const sizes = list(variant.sizes);
    for (const size of sizes) {
      const key = "v:" + code + "|" + size;
      if (key.length > 100) throw new Error("Слишком длинная комбинация цвета и размера.");
      allowed.push(key);
    }
  }
  return allowed;
}

function productVariantTitle(product, stockSize) {
  const match = /^v:([a-z0-9-]{1,25})\|/.exec(stockSize);
  const variant = match && Array.isArray(product.variants)
    ? product.variants.find(v => v && v.code === match[1])
    : null;
  const title = String(product.title || product.slug);
  const design = String(product.design || "").trim();
  const base = title + (design && !title.includes(design) ? " — " + design : "");
  return variant ? base + " — " +
    String(variant.label || variant.code) : base;
}

function productPrice(product) {
  const price = Number(product.price);

  if (
    !Number.isSafeInteger(price) ||
    price < 0
  ) {
    throw new Error(
      "Некорректная цена товара: " +
      String(product.title || product.slug)
    );
  }

  return price;
}

function generateOrderId() {
  const date = new Date();

  const stamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("");

  const randomBytes = crypto.getRandomValues(
    new Uint8Array(6)
  );

  const suffix = [...randomBytes]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  return `FO-${stamp}-${suffix}`;
}

async function getExistingOrder(db, key, hash) {
  const order = await db.prepare(
    `SELECT order_id, status, payload_hash
     FROM orders
     WHERE checkout_key = ?
     LIMIT 1`
  ).bind(key).first();

  if (!order) return null;

  if (order.payload_hash !== hash) {
    return {
      conflict: true
    };
  }

  const result = await db.prepare(
    `SELECT
       product_slug AS slug,
       product_title AS title,
       size,
       quantity,
       unit_price
     FROM order_items
     WHERE order_id = ?
     ORDER BY product_slug, size`
  ).bind(order.order_id).all();

  const items = (result.results || []).map(item => ({
    ...item,
    item_total: item.quantity * item.unit_price
  }));

  const total = items.reduce(
    (sum, item) => sum + item.item_total,
    0
  );

  return {
    success: true,
    order_id: order.order_id,
    status: order.status,
    items,
    total,
    already_created: true
  };
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return fail("Склад временно недоступен.", 503);
  }

  const origin = request.headers.get("Origin");

  if (
    origin &&
    origin !== new URL(request.url).origin
  ) {
    return fail("Запрос из другого источника запрещён.", 403);
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site");

  if (fetchSite === "cross-site") {
    return fail("Запрос запрещён.", 403);
  }

  const contentType =
    request.headers.get("Content-Type") || "";

  if (!contentType.includes("application/json")) {
    return fail("Ожидается JSON.");
  }

  let body;

  try {
    const text = await request.text();

    if (text.length > MAX_BODY_LENGTH) {
      return fail("Слишком большой запрос.", 413);
    }

    body = JSON.parse(text);
  } catch {
    return fail("Не удалось прочитать заказ.");
  }

  const checkoutKey = body?.checkout_key;

  if (!validUuid(checkoutKey)) {
    return fail("Некорректный идентификатор оформления.");
  }

  let requestedItems;

  try {
    requestedItems = normalizeItems(body.items);
  } catch (error) {
    return fail(error.message);
  }

  const payloadHash = await hashItems(requestedItems);
  const db = env.DB;

  try {
    // Защита от повторного создания заказа.

    const existing = await getExistingOrder(
      db,
      checkoutKey,
      payloadHash
    );

    if (existing) {
      if (existing.conflict) {
        return fail(
          "Этот идентификатор уже использован для другой корзины.",
          409
        );
      }

      return json(existing);
    }

    // Загружаем цены и названия только с сервера.

    const catalog = await loadCatalog(env, request);

    const productsBySlug = new Map();

    for (const product of catalog) {
      if (product && product.slug) {
        productsBySlug.set(
          String(product.slug),
          product
        );
      }
    }

    const orderLines = [];
    let total = 0;

    for (const requested of requestedItems) {
      const product = productsBySlug.get(requested.slug);

      if (!product) {
        return fail(
          "Товар больше не найден: " + requested.slug,
          409
        );
      }

      const availableSizes = productSizes(product);

      if (!availableSizes.includes(requested.size)) {
        return fail(
          "Выбранный размер больше недоступен: " +
          String(product.title || requested.slug),
          409
        );
      }

      const stock = await db.prepare(
        `SELECT
           total_quantity,
           reserved_quantity
         FROM inventory
         WHERE product_slug = ?
           AND size = ?
           AND NOT EXISTS (
             SELECT 1 FROM inventory_exclusions AS e
             WHERE e.product_slug = inventory.product_slug
               AND e.size = inventory.size
           )
         LIMIT 1`
      ).bind(
        requested.slug,
        requested.size
      ).first();

      if (
        !stock ||
        Number(stock.total_quantity) -
        Number(stock.reserved_quantity) <
        requested.quantity
      ) {
        return fail(
          "Недостаточно товара на складе: " +
          String(product.title || requested.slug) +
          (requested.size
            ? " / " + requested.size
            : ""),
          409
        );
      }

      const unitPrice = productPrice(product);
      const itemTotal =
        unitPrice * requested.quantity;

      if (!Number.isSafeInteger(itemTotal)) {
        return fail("Ошибка расчёта суммы.", 400);
      }

      total += itemTotal;

      if (!Number.isSafeInteger(total)) {
        return fail("Ошибка расчёта суммы.", 400);
      }

      orderLines.push({
        slug: requested.slug,
        product_id: String(
          product.product_id || ""
        ),
        title: productVariantTitle(product, requested.size),
        size: requested.size,
        quantity: requested.quantity,
        unit_price: unitPrice,
        item_total: itemTotal
      });
    }

    // Создаём уникальный номер заказа.

    const orderId = generateOrderId();

    const statements = [
      db.prepare(
        `INSERT INTO orders (
           order_id,
           status,
           checkout_key,
           payload_hash
         )
         VALUES (?, 'pending', ?, ?)`
      ).bind(
        orderId,
        checkoutKey,
        payloadHash
      )
    ];

    for (const item of orderLines) {
      statements.push(
        db.prepare(
          `INSERT INTO order_items (
             order_id,
             product_slug,
             product_title,
             size,
             quantity,
             unit_price,
             product_id
           )
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          orderId,
          item.slug,
          item.title,
          item.size,
          item.quantity,
          item.unit_price,
          item.product_id
        )
      );
    }

    // D1 выполняет batch как транзакцию.
    // При ошибке записи откатываются.

    try {
      await db.batch(statements);
    } catch (error) {
      // Если запрос был отправлен повторно
      // одновременно с первым, возвращаем
      // уже существующий заказ.

      const existingAfterConflict =
        await getExistingOrder(
          db,
          checkoutKey,
          payloadHash
        );

      if (existingAfterConflict) {
        if (existingAfterConflict.conflict) {
          return fail(
            "Конфликт повторного оформления.",
            409
          );
        }

        return json(existingAfterConflict);
      }

      throw error;
    }

    return json({
      success: true,
      order_id: orderId,
      status: "pending",
      items: orderLines,
      total,
      already_created: false
    }, 201);

  } catch (error) {
    console.error("Order creation failed:", error);

    return fail(
      "Не удалось создать заказ. Попробуйте позже.",
      500
    );
  }
}
