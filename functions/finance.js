// Five Oceans — private financial management, same D1 and admin session as /developers.
// No supplier prices or payments are ever written to the public Pages CMS catalog.

const COOKIE = "__Host-fo-admin";
const AUTH_SECONDS = 8 * 3600;
const encode = new TextEncoder();
const money = n => Math.round(Number(n) || 0).toLocaleString("ru-RU") + " ₽";
const text = v => String(v == null ? "" : v);
const esc = v => text(v).replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const int = (v, min, max, title) => {
  const s = text(v).trim();
  if (!/^(0|[1-9]\d*)$/.test(s)) throw Error("Неверное значение: " + title);
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error("Неверное значение: " + title);
  return n;
};
const reply = (body, status=200) => new Response(body,{status,headers:{
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"no-store, private", "X-Robots-Tag":"noindex, nofollow",
  "X-Content-Type-Options":"nosniff", "X-Frame-Options":"DENY",
  "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
}});

function cookieValue(request) {
  const prefix = COOKIE + "=";
  const entry = (request.headers.get("Cookie")||"").split(";").map(x=>x.trim())
    .find(x=>x.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : "";
}
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw",encode.encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC",key,encode.encode(value)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function loggedIn(request, secret) {
  const cookie = cookieValue(request);
  const parts = cookie.split(".");
  if (parts.length !== 2 || !/^\d{10,12}$/.test(parts[0]) ||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return false;
  const expiry=Number(parts[0]), now=Math.floor(Date.now()/1000);
  if (expiry<=now || expiry>now+AUTH_SECONDS) return false;
  return (await hmac(secret,parts[0]))===parts[1];
}
async function csrf(request, secret) {
  return await hmac(secret,"developers-action:"+cookieValue(request));
}
const skuKey=(slug,size)=>JSON.stringify([slug,size]);

async function catalog(context) {
  const url = new URL("/data/products.json",context.request.url);
  if (!context.env.ASSETS) throw Error("Нет доступа к каталогу Pages.");
  const r = await context.env.ASSETS.fetch(new Request(url.toString()));
  if (!r.ok) throw Error("Каталог Pages временно недоступен.");
  const items=await r.json();
  if (!Array.isArray(items)) throw Error("Каталог Pages повреждён.");
  return items;
}

async function records(db) {
  const [products,suppliers,receipts,payments,expenses,sales]=await Promise.all([
    db.prepare("SELECT product_id,product_slug,title FROM finance_products ORDER BY title").all(),
    db.prepare("SELECT id,name FROM finance_suppliers ORDER BY name").all(),
    db.prepare("SELECT r.*,s.name AS supplier FROM finance_receipts r JOIN finance_suppliers s ON s.id=r.supplier_id ORDER BY r.id").all(),
    db.prepare("SELECT id,receipt_id,amount,note,created_at FROM finance_supplier_payments ORDER BY id").all(),
    db.prepare("SELECT id,reason,amount,created_at FROM finance_expenses ORDER BY id").all(),
    db.prepare("SELECT oi.order_id,oi.product_slug,oi.size,oi.quantity,oi.unit_price,o.updated_at FROM orders o JOIN order_items oi ON oi.order_id=o.order_id WHERE o.status='sold' ORDER BY o.updated_at,o.order_id,oi.product_slug,oi.size").all()
  ]);
  return {products:products.results||[],suppliers:suppliers.results||[],
    receipts:receipts.results||[],payments:payments.results||[],
    expenses:expenses.results||[],sales:sales.results||[]};
}

function calculate(data) {
  // FIFO of received quantities. Cost changes in later batches never rewrite
  // older receipts. Existing historical sales with no cost basis are flagged.
  const consumed=new Map();
  const lots=new Map();
  for(const r of data.receipts) {
    const key=skuKey(r.product_slug,r.stock_size);
    if(!lots.has(key))lots.set(key,[]);
    lots.get(key).push(r);
  }
  const products=new Map(data.products.map(p=>[p.product_slug,{
    ...p, received:0, sold:0, revenue:0, cost:0, due:0, missing:0
  }]));
  let revenue=0, cogs=0, quantitySold=0, unknownQty=0;
  for(const r of data.receipts){
    const p=products.get(r.product_slug);
    if(p)p.received+=Number(r.quantity);
  }
  for(const row of data.sales){
    const qty=Number(row.quantity), income=qty*Number(row.unit_price);
    if(!Number.isSafeInteger(income)||qty<0)throw Error("Ошибка суммы в истории заказов.");
    revenue+=income;quantitySold+=qty;
    const p=products.get(row.product_slug);
    if(p){p.sold+=qty;p.revenue+=income;}
    let rest=qty;
    for(const lot of lots.get(skuKey(row.product_slug,row.size))||[]){
      const available=Number(lot.quantity)-Number(consumed.get(lot.id)||0);
      const taken=Math.min(rest,Math.max(0,available));
      if(!taken)continue;
      consumed.set(lot.id,Number(consumed.get(lot.id)||0)+taken);
      const cost=taken*Number(lot.unit_cost);
      cogs+=cost;if(p)p.cost+=cost;
      rest-=taken;if(!rest)break;
    }
    if(rest){unknownQty+=rest;if(p)p.missing+=rest;}
  }
  let supplierLiability=0, inventoryCost=0, supplierPayments=0;
  const receipts=data.receipts.map(r=>{
    const received=Number(r.quantity),sold=Number(consumed.get(r.id)||0);
    const cost=Number(r.unit_cost), paid=data.payments.filter(x=>x.receipt_id===r.id)
      .reduce((a,x)=>a+Number(x.amount),0);
    supplierPayments+=paid;
    const owedBase=(r.ownership==="purchase"?received:sold)*cost;
    const debt=Math.max(0,owedBase-paid);
    const excess=Math.max(0,paid-owedBase);
    supplierLiability+=debt;
    inventoryCost+=(received-sold)*cost;
    const p=products.get(r.product_slug);if(p)p.due+=debt;
    return {...r,qty_sold:sold,qty_left:received-sold,liability:owedBase,paid,debt,excess};
  });
  const expenses=data.expenses.reduce((a,x)=>a+Number(x.amount),0);
  const tax=Math.round(revenue*0.06);
  return {rows:receipts,productRows:[...products.values()],revenue,cogs,tax,
    expenses, spent:supplierPayments+expenses,supplierPayments,supplierLiability,
    inventoryCost,quantitySold,unknownQty,profit:revenue-cogs-tax-expenses};
}

function layout(content,title="Финансы") {
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<meta name="robots" content="noindex,nofollow"><title>'+esc(title)+' — 5 океанов</title>'+
  '<style>*{box-sizing:border-box}body{background:#f3f6fa;color:#122b44;font-family:Arial,sans-serif;margin:0}'+
  'main{max-width:1200px;margin:24px auto;padding:0 18px 60px}a{color:#125e87}h1{font-size:29px}'+
  'h2{margin-top:30px;font-size:20px}.nav{display:flex;gap:15px;flex-wrap:wrap;margin:15px 0 24px}'+
  '.box{background:white;border:1px solid #dbe4ee;border-radius:14px;padding:19px;margin:15px 0}'+
  '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}'+
  '.stat{background:#fff;border:1px solid #e0e6ee;border-radius:12px;padding:17px}.stat b{display:block;font-size:23px;margin-top:7px}'+
  '.muted{color:#61738b;font-size:13px;line-height:1.6}.warn{padding:12px;background:#fff2e0;border:1px solid #dfc29a;border-radius:8px}'+
  '.ok{background:#e7f7e9;padding:12px;border-radius:8px}.error{background:#ffe9eb;padding:12px;border-radius:8px}'+
  'table{width:100%;border-collapse:collapse;min-width:650px;font-size:13px}th,td{border-bottom:1px solid #e0e8f0;padding:10px;text-align:left}'+
  '.scroll{overflow-x:auto}th{background:#f0f4f8}.forms{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:15px}'+
  'label{display:block;margin:10px 0 4px;font-size:13px}input,select{width:100%;padding:10px;border:1px solid #c2d0e0;border-radius:8px;background:white}'+
  'button,.btn{border:0;background:#e30613;color:white;padding:11px 16px;border-radius:8px;font-weight:700;cursor:pointer;display:inline-block;text-decoration:none;margin-top:12px}'+
  '.btn-secondary{background:#154e7a}.pill{padding:4px 7px;border-radius:12px;background:#e9edf4;font-size:11px}'+
  '@media(max-width:600px){h1{font-size:23px}.box{padding:12px}}</style></head><body><main>'+
  '<h1>Финансовый учёт мерча</h1><nav class="nav"><a href="/developers?tab=stock">Склад</a>'+
  '<a href="/developers?tab=orders">Заказы</a><a href="/finance">Финансы</a>'+
  '<a href="/finance?download=xlsx">Скачать Excel (.xlsx)</a><a href="/">Сайт</a></nav>'+
  content+'</main></body></html>';
}
function formStart(action,token){
  return '<form method="POST" action="/finance">'+
  '<input type="hidden" name="action" value="'+esc(action)+'">'+
  '<input type="hidden" name="csrf" value="'+esc(token)+'">';
}
function options(rows,valFn,labelFn){
  return rows.map(x=>'<option value="'+esc(valFn(x))+'">'+esc(labelFn(x))+'</option>').join("");
}
function show(data,summary,products,token,notice,error) {
  const taxInfo='<p class="muted">Налог — предварительный управленческий расчёт 6% от выручки по заказам со статусом «Оплачен».'+
    ' Это не налоговая декларация: дата фактического получения денег, возвраты, комиссии и условия договора требуют проверки.</p>';
  const stats=[
    ["Выручка",summary.revenue],["Оплаченные поставщикам + расходы",summary.spent],
    ["Налог 6% (оценка)",summary.tax],["Долг поставщикам",summary.supplierLiability],
    ["Себестоимость проданного",summary.cogs],["Расчётная прибыль",summary.profit],
    ["Стоимость непроданного по партиям",summary.inventoryCost]
  ];
  let html=(notice?'<div class="ok">'+esc(notice)+'</div>':"")+
    (error?'<div class="error">'+esc(error)+'</div>':"")+
    '<p class="muted">Закрытый управленческий учёт. Данные поставщиков не публикуются на сайте.</p>'+
    '<div class="stats">'+stats.map(([name,n])=>'<div class="stat">'+esc(name)+'<b>'+money(n)+'</b></div>').join("")+'</div>'+taxInfo;
  if(summary.unknownQty)html+='<p class="warn">Внимание: '+summary.unknownQty+
    ' проданных единиц не имеют зарегистрированной закупочной партии. Прибыль завышена на неизвестную себестоимость. '+
    'Добавьте историю приёмки для этих товаров.</p>';
  html+='<div class="box"><h2>Товары в финансовом учёте</h2>'+
    '<p class="muted">В Pages CMS отметьте «Передать в финансовый учёт», сохраните карточку и нажмите кнопку ниже. '+ 
    'Само добавление в финансовый учёт не создаёт складскую позицию и не публикует товар.</p>'+
    formStart("import",token)+'<button type="submit" class="btn-secondary">Синхронизировать товары из Pages CMS</button></form>'+
    '<div class="scroll"><table><tr><th>Товар</th><th>Получено</th><th>Продано</th><th>Выручка</th><th>Себестоимость</th><th>Долг поставщику</th><th>Без себестоимости</th></tr>'+
    summary.productRows.map(p=>'<tr><td>'+esc(p.title)+'<br><small>'+esc(p.product_slug)+'</small></td><td>'+p.received+'</td>'+
      '<td>'+p.sold+'</td><td>'+money(p.revenue)+'</td><td>'+money(p.cost)+'</td><td>'+money(p.due)+'</td>'+
      '<td>'+p.missing+'</td></tr>').join("")+'</table></div></div>';
  const supplierOptions=options(data.suppliers,x=>x.id,x=>x.name);
  const catalogOptions=products.filter(p=>p.finance_enabled===true && p.published!==undefined)
    .flatMap(p=>(p.variants||[]).flatMap(v=>(v.sizes||[]).map(size=>{
      const stockSize="v:"+v.code+"|"+size;
      return {value:JSON.stringify([p.product_id,stockSize]),label:p.title+" — "+v.label+" / "+size};
    })));
  const receiptOpts=options(summary.rows,r=>r.id,r=>"#"+r.id+" "+r.product_slug+" / "+r.stock_size+" · "+r.supplier);
  html+='<h2>Добавить операцию</h2><div class="forms">'+
    '<div class="box"><h3>Поставщик</h3>'+formStart("supplier",token)+
      '<label>Название поставщика<input name="name" maxlength="140" required></label>'+
      '<button>Добавить поставщика</button></form></div>'+
    '<div class="box"><h3>Поступление на склад</h3><p class="muted">Вносите только после фактической приёмки. '+'Остаток увеличится автоматически, но карточка останется скрытой до публикации в Pages.</p>'+
      formStart("receipt",token)+
      '<label>Товар и размер<select name="sku" required>'+options(catalogOptions,x=>x.value,x=>x.label)+'</select></label>'+
      '<label>Поставщик<select name="supplier" required>'+supplierOptions+'</select></label>'+
      '<label>Тип договора<select name="ownership"><option value="purchase">Выкупили</option>'+
      '<option value="consignment">Под реализацию</option></select></label>'+
      '<label>Количество<input name="quantity" type="number" min="1" max="1000000" required></label>'+
      '<label>Закупочная цена / выплата за штуку (₽)<input name="unit_cost" type="number" min="0" max="100000000" required></label>'+
      '<label>Примечание<input name="note" maxlength="250"></label>'+
      '<button '+(!supplierOptions||!catalogOptions.length?'disabled':'')+'>Подтвердить приёмку</button></form></div>'+
    '<div class="box"><h3>Оплата поставщику</h3>'+formStart("payment",token)+
      '<label>Партия<select name="receipt_id">'+receiptOpts+'</select></label>'+
      '<label>Выплачено (₽)<input name="amount" type="number" min="1" required></label>'+
      '<label>Примечание<input name="note" maxlength="250"></label>'+
      '<button '+(!receiptOpts?'disabled':'')+'>Записать оплату</button></form></div>'+
    '<div class="box"><h3>Прочий расход</h3>'+formStart("expense",token)+
      '<label>Назначение<input name="reason" maxlength="250" required></label>'+
      '<label>Сумма (₽)<input name="amount" type="number" min="1" required></label>'+
      '<button>Записать расход</button></form></div></div>';
  html+='<div class="box"><h2>Поступления и расчёты</h2><div class="scroll"><table>'+
    '<tr><th>Дата</th><th>Партия</th><th>Поставщик</th><th>Схема</th><th>Получено</th><th>Продано</th><th>Себестоимость/шт.</th><th>Начислено</th><th>Оплачено</th><th>Долг</th></tr>'+
    summary.rows.map(r=>'<tr><td>'+esc(r.created_at)+'</td><td>#'+r.id+' '+esc(r.product_slug)+'<br><small>'+esc(r.stock_size)+'</small></td>'+
    '<td>'+esc(r.supplier)+'</td><td>'+(r.ownership==="purchase"?"Выкуп":"Реализация")+
    '</td><td>'+r.quantity+'</td><td>'+r.qty_sold+'</td><td>'+money(r.unit_cost)+
    '</td><td>'+money(r.liability)+'</td><td>'+money(r.paid)+'</td><td>'+money(r.debt)+'</td></tr>').join("")+
    '</table></div></div>';
  html+='<div class="box"><h2>Примечания к расчёту</h2>'+
    '<p class="muted">Себестоимость списывается по FIFO (сначала более ранние поступления). '+ 
    'Для выкупленных партий задолженность возникает после приёмки всей партии. '+
    'Для товара под реализацию — только за реализованные единицы. Обычные продажи берутся автоматически '+ 
    'из существующей CRM по статусу «Оплачен»; никакой второй записи заказов не создаётся. '+
    'Сумма «потрачено» основана на записанных платежах и прочих расходах. '+
    'Финансовые операции с ошибкой корректируем отдельными сторнирующими операциями — не удалением истории.</p></div>';
  return layout(html);
}

async function perform(context,form) {
  const db=context.env.DB, action=text(form.get("action"));
  if(action==="import"){
    const items=(await catalog(context)).filter(p=>p.finance_enabled===true &&
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(text(p.product_id)) && p.slug && p.title)
      .map(p=>[p.product_id,p.slug,p.title]);
    if(!items.length)throw Error("В Pages CMS пока нет товаров с включённым финансовым учётом.");
    await db.prepare("INSERT INTO finance_products (product_id,product_slug,title) SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]') FROM json_each(?) WHERE 1 ON CONFLICT(product_id) DO UPDATE SET product_slug=excluded.product_slug,title=excluded.title,updated_at=CURRENT_TIMESTAMP").bind(JSON.stringify(items)).run();
    return "Синхронизировано товаров в финансовом учёте: "+items.length+".";
  }
  if(action==="supplier"){
    const name=text(form.get("name")).trim();
    if(!name || name.length>140)throw Error("Укажите название поставщика.");
    await db.prepare("INSERT OR IGNORE INTO finance_suppliers (name) VALUES (?)").bind(name).run();
    return "Поставщик сохранён.";
  }
  if(action==="receipt"){
    const raw=text(form.get("sku"));let sku;
    try{sku=JSON.parse(raw)}catch{throw Error("Неверный товар / размер.");}
    if(!Array.isArray(sku)||sku.length!==2)throw Error("Неверная комбинация товара и размера.");
    const productId=text(sku[0]),size=text(sku[1]);
    const available=await catalog(context);
    const product=available.find(p=>p.product_id===productId && p.finance_enabled===true);
    if(!product)throw Error("Товар не выбран для финансового учёта в Pages.");
    const valid=(product.variants||[]).some(v=>(v.sizes||[]).some(s=>"v:"+v.code+"|"+s===size));
    if(!valid)throw Error("Размер или цвет больше не существует в Pages.");
    const imported=await db.prepare("SELECT 1 AS ok FROM finance_products WHERE product_id=? AND product_slug=?").bind(productId,product.slug).first();
    if(!imported)throw Error("Сначала синхронизируйте карточку товара в разделе «Финансы».");
    const excluded=await db.prepare("SELECT 1 AS ok FROM inventory_exclusions WHERE product_slug=? AND size=?").bind(product.slug,size).first();
    if(excluded)throw Error("Позиция находится в корзине склада. Сначала восстановите её в CRM.");
    const supplier=int(form.get("supplier"),1,100000000,"поставщик");
    const name=await db.prepare("SELECT id FROM finance_suppliers WHERE id=?").bind(supplier).first();
    if(!name)throw Error("Поставщик не найден.");
    const ownership=text(form.get("ownership"));
    if(!["purchase","consignment"].includes(ownership))throw Error("Выберите тип договора.");
    const qty=int(form.get("quantity"),1,1000000,"количество");
    const cost=int(form.get("unit_cost"),0,100000000,"себестоимость");
    const note=text(form.get("note")).trim().slice(0,250);
    await db.batch([
      db.prepare("INSERT INTO finance_receipts (product_id,product_slug,stock_size,supplier_id,ownership,quantity,unit_cost,note) VALUES (?,?,?,?,?,?,?,?)")
        .bind(productId,product.slug,size,supplier,ownership,qty,cost,note),
      db.prepare("INSERT INTO inventory (product_slug,product_id,size,total_quantity,reserved_quantity) VALUES (?,?,?, ?,0) ON CONFLICT(product_slug,size) DO UPDATE SET total_quantity=inventory.total_quantity+excluded.total_quantity,updated_at=CURRENT_TIMESTAMP")
        .bind(product.slug,productId,size,qty)
    ]);
    return "Приёмка зафиксирована. Остаток увеличен на "+qty+" шт. Товар не публиковался.";
  }
  if(action==="payment"){
    const receiptId=int(form.get("receipt_id"),1,100000000,"партия");
    const exists=await db.prepare("SELECT id FROM finance_receipts WHERE id=?").bind(receiptId).first();
    if(!exists)throw Error("Партия не найдена.");
    const amount=int(form.get("amount"),1,1000000000,"сумма");
    const note=text(form.get("note")).trim().slice(0,250);
    await db.prepare("INSERT INTO finance_supplier_payments(receipt_id,amount,note) VALUES(?,?,?)")
      .bind(receiptId,amount,note).run();
    return "Оплата поставщику записана.";
  }
  if(action==="expense"){
    const reason=text(form.get("reason")).trim();
    if(!reason||reason.length>250)throw Error("Укажите назначение расхода.");
    const amount=int(form.get("amount"),1,1000000000,"сумма");
    await db.prepare("INSERT INTO finance_expenses(reason,amount) VALUES(?,?)").bind(reason,amount).run();
    return "Расход добавлен.";
  }
  throw Error("Неизвестная операция.");
}

export async function onRequestGet(context){
  const secret=context.env.ADMIN_PASSWORD;
  if(!secret || !(await loggedIn(context.request,secret))){
    return reply(layout('<p class="warn">Требуется вход в закрытую CRM. <a href="/developers">Открыть вход</a>.</p>'),401);
  }
  try{
    if(!context.env.DB)throw Error("Cloudflare D1 не подключена.");
    const data=await records(context.env.DB), report=calculate(data);
    const query=new URL(context.request.url).searchParams;
    if(query.get("download")==="xlsx")return excelDownload(data,report);
    const catalogProducts=await catalog(context);
    return reply(show(data,report,catalogProducts,await csrf(context.request,secret),query.get("notice")||"",""));
  }catch(error){
    console.error("Finance GET",error);
    return reply(layout('<p class="error">Финансовая база пока недоступна: '+esc(error.message)+
      '</p><p class="muted">Перед использованием выполните миграцию finance-mvp.sql в Cloudflare D1 (production).</p>'),503);
  }
}

export async function onRequestPost(context){
  const secret=context.env.ADMIN_PASSWORD;
  if(!secret || !(await loggedIn(context.request,secret)))
    return reply(layout('<p class="error">Требуется вход в CRM.</p>'),401);
  const origin=context.request.headers.get("Origin");
  if(origin && origin!==new URL(context.request.url).origin)return reply("Forbidden",403);
  if(context.request.headers.get("Sec-Fetch-Site")==="cross-site")return reply("Forbidden",403);
  const len=Number(context.request.headers.get("Content-Length")||0);
  if(!Number.isFinite(len)||len>25000)return reply("Request too large",413);
  try{
    const form=await context.request.formData();
    const validToken=await csrf(context.request,secret);
    if(text(form.get("csrf"))!==validToken)return reply("Недействительная защита формы.",403);
    if(!context.env.DB)throw Error("D1 не подключена.");
    const message=await perform(context,form);
    return Response.redirect(new URL("/finance?notice="+encodeURIComponent(message),context.request.url).toString(),303);
  }catch(error){
    console.error("Finance POST",error);
    try{
      const [data,products]=await Promise.all([records(context.env.DB),catalog(context)]);
      return reply(show(data,calculate(data),products,await csrf(context.request,secret),"",error.message),400);
    }catch{
      return reply(layout('<p class="error">'+esc(error.message)+'</p><a href="/finance">Назад</a>'),400);
    }
  }
}
