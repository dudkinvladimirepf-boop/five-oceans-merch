
/*
  Клуб «5 океанов»
  Единая корзина и счётчик товаров
*/

(function () {
  "use strict";

  const CART_KEY = "five-oceans-cart-v1";

  // Подсчёт количества товаров
  function getCartCount() {
    try {
      const saved = localStorage.getItem(CART_KEY);
      const cart = JSON.parse(saved || "[]");

      if (!Array.isArray(cart)) return 0;

      return cart.reduce((total, item) => {
        const quantity = Number(item.quantity);

        if (!Number.isFinite(quantity) || quantity < 1) {
          return total;
        }

        return total + Math.min(99, Math.floor(quantity));
      }, 0);

    } catch (error) {
      console.error("Ошибка чтения корзины:", error);
      return 0;
    }
  }

  // Создаём ссылку на корзину
  function initCartNavigation() {

    const nav = document.querySelector("header nav");

    if (!nav) return;

    // Предотвращаем дублирование кнопки
    if (nav.querySelector(".global-cart-link")) return;

    // Выбираем место в меню
    const menu =
      nav.querySelector(".menu") ||
      nav.querySelector(".nav-links") ||
      nav;

    const cartLink = document.createElement("a");

    cartLink.href = "/cart.html";
    cartLink.className = "global-cart-link";

    const cartLabel = document.createElement("span");

    cartLink.appendChild(cartLabel);
    menu.appendChild(cartLink);

    // Оформление в едином стиле с меню
    const style = document.createElement("style");

    style.textContent = `
      header nav .menu,
      header nav .nav-links {
        align-items: center;
      }

      header nav .global-cart-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;

        margin-left: 14px;
        padding: 0;

        border: none;
        border-radius: 0;
        background: transparent;

        color: inherit;
        font-family: inherit;
        font-size: inherit;
        font-weight: 400;
        line-height: inherit;

        text-decoration: none;
        white-space: nowrap;
        cursor: pointer;
      }

      header nav .global-cart-link:hover {
        color: #c2d9e6;
        background: transparent;
      }

      header nav .global-cart-link:focus-visible {
        outline: 2px solid white;
        outline-offset: 5px;
      }

      @media (max-width: 600px) {
        header nav .global-cart-link {
          margin-left: 6px;
        }
      }
    `;

    document.head.appendChild(style);

    // Обновление счётчика
    function updateCartBadge() {
      const count = getCartCount();

      cartLabel.textContent = "Корзина (" + count + ")";

      cartLink.setAttribute(
        "aria-label",
        "Открыть корзину. Товаров: " + count
      );
    }

    // Доступ для остальных скриптов
    window.updateCartBadge = updateCartBadge;

    // Изменение корзины на текущей странице
    window.addEventListener(
      "five-oceans-cart-updated",
      updateCartBadge
    );

    // Изменение корзины в другой вкладке
    window.addEventListener("storage", (event) => {
      if (
        event.key === CART_KEY ||
        event.key === null
      ) {
        updateCartBadge();
      }
    });

    // Возвращение на страницу
    window.addEventListener(
      "pageshow",
      updateCartBadge
    );

    // Возвращение во вкладку
    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          updateCartBadge();
        }
      }
    );

    updateCartBadge();
  }

  // Запуск после загрузки страницы
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initCartNavigation
    );
  } else {
    initCartNavigation();
  }

})();

