# Telegram-магазин «5 океанов»: управление и деплой

Этот каталог содержит исходный код **существующего** Cloudflare Worker
`five-oceans-merch-bot`. Он использует те же Pages CMS и Cloudflare D1,
что и сайт `five-oceans-merch`. Здесь не создаётся новая CRM.

## Подключить единожды

1. В Cloudflare → Workers & Pages → `five-oceans-merch-bot` →
   Settings → Variables and Secrets:
   - `BOT_ADMIN_ID`: личный **числовой** Telegram ID владельца,
     тип Text или Secret;
   - `BOT_ADMIN_PASSWORD`: пароль управления, тип **Secret**.
   - Сохранить существующие `TELEGRAM_BOT_TOKEN`,
     `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_CHAT_ID` и D1 binding `DB`.
2. В GitHub → репозиторий `five-oceans-merch` → Settings →
   Secrets and variables → Actions → New repository secret:
   - `CLOUDFLARE_API_TOKEN`: API Token с Workers Scripts Read + Edit,
     и, при необходимости, Worker/Account Read;
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare Account ID.
   **Секрет Telegram-бота и пароль управления в GitHub не переносить.**

## Деплой (после первоначальной настройки)

GitHub → Actions → **Deploy Telegram merchandise bot** →
Run workflow → Run workflow. Только этот ручной запуск публикует код Worker.
Никакие Pages или сайт обновление не затрагивает.

Рабочий Worker берётся из `bot/worker.js`. Перед загрузкой
`bot/prepare-deploy.mjs` читает настройки *существующего* Worker
из Cloudflare API, находит нынешнее D1-подключение `DB`,
проверяет наличие обязательных секретов и генерирует временный
Wrangler config с `keep_vars: true`. Если не найдено оригинальное
подключение к D1 или какая-то обязательная настройка — деплой
останавливается без изменений.

После публикации проверьте /start, «⚙️ Управление», корректность
авторизации, тестовый заказ и статусы в веб-CRM.

## Пароль и приватность

Не прописывать реальные пароли, API-токены или Telegram bot token
в `worker.js`, workflow либо в комментариях к PR.
Панель управления доступна только `BOT_ADMIN_ID` и после пароля;
активная сессия длится 8 часов, пять неверных паролей блокируют вход
на 15 минут.

## Ограничения

- Деплой требует одноразовой настройки Cloudflare API-токена в GitHub.
  Пока её нет, нажатие Run workflow завершится без публикации.
- При наличии дополнительных нестандартных binding типов кроме
  D1, plain_text и secret_text защитная проверка остановит деплой
  во избежание повреждения конфигурации.
- Действия в Telegram работают с живой D1 и изменяют статусы,
  резервирование и списание склада. Не тестируйте на реальных заказах.
