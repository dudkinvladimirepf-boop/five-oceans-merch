"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const script=fs.readFileSync("site-i18n.js","utf8");
function locale(value){
  const module={exports:{}};
  const sandbox={module,localStorage:{getItem:()=>value,setItem:()=>{}}};
  vm.runInNewContext(script,sandbox,{filename:"site-i18n.js"});
  return module.exports;
}
const catalog=JSON.parse(fs.readFileSync("data/products.json","utf8"));
const categories=JSON.parse(fs.readFileSync("data/categories.json","utf8"));
test("both language modes keep the original catalog identifiers, prices and stock controls",()=>{
  const ru=locale("ru"),en=locale("en");
  assert.equal(ru.lang,"ru");
  assert.equal(en.lang,"en");
  assert.equal(ru.products(catalog),catalog);
  const localized=en.products(catalog);
  assert.equal(localized.length,catalog.length);
  for(let i=0;i<catalog.length;i++){
    const original=catalog[i],translated=localized[i];
    assert.ok(original.title_en && original.description_en && original.design_en,original.slug);
    assert.equal(translated.title,original.title_en);
    assert.equal(translated.description,original.description_en);
    assert.equal(translated.product_id,original.product_id);
    assert.equal(translated.slug,original.slug);
    assert.equal(translated.price,original.price);
    assert.equal(translated.published,original.published);
    assert.equal(translated.category,original.category);
    assert.equal(translated.variants.length,original.variants.length);
    translated.variants.forEach((v,j)=>{
      const old=original.variants[j];
      assert.equal(v.code,old.code);
      assert.equal(v.available,old.available);
      assert.equal(v.finance_enabled,old.finance_enabled);
      assert.equal(v.label,old.label_en);
      assert.deepEqual(Array.from(v.sizes),Array.from(old.sizes));
      assert.deepEqual(Array.from(v.photos),Array.from(old.photos));
    });
  }
  const localizedCategories=en.categories(categories);
  assert.equal(localizedCategories.length,categories.length);
  localizedCategories.forEach((c,i)=>{
    assert.equal(c.id,categories[i].id);
    assert.equal(c.slug,categories[i].slug);
    assert.equal(c.title,categories[i].title_en);
    assert.ok(c.description_en);
  });
});
test("language selection uses Russian by default and translates vital shopping labels",()=>{
 const defaultLang=locale(null),en=locale("en");
 assert.equal(defaultLang.lang,"ru");
 assert.equal(defaultLang.t("Корзина"),"Корзина");
 for(const [ru,english] of [
  ["Корзина","Cart"],["Добавить в корзину","Add to Cart"],
  ["Оформление заказа","Checkout"],["Новинки","New Arrivals"],
  ["Проверяем наличие...","Checking availability..."],["Нет на складе","Out of stock"]
 ])assert.equal(en.t(ru),english);
 assert.equal(en.t("Открыть корзину. Товаров: 3"),"Open cart. Items: 3");
 const order=en.orderText("Здравствуйте! Хочу заказать мерч Клуба «5 океанов».\nЦвет: Красный\nКоличество: 2 шт.");
 assert.match(order,/Hello!/);
 assert.match(order,/Colour:/);
 assert.match(order,/Quantity: 2 pcs/);
});
test("all six public pages load language module before their own scripts",()=>{
 for(const path of ["index.html","category.html","product.html","search.html","cart.html","contacts.html"]){
  const page=fs.readFileSync(path,"utf8");
  assert.match(page,/<script src="\/site-i18n\.js"><\/script>/,path);
  assert.ok(page.indexOf("/site-i18n.js")<page.indexOf("</head>"),path);
 }
 const shell=fs.readFileSync("site-shell.js","utf8");
 assert.match(shell,/data-store-lang="ru"/);
 assert.match(shell,/data-store-lang="en"/);
 assert.match(shell,/StoreI18n\?\.setLanguage/);
 assert.match(fs.readFileSync(".pages.yml","utf8"),/name: title_en/);
 assert.match(fs.readFileSync(".pages.yml","utf8"),/name: label_en/);
 assert.match(fs.readFileSync("cart.html","utf8"),/StoreI18n\?\.orderText/);
});
