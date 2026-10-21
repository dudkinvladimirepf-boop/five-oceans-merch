/* Единая корзина для всех публичных страниц магазина */
(() => {
  "use strict";
  const CART_KEY = "five-oceans-cart-v1";

  function getCartCount() {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      if (!Array.isArray(saved)) return 0;
      return saved.reduce((sum, item) => {
        const qty = Number(item.quantity);
        return sum + (Number.isFinite(qty) && qty > 0
          ? Math.min(99, Math.floor(qty)) : 0);
      }, 0);
    } catch (error) {
      console.error("Ошибка чтения корзины:", error);
      return 0;
    }
  }

  function initCartNavigation() {
    const nav = document.querySelector("header nav");
    if (!nav || nav.querySelector(".global-cart-link")) return;

    const menu = nav.querySelector(".site-actions") ||
      nav.querySelector(".menu") ||
      nav.querySelector(".nav-links") || nav;

    const link = document.createElement("a");
    link.href = "/cart.html";
    link.className = "global-cart-link";
    link.innerHTML = `
      <span class="cart-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="1.7"
             stroke-linejoin="round" stroke-linecap="round">
          <path d="M2 3h2l2.6 12.2h12.2L22 7H5"/>
          <circle cx="9" cy="20.2" r="1.2"/>
          <circle cx="18" cy="20.2" r="1.2"/>
        </svg>
      </span>
      <span class="cart-word">Корзина</span>
      <span class="cart-badge" data-empty="true" aria-hidden="true">0</span>
    `;

    const badge = link.querySelector(".cart-badge");
    const updateCartBadge = () => {
      const count = getCartCount();
      badge.textContent = String(count > 99 ? "99+" : count);
      badge.dataset.empty = count ? "false" : "true";
      link.setAttribute("aria-label", "Открыть корзину. Товаров: " + count);
    };

    menu.appendChild(link);
    window.updateCartBadge = updateCartBadge;

    window.addEventListener("five-oceans-cart-updated", updateCartBadge);
    window.addEventListener("storage", event => {
      if (event.key === CART_KEY || event.key === null) updateCartBadge();
    });
    window.addEventListener("pageshow", updateCartBadge);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) updateCartBadge();
    });

    updateCartBadge();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCartNavigation);
  } else {
    initCartNavigation();
  }
})();
