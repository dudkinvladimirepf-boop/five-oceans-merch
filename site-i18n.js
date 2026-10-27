/* RU/EN public storefront language support. Product translations live in Pages CMS. */
(() => {
"use strict";
const KEY="five-oceans-store-language";
let lang="ru";
try{lang=localStorage.getItem(KEY)==="en"?"en":"ru";}catch{}
if(typeof document!=="undefined")document.documentElement.lang=lang;
const pairs=[
["Мерч Клуба «5 океанов»","Five Oceans Club Merchandise"],
["Каталог — Клуб «5 океанов»","Catalog — Five Oceans Club"],
["Товар — Клуб «5 океанов»","Product — Five Oceans Club"],
["Поиск товаров — Клуб «5 океанов»","Search Products — Five Oceans Club"],
["Контакты — Клуб «5 океанов» × ОКЕАН HD","Contact — Five Oceans Club × OKEAN HD"],
["Главная","Home"],["Каталог","Catalog"],["Все категории","All Categories"],
["Контакты","Contact"],["Поиск товаров","Search Products"],["Поиск товаров...","Search products..."],
["Искать товары","Search products"],["Главная навигация","Main navigation"],
["Клуб 5 океанов — главная","Five Oceans Club — homepage"],["ОКЕАН HD — магазин","OKEAN HD — shop"],
["На главную","Home"],["← На главную","← Home"],
["Корзина","Cart"],["Клуб «5 океанов»","Five Oceans Club"],["Клуб 5 океанов","Five Oceans Club"],
["Телеканал «ОКЕАН HD»","OKEAN HD TV channel"],
["Клуб «5 океанов» × ОКЕАН HD","Five Oceans Club × OKEAN HD"],
["Официальный мерч Клуба «5 океанов» и телеканала ОКЕАН HD для тех, кого вдохновляет океан.","Official Five Oceans Club and OKEAN HD merchandise for everyone inspired by the ocean."],
["Ближе","Closer"],["к океану","to the Ocean"],["Ближе к океану","Closer to the Ocean"],
["Смотреть каталог","Explore the Catalog"],["ЛЮДИ","PEOPLE"],["МЕСТА","PLACES"],["ИСТОРИИ","STORIES"],
["Коллекции","Collections"],["Смотреть все коллекции →","View all collections →"],
["Загружаем категории...","Loading categories..."],["Категории скоро появятся.","Categories coming soon."],
["Мы исследуем океаны, путешествуем под парусом и делимся любовью к морю. Наш мерч — небольшая часть большого экспедиционного приключения.","We explore the oceans, travel under sail and share our love of the sea. Our merchandise is a small part of a much bigger expedition."],
["Для разработчиков","Developer Area"],["Вдохновение на большой глубине.","Inspired by the depths."],
["Социальные сети клуба и телеканала","Club and channel social media"],
["YouTube — выбрать страницу","YouTube — choose a channel"],["ВКонтакте — выбрать страницу","VK — choose a page"],
["Telegram — выбрать канал","Telegram — choose a channel"],["Instagram — выбрать страницу","Instagram — choose a page"],
["Товар","Product"],["Цена уточняется","Price on request"],["Пока нет товаров","No products yet"],
["Смотреть товары →","Browse products →"],["Подробнее о товаре →","View product →"],
["Смотреть категорию →","Browse category →"],["Новинки","New Arrivals"],
["Новые поступления нашего мерча","The latest arrivals in our collection"],
["Новые поступления магазина","New arrivals in our shop"],["Все новинки →","All new arrivals →"],
["Наш выбор","Our Picks"],["Товары, которые мы особенно рекомендуем","Our favourite picks"],
["Весь наш выбор →","All our picks →"],["Все товары","All Products"],["Товары магазина","Shop Products"],
["Мерч Клуба «5 океанов» и телеканала ОКЕАН HD","Merchandise from Five Oceans Club and OKEAN HD"],
["По этому запросу товары не найдены.","No products match your search."],
["Не удалось загрузить товары. Обновите страницу.","Unable to load products. Please refresh."],
["Подробнее · Нет в наличии →","Details · Out of stock →"],
["Загружаем каталог...","Loading catalog..."],["Загружаем товары...","Loading products..."],
["Не удалось загрузить каталог.","Unable to load the catalog."],
["← К категориям","← Back to categories"],["Навигация по каталогу","Catalog navigation"],
["Цвета в каталоге:","Colours:"],["Цвета товара","Product colours"],
["Страница товара пока не настроена","Product page is not available yet"],
["Категория не найдена","Category not found"],["Вернитесь на главную страницу.","Please return to the homepage."],
["В этой категории пока нет товаров.","No products in this category yet."],
["Не удалось загрузить товары. Попробуйте обновить страницу.","Unable to load products. Please refresh the page."],
["Загружаем товар...","Loading product..."],["Товар не найден.","Product not found."],
["Вернуться к товарам","Back to products"],["Вернуться в категорию","Back to category"],
["Фотографии этого цвета пока не загружены","No photos uploaded for this colour yet"],
["Фотография пока отсутствует","Photo coming soon"],["Фото","Photo"],
["В наличии","Available"],["Нет в наличии","Unavailable"],["Нет на складе","Out of stock"],
["Новинка","New"],["Выбор цвета","Choose a colour"],["Размер","Size"],["Цвет","Colour"],
["Уменьшить количество","Decrease quantity"],["Увеличить количество","Increase quantity"],
["Добавить в корзину","Add to Cart"],["← Продолжить покупки","← Continue Shopping"],
["Проверяем наличие...","Checking availability..."],["Наличие уточняется","Checking availability"],
["✓ В корзине","✓ In Cart"],["На складе недостаточно товара.","Not enough stock is available."],
["Не удалось проверить склад. Попробуйте ещё раз.","Unable to check stock. Please try again."],
["Максимум 99 шт. одного размера.","Maximum 99 items per size."],
["Не удалось загрузить информацию о товаре.","Unable to load product information."],
["Здесь находятся выбранные вами товары. Корзина сохраняется в вашем браузере.","Your selected products are saved in this browser."],
["Загружаем корзину...","Loading your cart..."],["Оформление заказа","Checkout"],["Ваш заказ","Your Order"],
["Онлайн-оплата на сайте не производится. Подтверждение наличия, оплату и доставку согласуем в Telegram.","Online payment is not available. We will confirm availability, payment and delivery in Telegram."],
["Текст заказа","Order text"],["Текст созданного заказа","Confirmed order text"],
["Создать заказ и перейти в Telegram-бот","Place Order and Open Telegram Bot"],
["Создать заказ и скопировать","Place Order and Copy Details"],
["Открыть Telegram-бота без заказа →","Open Telegram Bot Without Ordering →"],
["При нажатии на кнопку оформления заказ сначала сохраняется в системе и получает номер. Затем откроется Telegram-бот, которому номер заказа будет передан через ссылку. В Telegram нажмите «Старт». Пока бот не подключён к заказам с сайта, текст можно скопировать и отправить ему вручную. Создание заказа не резервирует товар.","Placing an order first registers it and assigns an order number. Telegram will then open with a link to your order. Tap Start in the bot. If necessary, you can copy and send the order text manually. Placing an order does not reserve stock."],
["Заказ создан","Order Placed"],
["Последний заказ доступен здесь 10 минут после оформления, в том числе после обновления страницы. Нажмите «Перейти в Telegram-бот», чтобы передать ему номер заказа, затем нажмите «Старт». Для резервного варианта можно скопировать текст заказа. Сам заказ уже сохранён в системе. Для повторной покупки тех же товаров нажмите «Повторить заказ»: они вернутся в корзину, но новый заказ не создастся автоматически.","Your latest order remains available here for 10 minutes, even after refreshing. Open Telegram and tap Start to send the order number. You can also copy the order text. Select Repeat Order to return the same items to your cart without placing a new order automatically."],
["Скопировать заказ","Copy Order"],["Повторить заказ","Repeat Order"],
["Перейти в Telegram-бот →","Open Telegram Bot →"],
["Перейти в Telegram-бот с заказом","Open Telegram Bot with Order"],
["В корзине есть недоступные позиции.","Some items in your cart are unavailable."],
["Удалите их или измените заказ, чтобы продолжить оформление.","Remove them or update your cart to continue."],
["Корзина пока пуста.","Your cart is empty."],
["Товар больше не найден в каталоге.","This product is no longer in the catalog."],
["Стоимость:","Price:"],["Дизайн:","Design:"],["Цвет:","Colour:"],["Размер:","Size:"],
["Количество:","Quantity:"],["Цена:","Unit price:"],["Сумма:","Subtotal:"],
["Итого по товарам:","Items total:"],["Итого по доступным товарам:","Available items total:"],
["Доставка: уточняется.","Delivery: to be confirmed."],["Удалить","Remove"],
["Товар, размер или цена недоступны.","Product, size or price unavailable."],
["Есть недоступные товары или размеры.","Some products or sizes are unavailable."],
["Для оформления удалите такие позиции.","Please remove those items before checkout."],
["Стоимость доставки не включена. Итоговая сумма подтверждается продавцом.","Shipping is not included. The seller will confirm the final total."],
["Проверяем остатки и регистрируем заказ...","Checking stock and placing your order..."],
["Не удалось зарегистрировать заказ.","Unable to place the order."],
["Не удалось оформить заказ.","Unable to place your order."],
["Корзина обновилась. Проверьте её состав.","Your cart has changed. Please review it."],
["Не удалось прочитать корзину. Обновите страницу.","Unable to read your cart. Please refresh."],
["Не удалось загрузить корзину.","Unable to load your cart."],
["Не удалось прочитать корзину.","Unable to read your cart."],
["Сервер вернул некорректные данные заказа.","The order service returned an invalid response."],
["Корзина изменилась во время оформления.","Your cart changed during checkout."],
["Проверьте состав и оформите её заново.","Review the items and place the order again."],
["Текст скопирован. При необходимости отправьте его Telegram-боту.","Order text copied. Send it to the Telegram bot if needed."],
["Скопируйте выделенный текст вручную для Telegram-бота.","Please copy the highlighted text and send it to the Telegram bot."],
["Повторить этот заказ уже нельзя. Добавьте товары через каталог.","This order can no longer be repeated. Add products from the catalog."],
["В корзине уже есть другие товары.","Your cart already contains other items."],
["Сначала завершите или очистите её, чтобы повторить заказ.","Finish or empty the current cart before repeating this order."],
["Товары добавлены в новую корзину.","Products added to a new cart."],
["Проверьте их наличие и нажмите «Создать заказ» для нового оформления.","Check availability and place a new order when ready."],
["Не удалось повторить заказ.","Unable to repeat the order."],
["Обновите страницу и попробуйте снова.","Refresh and try again."],
["По вопросам товаров, оформления заказов и сотрудничества напишите нам на электронную почту клуба.","For product enquiries, orders and collaborations, please contact us by email."],
["← Вернуться в магазин","← Back to Shop"],
["Контакты магазина Клуба 5 океанов и ОКЕАН HD","Five Oceans Club and OKEAN HD shop contact information"],
["Новинки — 5 океанов","New Arrivals — Five Oceans Club"],
["Наш выбор — 5 океанов","Our Picks — Five Oceans Club"],
["© 2026 Клуб 5 океанов × ОКЕАН HD","© 2026 Five Oceans Club × OKEAN HD"],
["Не удалось сохранить корзину.","Unable to save your cart."],
["Не удалось загрузить товары.","Unable to load products."],
["Попробуйте обновить страницу.","Please refresh the page."],
["Не удалось загрузить данные","Unable to load data"],
["Неверный формат данных","Invalid data format"],
["Не удалось проверить данные","Unable to verify information"],
["Не удалось загрузить каталог.","Unable to load the catalog."],
["Нет связи с сервером заказов.","Cannot connect to the order server."],
["Повторите попытку — дубликат не создастся.","Try again; no duplicate order will be created."],
["Не удалось восстановить последний заказ","Unable to restore your latest order"],
["Неверный ответ склада","Invalid stock service response"],
["Не удалось загрузить товары. Попробуйте обновить страницу.","Unable to load products. Please refresh."],
["Не удалось завершить ключ оформления","Unable to finalize checkout"],
["Ссылка передаёт боту номер заказа.","The link sends the order number to the bot."],
["После перехода нажмите «Старт».","Tap Start after opening the bot."],
["Создано","Created"],
["Сохранение подтверждения заказа не удалось","Unable to save order confirmation"],
["Не удалось скопировать заказ.","Unable to copy the order."],
["Количество","Quantity"],
["Цена","Unit price"],
["Отсутствует на складе","Out of stock"],
["Артикул","SKU"],
["Ошибка загрузки","Loading error"],["Красный","Red"],["Белый","White"],
["Тёмно-синий","Navy blue"],["Чёрный","Black"],["Черный","Black"],
["Сине-голубой","Blue and light blue"],["Сине-белая полоска","Navy and white stripes"],
["Выпуск 2025","2025 edition"],["шт.","pcs"]
];
const clean=x=>String(x??"").replace(/\s+/g," ").trim();
const lookup=new Map(pairs.map(([a,b])=>[clean(a),b]));
const patterns=[
[/^Открыть корзину\. Товаров:\s*(\d+)$/,"Open cart. Items: $1"],
[/^(.+) — 5 океанов$/,(whole,name)=>t(name)+" — Five Oceans Club"],
[/^(.+) — Клуб «5 океанов»$/,(whole,name)=>t(name)+" — Five Oceans Club"],
[/^(\d+) шт\.$/,"$1 pcs"],
[/^· (\d+) шт\.$/,"· $1 items"],
[/^Заказ № (.+?) создан\. Номер передаётся боту ссылкой\. Текст не удалось скопировать автоматически — при необходимости скопируйте его вручную\.$/,"Order #$1 placed. The number is sent to the bot through the link. Automatic copying failed; please copy the text manually."],
[/^Заказ № (.+?) создан и скопирован\. Ссылка передаёт боту номер заказа\. После перехода нажмите «Старт»\.$/,"Order #$1 placed and copied. The link sends its number to the bot. Tap Start after opening Telegram."],
[/^Заказ № (.+?) уже создан, но не удалось сохранить подтверждение в браузере\. Повторите нажатие: новый заказ не будет создан\.$/,"Order #$1 was created, but the confirmation could not be saved in your browser. Try again; a duplicate order will not be created."],
[/^Заказ № (.+?) создан$/,"Order #$1 placed"],
[/^Результаты по запросу: «(.+)»$/,"Results for: “$1”"],
[/^Поиск: (.+) — 5 океанов$/,"Search: $1 — Five Oceans Club"],
[/^Фото (\d+)$/,"Photo $1"],
[/^(\d+) товаров$/,"$1 products"],
[/^(\d+) товар(?:а)?$/,"$1 products"],
[/^(.+) — временно недоступен$/,"$1 — temporarily unavailable"],
[/^(.+) — нет в наличии$/,"$1 — unavailable"],
[/^Вернуться в категорию «(.+)»$/,"Return to category “$1”"],
[/^Заказ № (.+?) создан(?: и скопирован)?\.(.*)$/,"Order #$1 placed. $2"]
];
function t(value){
 if(lang!=="en"||value==null)return String(value??"");
 const old=String(value),k=clean(old);
 if(lookup.has(k))return lookup.get(k);
 for(const [rx,replacement] of patterns)if(rx.test(k))return k.replace(rx,replacement);
 if(/^(Цвет|Размер|Количество|Цена|Сумма|Дизайн):\s*/.test(k)){
   const pos=k.indexOf(":"),a=t(k.slice(0,pos)+":"),b=k.slice(pos+1).trim();
   return a+" "+(lookup.get(b)||b);
 }
 return old;
}
function products(list){
 if(lang!=="en"||!Array.isArray(list))return list;
 return list.map(p=>({...p,title_ru:p.title,description_ru:p.description,design_ru:p.design,
   title:p.title_en||p.title,description:p.description_en||p.description,
   design:p.design_en||p.design,
   variants:Array.isArray(p.variants)?p.variants.map(v=>({...v,label_ru:v.label,label:v.label_en||v.label})):p.variants
 }));
}
function categories(list){
 if(lang!=="en"||!Array.isArray(list))return list;
 return list.map(c=>({...c,title:c.title_en||c.title,description:c.description_en||c.description}));
}
function setLanguage(next){
 if(next!=="ru"&&next!=="en")return;
 try{localStorage.setItem(KEY,next)}catch{}
 if(typeof location!=="undefined")location.reload();
}
function orderText(str){
 if(lang!=="en")return String(str??"");
 const fixed={
 "Здравствуйте! Хочу заказать мерч Клуба «5 океанов».":"Hello! I would like to order merchandise from Five Oceans Club.",
 "Номер заказа: будет присвоен после оформления":"Order number: assigned at checkout",
 "Доставка: уточняется.":"Delivery: to be confirmed.",
 "Пожалуйста, подтвердите наличие и итоговую стоимость.":"Please confirm availability and the final price."
 };
 return String(str??"").split("\n").map(line=>{
  if(fixed[line])return fixed[line];
  if(line.startsWith("Номер заказа: "))return "Order number: "+line.slice("Номер заказа: ".length);
  return line.replace(/^(Цвет|Размер|Количество|Цена|Сумма|Итого по товарам):/,(x)=>({
   "Цвет:":"Colour:","Размер:":"Size:","Количество:":"Quantity:",
   "Цена:":"Unit price:","Сумма:":"Subtotal:","Итого по товарам:":"Items total:"
  })[x]).replace(/шт\./g,"pcs").replace(/\/pcs/g,"/pc");
 }).join("\n");
}
function translateNode(node){
 if(lang!=="en"||!node)return;
 if(node.nodeType===3){
  const p=node.parentElement;
  if(p&&/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|CODE|PRE|SVG)$/.test(p.tagName))return;
  const old=node.nodeValue,v=t(old);if(old!==v)node.nodeValue=v;
 }else if(node.nodeType===1){
  if(/^(SCRIPT|STYLE|NOSCRIPT|SVG)$/.test(node.tagName))return;
  for(const attr of ["placeholder","aria-label","title","alt"]){
   if(node.hasAttribute(attr)){const old=node.getAttribute(attr),v=t(old);if(v!==old)node.setAttribute(attr,v);}
  }
  for(const child of node.childNodes)translateNode(child);
 }else if(node.nodeType===9)translateNode(node.documentElement);
}
const api={get lang(){return lang},t,products,categories,setLanguage,orderText,translateNode};
if(typeof window!=="undefined")window.StoreI18n=api;
if(typeof module==="object"&&module.exports)module.exports=api;
if(typeof document!=="undefined"&&lang==="en"){
 const start=()=>{
  translateNode(document);
  const observer=new MutationObserver(records=>{
   for(const r of records){
    if(r.type==="characterData"||r.type==="attributes")translateNode(r.target);
    else for(const n of r.addedNodes)translateNode(n);
   }
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["placeholder","aria-label","title","alt"]});
 };
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
 else start();
}
})();
