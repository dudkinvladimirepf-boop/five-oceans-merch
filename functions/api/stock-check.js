
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

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  const slug = (url.searchParams.get("slug") || "").trim();
  const size = (url.searchParams.get("size") || "").trim();
  const rawQuantity = url.searchParams.get("quantity") || "1";
  const quantity = Number(rawQuantity);

  if (
    !slug ||
    slug.length > 300 ||
    size.length > 100 ||
    !/^[1-9]\d*$/.test(rawQuantity) ||
    !Number.isSafeInteger(quantity)
  ) {
    return json({
      tracked: true,
      available: false,
      error: "Некорректные параметры"
    }, 400);
  }

  if (!env.DB) {
    return json({
      tracked: true,
      available: false,
      error: "Склад временно недоступен"
    }, 503);
  }

  try {
    const item = await env.DB.prepare(
      `SELECT total_quantity, reserved_quantity
       FROM inventory
       WHERE product_slug = ?
         AND size = ?
       LIMIT 1`
    ).bind(slug, size).first();

    if (!item) {
      return json({
        tracked: true,
        available: false
      });
    }

    const available =
      Number(item.total_quantity) -
      Number(item.reserved_quantity);

    return json({
      tracked: true,
      available: available >= quantity
    });
  } catch (error) {
    console.error("Stock check failed", error);

    return json({
      tracked: true,
      available: false,
      error: "Не удалось проверить остаток"
    }, 503);
  }
}

