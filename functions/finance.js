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
  "Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
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
// Fixed snapshot of merchandise existing when the opening balance was planned.
// New products are intentionally excluded from the one-time opening import.
const LEGACY_UNIT_COSTS = new Map([
  ["d233280c-ab61-41e7-a3bd-c7682b38bc81",2950], // all hoodie colors and sizes
  ["6adb0179-7668-4942-8a7b-1806dfec65b9",2175], // all sweatshirt colors and sizes
  ["2114867b-3c44-483f-9c45-d5acea342836",1400],["63ab85af-1303-44c0-b588-f482f1b251a7",1400],
  ["1cab5aa8-9717-4756-88e7-317ba95dc9be",1400],["c6e83d8c-ab0a-42d4-a7dc-dbb1607a938e",1400],
  ["f74d03ce-a0aa-4f04-a738-c60a9221cec1",1400],["056aca62-9e79-4fa3-8d0b-647f35f30402",1400],
  ["6fa7f415-e6e3-4b9d-b408-e8cc0da44cf7",700]
]);
const LEGACY_BATCH_NAME = "Начальная партия № 1";
const LEGACY_SUPPLIER_NAME = "Неизвестный поставщик";


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
  const [products,suppliers,receipts,payments,expenses,sales,batches,opening]=await Promise.all([
    db.prepare("SELECT product_id,product_slug,title,list_price FROM finance_products ORDER BY title").all(),
    db.prepare("SELECT id,name FROM finance_suppliers ORDER BY name").all(),
    db.prepare("SELECT r.*,s.name AS supplier,b.name AS batch_name FROM finance_receipts r JOIN finance_suppliers s ON s.id=r.supplier_id LEFT JOIN finance_batches b ON b.id=r.batch_id ORDER BY r.id").all(),
    db.prepare("SELECT id,receipt_id,amount,note,created_at FROM finance_supplier_payments ORDER BY id").all(),
    db.prepare("SELECT id,reason,amount,created_at FROM finance_expenses ORDER BY id").all(),
    db.prepare("SELECT oi.order_id,oi.product_slug,oi.size,oi.quantity,oi.unit_price,o.updated_at FROM orders o JOIN order_items oi ON oi.order_id=o.order_id WHERE o.status='sold' AND (NOT EXISTS (SELECT 1 FROM finance_opening_state WHERE id='legacy-v1') OR o.updated_at > (SELECT snapshot_at FROM finance_opening_state WHERE id='legacy-v1')) ORDER BY o.updated_at,o.order_id,oi.product_slug,oi.size").all(),
    db.prepare("SELECT id,supplier_id,name FROM finance_batches ORDER BY id").all(),
    db.prepare("SELECT id,snapshot_at,stock_lines FROM finance_opening_state WHERE id='legacy-v1'").first()
  ]);
  return {products:products.results||[],suppliers:suppliers.results||[],
    receipts:receipts.results||[],payments:payments.results||[],
    expenses:expenses.results||[],sales:sales.results||[],
    batches:batches.results||[],opening:opening||null};
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
    ...p, received:0, openingQty:0, purchased:0, consignment:0, costTotal:0, averageCost:0, purchaseUnitCost:null, sold:0, revenue:0, cost:0, due:0, missing:0
  }]));
  let revenue=0, cogs=0, quantitySold=0, unknownQty=0;
  for(const r of data.receipts){
    const p=products.get(r.product_slug);
    if(p){p.received+=Number(r.quantity);p.costTotal+=Number(r.quantity)*Number(r.unit_cost);if(Number(r.is_opening||0)===1)p.openingQty+=Number(r.quantity);else if(r.ownership==="purchase")p.purchased+=Number(r.quantity);else p.consignment+=Number(r.quantity);}
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
  for(const p of products.values()){
    p.averageCost=p.received?p.costTotal/p.received:0;
    // A legacy SKU is still known even when its current stock is zero:
    // no opening receipt was created for zero-stock rows.
    // The reference price is informational, not a fictitious purchase.
    p.purchaseUnitCost=p.received>0 ? p.averageCost :
      (LEGACY_UNIT_COSTS.get(String(p.product_id||"").toLowerCase()) ?? null);
  }
  let supplierLiability=0, inventoryCost=0, supplierPayments=0;
  const receipts=data.receipts.map(r=>{
    const received=Number(r.quantity),sold=Number(consumed.get(r.id)||0);
    const cost=Number(r.unit_cost), paid=data.payments.filter(x=>x.receipt_id===r.id)
      .reduce((a,x)=>a+Number(x.amount),0);
    supplierPayments+=paid;
    // Existing stock predates finance accounting. Its origin is unknown;
    // never assume an outstanding debt or cash expense for opening units.
    const owedBase=Number(r.is_opening||0)===1 ? 0 :
      (r.ownership==="purchase"?received:sold)*cost;
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
  '.combobox{position:relative}.suggestions{position:relative;background:#fff;border:1px solid #d3dfea;border-radius:8px;max-height:210px;overflow-y:auto;margin-top:4px}'+
  '.suggestions[hidden]{display:none}.suggestions button{display:block;width:100%;text-align:left;margin:0;border:0;border-radius:0;background:white;color:#122b44;font-weight:normal;font-size:13px;padding:10px}'+
  '.suggestions button:hover,.suggestions button:focus{background:#e9f2ff;outline:2px solid #adcbea}.field-help{font-size:12px;color:#506982;margin:5px 0}'+
  '@media(max-width:600px){h1{font-size:23px}.box{padding:12px}}</style></head><body><main>'+
  '<h1>Финансовый учёт мерча</h1><nav class="nav"><a href="/developers?tab=stock">Склад</a>'+
  '<a href="/developers?tab=orders">Заказы</a><a href="/finance">Финансы</a>'+
  '<a href="/finance?download=xlsx">Скачать Excel (.xlsx)</a><a href="/">Сайт</a></nav>'+
  content+'</main><script src="/finance-forms.js" defer></script></body></html>';
}
function formStart(action,token){
  return '<form method="POST" action="/finance">'+
  '<input type="hidden" name="action" value="'+esc(action)+'">'+
  '<input type="hidden" name="csrf" value="'+esc(token)+'">';
}
// Only already-registered financial products can be received.
function receiptCatalogChoices(products,financialProducts){
  const registered=new Map(financialProducts.map(p=>[String(p.product_id),String(p.product_slug)]));
  const choices=[];
  for(const p of products){
    if(registered.get(String(p.product_id))!==String(p.slug))continue;
    for(const v of p.variants||[]){
      for(const size of v.sizes||[]){
        choices.push({
          value:JSON.stringify([p.product_id,"v:"+v.code+"|"+size]),
          label:p.title+" — "+v.label+" / "+size,
          search:[p.title,p.slug,v.label,v.code,size].join(" ")
        });
      }
    }
  }
  return choices;
}
function options(rows,valFn,labelFn){
  return rows.map(x=>'<option value="'+esc(valFn(x))+'">'+esc(labelFn(x))+'</option>').join("");
}
function show(data,summary,products,token,notice,error,filters={}) {
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
    '<p class="muted">Закупочная цена за штуку: если были поступления — средневзвешенная по количеству в партиях, если остатков не было — согласованная справочная цена исходного товара. '+
    'Справочная цена не создаёт расход или задолженность. Себестоимость проданного равна 0 ₽ до первой учтённой продажи.</p>'+
    '<div class="scroll"><table><tr><th>Товар</th><th>Цена продажи</th><th>Закупочная цена / шт.</th><th>Начальный остаток</th><th>Новые закупки</th><th>Под реализацию</th><th>Продано</th><th>Выручка</th><th>Себестоимость проданного</th><th>Долг поставщику</th><th>Продано без себестоимости, шт.</th></tr>'+
    summary.productRows.map(p=>'<tr><td>'+esc(p.title)+'<br><small>'+esc(p.product_slug)+'</small></td><td>'+money(p.list_price)+'</td><td>'+(p.purchaseUnitCost===null?'—':money(p.purchaseUnitCost))+'</td><td>'+p.openingQty+'</td><td>'+p.purchased+'</td><td>'+p.consignment+'</td>'+
      '<td>'+p.sold+'</td><td>'+money(p.revenue)+'</td><td>'+money(p.cost)+'</td><td>'+money(p.due)+'</td>'+
      '<td>'+p.missing+'</td></tr>').join("")+'</table></div></div>';
  const catalogOptions=receiptCatalogChoices(products,data.products);
  const supplierOptions=options(data.suppliers,x=>x.name,x=>x.name);
  const receiptOpts=options(summary.rows.filter(r=>Number(r.is_opening||0)!==1),r=>r.id,r=>"#"+r.id+" "+(r.batch_name||"Без названия")+" · "+r.product_slug+" / "+r.stock_size+" · "+r.supplier);
  const supplierFilter=String(filters.supplier||"");
  const batchFilter=String(filters.batch||"");
  const filteredRows=summary.rows.filter(r=>
    (!supplierFilter||String(r.supplier_id)===supplierFilter) &&
    (!batchFilter||String(r.batch_id||"")===batchFilter));
  const openingMismatches=data.receipts.filter(r=>Number(r.is_opening||0)===1 &&
    LEGACY_UNIT_COSTS.has(String(r.product_id||"").toLowerCase()) &&
    Number(r.unit_cost)!==LEGACY_UNIT_COSTS.get(String(r.product_id).toLowerCase()));
  if(openingMismatches.length){
    html+='<div class="box"><h2>Исправление закупочной цены старых товаров</h2>'+
      '<p class="warn">Найдено '+openingMismatches.length+
      ' записей начальной партии с устаревшей закупочной ценой. '+ 
      'Свитшоты должны стоить 2 175 ₽/шт. Операция корректирует только цену в начальных партиях. '+
      'Количество на складе, цену продажи, оплаты поставщикам и новые партии не затрагивает.</p>'+
      formStart("reconcile-opening-costs",token)+
      '<button type="submit" class="btn-secondary">Исправить закупочные цены начальных партий</button></form></div>';
  }
  html+='<div class="box"><h2>Начальный перенос существующих товаров</h2>'+
    (data.opening ?
     '<p class="ok">Начальная партия перенесена '+esc(data.opening.snapshot_at)+
     ' · товарных позиций на момент переноса: '+Number(data.opening.stock_lines)+
     '. Повторный перенос заблокирован.</p>' :
     '<p class="warn">Однократный перенос девяти существующих товаров из Pages и их фактических складских остатков. '+
     'Поставщик: «Неизвестный поставщик»; партия: «Начальная партия № 1». '+
     'Закупочные цены уже известны: худи 2 950 ₽, свитшоты 2 175 ₽, футболки 1 400 ₽, шапка 700 ₽. '+
     '<strong>Складские количества не изменяются; старые заказы не пересчитываются.</strong> '+
     'Никаких вымышленных долгов и платежей не создаётся.</p>'+
     formStart("opening-import",token)+
     '<button type="submit" class="btn-secondary">Перенести существующие товары и остатки (один раз)</button></form>')+
     '</div>';
  html+='<h2>Добавить операцию</h2>'+
    '<div class="box"><h3>Единое оформление поступления</h3>'+
      '<p class="muted">Одно подтверждение записывает поступление, поставщика, новую партию, фактическую оплату и расходы. Неоплаченные суммы и расходы можно оставить пустыми. Склад увеличивается только после успешного сохранения всей операции.</p>'+
      '<h4>1. Что получили и от кого</h4>'+
      formStart("receipt",token)+
      '<label for="finance-operation-mode">Что оформляем?</label>'+
      '<select id="finance-operation-mode" name="operation_mode">'+
      '<option value="receipt">Новое поступление (товар + оплата + расходы)</option>'+
      '<option value="settlement">Доплата / отдельный расход без нового поступления</option></select>'+
      '<div id="receipt-main-fields">'+
      '<label for="receipt-sku-select">Товар, цвет и размер — выбрать из списка</label>'+
      '<select id="receipt-sku-select" name="sku" required>'+
      '<option value="">— Выберите товар, цвет и размер —</option>'+
      options(catalogOptions,x=>x.value,x=>x.label)+'</select>'+
      '<div class="combobox"><label for="receipt-sku-search">Или найти товар по названию / ввести вручную</label>'+
      '<input id="receipt-sku-search" type="search" autocomplete="off" placeholder="Например: футболка, Не как все, ne..." aria-controls="receipt-sku-suggestions">'+
      '<div id="receipt-sku-suggestions" class="suggestions" role="listbox" hidden></div></div>'+
      '<p class="field-help">Начните печатать — появятся подходящие товары и размеры. Выберите подсказку. Для совершенно нового товара сначала создайте карточку в Pages и синхронизируйте с финансами.</p>'+
      '<label for="receipt-supplier-select">Поставщик — выбрать из списка</label>'+
      '<select id="receipt-supplier-select"><option value="">— Новый или не выбран —</option>'+
      supplierOptions+'</select>'+
      '<div class="combobox"><label for="receipt-supplier-input">Или ввести название поставщика</label>'+
      '<input id="receipt-supplier-input" name="supplier_name" type="text" required maxlength="140" autocomplete="off" placeholder="Начните печатать или укажите нового поставщика" aria-controls="receipt-supplier-suggestions">'+
      '<div id="receipt-supplier-suggestions" class="suggestions" role="listbox" hidden></div></div>'+
      '<p class="field-help">Известный поставщик выбирается из списка или по подсказке. Если название новое, оно сохранится автоматически при приёмке.</p>'+
      '<label>Название партии у поставщика<input name="batch_name" value="Партия № 1" maxlength="150" required></label>'+
      '<label>Тип договора<select name="ownership"><option value="purchase">Выкупили</option>'+
      '<option value="consignment">Под реализацию</option></select></label>'+
      '<label>Количество<input name="quantity" type="number" min="1" max="1000000" required></label>'+
      '<label>Закупочная цена / выплата за штуку (₽)<input name="unit_cost" type="number" min="0" max="100000000" required></label>'+
      '<label>Примечание к поступлению<input name="note" maxlength="250"></label>'+
      '</div>'+
      '<div id="existing-receipt-select" hidden>'+
      '<label for="finance-existing-receipt">Ранее оформленная партия для доплаты</label>'+
      '<select id="finance-existing-receipt" name="receipt_id" disabled>'+
      '<option value="">— Только расход (без платежа) —</option>'+
      receiptOpts+'</select>'+
      '<p class="field-help">Если это доплата, выбери нужное поступление. Если нужно учесть только самостоятельный расход, оставь партию пустой.</p></div>'+
      '<h4>2. Оплата поставщику — необязательно</h4>'+
      '<p class="muted">Если пока не платили — оставь сумму пустой. При новом поступлении платёж привязывается к нему, при доплате — к выбранной ранее партии.</p>'+
      '<div class="forms"><label>Уже выплачено поставщику (₽)<input name="payment_amount" type="number" min="0" max="1000000000" placeholder="Не оплачивали — оставить пустым"></label>'+
      '<label>Комментарий к оплате<input name="payment_note" maxlength="250" placeholder="Например, банковский перевод"></label></div>'+
      '<h4>3. Прочие расходы — необязательно</h4>'+
      '<p class="muted">Доставка, упаковка и другие расходы, уже понесённые по этой приёмке. Можно добавить несколько строк; пустые не сохраняются.</p>'+
      '<div id="receipt-expenses">'+
      '<div class="forms expense-line"><label>Назначение расхода<input name="expense_reason" maxlength="250" placeholder="Например, доставка"></label>'+
      '<label>Сумма расхода (₽)<input name="expense_amount" type="number" min="1" max="1000000000" placeholder="Если нет расходов — оставить пустым"></label></div>'+
      '</div>'+
      '<button type="button" id="add-receipt-expense" class="btn-secondary">+ Ещё расход</button>'+
      '<p class="field-help">Проверь все суммы и количество до подтверждения. Это единая операция, отдельно сохранять каждый блок не нужно.</p>'+
      '<button type="submit" id="confirm-receipt" '+(!catalogOptions.length?'disabled':'')+'>Подтвердить операцию</button>'+
      '</form></div>';
  html+='<div class="box"><h2>Поступления и расчёты</h2>'+
    '<form method="GET" action="/finance"><div class="forms">'+
    '<label>Поставщик<select name="supplier"><option value="">Все поставщики</option>'+
    data.suppliers.map(x=>'<option value="'+x.id+'"'+(supplierFilter===String(x.id)?' selected':'')+'>'+esc(x.name)+'</option>').join("")+'</select></label>'+
    '<label>Партия<select name="batch"><option value="">Все партии</option>'+
    data.batches.map(x=>'<option value="'+x.id+'"'+(batchFilter===String(x.id)?' selected':'')+'>#'+x.id+' · '+esc(x.name)+'</option>').join("")+'</select></label>'+
    '</div><button type="submit" class="btn-secondary">Найти партии</button> <a href="/finance">Сбросить фильтры</a></form>'+
    '<p class="muted">Показаны '+filteredRows.length+' из '+summary.rows.length+' складских партий. Общая сводка выше не фильтруется.</p>'+
    '<div class="scroll"><table>'+
    '<tr><th>Дата</th><th>Партия / внутренний ID</th><th>Товар и размер</th><th>Поставщик</th><th>Схема</th><th>Получено</th><th>Продано</th><th>Себестоимость/шт.</th><th>Начислено</th><th>Оплачено</th><th>Долг</th></tr>'+
    filteredRows.map(r=>'<tr><td>'+esc(r.created_at)+'</td><td>#'+esc(r.batch_id||r.id)+' · '+esc(r.batch_name||"Без названия")+'</td>'+
    '<td>'+esc(r.product_slug)+'<br><small>'+esc(r.stock_size)+'</small></td>'+
    '<td>'+esc(r.supplier)+'</td><td>'+(Number(r.is_opening||0)===1?"Начальный остаток":(r.ownership==="purchase"?"Выкуп":"Реализация"))+
    '</td><td>'+r.quantity+'</td><td>'+r.qty_sold+'</td><td>'+money(r.unit_cost)+
    '</td><td>'+money(r.liability)+'</td><td>'+money(r.paid)+'</td><td>'+money(r.debt)+'</td></tr>').join("")+
    '</table></div></div>';
  html+='<div class="box"><h2>Примечания к расчёту</h2>'+
    '<p class="muted">Себестоимость списывается по FIFO (сначала более ранние поступления). '+ 
    'Для начальных партий задолженность и выплаты неизвестны, поэтому не начисляются. Для выкупленных новых партий задолженность возникает после приёмки всей партии. '+
    'Для товара под реализацию — только за реализованные единицы. Обычные продажи берутся автоматически '+ 
    'из существующей CRM по статусу «Оплачен»; никакой второй записи заказов не создаётся. '+
    'Сумма «потрачено» основана на записанных платежах и прочих расходах. '+
    'Финансовые операции с ошибкой корректируем отдельными сторнирующими операциями — не удалением истории.</p></div>';
  return layout(html);
}


async function importOpening(context) {
  const db=context.env.DB;
  // Read-only checks before the transaction: failed/pre-existing imports must
  // not add a second beginning balance or silently overwrite manual history.
  const [state,prior]=await Promise.all([
    db.prepare("SELECT id FROM finance_opening_state WHERE id='legacy-v1'").first(),
    db.prepare("SELECT COUNT(*) AS n FROM finance_receipts").first()
  ]);
  if(state)throw Error("Начальный перенос уже выполнялся. Повторять его нельзя.");
  if(Number(prior?.n||0)>0)throw Error("В финансах уже есть зарегистрированные партии. Автоматический перенос остановлен для защиты от удвоения учёта.");

  const items=await catalog(context);
  const known=new Map(items.filter(p=>p.published===true &&
    LEGACY_UNIT_COSTS.has(String(p.product_id).toLowerCase()))
    .map(p=>[p.slug,p]));
  if(known.size!==LEGACY_UNIT_COSTS.size)
    throw Error("Часть из девяти первоначальных товаров отсутствует или скрыта в Pages. Перенос отменён.");
  const byId=new Set([...known.values()].map(p=>String(p.product_id).toLowerCase()));
  if(byId.size!==LEGACY_UNIT_COSTS.size)
    throw Error("Повторяющиеся ID старых товаров в Pages. Перенос отменён.");

  const stockResult=await db.prepare(
    "SELECT i.product_slug,i.size,i.total_quantity,i.reserved_quantity "+
    "FROM inventory i WHERE i.total_quantity>0 AND NOT EXISTS "+
    "(SELECT 1 FROM inventory_exclusions e WHERE e.product_slug=i.product_slug AND e.size=i.size)"
  ).all();
  // Keep catalog SKU IDs/costs; read actual quantities inside the D1 transaction.
  const positions=[];
  for(const p of known.values()) {
    const cost=LEGACY_UNIT_COSTS.get(String(p.product_id).toLowerCase());
    for(const v of p.variants||[])for(const size of v.sizes||[])
      positions.push([p.product_id,p.slug,"v:"+v.code+"|"+size,cost]);
  }
  for(const x of stockResult.results||[]){
    const p=known.get(x.product_slug);
    if(!p)continue; // Goods absent from the current published catalog are not imported.
    const valid=(p.variants||[]).some(v=>Array.isArray(v.sizes)&&
      v.sizes.some(size=>"v:"+v.code+"|"+size===x.size));
    if(!valid)throw Error("На складе у старого товара есть размер, отсутствующий в Pages: "+p.title+" / "+x.size+". Перенос не выполнен.");
    const qty=Number(x.total_quantity),reserved=Number(x.reserved_quantity);
    if(!Number.isSafeInteger(qty)||qty<1||!Number.isSafeInteger(reserved)||reserved<0||reserved>qty)
      throw Error("Некорректные складские количества: "+p.title+" / "+x.size);
  }
  const products=[...known.values()].map(p=>[
    p.product_id,p.slug,p.title,Number(p.price||0)]);
  if(products.some(p=>!Number.isSafeInteger(p[3])||p[3]<0))
    throw Error("Некорректная цена продажи в Pages.");
  const statements=[
    // Uniqueness of legacy-v1 makes the whole batch fail atomically on races.
    db.prepare("INSERT INTO finance_opening_state(id,stock_lines) "+
      "SELECT 'legacy-v1',COUNT(*) FROM inventory i "+
      "JOIN json_each(?) x ON i.product_slug=json_extract(x.value,'$[1]') "+
      "AND i.size=json_extract(x.value,'$[2]') "+
      "WHERE i.total_quantity>0 AND NOT EXISTS "+
      "(SELECT 1 FROM inventory_exclusions e WHERE e.product_slug=i.product_slug AND e.size=i.size)"
    ).bind(JSON.stringify(positions)),
    db.prepare("INSERT INTO finance_products (product_id,product_slug,title,list_price) "+
      "SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]') "+
      "FROM json_each(?) WHERE 1 ON CONFLICT(product_id) DO UPDATE SET "+
      "product_slug=excluded.product_slug,title=excluded.title,list_price=excluded.list_price,updated_at=CURRENT_TIMESTAMP"
    ).bind(JSON.stringify(products)),
    db.prepare("INSERT OR IGNORE INTO finance_suppliers(name) VALUES(?)").bind(LEGACY_SUPPLIER_NAME),
    db.prepare("INSERT OR IGNORE INTO finance_batches(supplier_id,name) "+
      "SELECT id,? FROM finance_suppliers WHERE name=?").bind(LEGACY_BATCH_NAME,LEGACY_SUPPLIER_NAME)
  ];
  if(positions.length) statements.push(
    db.prepare("INSERT INTO finance_receipts (product_id,product_slug,stock_size,supplier_id,batch_id,ownership,quantity,unit_cost,note,is_opening) "+
      "SELECT json_extract(x.value,'$[0]'),json_extract(x.value,'$[1]'),json_extract(x.value,'$[2]'),"+
      "s.id,b.id,'purchase',i.total_quantity,json_extract(x.value,'$[3]'),'Первичный перенос из CRM; без движения склада',1 "+
      "FROM json_each(?) x JOIN inventory i ON i.product_slug=json_extract(x.value,'$[1]') "+
      "AND i.size=json_extract(x.value,'$[2]') "+
      "CROSS JOIN finance_suppliers s JOIN finance_batches b "+
      "ON b.supplier_id=s.id AND b.name=? WHERE s.name=? AND i.total_quantity>0 "+
      "AND NOT EXISTS (SELECT 1 FROM inventory_exclusions e "+
      "WHERE e.product_slug=i.product_slug AND e.size=i.size)"
    ).bind(JSON.stringify(positions),LEGACY_BATCH_NAME,LEGACY_SUPPLIER_NAME)
  );
  await db.batch(statements);
  return "Начальный перенос выполнен: "+products.length+
    " товаров. Складские позиции с положительным остатком перенесены по фактическим значениям D1. "+
    "Остатки не изменялись; долг поставщику не начислялся.";
}

async function reconcileOpeningCosts(db) {
  const opening=await db.prepare("SELECT id FROM finance_opening_state WHERE id='legacy-v1'").first();
  if(!opening)throw Error("Начальный перенос ещё не выполнялся.");
  const prices=JSON.stringify([...LEGACY_UNIT_COSTS]);
  const result=await db.prepare(
    "WITH prices AS (SELECT json_extract(value,'$[0]') AS pid,"+
    "CAST(json_extract(value,'$[1]') AS INTEGER) AS unit_cost FROM json_each(?)) "+
    "UPDATE finance_receipts AS r SET unit_cost=prices.unit_cost "+
    "FROM prices WHERE r.product_id=prices.pid AND r.is_opening=1 "+
    "AND r.unit_cost<>prices.unit_cost"
  ).bind(prices).run();
  return "Закупочные цены начальных партий сверены: обновлено "+Number(result.meta?.changes||0)+
    " записей. Остатки и другие партии не изменены.";
}

async function resolveSupplierName(db,input,legacyId){
  let raw=text(input).trim();
  // Support submissions from a previously opened version of the old form.
  if(!raw && legacyId){
    const id=int(legacyId,1,100000000,"поставщик");
    const existing=await db.prepare("SELECT name FROM finance_suppliers WHERE id=?").bind(id).first();
    if(!existing)throw Error("Поставщик не найден.");
    raw=String(existing.name);
  }
  if(!raw||raw.length>140||/[\x00-\x1f\x7f]/.test(raw))
    throw Error("Введите корректное название поставщика (до 140 символов).");
  const suppliers=await db.prepare("SELECT name FROM finance_suppliers").all();
  const match=(suppliers.results||[]).find(p=>String(p.name).trim().toLocaleLowerCase("ru")===raw.toLocaleLowerCase("ru"));
  return match?String(match.name):raw;
}

function optionalMoney(value,title){
  const raw=text(value).trim();
  return raw==="" ? 0 : int(raw,0,1000000000,title);
}
function receiptExtras(form){
  const payment=optionalMoney(form.get("payment_amount"),"оплата поставщику");
  const paymentNote=text(form.get("payment_note")).trim();
  if(paymentNote.length>250)throw Error("Комментарий к оплате слишком длинный.");
  if(!payment && paymentNote)throw Error("Укажи сумму оплаты или удали комментарий к ней.");
  const reasons=form.getAll("expense_reason").map(v=>text(v).trim());
  const amounts=form.getAll("expense_amount").map(v=>text(v).trim());
  // A malicious/malformed request must not silently drop extra rows.
  if(reasons.length!==amounts.length || reasons.length>10)
    throw Error("Некорректный список расходов (максимум 10).");
  const expenses=[];
  for(let i=0;i<reasons.length;i++){
    const reason=reasons[i],raw=amounts[i];
    if(!reason&&!raw)continue;
    if(!reason||reason.length>250||!raw)
      throw Error("Для каждого расхода укажи и назначение, и сумму.");
    const amount=int(raw,1,1000000000,"сумма расхода");
    expenses.push({reason,amount});
  }
  return {payment,paymentNote,expenses};
}

async function settleExisting(db,form){
  const extras=receiptExtras(form);
  if(!extras.payment&&!extras.expenses.length)
    throw Error("Укажи сумму доплаты или хотя бы один расход.");
  let target=null;
  if(extras.payment){
    const receiptId=int(form.get("receipt_id"),1,100000000,"номер поступления");
    target=await db.prepare("SELECT id FROM finance_receipts WHERE id=? AND is_opening=0")
      .bind(receiptId).first();
    if(!target)throw Error("Выбранная партия не найдена или не допускает доплаты.");
  }
  const statements=[];
  if(extras.payment)statements.push(db.prepare(
    "INSERT INTO finance_supplier_payments(receipt_id,amount,note) VALUES(?,?,?)"
  ).bind(target.id,extras.payment,extras.paymentNote));
  for(const expense of extras.expenses)statements.push(db.prepare(
    "INSERT INTO finance_expenses(reason,amount) VALUES(?,?)"
  ).bind(expense.reason,expense.amount));
  await db.batch(statements);
  return "Дополнительная операция сохранена: "+
    (extras.payment?"оплата поставщику "+money(extras.payment)+"; ":"")+
    "прочих расходов "+extras.expenses.length+". Склад не менялся.";
}

async function perform(context,form) {
  const db=context.env.DB, action=text(form.get("action"));
  if(action==="opening-import")return importOpening(context);
  if(action==="reconcile-opening-costs")return reconcileOpeningCosts(db);
  if(action==="import"){
    const items=(await catalog(context)).filter(p=>p.finance_enabled===true &&
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(text(p.product_id)) && p.slug && p.title)
      .map(p=>[p.product_id,p.slug,p.title,Number(p.price||0)]);
    if(!items.length)throw Error("В Pages CMS пока нет товаров с включённым финансовым учётом.");
    await db.prepare("INSERT INTO finance_products (product_id,product_slug,title,list_price) SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]') FROM json_each(?) WHERE 1 ON CONFLICT(product_id) DO UPDATE SET product_slug=excluded.product_slug,title=excluded.title,list_price=excluded.list_price,updated_at=CURRENT_TIMESTAMP").bind(JSON.stringify(items)).run();
    return "Синхронизировано товаров в финансовом учёте: "+items.length+".";
  }
  if(action==="supplier"){
    const name=text(form.get("name")).trim();
    if(!name || name.length>140)throw Error("Укажите название поставщика.");
    await db.prepare("INSERT OR IGNORE INTO finance_suppliers (name) VALUES (?)").bind(name).run();
    return "Поставщик сохранён.";
  }
  if(action==="receipt"){
    const mode=text(form.get("operation_mode")||"receipt");
    if(mode==="settlement")return settleExisting(db,form);
    if(mode!=="receipt")throw Error("Неизвестный режим операции.");
    const raw=text(form.get("sku"));let sku;
    try{sku=JSON.parse(raw)}catch{throw Error("Неверный товар / размер.");}
    if(!Array.isArray(sku)||sku.length!==2)throw Error("Неверная комбинация товара и размера.");
    const productId=text(sku[0]),size=text(sku[1]);
    const available=await catalog(context);
    const product=available.find(p=>p.product_id===productId);
    if(!product)throw Error("Товар не найден в Pages. Сначала создайте карточку в Pages.");
    const valid=(product.variants||[]).some(v=>(v.sizes||[]).some(s=>"v:"+v.code+"|"+s===size));
    if(!valid)throw Error("Размер или цвет больше не существует в Pages.");
    const imported=await db.prepare("SELECT 1 AS ok FROM finance_products WHERE product_id=? AND product_slug=?").bind(productId,product.slug).first();
    if(!imported)throw Error("Сначала синхронизируйте карточку товара в разделе «Финансы».");
    const excluded=await db.prepare("SELECT 1 AS ok FROM inventory_exclusions WHERE product_slug=? AND size=?").bind(product.slug,size).first();
    if(excluded)throw Error("Позиция находится в корзине склада. Сначала восстановите её в CRM.");
    const providerInput=text(form.get("supplier_name")).replace(/\s+/g," ").trim();
    const supplierName=await resolveSupplierName(db,providerInput,form.get("supplier"));
    if(!supplierName)throw Error("Укажите поставщика: выберите из списка или введите новое название.");
    const ownership=text(form.get("ownership"));
    if(!["purchase","consignment"].includes(ownership))throw Error("Выберите тип договора.");
    const qty=int(form.get("quantity"),1,1000000,"количество");
    const cost=int(form.get("unit_cost"),0,100000000,"себестоимость");
    const note=text(form.get("note")).trim().slice(0,250);
    const batchName=text(form.get("batch_name")).trim();
    if(!batchName||batchName.length>150)throw Error("Укажите название партии поставщика.");
    // Validate every optional payment and expense BEFORE writing anything.
    const extras=receiptExtras(form);
    const statements=[
      db.prepare("INSERT OR IGNORE INTO finance_suppliers(name) VALUES(?)").bind(supplierName),
      db.prepare("INSERT OR IGNORE INTO finance_batches(supplier_id,name) "+
        "SELECT s.id,? FROM finance_suppliers s WHERE s.name=?")
        .bind(batchName,supplierName),
      db.prepare("INSERT INTO finance_receipts (product_id,product_slug,stock_size,supplier_id,batch_id,ownership,quantity,unit_cost,note) "+
        "SELECT ?,?,?,s.id,b.id,?,?,?,? FROM finance_suppliers s "+
        "JOIN finance_batches b ON b.supplier_id=s.id AND b.name=? WHERE s.name=?")
        .bind(productId,product.slug,size,ownership,qty,cost,note,batchName,supplierName)
    ];
    if(extras.payment>0){
      // Immediately after inserting the receipt, last_insert_rowid() points
      // to THIS receipt, not any other receipt in a same-named supplier batch.
      statements.push(db.prepare(
        "INSERT INTO finance_supplier_payments(receipt_id,amount,note) VALUES(last_insert_rowid(),?,?)"
      ).bind(extras.payment,extras.paymentNote));
    }
    for(const e of extras.expenses){
      statements.push(db.prepare("INSERT INTO finance_expenses(reason,amount) VALUES(?,?)").bind(e.reason,e.amount));
    }
    statements.push(db.prepare(
      "INSERT INTO inventory (product_slug,product_id,size,total_quantity,reserved_quantity) VALUES (?,?,?, ?,0) "+
      "ON CONFLICT(product_slug,size) DO UPDATE SET total_quantity=inventory.total_quantity+excluded.total_quantity,updated_at=CURRENT_TIMESTAMP"
    ).bind(product.slug,productId,size,qty));
    // D1 batch is atomic: a failed payment, expense or stock write rolls back
    // receipt, supplier creation, all other writes as one transaction.
    await db.batch(statements);
    return "Поступление оформлено: +"+qty+" шт. на складе"+
      (extras.payment ? ", поставщику записано "+money(extras.payment) : "")+
      (extras.expenses.length ? ", дополнительных расходов: "+extras.expenses.length : "")+
      ". Товар не публиковался.";
  }
  if(action==="payment"){
    const receiptId=int(form.get("receipt_id"),1,100000000,"партия");
    const exists=await db.prepare("SELECT id FROM finance_receipts WHERE id=? AND is_opening=0").bind(receiptId).first();
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
    return reply(show(data,report,catalogProducts,await csrf(context.request,secret),query.get("notice")||"","",{supplier:query.get("supplier"),batch:query.get("batch")}));
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


// Minimal valid XLSX (OOXML / ZIP stored entries): no third-party packages,
// numeric cells remain numeric and text is always inlineStr (not formulae).
function bytes(...parts) {
  const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));
  let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}
  return out;
}
function two(n){return Uint8Array.of(n&255,(n>>>8)&255);}
function four(n){return Uint8Array.of(n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255);}
function crc32(buf) {
  let c=-1;
  for(const b of buf){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}
  return (c^(-1))>>>0;
}
function zipStore(entries){
  const local=[],central=[];let offset=0;
  for(const [name,content] of entries){
    const filename=encode.encode(name),data=encode.encode(content),crc=crc32(data);
    const header=bytes(four(0x04034b50),two(20),two(0x0800),two(0),two(0),two(0),
      four(crc),four(data.length),four(data.length),two(filename.length),two(0),filename,data);
    local.push(header);
    const directory=bytes(four(0x02014b50),two(20),two(20),two(0x0800),two(0),
      two(0),two(0),four(crc),four(data.length),four(data.length),
      two(filename.length),two(0),two(0),two(0),two(0),four(0),four(offset),filename);
    central.push(directory);offset+=header.length;
  }
  const centralBytes=bytes(...central);
  const end=bytes(four(0x06054b50),two(0),two(0),two(entries.length),two(entries.length),
    four(centralBytes.length),four(offset),two(0));
  return bytes(...local,centralBytes,end);
}
function sheetXml(table){
  const col=n=>{let s="";do{s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)-1;}while(n>=0);return s;};
  const rows=table.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((cell,j)=>{
    const ref=col(j)+(i+1);
    if(typeof cell==="number"&&Number.isFinite(cell))
      return '<c r="'+ref+'"><v>'+cell+'</v></c>';
    return '<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+
      esc(cell)+'</t></is></c>';
  }).join("")+'</row>').join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    '<sheetData>'+rows+'</sheetData></worksheet>';
}
function excelDownload(data,report){
  const tabs=[
    ["Сводка",[["Показатель","Рубли / количество"],
      ["Выручка",report.revenue],["Оплаченные поставщики + расходы",report.spent],
      ["Налог 6% (оценка)",report.tax],["Себестоимость проданного",report.cogs],
      ["Расчётная прибыль",report.profit],["Долг поставщикам",report.supplierLiability],
      ["Стоимость непроданного",report.inventoryCost],
      ["Продано, шт.",report.quantitySold],["Без зарегистрированной себестоимости, шт.",report.unknownQty]]],
    ["Товары",[["Товар","Slug","Цена продажи, ₽","Закупочная цена / шт., ₽","Начальный остаток, шт.","Новые закупки, шт.","Под реализацию, шт.","Продано, шт.","Выручка, ₽","Себестоимость проданного, ₽","Долг поставщикам, ₽","Продано без себестоимости, шт."],
      ...report.productRows.map(p=>[p.title,p.product_slug,Number(p.list_price),p.purchaseUnitCost===null?"":p.purchaseUnitCost,p.openingQty,p.purchased,p.consignment,p.sold,p.revenue,p.cost,p.due,p.missing])]],
    ["Партии",[["Дата","№ записи","Внутренний № партии","Название партии","Товар","Размер / цвет","Поставщик","Договор","Получено","Продано","Остаток","Цена поставщика, ₽","Начислено, ₽","Оплачено, ₽","Долг, ₽"],
      ...report.rows.map(r=>[r.created_at,r.id,r.batch_id||"",r.batch_name||"",r.product_slug,r.stock_size,r.supplier,
        Number(r.is_opening||0)===1?"Начальный остаток":r.ownership==="purchase"?"Выкуп":"Под реализацию",Number(r.quantity),r.qty_sold,
        r.qty_left,Number(r.unit_cost),r.liability,r.paid,r.debt])]],
    ["Продажи",[["Дата","Номер заказа","Товар","Цвет / размер","Количество","Цена продажи, ₽","Выручка, ₽"],
      ...data.sales.map(r=>[r.updated_at,r.order_id,r.product_slug,r.size,Number(r.quantity),
        Number(r.unit_price),Number(r.quantity)*Number(r.unit_price)])]],
    ["Платежи",[["Дата","№ платежа","№ партии","Сумма, ₽","Комментарий"],
      ...data.payments.map(p=>[p.created_at,p.id,p.receipt_id,Number(p.amount),p.note])]],
    ["Расходы",[["Дата","№","Назначение","Сумма, ₽"],
      ...data.expenses.map(e=>[e.created_at,e.id,e.reason,Number(e.amount)])]]
  ];
  const xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const mainNs='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const officeNs='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const packageNs='http://schemas.openxmlformats.org/package/2006/relationships';
  const book=xml+'<workbook xmlns="'+mainNs+'" xmlns:r="'+officeNs+'"><sheets>'+
    tabs.map((t,i)=>'<sheet name="'+esc(t[0])+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join("")+
    '</sheets></workbook>';
  const contentTypes=xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
    tabs.map((t,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("")+
    '</Types>';
  const workbookRels=xml+'<Relationships xmlns="'+packageNs+'">'+
    tabs.map((t,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+officeNs+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join("")+
    '</Relationships>';
  const rootRels=xml+'<Relationships xmlns="'+packageNs+'"><Relationship Id="rId1" Type="'+
    officeNs+'/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const archive=zipStore([["[Content_Types].xml",contentTypes],["_rels/.rels",rootRels],
    ["xl/workbook.xml",book],["xl/_rels/workbook.xml.rels",workbookRels],
    ...tabs.map((tab,i)=>["xl/worksheets/sheet"+(i+1)+".xml",sheetXml(tab[1])])]);
  const date=new Date().toISOString().slice(0,10);
  return new Response(archive,{status:200,headers:{
    "Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition":'attachment; filename="five-oceans-finance-'+date+'.xlsx"',
    "Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff"
  }});
}
