"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {spawnSync}=require("node:child_process");
const catalog=JSON.parse(fs.readFileSync("data/products.json","utf8"));
const old=catalog.find(p=>p.slug==="futbolka-ne-kak-vse");
const source=fs.readFileSync("functions/finance.js","utf8");
let mod;
function api(){
  return mod||(mod=import("data:text/javascript;base64,"+Buffer.from(
    source+"\nexport { perform, receiptExtras, settleExisting, show, calculate };\n"
  ).toString("base64")));
}
function fixture(){
  const writes=[];
  const db={
    prepare(sql) {
      const entry={sql,params:[]};
      return {
        bind(...args){entry.params=args;return this;},
        get sql(){return sql;},
        get params(){return entry.params;},
        async first(){
          if(sql.includes("FROM finance_products WHERE product_id"))
            return {ok:1};
          if(sql.includes("FROM inventory_exclusions"))
            return null;
          if(sql.includes("FROM finance_receipts WHERE id"))
            return {id:Number(entry.params[0])};
          throw Error("Unexpected first: "+sql);
        },
        async all(){
          if(sql.includes("FROM finance_suppliers"))
            return {results:[{name:"Неизвестный поставщик"}]};
          throw Error("Unexpected all: "+sql);
        }
      };
    },
    async batch(stmts){
      for(const stmt of stmts)writes.push({sql:stmt.sql,params:stmt.params});
      return stmts.map(()=>({meta:{changes:1}}));
    }
  };
  const context={env:{DB:db,ASSETS:{fetch:async()=>new Response(JSON.stringify(catalog),{status:200})}},
    request:{url:"https://example.pages.dev/finance"}};
  return {db,context,writes};
}
function receiptForm(){
  const form=new FormData();
  const data={action:"receipt",operation_mode:"receipt",
    sku:JSON.stringify([old.product_id,"v:red|46-48"]),
    supplier_name:"Фабрика Тест",batch_name:"Партия № 1",
    ownership:"purchase",quantity:"5",unit_cost:"1400",note:"Новая поставка"};
  for(const [k,v] of Object.entries(data))form.set(k,v);
  return form;
}
test("single operation form has no separate payment or expense submit buttons",async()=>{
  const {show,calculate}=await api();
  const products=catalog.map(p=>({product_id:p.product_id,product_slug:p.slug,title:p.title,list_price:p.price}));
  const data={products,suppliers:[{id:1,name:"Неизвестный поставщик"}],receipts:[],payments:[],
    expenses:[],sales:[],batches:[],opening:{snapshot_at:"2026-10-23",stock_lines:0}};
  const html=show(data,calculate(data),catalog,"csrf","","");
  const start=html.indexOf("<h2>Добавить операцию</h2>");
  const end=html.indexOf("<h2>Поступления и расчёты</h2>");
  const section=html.slice(start,end);
  assert.equal((section.match(/<form\b/g)||[]).length,1);
  assert.equal((section.match(/type="submit"/g)||[]).length,1);
  assert.match(section,/Подтвердить операцию/);
  assert.match(section,/name="payment_amount"/);
  assert.match(section,/name="expense_reason"/);
  assert.match(section,/name="expense_amount"/);
  assert.match(section,/id="finance-operation-mode"/);
  assert.match(section,/id="finance-existing-receipt"/);
  assert.doesNotMatch(section,/name="action" value="payment"/);
  assert.doesNotMatch(section,/name="action" value="expense"/);
});

test("new receipt plus actual payment and two expenses use one D1 atomic batch",async()=>{
  const {perform}=await api();
  const {context,writes}=fixture();
  const form=receiptForm();
  form.set("payment_amount","3000");
  form.set("payment_note","Частичная оплата");
  form.append("expense_reason","Доставка");
  form.append("expense_amount","250");
  form.append("expense_reason","Упаковка");
  form.append("expense_amount","120");
  const message=await perform(context,form);
  assert.match(message,/\\+5 шт\. на складе/);
  assert.match(message,/дополнительных расходов: 2/);
  assert.equal(writes.length,7);
  assert.match(writes[0].sql,/finance_suppliers/);
  assert.match(writes[1].sql,/finance_batches/);
  assert.match(writes[2].sql,/INSERT INTO finance_receipts/);
  assert.match(writes[3].sql,/INSERT INTO finance_supplier_payments/);
  assert.match(writes[3].sql,/last_insert_rowid\(\)/);
  assert.deepEqual(writes[3].params,[3000,"Частичная оплата"]);
  assert.match(writes[4].sql,/finance_expenses/);
  assert.match(writes[5].sql,/finance_expenses/);
  assert.match(writes[6].sql,/INSERT INTO inventory/);
});

test("deferred settlement runs in same form without adding inventory",async()=>{
  const {perform}=await api();
  const {context,writes}=fixture();
  const form=new FormData();
  form.set("action","receipt");
  form.set("operation_mode","settlement");
  form.set("receipt_id","8");
  form.set("payment_amount","900");
  form.set("payment_note","Доплата");
  form.append("expense_reason","Доставка");
  form.append("expense_amount","100");
  const message=await perform(context,form);
  assert.match(message,/Склад не менялся/);
  assert.equal(writes.length,2);
  assert.match(writes[0].sql,/finance_supplier_payments/);
  assert.deepEqual(writes[0].params,[8,900,"Доплата"]);
  assert.match(writes[1].sql,/finance_expenses/);
  assert.ok(writes.every(w=>!/\b(?:INSERT|UPDATE)\s+(?:INTO\s+)?inventory\b/.test(w.sql)));
});

test("empty optional fields write only supplier, batch, receipt, inventory",async()=>{
  const {perform}=await api();
  const {context,writes}=fixture();
  const form=receiptForm();
  form.append("expense_reason","");
  form.append("expense_amount","");
  await perform(context,form);
  assert.equal(writes.length,4);
  assert.ok(!writes.some(w=>/finance_supplier_payments|finance_expenses/.test(w.sql)));
});

test("invalid payment or incomplete expense reject before ANY writes",async()=>{
  const {perform}=await api();
  for(const [k,v] of [["payment_amount","-1"],["expense_reason","Доставка"]]){
    const {context,writes}=fixture();
    const f=receiptForm();f.set(k,v);
    await assert.rejects(perform(context,f));
    assert.equal(writes.length,0,k);
  }
  const {context,writes}=fixture();
  const form=receiptForm();
  for(let i=0;i<11;i++){form.append("expense_reason","X");form.append("expense_amount","1");}
  await assert.rejects(perform(context,form),/максимум 10/);
  assert.equal(writes.length,0);
});

test("SQLite links immediate payment to exactly the new receipt and rolls back on any expense failure",async()=>{
  const {perform}=await api();
  const f=receiptForm();f.set("payment_amount","3000");
  f.append("expense_reason","Доставка");f.append("expense_amount","250");
  const sim=fixture();await perform(sim.context,f);
  const input={
    base:fs.readFileSync("migrations/2026-10-23-finance-mvp.sql","utf8"),
    mig:fs.readFileSync("migrations/2026-10-23-finance-opening-batches.sql","utf8"),
    commands:sim.writes,
    productId:old.product_id,
    slug:old.slug
  };
  const py=[
    "import sqlite3,json,sys",
    "d=json.load(sys.stdin)",
    "db=sqlite3.connect(':memory:')",
    "db.execute('PRAGMA foreign_keys=ON')",
    "db.executescript(d['base'])",
    "db.executescript(d['mig'])",
    "db.executescript('CREATE TABLE inventory(product_slug TEXT NOT NULL,product_id TEXT NOT NULL,size TEXT NOT NULL,total_quantity INTEGER NOT NULL,reserved_quantity INTEGER NOT NULL,updated_at TEXT,PRIMARY KEY(product_slug,size));CREATE TABLE inventory_exclusions(product_slug TEXT,size TEXT);')",
    "db.execute('INSERT INTO finance_products(product_id,product_slug,title,list_price) VALUES(?,?,?,1900)',(d['productId'],d['slug'],'Футболка'))",
    "db.execute(\"INSERT INTO finance_suppliers(name) VALUES('Первый поставщик')\")",
    "db.execute(\"INSERT INTO finance_batches(supplier_id,name) VALUES(1,'Партия № 1')\")",
    "db.execute('INSERT INTO finance_receipts(product_id,product_slug,stock_size,supplier_id,batch_id,ownership,quantity,unit_cost) VALUES(?,?,?,?,?,?,?,?)',(d['productId'],d['slug'],'v:red|46-48',1,1,'purchase',1,1000))",
    "db.commit()",
    "db.execute('BEGIN')",
    "for x in d['commands']:db.execute(x['sql'],x['params'])",
    "db.commit()",
    "r=db.execute('SELECT id,supplier_id,quantity FROM finance_receipts ORDER BY id').fetchall()",
    "pay=db.execute('SELECT receipt_id,amount FROM finance_supplier_payments').fetchall()",
    "cost=db.execute('SELECT reason,amount FROM finance_expenses').fetchall()",
    "qty=db.execute('SELECT total_quantity FROM inventory').fetchone()[0]",
    "assert len(r)==2 and r[1][2]==5,r",
    "assert pay==[(r[1][0],3000)],(pay,r)",
    "assert cost==[('Доставка',250)],cost",
    "assert qty==5,qty",
    "db.execute(\"CREATE TRIGGER reject_delivery BEFORE INSERT ON finance_expenses BEGIN SELECT RAISE(ABORT,'expense failure'); END\")",
    "db.commit()",
    "try:",
    "  db.execute('BEGIN')",
    "  for x in d['commands']:db.execute(x['sql'],x['params'])",
    "  db.commit()",
    "  raise AssertionError('failure should abort receipt')",
    "except sqlite3.IntegrityError:",
    "  db.rollback()",
    "assert db.execute('SELECT COUNT(*) FROM finance_receipts').fetchone()[0]==2",
    "assert db.execute('SELECT COUNT(*) FROM finance_supplier_payments').fetchone()[0]==1",
    "assert db.execute('SELECT total_quantity FROM inventory').fetchone()[0]==5",
    "print('OK - payment linked to new receipt, optional expenses atomic, failure rolled back')"
  ].join("\n");
  const r=spawnSync("python3",["-c",py],{input:JSON.stringify(input),encoding:"utf8"});
  assert.equal(r.status,0,r.stderr||r.stdout);
  assert.match(r.stdout,/OK - payment linked/);
});
