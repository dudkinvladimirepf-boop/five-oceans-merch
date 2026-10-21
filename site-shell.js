/* Общая шапка и подвал публичных страниц. /developers не затрагиваем. */
(() => {
  "use strict";
  const path = window.location.pathname;
  if (path === "/" || path === "/index.html") {
    document.body.classList.add("home-page");
  } else {
    document.body.classList.add("store-page");
  }

  const header = document.querySelector("body > header");
  if (header) {
    header.classList.add("site-header");
    header.innerHTML = `
      <nav class="site-nav" aria-label="Главная навигация">
        <div class="brandmarks">
          <a href="/" aria-label="Клуб 5 океанов — главная">
            <img src="/media/logo5oceanscoloreng-1.jpg"
                 alt="Клуб 5 океанов" width="152" height="43">
          </a>
          <span class="brand-separator" aria-hidden="true"></span>
          <a href="/" aria-label="ОКЕАН HD — магазин">
            <img class="oceanhd-logo" src="/media/oceanhdlogo.png"
                 alt="ОКЕАН HD" width="142" height="43">
          </a>
        </div>
        <div class="nav-links">
          <details class="nav-catalog">
            <summary>Каталог <span aria-hidden="true">⌄</span></summary>
            <div class="nav-catalog-menu" id="nav-catalog-menu">
              <a href="/#catalog">Все категории</a>
            </div>
          </details>
          <a href="/#contacts">Контакты</a>
        </div>
        <div class="site-actions menu">
          <form class="site-search" action="/search.html" method="GET"
                role="search">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round">
              <circle cx="10.8" cy="10.8" r="6.8"/>
              <path d="m16 16 5 5"/>
            </svg>
            <input type="search" name="q" maxlength="100"
                   aria-label="Поиск товаров" placeholder="Поиск товаров...">
          </form>
          <!-- Кнопка корзины добавляется рабочим cart-nav.js -->
        </div>
      </nav>`;
  }

  // Меню категорий читает тот же файл Pages CMS, что и каталог.
  // Новые или переименованные категории появляются без правок HTML.
  if (header) {
    fetch("/data/categories.json", {cache:"no-store"})
      .then(response => {
        if (!response.ok) throw new Error("Категории временно недоступны");
        return response.json();
      })
      .then(categories => {
        if (!Array.isArray(categories)) return;
        const menu = header.querySelector("#nav-catalog-menu");
        if (!menu) return;
        for (const category of categories) {
          if (!category || typeof category.slug !== "string" || !category.slug) {
            continue;
          }
          const link = document.createElement("a");
          link.href = "/category.html?slug=" + encodeURIComponent(category.slug);
          link.textContent = category.title || category.slug;
          menu.appendChild(link);
        }
      })
      .catch(() => {}); // Рабочая ссылка «Все категории» остаётся доступной.
  }

  let footer = document.querySelector("body > footer");
  if (!footer) {
    footer = document.createElement("footer");
    document.body.appendChild(footer);
  }
  footer.classList.add("site-footer");
  footer.id = "contacts";
  footer.innerHTML = `
    <div class="footer-content">
      <div class="footer-brand" aria-label="Клуб 5 океанов и ОКЕАН HD">
        <img src="/media/logo5oceanscoloreng-1.jpg"
             alt="Клуб 5 океанов" width="132" height="35">
        <span class="brand-separator" aria-hidden="true"></span>
        <img class="oceanhd-logo" src="/media/oceanhdlogo.png"
             alt="ОКЕАН HD" width="123" height="35">
      </div>
      <div class="footer-links">
        <a href="/#catalog">Каталог</a>
        <a href="/#contacts">Контакты</a>
      </div>
      <div class="footer-socials" aria-label="Социальные сети: ссылки добавим позже">
        <span class="social-placeholder" aria-label="YouTube, ссылка появится позже" title="YouTube — ссылка появится позже">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 6 3-6 3Z" fill="#111f3e"/></svg>
        </span>
        <span class="social-placeholder" aria-label="ВКонтакте, ссылка появится позже" title="ВКонтакте — ссылка появится позже">VK</span>
        <span class="social-placeholder" aria-label="Telegram, ссылка появится позже" title="Telegram — ссылка появится позже">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.3 3.2 2.8 10.5c-1.1.4-1 1.1-.2 1.4l4.7 1.5 1.8 5.4c.2.6.1.8.8.8.5 0 .7-.2 1-.5l2.3-2.3 4.9 3.6c.9.5 1.5.3 1.8-.9l3-14c.4-1.5-.5-2-1.6-1.3Zm-4 4.2-7.6 7-.3 3.5-1.3-4.4 9.2-6.1Z"/></svg>
        </span>
        <span class="social-placeholder" aria-label="Instagram, ссылка появится позже" title="Instagram — ссылка появится позже">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.7" cy="6.7" r="1" fill="currentColor" stroke="none"/></svg>
        </span>
      </div>
      <div class="footer-note">
        © 2026 Клуб 5 океанов × ОКЕАН HD
        <div class="footer-contacts">Вдохновение на большой глубине.</div>
      </div>
      <a href="/developers" class="footer-developers">Для разработчиков</a>
    </div>`;
})();
