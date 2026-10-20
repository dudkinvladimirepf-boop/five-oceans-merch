
/*
  Клуб «5 океанов»
  Проверка наличия товара на складе.

  URL:
  /api/stock-check?slug=...&quantity=1

  База Cloudflare D1 подключена
  через переменную DB.
*/

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

export async function onRequestGet(context) {

  const { request, env } = context;

  const url = new URL(request.url);

  const slug = (
    url.searchParams.get("slug") || ""
  ).trim();

  const size = (
    url.searchParams.get("size") || ""
  ).trim();

  const rawQuantity =
    url.searchParams.get("quantity") || "1";

  const quantity = Number(rawQuantity);

  /* Проверяем входные данные */

  if (
    !slug ||
    slug.length > 120 ||
    size.length > 100 ||
    !/^\d+$/.test(rawQuantity) ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 99
  ) {
    return json(
      { error: "Некорректные параметры" },
      400
    );
  }

  /* Проверяем подключение к D1 */

  if (!env.DB) {
    return json(
      { error: "База данных не подключена" },
      503
    );
  }

  try {

    /* Получаем остаток конкретного товара */

    const item = await env.DB
      .prepare(
        `SELECT
           total_quantity,
           reserved_quantity
         FROM inventory
         WHERE product_slug = ?
           AND size = ?
         LIMIT 1`
      )
      .bind(slug, size)
      .first();

    /* Товар отсутствует в складском учёте */

    if (!item) {
      return json({
        tracked: false,
        available: false
      });
    }

    /* Вычисляем свободный остаток */

    const freeQuantity = Math.max(
      0,
      Number(item.total_quantity) -
      Number(item.reserved_quantity)
    );

    /* Возвращаем результат проверки */

    return json({
      tracked: true,
      available: freeQuantity >= quantity
    });

  } catch (error) {

    console.error(
      "Ошибка проверки склада:",
      error
    );

    return json(
      { error: "Ошибка проверки наличия" },
      500
    );
  }
}
