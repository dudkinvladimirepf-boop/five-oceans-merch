import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./worker.js";

// End-to-end webhook tests with a fake Telegram API, Pages catalog and D1.
// No production API tokens, passwords or databases are used.
const ADMIN = 123456789;
const CUSTOMER = 555555551;
const PASSWORD = "local-test-password";
const env = {
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
  ADMIN_CHAT_ID: String(ADMIN),
  BOT_ADMIN_ID: String(ADMIN),
  BOT_ADMIN_PASSWORD: PASSWORD
};
const sessions = new Map();
let apiCalls = [];
let callbackExpired = false;
const product = {
  product_id: "abc-123", slug: "test-tshirt", title: "Тестовая футболка",
  category: "футболки", price: 1900, description: "Морская футболка",
  variants: [
    { code: "red", label: "Красный", available: true, sizes: ["M"],
      photos: ["/red-1.jpg", "/red-2.jpg"] },
    { code: "white", label: "Белый", available: true, sizes: ["M"],
      photos: ["/white.jpg"] }
  ]
};
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if (u.hostname === "api.telegram.org") {
    const method = u.pathname.split("/").at(-1);
    const payload = JSON.parse(options.body);
    apiCalls.push({ method, payload });
    if (method === "answerCallbackQuery" && callbackExpired) {
      return Response.json({ok:false,description:"query is too old"}, {status:400});
    }
    return Response.json({ok:true,result:{}});
  }
  if (u.pathname === "/data/products.json") return Response.json([product]);
  if (u.pathname === "/data/categories.json") {
    return Response.json([{id:"футболки",title:"Футболки"}]);
  }
  throw new Error("Unexpected mock URL: " + u);
};
const row = id => sessions.get(String(id));
const stmt = (sql, binds = []) => ({
  bind(...args) { return stmt(sql, args); },
  async first() {
    if (sql.includes("FROM bot_admin_auth")) return row(binds[0]) || null;
    if (sql.includes("FROM orders") && sql.includes("COUNT(*)")) {
      return {total:1,pending:1,reserved:0};
    }
    if (sql.includes("FROM inventory")) {
      return {total_quantity:10,reserved_quantity:0};
    }
    if (sql.includes("FROM bot_cart_items")) return {quantity:0};
    return null;
  },
  async all() { return {results:[]}; },
  async run() {
    if (sql.includes("CREATE TABLE IF NOT EXISTS bot_admin_auth")) {
      return {meta:{changes:0}};
    }
    if (sql.includes("INSERT INTO bot_admin_auth")) {
      const [id, expiry] = binds;
      sessions.set(String(id), {...(row(id)||{
        authenticated_until:0,failures:0,locked_until:0,secret_tag:""
      }),login_expires:expiry});
    } else if (sql.includes("SET authenticated_until = ?")) {
      const [until,tag,id] = binds;
      Object.assign(row(id),{
        authenticated_until:until,login_expires:0,failures:0,
        locked_until:0,secret_tag:tag
      });
    } else if (sql.includes("SET login_expires = 0")) {
      row(binds[0]).login_expires=0;
    }
    return {meta:{changes:1}};
  }
});
env.DB = {prepare(sql) {return stmt(sql);}};
async function invoke(update) {
  apiCalls=[];
  const request=new Request("https://example.workers.dev/telegram",{
    method:"POST",headers:{
      "Content-Type":"application/json",
      "X-Telegram-Bot-Api-Secret-Token":env.TELEGRAM_WEBHOOK_SECRET
    },body:JSON.stringify(update)
  });
  assert.equal((await worker.fetch(request,env)).status,200);
  return [...apiCalls];
}
const message = (id,text) => invoke({message:{
  chat:{id,type:"private"},from:{id,first_name:"Test"},message_id:10,text
}});
const callback = (id,data,photo) => invoke({callback_query:{
  id:"cb1",data,from:{id,first_name:"Test"},
  message:{message_id:9,chat:{id,type:"private"},...(photo?{photo:[{file_id:"old"}]}:{})}
}});
const contentOf = calls => calls.filter(x=>["sendMessage","editMessageText"].includes(x.method))
  .map(x=>x.payload.text||"");

test("public customer gets permanent catalog/cart/home but not admin",async()=>{
  const calls=await message(CUSTOMER,"/start");
  const keyboard=calls[0].payload.reply_markup;
  assert.equal(keyboard.is_persistent,true);
  const texts=keyboard.keyboard.flat().map(b=>b.text);
  assert(texts.includes("🏠 Главное меню"));
  assert(texts.includes("🛍 Каталог"));
  assert(texts.includes("🛒 Корзина"));
  assert(!texts.includes("⚙️ Управление"));
});
test("admin sees management, cart and catalog can be summoned anywhere",async()=>{
  const start=await message(ADMIN,"/start");
  assert(start[0].payload.reply_markup.keyboard.flat()
    .some(b=>b.text==="⚙️ Управление"));
  assert(contentOf(await message(ADMIN,"🛍 Каталог")).some(t=>t.includes("КАТАЛОГ МЕРЧА")));
  assert(contentOf(await message(ADMIN,"🛒 Корзина")).some(t=>t.includes("Корзина пуста")));
  assert((await message(ADMIN,"🏠 Главное меню"))[0].payload.reply_markup.keyboard.flat()
    .some(b=>b.text==="⚙️ Управление"));
});
test("admin login opens actual CRM buttons and persists for /admin",async()=>{
  assert(contentOf(await message(ADMIN,"⚙️ Управление"))
    .some(t=>t.includes("Отправьте пароль")));
  const accepted=await message(ADMIN,PASSWORD);
  assert(accepted.some(c=>c.method==="deleteMessage"));
  const adminMessage=accepted.find(c=>c.payload?.text?.includes("Вход выполнен"));
  assert(adminMessage);
  assert(adminMessage.payload.reply_markup.inline_keyboard.flat().some(b=>b.text==="📦 Заказы"));
  assert(contentOf(await message(ADMIN,"/admin"))
    .some(t=>t.includes("УПРАВЛЕНИЕ МАГАЗИНОМ")));
});
test("expired callback query does not disable inline navigation",async()=>{
  callbackExpired=true;
  assert(contentOf(await callback(ADMIN,"catalog")).some(t=>t.includes("КАТАЛОГ МЕРЧА")));
  callbackExpired=false;
});
test("item photo can be changed in place when a new color is selected",async()=>{
  const categories=await callback(CUSTOMER,"catalog");
  const category=categories.find(c=>c.payload?.text?.includes("КАТАЛОГ МЕРЧА"));
  const catCode=category.payload.reply_markup.inline_keyboard[0][0].callback_data;
  const items=await callback(CUSTOMER,catCode);
  const item=items.find(c=>c.payload?.text?.includes("Выберите товар"));
  const productCode=item.payload.reply_markup.inline_keyboard[0][0].callback_data;
  const opened=await callback(CUSTOMER,productCode);
  const photo=opened.find(c=>c.method==="sendPhoto");
  assert(photo);
  const white=photo.payload.reply_markup.inline_keyboard.flat()
    .find(b=>b.text.includes("Белый")).callback_data;
  const switched=await callback(CUSTOMER,white,true);
  assert(switched.some(c=>c.method==="editMessageMedia" &&
    c.payload.media.media.endsWith("/white.jpg")));
  assert(!switched.some(c=>c.method==="sendPhoto"));
});
test("expired password request returns a clear re-entry instruction",async()=>{
  sessions.set(String(ADMIN),{
    authenticated_until:0,login_expires:1,failures:0,locked_until:0,secret_tag:""
  });
  const calls=await message(ADMIN,"text after expiration");
  assert(contentOf(calls).some(t=>t.includes("Время ввода пароля истекло")));
});
