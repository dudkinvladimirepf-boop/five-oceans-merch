"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {spawnSync}=require("node:child_process");
const productList=JSON.parse(fs.readFileSync("data/products.json","utf8"));
const old=productList.find(p=>p.slug==="futbolka-ne-kak-vse");
const official=productList.map(p=>({product_id:p.product_id,product_slug:p.slug,title:p.title,list_price:p.price}));
const src=fs.readFileSync("functions/finance.js","utf8");
let mod;
const api=()=>mod||(mod=import("data:text/javascript;base64,"+Buffer.from(src+"\nexport { receiptCatalogChoices, resolveSupplierName, perform, show, calculate };\n").toString("base64")));

function mockContext(finance=official){
  const queries=[];
  const db={
    prepare(sql){
      const stmt={sql,args:[]};
      return {
        bind(...args){stmt.args=args;return this;},
        async first(){
          if(sql.includes("FROM finance_products WHERE product_id"))return finance.some(p=>p.product_id===stmt.args[0]&&p.product_slug===stmt.args[1])?{ok:1}:null;
          if(sql.includes("FROM inventory_exclusions"))return null;
          throw Error("Unexpected .first: "+sql);
        },
        async all(){
          if(sql.includes("FROM finance_suppliers"))return {results:[{name:"Неизвестный поставщик"}]};
          throw Error("Unexpected .all: "+sql);
        }
      };
    },
    async batch(stmts){
      for(const stmt of stmts)queries.push([stmt.sql,stmt.args]);
      return stmts.map(()=>({success:true,meta:{changes:1}}));
    }
  };
  return {
    queries, db,
    context:{env:{DB:db,ASSETS:{fetch:async()=>new Response(JSON.stringify(productList),{status:200})}},
      request:{url:"https://example.pages.dev/finance"}}
  };
}
function submit(sku,supplierName){
  const form=new FormData();
  const values={action:"receipt",sku,supplier_name:supplierName,batch_name:"Партия № 1",ownership:"purchase",
    quantity:"5",unit_cost:"1400",note:""};
  for(const [name,value] of Object.entries(values))form.set(name,value);
  return form;
}

test("all nine existing financial catalog products appear even with finance_enabled false",async()=>{
  const {receiptCatalogChoices,show,calculate}=await api();
  const all=receiptCatalogChoices(productList,official);
  assert.equal(new Set(all.map(x=>JSON.parse(x.value)[0])).size,9);
  assert.ok(all.some(o=>o.label.includes("Не как все")&&o.label.includes("46-48")));
  assert.ok(all.some(o=>o.label.includes("Полосатка")));
  const data={products:official,suppliers:[{id:1,name:"Неизвестный поставщик"}],
    receipts:[],payments:[],expenses:[],sales:[],batches:[],opening:{snapshot_at:"today",stock_lines:0}};
  const html=show(data,calculate(data),productList,"csrf","","");
  assert.match(html,/id="receipt-sku-select"/);
  assert.match(html,/Футболка «Не как все»/);
  assert.match(html,/id="receipt-supplier-input"/);
  assert.doesNotMatch(html,/<h3>Поставщик<\/h3>/);
  assert.match(html,/name="supplier_name"/);
  assert.doesNotMatch(html,/name="action" value="supplier"/);
});

test("new unsynchronized product cannot be received; becomes a choice after finance registration",async()=>{
  const {receiptCatalogChoices}=await api();
  const newcomer={...old,product_id:"new-id-unique",slug:"new-black-tshirt",title:"Футболка «Не как все» чёрная",
    variants:[{code:"black",label:"Чёрный",sizes:["46-48"]}],finance_enabled:true};
  const menu=receiptCatalogChoices([...productList,newcomer],official);
  assert.equal(menu.some(p=>p.label.includes("чёрная")),false);
  const after=receiptCatalogChoices([...productList,newcomer],
    [...official,{product_id:newcomer.product_id,product_slug:newcomer.slug}]);
  assert.ok(after.some(p=>p.label.includes("чёрная")));
});

test("manual supplier matches existing case-insensitively or registers a new name",async()=>{
  const {resolveSupplierName}=await api();
  const {db}=mockContext();
  assert.equal(await resolveSupplierName(db,"неизвестный ПОСТАВЩИК",null),"Неизвестный поставщик");
  assert.equal(await resolveSupplierName(db,"Фабрика  Тест",null),"Фабрика  Тест");
  await assert.rejects(resolveSupplierName(db," ",null),/Введите корректное название/);
});

test("search suggests Russian goods with Latin NE and matches multiword inputs",()=>{
  const {normalize,resultsFor}=require("./finance-forms.js");
  assert.equal(normalize("Не как все"),"ne kak vse");
  const options=[
    {label:"Футболка «Не как все» — Черный / 46-48",key:normalize("Футболка «Не как все» — Черный / 46-48")},
    {label:"Футболка «Океан» — Красный / 52-54",key:normalize("Футболка «Океан» — Красный / 52-54")}
  ];
  assert.equal(resultsFor(options,"NE kak").length,1);
  assert.equal(resultsFor(options,"футболка ne").length,1);
  assert.equal(resultsFor(options,"океан").length,1);
});

test("existing product receipt accepts new supplier and does not touch Pages catalog",async()=>{
  const {perform}=await api();
  const sim=mockContext();
  const size="v:red|46-48";
  const message=await perform(sim.context,submit(JSON.stringify([old.product_id,size]),"Новая фабрика"));
  assert.match(message,/Остаток увеличен на 5/);
  assert.equal(sim.queries.length,4);
  assert.match(sim.queries[0][0],/INSERT OR IGNORE INTO finance_suppliers/);
  assert.deepEqual(sim.queries[0][1],["Новая фабрика"]);
  assert.match(sim.queries[1][0],/INSERT OR IGNORE INTO finance_batches/);
  assert.match(sim.queries[2][0],/INSERT INTO finance_receipts/);
  assert.match(sim.queries[3][0],/INSERT INTO inventory/);
  assert.equal(sim.queries.some(([sql])=>/UPDATE\s+finance_products/i.test(sql)),false);
});

test("SQLite new supplier creation is atomic with receipt and stock; repeated parties remain supplier scoped",async()=>{
  const {perform}=await api();
  const sim=mockContext();
  const size="v:red|46-48";
  await perform(sim.context,submit(JSON.stringify([old.product_id,size]),"Фабрика Тест"));
  const oldSupplier=mockContext();
  await perform(oldSupplier.context,submit(JSON.stringify([old.product_id,size]),"Неизвестный поставщик"));
  const sqls=[...sim.queries,...oldSupplier.queries];
  const python=[
    "import json,sqlite3,sys",
    "data=json.load(sys.stdin)",
    "db=sqlite3.connect(':memory:')",
    "db.execute('PRAGMA foreign_keys=ON')",
    "db.executescript(data['base'])",
    "db.executescript(data['migration'])",
    "db.executescript('CREATE TABLE inventory(product_slug TEXT NOT NULL,product_id TEXT NOT NULL,size TEXT NOT NULL,total_quantity INTEGER NOT NULL,reserved_quantity INTEGER NOT NULL, updated_at TEXT,PRIMARY KEY(product_slug,size)); CREATE TABLE inventory_exclusions(product_slug TEXT,size TEXT);')",
    "db.execute('INSERT INTO finance_products(product_id,product_slug,title,list_price) VALUES (?,?,?,1900)',(data['id'],data['slug'],'Test'))",
    "db.execute(\"INSERT INTO finance_suppliers(name) VALUES ('Неизвестный поставщик')\")",
    "db.commit()",
    "for sql,params in data['queries']:",
    "    db.execute(sql,params)",
    "db.commit()",
    "supplier_count=db.execute('SELECT COUNT(*) FROM finance_suppliers').fetchone()[0]",
    "lots=db.execute('SELECT COUNT(*),COUNT(DISTINCT supplier_id),COUNT(DISTINCT batch_id) FROM finance_receipts').fetchone()",
    "quantity=db.execute('SELECT total_quantity FROM inventory').fetchone()[0]",
    "assert supplier_count==2,supplier_count",
    "assert lots==(2,2,2),lots",
    "assert quantity==10,quantity",
    "print('SQLite OK - created supplier, grouped batch by supplier, wrote both receipts and warehouse')"
  ].join("\n");
  const run=spawnSync("python3",["-c",python],{
    input:JSON.stringify({
      base:fs.readFileSync("migrations/2026-10-23-finance-mvp.sql","utf8"),
      migration:fs.readFileSync("migrations/2026-10-23-finance-opening-batches.sql","utf8"),
      id:old.product_id,slug:old.slug,queries:sqls
    }),encoding:"utf8"});
  assert.equal(run.status,0,run.stderr||run.stdout);
  assert.match(run.stdout,/SQLite OK/);
});
