
/*
  Клуб «5 океанов»
  Общая корзина для всех страниц сайта
*/

(function () {
  "use strict";

  const CART_KEY = "five-oceans-cart-v1";

  // Подсчёт общего количества товаров
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

  // Создание кнопки в меню
  function initCartNavigation() {

    const nav = document.querySelector("header nav");

    if (!nav) return;

    // Находим область ссылок в верхнем меню
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

    // Общие стили кнопки
    const style = document.createElement("style");

    style.textContent = `
      header nav {
        flex-wrap: wrap;
      }

      .global-cart-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 14px;
        border: 1px solid rgba(255,255,255,0.5);
        border-radius: 8px;
        color: white;
        text-decoration: none;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
      }

      .global-cart-link:hover {
        background: rgba(255,255,255,0.12);
      }
    `;

    document.head.appendChild(style);

    // Обновление счётчика
    function updateCartBadge() {
      const count = getCartCount();

      cartLabel.textContent = `Корзина (${count})`;

      cartLink.setAttribute(
        "aria-label",
        `Открыть корзину. Товаров: ${count}`
      );
    }

    // Доступно для других скриптов сайта
    window.updateCartBadge = updateCartBadge;

    // Обновление после изменений на текущей странице
    window.addEventListener(
      "five-oceans-cart-updated",
      updateCartBadge
    );

    // Обновление, если корзина изменилась в другой вкладке
    window.addEventListener("storage", (event) => {
      if (event.key === CART_KEY || event.key === null) {
        updateCartBadge();
      }
    });

    // Обновление при возвращении на страницу
    window.addEventListener(
      "pageshow",
      updateCartBadge
    );

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

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initCartNavigation
    );
  } else {
    initCartNavigation();
  }

})();
