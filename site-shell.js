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
          <a href="/contacts.html">Контакты</a>
        </div>
        <div class="site-actions menu">
          <form class="site-search" action="/search.html" method="GET"
                role="search">
            <button type="submit" class="search-submit" aria-label="Искать товары">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <circle cx="10.8" cy="10.8" r="6.8"/>
                <path d="m16 16 5 5"/>
              </svg>
            </button>
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
      <div class="footer-center">
        <div class="footer-links">
          <a href="/#catalog">Каталог</a>
          <a href="/contacts.html">Контакты</a>
        </div>
        <nav class="footer-socials" aria-label="Социальные сети клуба и телеканала">
          <details class="social-dropdown">
            <summary class="social-trigger" aria-label="YouTube — выбрать страницу" title="YouTube">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="2" y="5" width="20" height="14" rx="4"/>
                <path d="m10 9 6 3-6 3Z" fill="#111f3e"/>
              </svg>
            </summary>
            <div class="social-popup">
              <span class="social-popup-title">YouTube</span>
              <a href="https://www.youtube.com/@5oceansclub" target="_blank" rel="noopener noreferrer">Клуб «5 океанов» <span aria-hidden="true">↗</span></a>
            </div>
          </details>
          <details class="social-dropdown">
            <summary class="social-trigger" aria-label="ВКонтакте — выбрать страницу" title="ВКонтакте">VK</summary>
            <div class="social-popup">
              <span class="social-popup-title">ВКонтакте</span>
              <a href="https://vk.ru/5oceans_club" target="_blank" rel="noopener noreferrer">Клуб «5 океанов» <span aria-hidden="true">↗</span></a>
              <a href="https://vk.ru/oceanmediasu" target="_blank" rel="noopener noreferrer">Телеканал «ОКЕАН HD» <span aria-hidden="true">↗</span></a>
            </div>
          </details>
          <details class="social-dropdown">
            <summary class="social-trigger" aria-label="Telegram — выбрать канал" title="Telegram">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21.3 3.2 2.8 10.5c-1.1.4-1 1.1-.2 1.4l4.7 1.5 1.8 5.4c.2.6.1.8.8.8.5 0 .7-.2 1-.5l2.3-2.3 4.9 3.6c.9.5 1.5.3 1.8-.9l3-14c.4-1.5-.5-2-1.6-1.3Zm-4 4.2-7.6 7-.3 3.5-1.3-4.4 9.2-6.1Z"/>
              </svg>
            </summary>
            <div class="social-popup">
              <span class="social-popup-title">Telegram</span>
              <a href="https://t.me/five_oceans_club" target="_blank" rel="noopener noreferrer">Клуб «5 океанов» <span aria-hidden="true">↗</span></a>
              <a href="https://t.me/okeanHD" target="_blank" rel="noopener noreferrer">Телеканал «ОКЕАН HD» <span aria-hidden="true">↗</span></a>
            </div>
          </details>
          <details class="social-dropdown">
            <summary class="social-trigger" aria-label="Instagram — выбрать страницу" title="Instagram">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="5"/>
                <circle cx="12" cy="12" r="4"/>
                <circle cx="17.7" cy="6.7" r="1" fill="currentColor" stroke="none"/>
              </svg>
            </summary>
            <div class="social-popup">
              <span class="social-popup-title">Instagram</span>
              <a href="https://www.instagram.com/5oceans_club?dlrf=MTBnaWhqd29zdDYzZg==" target="_blank" rel="noopener noreferrer">Клуб «5 океанов» <span aria-hidden="true">↗</span></a>
              <a href="https://www.instagram.com/okean.hd?rpxt=MTY1Z3N3MGNrcHBzcA==" target="_blank" rel="noopener noreferrer">Телеканал «ОКЕАН HD» <span aria-hidden="true">↗</span></a>
            </div>
          </details>
        </nav>
      </div>
      <div class="footer-meta">
        <div class="footer-note">
          © 2026 Клуб 5 океанов × ОКЕАН HD
          <div class="footer-contacts">Вдохновение на большой глубине.</div>
        </div>
        <a href="/developers" class="footer-developers">Для разработчиков</a>
      </div>
    </div>`;

  // Прозрачность подложек: удаляем только связанный с краями светлый фон.
  // Замкнутые белые буквы внутри логотипа ОКЕАН HD оставляем белыми.
  function removeFooterLogoBackground(img) {
    const process = () => {
      if (img.dataset.logoProcessed || !img.naturalWidth || !img.naturalHeight) {
        return;
      }
      img.dataset.logoProcessed = "true";
      try {
        const canvas = document.createElement("canvas");
        const w = img.naturalWidth, h = img.naturalHeight;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d", {willReadFrequently:true});
        if (!ctx) return;
        ctx.drawImage(img,0,0);
        const pixels = ctx.getImageData(0,0,w,h);
        const data = pixels.data, pixelsCount = w*h;
        const seen = new Uint8Array(pixelsCount);
        const queue = new Uint32Array(pixelsCount);
        let head=0, tail=0;
        function isLight(i) {
          const p = i*4;
          return data[p+3] < 16 ||
            (data[p] >= 243 && data[p+1] >= 243 && data[p+2] >= 243);
        }
        function enqueue(i) {
          if (!seen[i] && isLight(i)) {
            seen[i]=1; queue[tail++]=i;
          }
        }
        for(let x=0;x<w;x++){ enqueue(x); enqueue((h-1)*w+x); }
        for(let y=0;y<h;y++){ enqueue(y*w); enqueue(y*w+w-1); }
        while(head<tail) {
          const i=queue[head++];
          if(i>=w) enqueue(i-w);
          if(i+w<pixelsCount) enqueue(i+w);
          if(i%w!==0) enqueue(i-1);
          if(i%w!==w-1) enqueue(i+1);
        }
        for(let i=0;i<pixelsCount;i++){
          if(seen[i]) data[i*4+3]=0;
        }
        ctx.putImageData(pixels,0,0);
        img.src = canvas.toDataURL("image/png");
      } catch (e) {
        // Исходный цветной логотип остаётся доступен при ошибке canvas.
        console.warn("Не удалось обработать фон логотипа", e);
      }
    };
    if(img.complete) process();
    else img.addEventListener("load",process,{once:true});
  }
  // Нативные details открываются тапом/Enter; на компьютере
  // варианты также появляются при наведении через CSS.
  // Закрываем соседние меню, чтобы они не накладывались друг на друга.
  const socialMenus = [...footer.querySelectorAll(".social-dropdown")];
  socialMenus.forEach(menu => {
    menu.addEventListener("toggle", () => {
      if (menu.open) {
        socialMenus.forEach(other => {
          if (other !== menu) other.open = false;
        });
      }
    });
    menu.addEventListener("pointerenter", () => {
      socialMenus.forEach(other => {
        if (other !== menu) other.open = false;
      });
    });
  });
  document.addEventListener("pointerdown", event => {
    if (!event.target.closest(".social-dropdown")) {
      socialMenus.forEach(menu => { menu.open = false; });
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      socialMenus.forEach(menu => { menu.open = false; });
      const focused = document.activeElement;
      if (focused && focused.closest(".social-dropdown")) focused.blur();
    }
  });

  footer.querySelectorAll(".footer-brand img").forEach(removeFooterLogoBackground);
})();
