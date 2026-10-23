"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const script=fs.readFileSync("functions/finance.js","utf8");
const catalog=JSON.parse(fs.readFileSync("data/products.json","utf8"));
let promise;
function load(){
  if(!promise)promise=import("data:text/javascript;base64,"+Buffer.from(
    script+"\nexport { calculate, reconcileOpeningCosts, LEGACY_UNIT_COSTS, excelDownload };\n"
  ).toString("base64"));
  return promise;
}
const hoodie=catalog.find(p=>p.slug==="hudi-klub-5-okeanov");
const sweatshirt=catalog.find(p=>p.slug==="svitshot-klub-5-okeanov");
const hat=catalog.find(p=>p.slug==="shapka-polosatka");

test("legacy reference costs are bound to product IDs, including no-stock hat",async()=>{
  const {calculate,LEGACY_UNIT_COSTS}=await load();
  assert.equal(LEGACY_UNIT_COSTS.get(sweatshirt.product_id),2175);
  assert.equal(LEGACY_UNIT_COSTS.get(hoodie.product_id),2950);
  assert.equal(LEGACY_UNIT_COSTS.get(hat.product_id),700);
  const result=calculate({products:[
    {product_id:hat.product_id,product_slug:hat.slug,title:hat.title,list_price:1100},
    {product_id:sweatshirt.product_id,product_slug:sweatshirt.slug,title:sweatshirt.title,list_price:2600}
  ],receipts:[],suppliers:[],payments:[],expenses:[],sales:[]});
  assert.equal(result.productRows[0].purchaseUnitCost,700);
  assert.equal(result.productRows[1].purchaseUnitCost,2175);
  assert.equal(result.supplierLiability,0);
  assert.equal(result.inventoryCost,0);
  assert.equal(result.profit,0);
});

test("separates initial quantities from new purchases; uses weighted real cost",async()=>{
  const {calculate}=await load();
  const stockSize="v:red|46-48";
  const report=calculate({products:[{product_id:sweatshirt.product_id,product_slug:sweatshirt.slug,title:sweatshirt.title}],
    receipts:[
      {id:1,product_slug:sweatshirt.slug,stock_size:stockSize,quantity:4,unit_cost:2175,is_opening:1,ownership:"purchase"},
      {id:2,product_slug:sweatshirt.slug,stock_size:stockSize,quantity:2,unit_cost:2400,is_opening:0,ownership:"purchase"}
    ],
    payments:[],expenses:[],sales:[]});
  const p=report.productRows[0];
  assert.equal(p.openingQty,4);
  assert.equal(p.purchased,2);
  assert.equal(p.purchaseUnitCost,(2175*4+2400*2)/6);
  assert.equal(report.supplierLiability,4800);
  assert.equal(report.inventoryCost,13500);
});

test("safe reconciliation SQL alters only historical receipts and can be repeated",async()=>{
  const {reconcileOpeningCosts}=await load();
  const calls=[];
  const mock={
    prepare(sql){const stmt={sql,values:[]};
      return {
        bind(...values){stmt.values=values;return this;},
        async first(){assert.match(sql,/finance_opening_state/);return {id:"legacy-v1"};},
        async run(){calls.push(stmt);return {meta:{changes:1}};}
      };
    }
  };
  const message=await reconcileOpeningCosts(mock);
  assert.match(message,/обновлено 1/);
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/r\.is_opening=1/);
  assert.ok(!/UPDATE\s+inventory/i.test(calls[0].sql));
  const params=JSON.parse(calls[0].values[0]);
  const prices=new Map(params);
  assert.equal(prices.get(sweatshirt.product_id),2175);
  assert.equal(prices.get(hat.product_id),700);
  const sql=fs.readFileSync("migrations/2026-10-23-finance-mvp.sql","utf8");
  const migration=fs.readFileSync("migrations/2026-10-23-finance-opening-batches.sql","utf8");
  const py=[
    "import json, sqlite3, sys",
    "p=json.load(sys.stdin)",
    "db=sqlite3.connect(':memory:')",
    "db.execute('PRAGMA foreign_keys=ON')",
    "db.executescript(p['base'])",
    "db.executescript(p['migration'])",
    "db.execute(\"INSERT INTO finance_products(product_id,product_slug,title,list_price) VALUES (?,?,?,?)\",(p['sweater'],'sweatshirt','Свитшот',2600))",
    "db.execute(\"INSERT INTO finance_products(product_id,product_slug,title,list_price) VALUES (?,?,?,?)\",(p['hat'],'hat','Шапка',1100))",
    "db.execute(\"INSERT INTO finance_suppliers(name) VALUES ('Неизвестный поставщик')\")",
    "db.execute(\"INSERT INTO finance_batches(supplier_id,name) VALUES (1,'Начальная партия № 1')\")",
    "db.execute(\"INSERT INTO finance_opening_state(id,stock_lines) VALUES('legacy-v1',2)\")",
    "rows=[(p['sweater'],'sweatshirt','v:red|46-48',1,1,'purchase',4,2285,1),(p['hat'],'hat','v:navy-white|Без размера',1,1,'purchase',2,700,1),(p['sweater'],'sweatshirt','v:white|50-52',1,1,'purchase',3,2400,0)]",
    "db.executemany('INSERT INTO finance_receipts(product_id,product_slug,stock_size,supplier_id,batch_id,ownership,quantity,unit_cost,is_opening) VALUES (?,?,?,?,?,?,?,?,?)',rows)",
    "db.commit()",
    "db.execute(p['sql'],(json.dumps(p['prices']),))",
    "db.commit()",
    "costs=db.execute('SELECT unit_cost FROM finance_receipts ORDER BY id').fetchall()",
    "assert costs==[(2175,),(700,),(2400,)],costs",
    "db.execute(p['sql'],(json.dumps(p['prices']),))",
    "db.commit()",
    "assert db.execute('SELECT unit_cost FROM finance_receipts ORDER BY id').fetchall()==costs",
    "assert db.execute('SELECT quantity FROM finance_receipts ORDER BY id').fetchall()==[(4,),(2,),(3,)]",
    "print('SQLite correction passed')"
  ].join("\n");
  const run=spawnSync("python3",["-c",py],{
    input:JSON.stringify({base:sql,migration,sql:calls[0].sql,prices:params,sweater:sweatshirt.product_id,hat:hat.product_id}),
    encoding:"utf8"
  });
  assert.equal(run.status,0,run.stderr||run.stdout);
  assert.match(run.stdout,/SQLite correction passed/);
});

test("reconciliation cannot run before opening migration",async()=>{
  const {reconcileOpeningCosts}=await load();
  await assert.rejects(reconcileOpeningCosts({
    prepare(){return {async first(){return null;}};}
  }),/ещё не выполнялся/);
});
