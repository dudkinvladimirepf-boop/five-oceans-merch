// Клуб «5 океанов» × ОКЕАН HD — Telegram-магазин
// Полная версия Cloudflare Worker для каталога Pages с цветами и размерами.
// Зависимости: D1 binding DB, секреты TELEGRAM_BOT_TOKEN,
// TELEGRAM_WEBHOOK_SECRET, ADMIN_CHAT_ID.

const SITE = "https://five-oceans-merch.pages.dev";
const MAIN_BUTTON = "🏠 Главное меню";
const PAGE_SIZE = 8;
const MAX_QUANTITY = 99;
const MAX_ORDER_ITEMS = 40;
const COLOR_CODE_RE = /^[a-z0-9][a-z0-9-]{0,24}$/;
const ORDER_ID_RE = /^FO-\d{8}-[0-9A-F]{12}$/;
const ADMIN_SESSION_SECONDS = 8 * 3600;
const ADMIN_LOGIN_SECONDS = 180;
const ADMIN_LOCK_SECONDS = 15 * 60;
const ADMIN_MAX_FAILURES = 5;
const ADMIN_PAGE_SIZE = 8;

// ===== Telegram и D1 =====

function db(env) {
  if (!env.DB) throw new Error("Не задано подключение DB к D1");
  return env.DB;
}

async function telegram(env, method, payload) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
  const answer = await response.json();
  if (!response.ok || !answer.ok) {
    throw new Error(answer.description || `Telegram API ${response.status}`);
  }
  return answer;
}

function money(amount) {
  if (!Number.isFinite(Number(amount))) return "Уточняется";
  return Number(amount).toLocaleString("ru-RU") + " ₽";
}

function shortId(value) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(String(value))) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function sizesList(values) {
  return Array.isArray(values)
    ? [...new Set(values.map(v => String(v ?? "").trim()).filter(Boolean))]
    : [];
}

function productId(product) {
  return shortId(product.product_id || product.slug || product.title);
}

function productForId(data, id) {
  return data.products.find(p => productId(p) === id);
}

function variantList(product) {
  if (!Array.isArray(product?.variants)) return [];
  const codes = new Set();
  const variants = [];
  for (const v of product.variants) {
    const code = String(v?.code || "").trim();
    if (!COLOR_CODE_RE.test(code) || codes.has(code)) continue;
    codes.add(code);
    variants.push({
      code,
      label: String(v.label || code),
      available: v.available === true && product.available !== false,
      photos: Array.isArray(v.photos) ? v.photos.filter(Boolean) : [],
      sizes: sizesList(v.sizes)
    });
  }
  return variants;
}

function sizeChoices(product, colorIndex) {
  const variants = variantList(product);
  if (variants.length) {
    if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex >= variants.length) return [];
    return variants[colorIndex].sizes;
  }
  // Совместимость со старыми товарами, если они ещё присутствуют в JSON.
  const old = sizesList(product.sizes);
  return old.length ? old : [""];
}

function stockKey(product, colorIndex, sizeIndex) {
  const choices = sizeChoices(product, colorIndex);
  if (!Number.isInteger(sizeIndex) || sizeIndex < 0 || sizeIndex >= choices.length) return null;
  const variants = variantList(product);
  if (variants.length) {
    const v = variants[colorIndex];
    if (!v || !v.available) return null;
    const key = `v:${v.code}|${choices[sizeIndex]}`;
    return key.length <= 100 ? key : null;
  }
  return choices[sizeIndex];
}

function describeStockSize(product, key) {
  const technical = String(key ?? "");
  const match = /^v:([a-z0-9-]{1,25})\|(.*)$/.exec(technical);
  if (match) {
    const variant = variantList(product || {}).find(v => v.code === match[1]);
    return {
      color: variant?.label || match[1],
      colorCode: match[1],
      size: match[2],
      valid: Boolean(product && variant?.available && variant.sizes.includes(match[2]))
    };
  }
  const variants = variantList(product || {});
  const legacySizes = sizesList(product?.sizes);
  return {
    color: "",
    colorCode: "",
    size: technical,
    valid: Boolean(product && !variants.length && (legacySizes.length ? legacySizes.includes(technical) : technical === ""))
  };
}

function productTitle(product, stockSize) {
  const base = String(product.title || product.slug);
  const design = String(product.design || "").trim();
  const withDesign = design && !base.includes(design) ? `${base} — ${design}` : base;
  const color = describeStockSize(product, stockSize).color;
  return color ? `${withDesign} — ${color}` : withDesign;
}

function productPrice(product) {
  const price = Number(product.price);
  if (!Number.isSafeInteger(price) || price < 0) {
    throw new Error(`Некорректная цена: ${product.title || product.slug}`);
  }
  return price;
}

async function catalog() {
  const [productsRes, categoriesRes] = await Promise.all([
    fetch(`${SITE}/data/products.json`, { cache: "no-store" }),
    fetch(`${SITE}/data/categories.json`, { cache: "no-store" })
  ]);
  if (!productsRes.ok || !categoriesRes.ok) throw new Error("Не удалось загрузить каталог Pages");
  const [products, categories] = await Promise.all([productsRes.json(), categoriesRes.json()]);
  if (!Array.isArray(products) || !Array.isArray(categories)) throw new Error("Неверный формат каталога Pages");
  return {
    products: products.filter(p => p && p.slug && p.available !== false),
    categories
  };
}

function categoryEmoji(title) {
  const n = normalized(title);
  if (n.includes("футбол")) return "👕";
  if (n.includes("свитшот") || n.includes("худи") || n.includes("куртк")) return "🧥";
  if (n.includes("нос")) return "🧦";
  if (n.includes("аксесс")) return "🎒";
  return "🛍";
}

function groupedCategories(data) {
  const result = [];
  const seen = new Set();
  for (const c of data.categories) {
    const id = normalized(c.id);
    const products = data.products.filter(p => normalized(p.category) === id);
    if (id && products.length && !seen.has(id)) {
      result.push({ id, title: String(c.title || c.id), products });
      seen.add(id);
    }
  }
  for (const p of data.products) {
    const id = normalized(p.category) || "другое";
    if (!seen.has(id)) {
      result.push({
        id,
        title: String(p.category || "Другое"),
        products: data.products.filter(x => (normalized(x.category) || "другое") === id)
      });
      seen.add(id);
    }
  }
  return result;
}

function absolutePhoto(photo) {
  if (typeof photo !== "string" || !photo.trim()) return null;
  try {
    const url = new URL(photo.trim(), SITE + "/");
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function photosOfColor(product, index) {
  const variants = variantList(product);
  const raw = variants.length
    ? (variants[index]?.photos || [])
    : Array.isArray(product.photos) ? product.photos : [];
  return raw.map(absolutePhoto).filter(Boolean).slice(0, 6);
}

async function stock(env, slug, key) {
  const row = await db(env).prepare(
    `SELECT total_quantity, reserved_quantity
     FROM inventory
     WHERE product_slug = ? AND size = ?
       AND NOT EXISTS (
         SELECT 1 FROM inventory_exclusions e
         WHERE e.product_slug = inventory.product_slug
           AND e.size = inventory.size
       )
     LIMIT 1`
  ).bind(slug, key).first();
  if (!row) return 0;
  const total = Number(row.total_quantity);
  const reserved = Number(row.reserved_quantity);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(reserved)) return 0;
  return Math.max(0, total - reserved);
}

async function cartQuantity(env, userId, slug, key) {
  const row = await db(env).prepare(
    `SELECT quantity FROM bot_cart_items
     WHERE telegram_user_id = ? AND product_slug = ? AND size = ? LIMIT 1`
  ).bind(String(userId), slug, key).first();
  return Number(row?.quantity || 0);
}

async function cartRows(env, userId) {
  const response = await db(env).prepare(
    `SELECT product_slug, size, quantity FROM bot_cart_items
     WHERE telegram_user_id = ? ORDER BY updated_at DESC, product_slug, size`
  ).bind(String(userId)).all();
  return response.results || [];
}

// Общие текстовые экраны. Если пользователь вышел из фото-карточки,
// удаляем её, чтобы старые изображения не оставались в переписке.
async function removeOldPhoto(env, cb) {
  if (!cb.message?.photo?.length || !cb.message?.message_id) return;
  try {
    await telegram(env, "deleteMessage", {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id
    });
  } catch (error) {
    console.warn("Старую фотографию не удалось удалить:", error.message);
  }
}

async function sendScreen(env, cb, message, keyboard) {
  const chatId = cb.message?.chat?.id;
  if (!chatId) return;
  const payload = {
    chat_id: chatId,
    text: String(message).slice(0, 3900),
    reply_markup: { inline_keyboard: keyboard }
  };
  if (cb.message?.message_id && !cb.message?.photo?.length) {
    try {
      await telegram(env, "editMessageText", { ...payload, message_id: cb.message.message_id });
      return;
    } catch (error) {
      if (String(error.message).includes("not modified")) return;
      console.warn("editMessageText fallback:", error.message);
    }
  }
  await removeOldPhoto(env, cb);
  await telegram(env, "sendMessage", payload);
}

function shortDescription(value, maxLength) {
  const text = String(value || "")
    .replace(/\*\*/g, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (maxLength < 10) return "";
  return text.length > maxLength ? text.slice(0, maxLength - 1).trimEnd() + "…" : text;
}

// Одна фотография + подпись + кнопки = одна карточка.
// Для нового цвета вызываем editMessageMedia: Telegram заменит старое фото.
// При отсутствии снимка используем текстовую карточку.
async function showUnifiedCard(env, cb, photo, caption, keyboard) {
  const chatId = cb.message?.chat?.id;
  if (!chatId) return;
  const reply_markup = { inline_keyboard: keyboard };
  if (!photo) {
    return sendScreen(env, cb, caption, keyboard);
  }
  const media = { type: "photo", media: photo, caption: String(caption).slice(0, 960) };
  if (cb.message?.photo?.length && cb.message?.message_id) {
    try {
      await telegram(env, "editMessageMedia", {
        chat_id: chatId,
        message_id: cb.message.message_id,
        media,
        reply_markup
      });
      return;
    } catch (error) {
      if (String(error.message).includes("not modified")) return;
      console.warn("editMessageMedia fallback:", error.message);
      await removeOldPhoto(env, cb);
    }
  }
  // Сразу отправляем фото С ПОДПИСЬЮ и кнопками, не отдельным сообщением.
  await telegram(env, "sendPhoto", {
    chat_id: chatId,
    photo,
    caption: media.caption,
    reply_markup
  });
}

async function welcome(env, chatId) {
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: "🌊 Добро пожаловать в магазин!\n\n⛵ Клуб «5 океанов» × ОКЕАН HD\n\n👕 Фирменная одежда и сувениры.",
    reply_markup: { keyboard: [[{ text: MAIN_BUTTON }]], resize_keyboard: true, is_persistent: true }
  });
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: "🛍 Выберите действие:",
    reply_markup: { inline_keyboard: [
      [{ text: "🛍 Каталог товаров", callback_data: "catalog" }],
      [{ text: "🛒 Моя корзина", callback_data: "cart:0" }],
      ...(isBotAdmin(env, chatId)
        ? [[{ text: "⚙️ Управление", callback_data: "ad:home" }]]
        : [])
    ] }
  });
}

// ===== Категории, карточки, цвета и фотографии =====

async function showCategories(env, cb, data) {
  const categories = groupedCategories(data);
  const keyboard = categories.map(c => [{
    text: `${categoryEmoji(c.title)} ${c.title} (${c.products.length})`,
    callback_data: `c:${shortId(c.id)}:0`
  }]);
  keyboard.push([{ text: "🛒 Моя корзина", callback_data: "cart:0" }]);
  await sendScreen(env, cb, categories.length
    ? "🛍 КАТАЛОГ МЕРЧА\n\n🌊 Клуб «5 океанов» × ОКЕАН HD\n\nВыберите категорию:"
    : "📦 Сейчас нет товаров в каталоге.", keyboard);
}

async function showCategory(env, cb, data, id, page = 0) {
  const c = groupedCategories(data).find(item => shortId(item.id) === id);
  if (!c) return showCategories(env, cb, data);
  const maxPage = Math.max(0, Math.ceil(c.products.length / PAGE_SIZE) - 1);
  const current = Math.max(0, Math.min(maxPage, Math.trunc(page) || 0));
  const visible = c.products.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const keyboard = visible.map(p => [{
    text: `${String(p.title || p.slug).slice(0, 38)} — ${money(p.price)}`,
    callback_data: `p:${productId(p)}`
  }]);
  const nav = [];
  if (current > 0) nav.push({ text: "◀️", callback_data: `c:${id}:${current - 1}` });
  if (current < maxPage) nav.push({ text: "▶️", callback_data: `c:${id}:${current + 1}` });
  if (nav.length) keyboard.push(nav);
  keyboard.push([{ text: "🛒 Моя корзина", callback_data: "cart:0" }]);
  keyboard.push([{ text: "⬅️ К категориям", callback_data: "catalog" }]);
  await sendScreen(env, cb,
    `${categoryEmoji(c.title)} ${c.title}\n\nТоваров: ${c.products.length}\nСтраница ${current + 1} из ${maxPage + 1}\n\nВыберите товар:`,
    keyboard
  );
}

// Единая фото-карточка товара в трёх режимах:
// colors — выбор цвета; sizes — размеры; qty — количество.
async function renderProductCard(env, cb, data, id, ci = 0, pi = 0, mode = "colors", si = 0, qty = 1) {
  const p = productForId(data, id);
  if (!p) return sendScreen(env, cb, "⚠️ Товар не найден.", [[{ text: "⬅️ Каталог", callback_data: "catalog" }]]);
  const variants = variantList(p);
  if (!variants.length) ci = 0;
  else if (!Number.isInteger(ci) || ci < 0 || ci >= variants.length) ci = 0;
  const v = variants[ci];
  const photos = photosOfColor(p, ci);
  pi = Math.max(0, Math.min(photos.length - 1, Number.isInteger(pi) ? pi : 0));
  const photo = photos[pi] || null;
  const keyboard = [];
  const info = [];
  info.push(`🛍 ${p.title}`);
  info.push(`💰 ${money(p.price)}`);
  if (v) info.push(`🎨 Цвет: ${v.label}`);
  const heading = info.join("\n");
  const maxDescription = mode === "qty" ? 0 : mode === "sizes" ? 390 : 680;
  const description = shortDescription(p.description || p.design || "", maxDescription);
  const tail = mode === "colors"
    ? "\n\nВыберите цвет:" : mode === "sizes"
      ? "\n\nВыберите размер:" : "";
  let caption = heading + (description ? "\n\n" + description : "") + tail;

  // Листаем до 6 снимков внутри той же карточки.
  if (photos.length > 1) {
    keyboard.push([
      { text: "◀️", callback_data: `pic:${id}:${ci}:${(pi - 1 + photos.length) % photos.length}:${mode}:${si}:${qty}` },
      { text: `📷 ${pi + 1}/${photos.length}`, callback_data: "noop" },
      { text: "▶️", callback_data: `pic:${id}:${ci}:${(pi + 1) % photos.length}:${mode}:${si}:${qty}` }
    ]);
  }

  if (mode === "colors") {
    if (variants.length) {
      variants.forEach((color, index) => {
        const selected = index === ci ? "● " : "";
        keyboard.push([color.available && color.sizes.length
          ? { text: `🎨 ${selected}${color.label}`, callback_data: `cl:${id}:${index}` }
          : { text: `❌ ${color.label} — недоступен`, callback_data: "noop" }
        ]);
      });
    } else {
      keyboard.push([{ text: "📏 Выбрать размер", callback_data: `cl:${id}:0` }]);
    }
  } else if (mode === "sizes") {
    if (v && (!v.available || !v.sizes.length)) return renderProductCard(env, cb, data, id, ci, pi, "colors");
    const sizes = sizeChoices(p, ci);
    const keys = sizes.map((_, i) => stockKey(p, ci, i));
    const [stocks, inCarts] = await Promise.all([
      Promise.all(keys.map(k => k === null ? 0 : stock(env, p.slug, k))),
      Promise.all(keys.map(k => k === null ? 0 : cartQuantity(env, cb.from.id, p.slug, k)))
    ]);
    sizes.forEach((size, i) => {
      const room = Math.max(0, Math.min(MAX_QUANTITY - inCarts[i], stocks[i] - inCarts[i]));
      keyboard.push([room > 0
        ? { text: `📏 ${size || "Без размера"} — доступно ${room} шт.`, callback_data: `q:${id}:${ci}:${i}:1` }
        : { text: `❌ ${size || "Без размера"} — нет в наличии`, callback_data: "noop" }
      ]);
    });
    keyboard.push([{ text: "⬅️ К выбору цвета", callback_data: `p:${id}` }]);
  } else if (mode === "qty") {
    const key = stockKey(p, ci, si);
    if (key === null) return renderProductCard(env, cb, data, id, ci, pi, "sizes");
    const sizeInfo = describeStockSize(p, key);
    const [remaining, already] = await Promise.all([
      stock(env, p.slug, key), cartQuantity(env, cb.from.id, p.slug, key)
    ]);
    const room = Math.max(0, Math.min(MAX_QUANTITY - already, remaining - already));
    if (!room) {
      caption += `\n📏 ${sizeInfo.size || "Без размера"}\n\n⚠️ Добавить больше нельзя: на складе ${remaining}, в корзине ${already}.`;
    } else {
      qty = Math.max(1, Math.min(room, Math.trunc(Number(qty)) || 1));
      caption += `\n📏 Размер: ${sizeInfo.size || "Без размера"}\n` +
        `📦 На складе: ${remaining} шт.\n🛒 В корзине: ${already} шт.\n` +
        `Добавляем: ${qty} шт.\nСумма: ${money(Number(p.price) * qty)}`;
      keyboard.push([
        { text: "➖", callback_data: `q:${id}:${ci}:${si}:${Math.max(1, qty - 1)}` },
        { text: `📦 ${qty} шт.`, callback_data: "noop" },
        { text: "➕", callback_data: `q:${id}:${ci}:${si}:${Math.min(room, qty + 1)}` }
      ]);
      keyboard.push([{ text: "✅ Добавить в корзину", callback_data: `add:${id}:${ci}:${si}:${qty}` }]);
    }
    keyboard.push([{ text: "⬅️ Назад к размерам", callback_data: `cl:${id}:${ci}` }]);
  }

  if (p.slug) {
    keyboard.push([{ text: "🌐 Полное описание на сайте", url: `${SITE}/product.html?slug=${encodeURIComponent(p.slug)}` }]);
  }
  const parent = groupedCategories(data).find(c => normalized(c.id) === normalized(p.category));
  if (parent) keyboard.push([{ text: "⬅️ К товарам", callback_data: `c:${shortId(parent.id)}:0` }]);
  keyboard.push([{ text: "🛒 Моя корзина", callback_data: "cart:0" }]);
  // На фотографию помещается 1024 символа; оставляем запас.
  caption = caption.slice(0, 960);
  await showUnifiedCard(env, cb, photo, caption, keyboard);
}

async function showProduct(env, cb, data, id) {
  const p = productForId(data, id);
  if (!p) return showCategories(env, cb, data);
  const variants = variantList(p);
  const ci = variants.length ? Math.max(0, variants.findIndex(v => v.available && v.photos.length)) : 0;
  return renderProductCard(env, cb, data, id, ci, 0, "colors");
}

async function showColor(env, cb, data, id, ci) {
  return renderProductCard(env, cb, data, id, ci, 0, "sizes");
}

async function showGallery(env, cb, data, id, ci) {
  return renderProductCard(env, cb, data, id, ci, 0, "sizes");
}

// ===== Размер, количество, корзина =====

async function chooseQuantity(env, cb, data, id, colorIndex, sizeIndex, desired) {
  return renderProductCard(env, cb, data, id, colorIndex, 0, "qty", sizeIndex, desired);
}

async function addToCart(env, cb, data, id, colorIndex, sizeIndex, quantity) {
  const p = productForId(data, id);
  if (!p) return showCategories(env, cb, data);
  const key = stockKey(p, colorIndex, sizeIndex);
  if (key === null || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return showProduct(env, cb, data, id);
  }
  const result = await db(env).prepare(
    `INSERT INTO bot_cart_items (telegram_user_id, product_slug, size, quantity)
     SELECT ?, ?, ?, ?
     WHERE COALESCE((
       SELECT total_quantity - reserved_quantity FROM inventory
       WHERE product_slug = ? AND size = ?
         AND NOT EXISTS (
           SELECT 1 FROM inventory_exclusions e
           WHERE e.product_slug = inventory.product_slug AND e.size = inventory.size
         )
     ), 0) >= ?
     ON CONFLICT(telegram_user_id, product_slug, size)
     DO UPDATE SET
       quantity = bot_cart_items.quantity + excluded.quantity,
       updated_at = CURRENT_TIMESTAMP
     WHERE bot_cart_items.quantity + excluded.quantity <= 99
       AND COALESCE((
         SELECT total_quantity - reserved_quantity FROM inventory
         WHERE product_slug = ? AND size = ?
           AND NOT EXISTS (
             SELECT 1 FROM inventory_exclusions e
             WHERE e.product_slug = inventory.product_slug AND e.size = inventory.size
           )
       ), 0) >= bot_cart_items.quantity + excluded.quantity`
  ).bind(String(cb.from.id), p.slug, key, quantity, p.slug, key, quantity, p.slug, key).run();
  if (Number(result.meta?.changes || 0) !== 1) {
    return sendScreen(env, cb,
      "⚠️ Остаток выбранного цвета и размера изменился. Попробуйте обновить количество.",
      [[{ text: "🔄 Проверить снова", callback_data: `q:${id}:${colorIndex}:${sizeIndex}:1` }],
       [{ text: "🛒 Корзина", callback_data: "cart:0" }]]
    );
  }
  const info = describeStockSize(p, key);
  await sendScreen(env, cb,
    `✅ ТОВАР ДОБАВЛЕН\n\n🛍 ${p.title}\n` +
    (info.color ? `🎨 Цвет: ${info.color}\n` : "") +
    `📏 Размер: ${info.size || "Без размера"}\n📦 Добавлено: ${quantity} шт.`,
    [
      [{ text: "🛒 Открыть корзину", callback_data: "cart:0" }],
      [{ text: "🛍 Продолжить покупки", callback_data: "catalog" }]
    ]
  );
}

function cartRowId(row) {
  return shortId(JSON.stringify([row.product_slug, row.size]));
}

async function prepareOrder(env, data, userId) {
  const rows = await cartRows(env, userId);
  if (!rows.length) throw new Error("Корзина пуста.");
  if (rows.length > MAX_ORDER_ITEMS) throw new Error("Слишком много позиций в корзине.");
  const bySlug = new Map(data.products.map(p => [p.slug, p]));
  const items = [];
  let total = 0;
  for (const row of rows) {
    const p = bySlug.get(row.product_slug);
    if (!p) throw new Error(`Товар ${row.product_slug} недоступен.`);
    const info = describeStockSize(p, row.size);
    if (!info.valid) throw new Error(`Цвет или размер товара «${p.title}» больше недоступен.`);
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new Error(`Некорректное количество товара «${p.title}».`);
    }
    const remaining = await stock(env, p.slug, row.size);
    if (remaining < quantity) throw new Error(
      `Недостаточно товара «${p.title}» (${[info.color, info.size].filter(Boolean).join(" / ")}). На складе ${remaining} шт.`
    );
    const price = productPrice(p);
    const itemTotal = price * quantity;
    if (!Number.isSafeInteger(itemTotal)) throw new Error("Ошибка расчёта суммы.");
    total += itemTotal;
    if (!Number.isSafeInteger(total)) throw new Error("Ошибка расчёта суммы.");
    items.push({
      slug: String(p.slug),
      product_id: String(p.product_id || ""),
      title: String(p.title || p.slug),
      dbTitle: productTitle(p, row.size),
      color: info.color,
      size: info.size,
      stockSize: String(row.size),
      quantity,
      unit_price: price,
      item_total: itemTotal
    });
  }
  items.sort((a, b) => JSON.stringify([a.slug, a.stockSize]).localeCompare(JSON.stringify([b.slug, b.stockSize])));
  return { items, total };
}

async function showCart(env, cb, data, page = 0) {
  const rows = await cartRows(env, cb.from.id);
  if (!rows.length) return sendScreen(env, cb, "🛒 ВАША КОРЗИНА\n\n📦 Корзина пуста.",
    [[{ text: "🛍 К покупкам", callback_data: "catalog" }]]);
  const bySlug = new Map(data.products.map(p => [p.slug, p]));
  const maxPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
  const current = Math.max(0, Math.min(maxPage, Math.trunc(page) || 0));
  const lineTexts = [];
  const keyboard = [];
  let total = 0;
  let valid = rows.length <= MAX_ORDER_ITEMS;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const p = bySlug.get(row.product_slug);
    const info = describeStockSize(p, row.size);
    const count = await stock(env, row.product_slug, row.size);
    const price = p ? Number(p.price) : NaN;
    const quantity = Number(row.quantity);
    const ok = Boolean(p && info.valid && Number.isSafeInteger(price) && price >= 0 &&
      Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY && count >= quantity);
    if (!ok) valid = false;
    if (p && Number.isSafeInteger(price)) total += price * quantity;
    lineTexts.push(
      `${i + 1}. ${p?.title || row.product_slug}\n` +
      (info.color ? `🎨 ${info.color}\n` : "") +
      `📏 ${info.size || "Без размера"}\n` +
      `📦 ${quantity} шт. (на складе ${count})\n` +
      `💰 ${p && Number.isSafeInteger(price) ? money(price * quantity) : "Уточняется"}` +
      (ok ? "" : "\n⚠️ Позиция недоступна")
    );
  }
  for (let i = current * PAGE_SIZE; i < Math.min(rows.length, (current + 1) * PAGE_SIZE); i++) {
    keyboard.push([{ text: `🗑 Удалить позицию ${i + 1}`, callback_data: `del:${cartRowId(rows[i])}:${current}` }]);
  }
  const nav = [];
  if (current > 0) nav.push({ text: "◀️", callback_data: `cart:${current - 1}` });
  if (current < maxPage) nav.push({ text: "▶️", callback_data: `cart:${current + 1}` });
  if (nav.length) keyboard.push(nav);
  if (valid && Number.isSafeInteger(total)) keyboard.push([
    { text: "✅ Оформить заявку", callback_data: `review:${crypto.randomUUID()}` }
  ]);
  keyboard.push([{ text: "🔄 Обновить остатки", callback_data: `cart:${current}` }]);
  keyboard.push([{ text: "🛍 Продолжить покупки", callback_data: "catalog" }]);
  await sendScreen(env, cb,
    "🛒 ВАША КОРЗИНА\n\n" +
    lineTexts.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).join("\n\n") +
    `\n\nПозиций: ${rows.length}\nСтраница ${current + 1} из ${maxPage + 1}` +
    `\n💰 Итого: ${money(total)}` +
    (valid ? "\n\n✅ Можно оформить заявку." : "\n\n⚠️ Удалите недоступные позиции перед оформлением."),
    keyboard
  );
}

async function deleteCartItem(env, cb, data, id, page) {
  const row = (await cartRows(env, cb.from.id)).find(item => cartRowId(item) === id);
  if (row) await db(env).prepare(
    `DELETE FROM bot_cart_items WHERE telegram_user_id = ? AND product_slug = ? AND size = ?`
  ).bind(String(cb.from.id), row.product_slug, row.size).run();
  await showCart(env, cb, data, page);
}

// ===== Оформление заказов прямо в Telegram =====

function validUuid(s) {
  return typeof s === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function orderLinesText(items) {
  return items.map((item, i) =>
    `${i + 1}. ${item.title}` +
    (item.color ? `\nЦвет: ${item.color}` : "") +
    `\nРазмер: ${item.size || "Без размера"}\n` +
    `${item.quantity} шт. × ${money(item.unit_price)} = ${money(item.item_total)}`
  ).join("\n\n");
}

async function reviewOrder(env, cb, data, key) {
  if (!validUuid(key)) return showCart(env, cb, data);
  let order;
  try {
    order = await prepareOrder(env, data, cb.from.id);
  } catch (error) {
    return sendScreen(env, cb, `⚠️ Оформление пока недоступно:\n${error.message}`,
      [[{ text: "🛒 Вернуться в корзину", callback_data: "cart:0" }]]);
  }
  await sendScreen(env, cb,
    "📋 ПРОВЕРКА ЗАКАЗА\n\n" + orderLinesText(order.items) +
    `\n\n💰 Итого: ${money(order.total)}\n\n` +
    "Подтвердив заказ, вы передадите магазину данные Telegram для связи. " +
    "Оплата сейчас не производится.",
    [
      [{ text: "✅ Подтвердить заказ", callback_data: `confirm:${key}` }],
      [{ text: "⬅️ Вернуться в корзину", callback_data: "cart:0" }]
    ]
  );
}

function newOrderId() {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const rand = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `FO-${stamp}-${rand}`;
}

async function sha256(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function previousTelegramOrder(env, key, userId) {
  return db(env).prepare(
    `SELECT order_id, status FROM orders
     WHERE checkout_key = ? AND source = 'telegram' AND telegram_user_id = ? LIMIT 1`
  ).bind(key, String(userId)).first();
}

async function storeTelegramOrder(env, userId, key, order) {
  const prior = await previousTelegramOrder(env, key, userId);
  if (prior) return { created: false, duplicate: true, orderId: prior.order_id };
  const items = order.items;
  const id = newOrderId();
  const fingerprint = await sha256(JSON.stringify(items.map(i => ({
    slug: i.slug, size: i.stockSize, quantity: i.quantity
  }))));
  const expectedSql = items.map(() => "(?, ?, ?)").join(", ");
  const args = items.flatMap(i => [i.slug, i.stockSize, i.quantity]);
  // Все проверки и запись выполняются в одной D1 batch-транзакции.
  const insert = db(env).prepare(
    `WITH expected(slug, size, quantity) AS (VALUES ${expectedSql})
     INSERT INTO orders (order_id, status, checkout_key, payload_hash, source, telegram_user_id)
     SELECT ?, 'pending', ?, ?, 'telegram', ?
     WHERE EXISTS (SELECT 1 FROM bot_cart_items WHERE telegram_user_id = ?)
       AND (SELECT COUNT(*) FROM bot_cart_items WHERE telegram_user_id = ?) = ?
       AND NOT EXISTS (
         SELECT 1 FROM bot_cart_items c LEFT JOIN expected e
           ON e.slug = c.product_slug AND e.size = c.size
         WHERE c.telegram_user_id = ? AND (e.quantity IS NULL OR e.quantity <> c.quantity)
       )
       AND NOT EXISTS (
         SELECT 1 FROM bot_cart_items c LEFT JOIN inventory i
           ON i.product_slug = c.product_slug AND i.size = c.size
         WHERE c.telegram_user_id = ? AND (
           i.product_slug IS NULL OR
           i.total_quantity - i.reserved_quantity < c.quantity OR
           EXISTS (SELECT 1 FROM inventory_exclusions ex
                   WHERE ex.product_slug = c.product_slug AND ex.size = c.size)
         )
       )`
  ).bind(...args, id, key, fingerprint, String(userId), String(userId), String(userId),
    items.length, String(userId), String(userId));
  const statements = [insert];
  for (const item of items) {
    statements.push(db(env).prepare(
      `INSERT INTO order_items
        (order_id, product_slug, product_title, size, quantity, unit_price, product_id)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM orders WHERE order_id = ? AND checkout_key = ?)`
    ).bind(id, item.slug, item.dbTitle, item.stockSize, item.quantity,
      item.unit_price, item.product_id, id, key));
  }
  statements.push(db(env).prepare(
    `DELETE FROM bot_cart_items
     WHERE telegram_user_id = ?
       AND EXISTS (SELECT 1 FROM orders WHERE order_id = ? AND checkout_key = ?)`
  ).bind(String(userId), id, key));
  let results;
  try {
    results = await db(env).batch(statements);
  } catch (error) {
    const existing = await previousTelegramOrder(env, key, userId);
    if (existing) return { created: false, duplicate: true, orderId: existing.order_id };
    throw error;
  }
  if (Number(results?.[0]?.meta?.changes || 0) === 1) {
    return { created: true, duplicate: false, orderId: id };
  }
  const existing = await previousTelegramOrder(env, key, userId);
  if (existing) return { created: false, duplicate: true, orderId: existing.order_id };
  return { created: false, duplicate: false, orderId: null };
}

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function contactLink(from) {
  const username = String(from.username || "");
  if (/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    return `<a href="https://t.me/${username}">@${esc(username)}</a>`;
  }
  return `<a href="tg://user?id=${from.id}">Открыть профиль</a>`;
}

async function notifyAdmin(env, from, orderId, items, total, source) {
  const adminId = String(env.ADMIN_CHAT_ID || "").trim();
  if (!/^-?\d+$/.test(adminId)) {
    console.error("ADMIN_CHAT_ID не задан");
    return false;
  }
  const lines = items.map((item, i) =>
    `${i + 1}. ${esc(item.title)}` +
    (item.color ? `\nЦвет: ${esc(item.color)}` : "") +
    `\nРазмер: ${esc(item.size || "Без размера")}` +
    `\n${item.quantity} шт. × ${esc(money(item.unit_price))} = ${esc(money(item.item_total))}`
  ).join("\n\n");
  const person = [from.first_name, from.last_name].filter(Boolean).join(" ");
  const body =
    `🔔 <b>${source === "site" ? "ЗАКАЗ С САЙТА — ПЕРЕХОД В TELEGRAM" : "НОВЫЙ ЗАКАЗ"}</b>\n\n` +
    `<b>№ ${esc(orderId)}</b>\nИсточник: ${source === "site" ? "Сайт" : "Telegram-бот"}\n` +
    `Статус: Ожидает обработки\n\n${lines}\n\n` +
    `<b>💰 Итого: ${esc(money(total))}</b>\n\n` +
    `👤 <b>Покупатель</b>\n${esc(person || "Без имени")}\n` +
    `Telegram ID: <code>${from.id}</code>\n${contactLink(from)}\n\n` +
    "💳 Оплата не произведена.";
  try {
    await telegram(env, "sendMessage", {
      chat_id: adminId, text: body.slice(0, 3900), parse_mode: "HTML",
      disable_web_page_preview: true
    });
    return true;
  } catch (error) {
    console.error("Ошибка уведомления администратора:", error.message);
    return false;
  }
}

async function confirmOrder(env, cb, data, key) {
  if (!validUuid(key)) return showCart(env, cb, data);
  const userId = String(cb.from.id);
  const existing = await previousTelegramOrder(env, key, userId);
  if (existing) return sendScreen(env, cb,
    `✅ ЗАКАЗ УЖЕ СОЗДАН\n\n🆔 № ${existing.order_id}\n\nПовторный заказ не создавался.`,
    [[{ text: "🛍 Каталог", callback_data: "catalog" }]]);
  let order;
  try {
    order = await prepareOrder(env, data, userId);
  } catch (error) {
    // Двойной клик мог успеть создать заказ и очистить корзину.
    const after = await previousTelegramOrder(env, key, userId);
    if (after) return sendScreen(env, cb,
      `✅ ЗАКАЗ УЖЕ СОЗДАН\n\n🆔 № ${after.order_id}\n\nПовторного заказа нет.`,
      [[{ text: "🛍 Каталог", callback_data: "catalog" }]]);
    return sendScreen(env, cb,
      `⚠️ ЗАКАЗ НЕ ОФОРМЛЕН\n\n${error.message}`,
      [[{ text: "🛒 Проверить корзину", callback_data: "cart:0" }]]);
  }
  const result = await storeTelegramOrder(env, userId, key, order);
  if (!result.created) {
    if (result.duplicate) return sendScreen(env, cb,
      `✅ ЗАКАЗ УЖЕ СОЗДАН\n\n🆔 № ${result.orderId}\n\nПовторный заказ не создавался.`,
      [[{ text: "🛍 Каталог", callback_data: "catalog" }]]);
    return sendScreen(env, cb,
      "⚠️ Корзина или остатки изменились при оформлении. Обновите корзину и попробуйте снова.",
      [[{ text: "🛒 Обновить корзину", callback_data: "cart:0" }]]);
  }
  const notified = await notifyAdmin(env, cb.from, result.orderId, order.items, order.total, "telegram");
  if (!notified) console.error("Заказ сохранён, но администратор не уведомлён:", result.orderId);
  await sendScreen(env, cb,
    `🎉 ЗАКАЗ ПРИНЯТ!\n\n🆔 Номер заказа:\n${result.orderId}\n\n` +
    `💰 Сумма: ${money(order.total)}\n\n` +
    "📩 Заявка сохранена в системе магазина.\n\n" +
    "Администратор свяжется с вами для согласования наличия, оплаты и доставки.\n\n" +
    "Сохраните номер заказа.",
    [
      [{ text: "🛍 Продолжить покупки", callback_data: "catalog" }],
      [{ text: "🛒 Моя корзина", callback_data: "cart:0" }]
    ]
  );
}

// ===== Привязка созданных на сайте заказов через /start order_FO-... =====

function parseSiteOrder(text) {
  const match = String(text || "").trim().match(
    /^\/start(?:@\w+)?\s+order_(FO-\d{8}-[0-9A-F]{12})$/i
  );
  return match ? match[1].toUpperCase() : null;
}

async function siteOrder(env, id) {
  const order = await db(env).prepare(
    `SELECT order_id, status, source, telegram_user_id FROM orders WHERE order_id = ? LIMIT 1`
  ).bind(id).first();
  if (!order) return null;
  const result = await db(env).prepare(
    `SELECT product_slug AS slug, product_title AS title, size, quantity, unit_price
     FROM order_items WHERE order_id = ? ORDER BY product_slug, size`
  ).bind(id).all();
  const data = await catalog().catch(() => ({ products: [] }));
  const bySlug = new Map(data.products.map(p => [p.slug, p]));
  const items = (result.results || []).map(r => {
    const product = bySlug.get(r.slug);
    const info = describeStockSize(product, r.size);
    const quantity = Number(r.quantity);
    const price = Number(r.unit_price);
    return {
      title: product?.title || String(r.title || r.slug),
      color: info.color,
      size: info.size,
      quantity,
      unit_price: price,
      item_total: price * quantity
    };
  });
  return { ...order, items, total: items.reduce((sum, item) => sum + item.item_total, 0) };
}

function siteOrderText(order) {
  const lines = [
    "Здравствуйте! Хочу заказать мерч Клуба «5 океанов».",
    "",
    `Номер заказа: ${order.order_id}`,
    ""
  ];
  order.items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.title}`);
    if (item.color) lines.push(`Цвет: ${item.color}`);
    lines.push(`Размер: ${item.size || "Без размера"}`);
    lines.push(`Количество: ${item.quantity} шт.`);
    lines.push(`Цена: ${money(item.unit_price)}/шт.`);
    lines.push(`Сумма: ${money(item.item_total)}`);
    lines.push("");
  });
  lines.push(`Итого по товарам: ${money(order.total)}`);
  lines.push("Доставка: уточняется.");
  lines.push("");
  lines.push("Пожалуйста, подтвердите наличие и итоговую стоимость.");
  return lines.join("\n");
}

async function claimSiteOrder(env, message, orderId) {
  if (!ORDER_ID_RE.test(orderId)) return;
  const userId = String(message.from.id);
  // Атомарно привязываем заказ один раз; новые строки orders НЕ создаём.
  const result = await db(env).prepare(
    `UPDATE orders SET telegram_user_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE order_id = ? AND source = 'site' AND telegram_user_id IS NULL
       AND status NOT IN ('cancelled', 'expired')`
  ).bind(userId, orderId).run();
  const firstClaim = Number(result.meta?.changes || 0) === 1;
  const order = await siteOrder(env, orderId);
  if (!order || order.source !== "site" || String(order.telegram_user_id) !== userId) {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: "⚠️ Заказ не найден либо уже привязан к другому Telegram-аккаунту.",
      reply_markup: { inline_keyboard: [[{ text: "🌐 Открыть магазин", url: SITE }]] }
    });
    return;
  }
  if (!order.items.length) {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id,
      text: `⚠️ Заказ № ${orderId} найден, но сведения о товарах недоступны. Обратитесь к администратору.`
    });
    return;
  }
  await telegram(env, "sendMessage", {
    chat_id: message.chat.id,
    text: (firstClaim ? "✅ ЗАКАЗ С САЙТА ПОЛУЧЕН!\n\n" : "✅ ЗАКАЗ УЖЕ ПРИВЯЗАН К ВАШЕМУ TELEGRAM\n\n") +
      siteOrderText(order).slice(0, 3400) +
      "\n\n📩 Заявка находится в системе магазина. Администратор свяжется с вами для согласования оплаты и доставки.",
    reply_markup: { inline_keyboard: [
      [{ text: "🛍 Каталог", callback_data: "catalog" }],
      [{ text: "🛒 Моя корзина", callback_data: "cart:0" }]
    ] }
  });
  if (firstClaim) {
    const ok = await notifyAdmin(env, message.from, order.order_id, order.items, order.total, "site");
    if (!ok) console.error("Сайт: заказ привязан, но администратор не уведомлён:", order.order_id);
  }
}

// ===== Закрытое управление заказами через Telegram =====
// BOT_ADMIN_ID: единственный числовой Telegram ID администратора.
// BOT_ADMIN_PASSWORD: секрет Worker (НЕ хранить пароль в исходном коде).
// Сессии (8 часов) и ограничение попыток хранятся в общей D1.
// Все операции с заказами используют те же поля и SQL-правила,
// что и /developers на сайте. Отдельной CRM нет.

function isBotAdmin(env, telegramId) {
  const configured = String(env.BOT_ADMIN_ID || "").trim();
  return /^\d{5,20}$/.test(configured) &&
    configured === String(telegramId);
}

function adminConfigured(env) {
  return isBotAdmin(env, env.BOT_ADMIN_ID) &&
    typeof env.BOT_ADMIN_PASSWORD === "string" &&
    env.BOT_ADMIN_PASSWORD.length >= 8;
}

async function ensureAdminAuthTable(env) {
  await db(env).prepare(
    `CREATE TABLE IF NOT EXISTS bot_admin_auth (       telegram_user_id TEXT PRIMARY KEY,
       authenticated_until INTEGER NOT NULL DEFAULT 0,
       login_expires INTEGER NOT NULL DEFAULT 0,
       failures INTEGER NOT NULL DEFAULT 0,
       locked_until INTEGER NOT NULL DEFAULT 0,
       secret_tag TEXT NOT NULL DEFAULT ''
     )`
  ).run();
}

function adminNow() {
  return Math.floor(Date.now() / 1000);
}

async function adminSecretTag(env) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.BOT_ADMIN_PASSWORD),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const result = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode("five-oceans-bot-admin-v1")
  );
  return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, "0")).join("");
}

async function samePassword(candidate, secret) {
  const encoder = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(secret))
  ]);
  const a = new Uint8Array(x), b = new Uint8Array(y);
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}

async function adminAuthRow(env, userId) {
  return db(env).prepare(
    `SELECT authenticated_until, login_expires, failures,
            locked_until, secret_tag
     FROM bot_admin_auth WHERE telegram_user_id = ? LIMIT 1`
  ).bind(String(userId)).first();
}

async function adminAuthorized(env, userId) {
  if (!isBotAdmin(env, userId) || !adminConfigured(env)) return false;
  await ensureAdminAuthTable(env);
  const row = await adminAuthRow(env, userId);
  if (!row || Number(row.authenticated_until) <= adminNow()) return false;
  return row.secret_tag === await adminSecretTag(env);
}

async function adminPrompt(env, cb) {
  const userId = cb.from.id;
  if (!isBotAdmin(env, userId)) return;
  if (!adminConfigured(env)) {
    return sendScreen(env, cb,
      "⚙️ Управление ещё не настроено.\n\nДобавьте в Worker переменные BOT_ADMIN_ID и секрет BOT_ADMIN_PASSWORD.",
      [[{ text: "⬅️ К магазину", callback_data: "catalog" }]]
    );
  }
  await ensureAdminAuthTable(env);
  const now = adminNow();
  const row = await adminAuthRow(env, userId);
  if (Number(row?.locked_until || 0) > now) {
    return sendScreen(env, cb,
      "🔒 Слишком много неверных попыток. Вход временно заблокирован на 15 минут.",
      [[{ text: "⬅️ К магазину", callback_data: "catalog" }]]
    );
  }
  await db(env).prepare(
    `INSERT INTO bot_admin_auth
       (telegram_user_id, login_expires, failures, locked_until)
     VALUES (?, ?, 0, 0)
     ON CONFLICT(telegram_user_id) DO UPDATE SET
       login_expires = excluded.login_expires,
       failures = CASE WHEN locked_until > 0 AND locked_until <= ? THEN 0 ELSE failures END,
       locked_until = CASE WHEN locked_until > 0 AND locked_until <= ? THEN 0 ELSE locked_until END`
  ).bind(String(userId), now + ADMIN_LOGIN_SECONDS, now, now).run();
  await sendScreen(env, cb,
    "🔐 Вход в управление\n\nОтправьте пароль отдельным сообщением в этот чат. " +
    "На ввод даётся 3 минуты. Сообщение с паролем бот попытается сразу удалить.\n\n" +
    "После входа сессия действует 8 часов.",
    [[{ text: "❌ Отмена", callback_data: "ad:cancel" }]]
  );
}

async function maybeHandleAdminPassword(env, message) {
  if (!isBotAdmin(env, message.from?.id) ||
      !adminConfigured(env) ||
      typeof message.text !== "string") return false;
  const value = message.text;
  if (/^\/\w+/.test(value) || value === MAIN_BUTTON) return false;
  await ensureAdminAuthTable(env);
  const row = await adminAuthRow(env, message.from.id);
  const now = adminNow();
  if (!row || Number(row.login_expires) <= now) return false;
  if (Number(row.authenticated_until) > now &&
      row.secret_tag === await adminSecretTag(env)) return false;
  // Не записываем пароль в логи и не пересылаем администратору.
  try {
    await telegram(env, "deleteMessage", {
      chat_id: message.chat.id, message_id: message.message_id
    });
  } catch (error) {
    console.warn("Не удалось удалить сообщение с паролем", error.message);
  }
  if (Number(row.locked_until) > now) {
    await telegram(env, "sendMessage", {
      chat_id: message.chat.id, text: "🔒 Вход временно заблокирован."
    });
    return true;
  }
  const match = value.length <= 256 &&
    await samePassword(value.trim(), env.BOT_ADMIN_PASSWORD);
  if (match) {
    const tag = await adminSecretTag(env);
    await db(env).prepare(
      `UPDATE bot_admin_auth
       SET authenticated_until = ?, login_expires = 0,
           failures = 0, locked_until = 0, secret_tag = ?
       WHERE telegram_user_id = ? AND locked_until <= ?`
    ).bind(now + ADMIN_SESSION_SECONDS, tag,
      String(message.from.id), now).run();
    const pseudoCallback = {
      from: message.from, message: { chat: message.chat }
    };
    await adminHome(env, pseudoCallback, true);
    return true;
  }
  await db(env).prepare(
    `UPDATE bot_admin_auth
     SET failures = failures + 1,
         locked_until = CASE WHEN failures + 1 >= ? THEN ? ELSE locked_until END,
         login_expires = CASE WHEN failures + 1 >= ? THEN 0 ELSE login_expires END
     WHERE telegram_user_id = ?`
  ).bind(ADMIN_MAX_FAILURES, now + ADMIN_LOCK_SECONDS,
    ADMIN_MAX_FAILURES, String(message.from.id)).run();
  const latest = await adminAuthRow(env, message.from.id);
  const locked = Number(latest?.locked_until || 0) > now;
  await telegram(env, "sendMessage", {
    chat_id: message.chat.id,
    text: locked
      ? "🔒 Пять неверных попыток. Вход заблокирован на 15 минут."
      : `❌ Неверный пароль. Осталось попыток: ${ADMIN_MAX_FAILURES - Number(latest?.failures || 0)}.`
  });
  return true;
}

async function adminLogout(env, userId) {
  await ensureAdminAuthTable(env);
  await db(env).prepare(
    `UPDATE bot_admin_auth
     SET authenticated_until = 0, login_expires = 0, secret_tag = ''
     WHERE telegram_user_id = ?`
  ).bind(String(userId)).run();
}

function statusName(status) {
  return ({
    pending: "Новый", reserved: "В резерве", sold: "Оплачен",
    cancelled: "Отменён", expired: "Истёк"
  })[status] || String(status || "Неизвестен");
}

function shippingName(status) {
  return status === "shipped" ? "Отправлено" : "Не отправлено";
}

function adminNav() {
  return [
    [{ text: "📦 Заказы", callback_data: "ad:orders:a:0" }],
    [{ text: "📊 Сводка", callback_data: "ad:summary" },
     { text: "🏬 Склад", callback_data: "ad:stock:0" }],
    [{ text: "🌐 Веб-CRM", url: `${SITE}/developers` }],
    [{ text: "🔒 Выйти", callback_data: "ad:logout" }]
  ];
}

async function adminHome(env, cb, fresh = false) {
  const totals = await db(env).prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) AS reserved
     FROM orders`
  ).first();
  const text =
    "⚙️ УПРАВЛЕНИЕ МАГАЗИНОМ\n\n" +
    (fresh ? "✅ Вход выполнен.\n\n" : "") +
    `🆕 Новые заказы: ${Number(totals?.pending || 0)}\n` +
    `📌 В резерве: ${Number(totals?.reserved || 0)}\n` +
    `📦 Всего заказов: ${Number(totals?.total || 0)}\n\n` +
    "Статусы заказов и склад общие с CRM на сайте.";
  await sendScreen(env, cb, text, adminNav());
}

async function adminSummary(env, cb) {
  const [orders, stockRows] = await Promise.all([
    db(env).prepare(
      `SELECT status, COUNT(*) AS count FROM orders GROUP BY status`
    ).all(),
    db(env).prepare(
      `SELECT COUNT(*) AS positions,
              SUM(MAX(0, i.total_quantity - i.reserved_quantity)) AS available,
              SUM(i.reserved_quantity) AS reserved
       FROM inventory i
       WHERE NOT EXISTS (
         SELECT 1 FROM inventory_exclusions e
         WHERE e.product_slug = i.product_slug AND e.size = i.size
       )`
    ).first()
  ]);
  const counts = Object.fromEntries((orders.results || []).map(r => [r.status, Number(r.count)]));
  await sendScreen(env, cb,
    "📊 СВОДКА CRM\n\n" +
    `🆕 Новые: ${counts.pending || 0}\n` +
    `📌 В резерве: ${counts.reserved || 0}\n` +
    `✅ Оплачены: ${counts.sold || 0}\n` +
    `❌ Отменены: ${counts.cancelled || 0}\n` +
    `⌛ Истекли: ${counts.expired || 0}\n\n` +
    `🏬 Складских позиций: ${Number(stockRows?.positions || 0)}\n` +
    `📦 Доступно единиц: ${Number(stockRows?.available || 0)}\n` +
    `🔒 Зарезервировано единиц: ${Number(stockRows?.reserved || 0)}\n\n` +
    "Данные напрямую из D1.",
    [[{ text: "📦 К заказам", callback_data: "ad:orders:a:0" }],
     [{ text: "⬅️ Управление", callback_data: "ad:home" }]]
  );
}

const ADMIN_ORDER_FILTERS = {
  a: { name: "Все", condition: "1=1" },
  p: { name: "Новые", condition: "status = 'pending'" },
  r: { name: "В резерве", condition: "status = 'reserved'" },
  s: { name: "Оплаченные", condition: "status = 'sold'" }
};

async function adminOrders(env, cb, filterCode = "a", page = 0) {
  const filter = ADMIN_ORDER_FILTERS[filterCode] || ADMIN_ORDER_FILTERS.a;
  const code = ADMIN_ORDER_FILTERS[filterCode] ? filterCode : "a";
  const current = Math.max(0, Math.min(10000, Math.trunc(page) || 0));
  const [countRow, orderResult] = await Promise.all([
    db(env).prepare(`SELECT COUNT(*) AS count FROM orders WHERE ${filter.condition}`).first(),
    db(env).prepare(
      `SELECT order_id, status, shipping_status, source, created_at
       FROM orders WHERE ${filter.condition}
       ORDER BY created_at DESC, order_id DESC
       LIMIT ? OFFSET ?`
    ).bind(ADMIN_PAGE_SIZE, current * ADMIN_PAGE_SIZE).all()
  ]);
  const total = Number(countRow?.count || 0);
  const maxPage = Math.max(0, Math.ceil(total / ADMIN_PAGE_SIZE) - 1);
  const safePage = Math.min(current, maxPage);
  if (safePage !== current) return adminOrders(env, cb, code, safePage);
  const keyboard = [
    [
      { text: "Все", callback_data: "ad:orders:a:0" },
      { text: "Новые", callback_data: "ad:orders:p:0" },
      { text: "Резерв", callback_data: "ad:orders:r:0" },
      { text: "Оплачено", callback_data: "ad:orders:s:0" }
    ]
  ];
  for (const order of orderResult.results || []) {
    keyboard.push([{
      text: `${order.status === "pending" ? "🆕" : order.status === "reserved" ? "📌" : "📦"} ` +
        `${order.order_id} · ${statusName(order.status)}`,
      callback_data: `ad:order:${order.order_id}`
    }]);
  }
  const navigation = [];
  if (safePage > 0) navigation.push({ text: "◀️", callback_data: `ad:orders:${code}:${safePage - 1}` });
  if (safePage < maxPage) navigation.push({ text: "▶️", callback_data: `ad:orders:${code}:${safePage + 1}` });
  if (navigation.length) keyboard.push(navigation);
  keyboard.push([{ text: "🔄 Обновить", callback_data: `ad:orders:${code}:${safePage}` }]);
  keyboard.push([{ text: "⬅️ Управление", callback_data: "ad:home" }]);
  await sendScreen(env, cb,
    `📦 ЗАКАЗЫ — ${filter.name}\n\n` +
    `Всего: ${total}, страница ${safePage + 1}/${maxPage + 1}.\n` +
    "Выберите заказ для просмотра и управления:", keyboard
  );
}

async function adminReadOrder(env, orderId) {
  const order = await db(env).prepare(
    `SELECT order_id, status, shipping_status, source, telegram_user_id,
            created_at, updated_at
     FROM orders WHERE order_id = ? LIMIT 1`
  ).bind(orderId).first();
  if (!order) return null;
  const r = await db(env).prepare(
    `SELECT product_slug, product_title, size, quantity, unit_price
     FROM order_items WHERE order_id = ? ORDER BY product_slug, size`
  ).bind(orderId).all();
  const rows = r.results || [];
  const total = rows.reduce((s, x) => s + Number(x.unit_price) * Number(x.quantity), 0);
  return { ...order, items: rows, total };
}

async function adminOrder(env, cb, orderId, notice = "") {
  if (!ORDER_ID_RE.test(orderId)) return adminOrders(env, cb);
  const order = await adminReadOrder(env, orderId);
  if (!order) return sendScreen(env, cb, "⚠️ Заказ не найден.", [
    [{ text: "⬅️ К заказам", callback_data: "ad:orders:a:0" }]
  ]);
  const data = await catalog().catch(() => ({ products: [] }));
  const products = new Map(data.products.map(p => [p.slug, p]));
  const lines = order.items.map((item, i) => {
    const p = products.get(item.product_slug);
    const details = describeStockSize(p, item.size);
    return `${i + 1}. ${item.product_title || item.product_slug}\n` +
      (details.color && !String(item.product_title).includes(details.color)
        ? `🎨 ${details.color}\n` : "") +
      `📏 ${details.size || "Без размера"} · ${item.quantity} шт. × ${money(item.unit_price)}`;
  }).join("\n\n");
  const status = order.status;
  const ship = order.shipping_status === "shipped" ? "shipped" : "not_shipped";
  const keyboard = [];
  if (status === "pending") keyboard.push([{
    text: "📌 В резерв", callback_data: `ad:ask:${orderId}:reserve:pending`
  }]);
  if (["pending", "reserved"].includes(status)) {
    keyboard.push([{
      text: "✅ Оплачено", callback_data: `ad:ask:${orderId}:paid:${status}`
    }]);
    keyboard.push([{
      text: "❌ Отменить", callback_data: `ad:ask:${orderId}:cancel:${status}`
    }]);
  }
  keyboard.push([{
    text: ship === "shipped" ? "↩️ Не отправлено" : "🚚 Отметить отправленным",
    callback_data: `ad:ask:${orderId}:${ship === "shipped" ? "unship" : "ship"}:${ship}`
  }]);
  keyboard.push([{ text: "🔄 Обновить", callback_data: `ad:order:${orderId}` }]);
  keyboard.push([{ text: "⬅️ К заказам", callback_data: "ad:orders:a:0" }]);
  await sendScreen(env, cb,
    (notice ? `✅ ${notice}\n\n` : "") +
    `📦 ЗАКАЗ ${order.order_id}\n\n` +
    `Источник: ${order.source === "telegram" ? "Telegram" : "Сайт"}\n` +
    `Статус: ${statusName(status)}\n` +
    `Отправка: ${shippingName(ship)}\n` +
    `Покупатель Telegram ID: ${order.telegram_user_id || "пока не привязан"}\n` +
    `Создан: ${order.created_at || "—"} UTC\n\n` +
    `${lines || "Нет позиций"}\n\n` +
    `💰 Итого: ${money(order.total)}`, keyboard
  );
}

function adminActionName(op) {
  return ({ reserve: "поставить в резерв", paid: "отметить оплаченным",
    cancel: "отменить заказ", ship: "отметить отправленным",
    unship: "вернуть в «Не отправлено»" })[op];
}

async function adminAsk(env, cb, id, op, expected) {
  if (!ORDER_ID_RE.test(id) || !adminActionName(op) ||
      !/^(pending|reserved|sold|cancelled|expired|not_shipped|shipped)$/.test(expected)) {
    return adminHome(env, cb);
  }
  const order = await adminReadOrder(env, id);
  if (!order) return adminOrders(env, cb);
  const current = (op === "ship" || op === "unship")
    ? order.shipping_status : order.status;
  if (current !== expected) {
    return adminOrder(env, cb, id, "Статус уже изменился; данные обновлены.");
  }
  return sendScreen(env, cb,
    `⚠️ ПОДТВЕРЖДЕНИЕ\n\nЗаказ: ${id}\n` +
    `Действие: ${adminActionName(op)}\n\n` +
    "Это сразу изменит CRM на сайте" +
    (["reserve", "paid", "cancel"].includes(op) ? " и, при необходимости, склад." : "."),
    [
      [{ text: "✅ Подтвердить", callback_data: `ad:do:${id}:${op}:${expected}` }],
      [{ text: "❌ Назад к заказу", callback_data: `ad:order:${id}` }]
    ]
  );
}

// Точная семантика actions order-reserve/order-paid/order-cancel
// из текущей функции changeOrderStatus кабинета /developers.
// SQL guard и D1 batch обеспечивают атомарность статуса и склада.
async function adminChangeOrderStatus(env, id, action, expected) {
  if (!["reserve", "paid", "cancel"].includes(action)) throw new Error("Недопустимое действие.");
  const existing = await db(env).prepare(
    `SELECT status FROM orders WHERE order_id = ? LIMIT 1`
  ).bind(id).first();
  if (!existing) throw new Error("Заказ не найден.");
  const from = existing.status;
  if (from !== expected || !["pending", "reserved"].includes(from)) {
    throw new Error("Статус уже изменился. Откройте заказ заново.");
  }
  if (action === "reserve" && from !== "pending") {
    throw new Error("Заказ уже в резерве.");
  }
  const to = action === "reserve" ? "reserved" : action === "paid" ? "sold" : "cancelled";
  const changesStock = action !== "cancel" || from === "reserved";
  const needsAvailable = action === "reserve" || (action === "paid" && from === "pending");
  const stockCheck = needsAvailable
    ? "i.total_quantity - i.reserved_quantity < oi.quantity"
    : "i.reserved_quantity < oi.quantity OR i.total_quantity < oi.quantity";
  const requirements = changesStock ? `EXISTS (
      SELECT 1 FROM order_items oi WHERE oi.order_id = orders.order_id
    ) AND NOT EXISTS (
      SELECT 1 FROM order_items oi
      LEFT JOIN inventory i ON i.product_slug = oi.product_slug AND i.size = oi.size
      WHERE oi.order_id = orders.order_id
        AND (i.product_slug IS NULL OR ${stockCheck})
    )` : "1 = 1";
  const update = db(env).prepare(
    `UPDATE orders SET status = CASE
       WHEN status = ? AND (${requirements}) THEN ?
       ELSE '__invalid_status__'
     END, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?`
  ).bind(from, to, id);
  const statements = [update];
  if (changesStock) {
    const quantity = `(SELECT oi.quantity FROM order_items oi
      WHERE oi.order_id = ? AND oi.product_slug = inventory.product_slug
        AND oi.size = inventory.size)`;
    let fields;
    let bindings;
    if (action === "reserve") {
      fields = `reserved_quantity = reserved_quantity + ${quantity}`;
      bindings = [id];
    } else if (action === "paid" && from === "pending") {
      fields = `total_quantity = total_quantity - ${quantity}`;
      bindings = [id];
    } else if (action === "paid" && from === "reserved") {
      fields = `total_quantity = total_quantity - ${quantity},
                reserved_quantity = reserved_quantity - ${quantity}`;
      bindings = [id, id];
    } else {
      fields = `reserved_quantity = reserved_quantity - ${quantity}`;
      bindings = [id];
    }
    statements.push(db(env).prepare(
      `UPDATE inventory SET ${fields}, updated_at = CURRENT_TIMESTAMP
       WHERE EXISTS (
         SELECT 1 FROM order_items oi
         WHERE oi.order_id = ?
           AND oi.product_slug = inventory.product_slug AND oi.size = inventory.size
       )`
    ).bind(...bindings, id));
  }
  try {
    const responses = await db(env).batch(statements);
    if (Number(responses?.[0]?.meta?.changes || 0) !== 1) {
      throw new Error("Заказ не был обновлён.");
    }
  } catch (error) {
    console.error("Admin order transition failed:", error.message);
    throw new Error("Статус или остатки изменились, либо товара недостаточно. Обновите заказ.");
  }
  return to === "reserved" ? "Заказ в резерве" :
    to === "sold" ? "Заказ оплачен" : "Заказ отменён";
}

async function adminChangeShipping(env, id, op, expected) {
  const next = op === "ship" ? "shipped" : "not_shipped";
  if (!(["ship", "unship"].includes(op) &&
    ["shipped", "not_shipped"].includes(expected) && next !== expected)) {
    throw new Error("Недопустимый статус отправки.");
  }
  const result = await db(env).prepare(
    `UPDATE orders SET shipping_status = ?
     WHERE order_id = ? AND shipping_status = ?`
  ).bind(next, id, expected).run();
  if (Number(result.meta?.changes || 0) === 1) return `Отправка: ${shippingName(next)}`;
  const current = await db(env).prepare(
    `SELECT shipping_status FROM orders WHERE order_id = ? LIMIT 1`
  ).bind(id).first();
  if (!current) throw new Error("Заказ не найден.");
  if (current.shipping_status === next) return `Отправка уже отмечена: ${shippingName(next)}`;
  throw new Error("Отправка изменилась в другом интерфейсе. Обновите заказ.");
}

async function adminExecute(env, cb, id, op, expected) {
  if (!ORDER_ID_RE.test(id) || !adminActionName(op)) return adminHome(env, cb);
  try {
    const label = ["ship", "unship"].includes(op)
      ? await adminChangeShipping(env, id, op, expected)
      : await adminChangeOrderStatus(env, id, op, expected);
    return adminOrder(env, cb, id, label);
  } catch (error) {
    return sendScreen(env, cb, `⚠️ ${error.message}`, [
      [{ text: "🔄 Обновить заказ", callback_data: `ad:order:${id}` }],
      [{ text: "⬅️ Заказы", callback_data: "ad:orders:a:0" }]
    ]);
  }
}

// Склад: компактный просмотр по товарам, без финансовых правок.
async function adminStock(env, cb, page = 0) {
  const r = await db(env).prepare(
    `SELECT i.product_slug AS slug,
            COUNT(*) AS positions,
            SUM(MAX(0, i.total_quantity - i.reserved_quantity)) AS available
     FROM inventory i
     WHERE NOT EXISTS (
       SELECT 1 FROM inventory_exclusions e
       WHERE e.product_slug = i.product_slug AND e.size = i.size
     )
     GROUP BY i.product_slug ORDER BY i.product_slug`
  ).all();
  const rows = r.results || [];
  const current = Math.max(0, Math.min(Math.ceil(rows.length / 8) - 1, Math.trunc(page) || 0));
  const data = await catalog().catch(() => ({ products: [] }));
  const bySlug = new Map(data.products.map(p => [p.slug, p.title]));
  const keyboard = rows.slice(current * 8, current * 8 + 8).map(x => [{
    text: `📦 ${String(bySlug.get(x.slug) || x.slug).slice(0, 35)} · ${x.available} шт.`,
    callback_data: `ad:item:${shortId(x.slug)}`
  }]);
  const nav = [];
  if (current > 0) nav.push({ text: "◀️", callback_data: `ad:stock:${current - 1}` });
  if ((current + 1) * 8 < rows.length) nav.push({ text: "▶️", callback_data: `ad:stock:${current + 1}` });
  if (nav.length) keyboard.push(nav);
  keyboard.push([{ text: "🔄 Обновить", callback_data: `ad:stock:${current}` }]);
  keyboard.push([{ text: "⬅️ Управление", callback_data: "ad:home" }]);
  await sendScreen(env, cb,
    `🏬 СКЛАД\n\nТоваров: ${rows.length}\n` +
    "Указаны доступные остатки. Выберите товар, чтобы увидеть цвета и размеры.",
    keyboard
  );
}

async function adminStockItem(env, cb, hashed) {
  const r = await db(env).prepare(
    `SELECT i.product_slug AS slug, i.size,
            i.total_quantity, i.reserved_quantity
     FROM inventory i
     WHERE NOT EXISTS (
       SELECT 1 FROM inventory_exclusions e
       WHERE e.product_slug = i.product_slug AND e.size = i.size
     ) ORDER BY product_slug, size`
  ).all();
  const rows = (r.results || []).filter(x => shortId(x.slug) === hashed);
  if (!rows.length) return adminStock(env, cb);
  const data = await catalog().catch(() => ({ products: [] }));
  const p = data.products.find(x => x.slug === rows[0].slug);
  const lines = rows.slice(0, 45).map(row => {
    const spec = describeStockSize(p, row.size);
    const free = Number(row.total_quantity) - Number(row.reserved_quantity);
    return `${spec.color ? spec.color + " / " : ""}${spec.size || "Без размера"}: ` +
      `${free} доступно, ${row.reserved_quantity} резерв, ${row.total_quantity} всего`;
  });
  await sendScreen(env, cb,
    `🏬 ${p?.title || rows[0].slug}\n\n` +
    lines.join("\n") + (rows.length > 45 ? "\n…и другие размеры" : "") +
    "\n\nИзменение количества и синхронизация — в веб-CRM.",
    [
      [{ text: "🌐 Открыть CRM", url: `${SITE}/developers` }],
      [{ text: "⬅️ Склад", callback_data: "ad:stock:0" }]
    ]
  );
}

async function handleAdminAction(env, cb, action) {
  // Никогда не доверяем видимости кнопки: все callbacks проверяются на сервере.
  if (!isBotAdmin(env, cb.from?.id)) return;
  const parts = action.split(":");
  const sub = parts[1];
  if (sub === "cancel") {
    await ensureAdminAuthTable(env);
    await db(env).prepare(
      `UPDATE bot_admin_auth SET login_expires = 0 WHERE telegram_user_id = ?`
    ).bind(String(cb.from.id)).run();
    return sendScreen(env, cb, "Вход отменён.", [[{ text: "🛍 Магазин", callback_data: "catalog" }]]);
  }
  if (sub === "logout") {
    await adminLogout(env, cb.from.id);
    return sendScreen(env, cb, "🔒 Вы вышли из управления.", [[{ text: "⚙️ Войти", callback_data: "ad:home" }]]);
  }
  if (sub === "home" && await adminAuthorized(env, cb.from.id)) {
    return adminHome(env, cb);
  }
  if (!(await adminAuthorized(env, cb.from.id))) {
    return adminPrompt(env, cb);
  }
  if (sub === "home") return adminHome(env, cb);
  if (sub === "summary") return adminSummary(env, cb);
  if (sub === "orders") return adminOrders(env, cb, parts[2], Number(parts[3] || 0));
  if (sub === "order") return adminOrder(env, cb, parts[2]);
  if (sub === "ask") return adminAsk(env, cb, parts[2], parts[3], parts[4]);
  if (sub === "do") return adminExecute(env, cb, parts[2], parts[3], parts[4]);
  if (sub === "stock") return adminStock(env, cb, Number(parts[2] || 0));
  if (sub === "item") return adminStockItem(env, cb, parts[2]);
}

// ===== Webhook Cloudflare Worker =====

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Bot worker is running!");
    }
    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return new Response("Not found", { status: 404 });
    }
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Missing secrets", { status: 503 });
    }
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
    let update;
    try { update = await request.json(); }
    catch { return new Response("Invalid JSON", { status: 400 }); }

    try {
      const message = update.message;
      if (message?.chat?.type === "private" && message.text) {
        const text = message.text.trim();
        const orderId = parseSiteOrder(text);
        if (orderId) {
          await welcome(env, message.chat.id);
          await claimSiteOrder(env, message, orderId);
        } else if (text === "/logout" && isBotAdmin(env, message.from.id)) {
          await adminLogout(env, message.from.id);
          await telegram(env, "sendMessage", { chat_id: message.chat.id, text: "🔒 Выход выполнен." });
        } else if (/^\/start(?:@\w+)?(?:\s|$)/.test(text) || text === MAIN_BUTTON) {
          await welcome(env, message.chat.id);
        } else if (await maybeHandleAdminPassword(env, message)) {
          // Пароль проверен, сообщение удалено по возможности.
        }
      }

      const cb = update.callback_query;
      if (cb) {
        await telegram(env, "answerCallbackQuery", { callback_query_id: cb.id });
        if (cb.message?.chat?.type !== "private") return new Response("OK");
        const action = String(cb.data || "");
        if (action === "noop") return new Response("OK");
        if (action.startsWith("ad:")) {
          await handleAdminAction(env, cb, action);
          return new Response("OK");
        }
        const data = await catalog();
        const parts = action.split(":");
        if (action === "catalog") await showCategories(env, cb, data);
        else if (parts[0] === "c") await showCategory(env, cb, data, parts[1], Number(parts[2] || 0));
        else if (parts[0] === "p") await showProduct(env, cb, data, parts[1]);
        else if (parts[0] === "cl") await showColor(env, cb, data, parts[1], Number(parts[2]));
        else if (parts[0] === "gallery") await showGallery(env, cb, data, parts[1], Number(parts[2]));
        else if (parts[0] === "pic") await renderProductCard(
          env, cb, data, parts[1], Number(parts[2]), Number(parts[3]),
          ["colors", "sizes", "qty"].includes(parts[4]) ? parts[4] : "colors",
          Number(parts[5] || 0), Number(parts[6] || 1));
        else if (parts[0] === "q") await chooseQuantity(
          env, cb, data, parts[1], Number(parts[2]), Number(parts[3]), Number(parts[4]));
        else if (parts[0] === "add") await addToCart(
          env, cb, data, parts[1], Number(parts[2]), Number(parts[3]), Number(parts[4]));
        else if (parts[0] === "cart") await showCart(env, cb, data, Number(parts[1] || 0));
        else if (parts[0] === "del") await deleteCartItem(env, cb, data, parts[1], Number(parts[2] || 0));
        else if (parts[0] === "review") await reviewOrder(env, cb, data, parts[1]);
        else if (parts[0] === "confirm") await confirmOrder(env, cb, data, parts[1]);
      }
    } catch (error) {
      console.error("Ошибка бота:", error.message, error.stack);
      const chatId = update.callback_query?.message?.chat?.id || update.message?.chat?.id;
      if (chatId) {
        try {
          await telegram(env, "sendMessage", {
            chat_id: chatId,
            text: "⚠️ Не удалось выполнить действие. Обновите каталог или корзину и попробуйте снова."
          });
        } catch (err) { console.error("Ошибка отправки уведомления:", err.message); }
      }
    }
    return new Response("OK");
  }
};
