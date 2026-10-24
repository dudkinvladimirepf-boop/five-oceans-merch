"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {spawnSync}=require("node:child_process");

const financeCode=fs.readFileSync("functions/finance.js","utf8");
let mod;
const api=()=>mod||(mod=import("data:text/javascript;base64,"+Buffer.from(
  financeCode+"\nexport { TEST_CRM, testCleanupSnapshot, testCleanupValidate, testCleanupDelete, showTestCleanup };\n"
).toString("base64")));
const id="b3ec1243-b170-4d8c-94b6-2a7feef4b9fe",slug="test_crm";
const oldId="1cab5aa8-9717-4756-88e7-317ba95dc9be";

function fixtures(){
  return {
    finance_products:[{product_id:id,product_slug:slug,title:"ТЕСТ CRM — удалить после проверки",list_price:100}],
    finance_receipts:[{id:9,product_id:id,product_slug:slug,stock_size:"v:black|Без размера",supplier_id:22,batch_id:12,quantity:2,is_opening:0}],
    finance_supplier_payments:[{id:7,receipt_id:9,amount:80,note:""}],
    orders:[{order_id:"FO-TEST-1",status:"sold",checkout_key:"abc"}],
    order_items:[{order_id:"FO-TEST-1",product_id:id,product_slug:slug,quantity:1,unit_price:100}],
    inventory:[{product_slug:slug,product_id:id,size:"v:black|Без размера",total_quantity:1,reserved_quantity:0}],
    inventory_exclusions:[],
    finance_batches:[{id:12,supplier_id:22,name:"Партия № 1"}],
    finance_suppliers:[{id:22,name:"Тестовый поставщик"}]
  };
}
function mockDB(source=fixtures()){
  const queries=[];
  const db={
    prepare(sql){
      return {
        sql,args:[],
        bind(...args){this.args=args;return this;},
        async all(){
          let key;
          if(sql.includes("SELECT * FROM finance_products"))key="finance_products";
          else if(sql.includes("SELECT * FROM finance_receipts"))key="finance_receipts";
          else if(sql.includes("SELECT o.* FROM orders"))key="orders";
          else if(sql.includes("SELECT * FROM order_items"))key="order_items";
          else if(sql.includes("SELECT * FROM inventory_exclusions"))key="inventory_exclusions";
          else if(sql.includes("SELECT * FROM inventory"))key="inventory";
          else if(sql.includes("SELECT pay.* FROM finance_supplier_payments"))key="finance_supplier_payments";
          else if(sql.includes("SELECT * FROM finance_batches"))key="finance_batches";
          else if(sql.includes("SELECT * FROM finance_suppliers"))key="finance_suppliers";
          else throw Error("Unexpected SELECT "+sql);
          return {results:source[key]};
        }
      };
    },
    async batch(items){
      for(const st of items)queries.push({sql:st.sql,args:st.args});
      return [];
    }
  };
  return {db,queries};
}
function form(){
  const f=new FormData();
  f.set("test_cleanup_confirmation","УДАЛИТЬ ТЕСТ CRM");
  f.set("test_cleanup_backup_confirm","yes");
  return f;
}

test("repository removes only the known test product and stock sync form",()=>{
  const products=JSON.parse(fs.readFileSync("data/products.json","utf8"));
  assert.ok(products.length>=9,"new legitimate catalog items should be kept");
  assert.ok(!products.some(p=>p.product_id===id||p.slug===slug));
  const developers=fs.readFileSync("functions/developers.js","utf8");
  assert.ok(!developers.includes('↻ Синхронизировать с Pages CMS'));
  assert.ok(developers.includes('case "sync":')); // backend logic is retained
});

test("protected preview identifies matching records and excludes unrelated stock and orders",async()=>{
  const {testCleanupSnapshot,testCleanupValidate,showTestCleanup}=await api();
  const {db}=mockDB();
  const snapshot=await testCleanupSnapshot(db);
  assert.equal(snapshot.identity.id,id);
  assert.equal(snapshot.orders.length,1);
  assert.equal(snapshot.inventory[0].total_quantity,1);
  assert.equal(testCleanupValidate(snapshot),1);
  const html=showTestCleanup(snapshot,"nonce");
  assert.match(html,/FO-TEST-1/);
  assert.match(html,/test-crm-backup.json|test-cleanup-json/);
  assert.match(html,/УДАЛИТЬ ТЕСТ CRM/);
  assert.match(html,/name="test_cleanup_backup_confirm"/);
});

test("cleanup refuses reserved orders, unmatched products and mixed-item orders",async()=>{
  const {testCleanupValidate}=await api();
  const reserved=fixtures();reserved.orders[0].status="reserved";
  assert.throws(()=>testCleanupValidate(reserved),/активном резерве/);
  const mixed=fixtures();
  mixed.order_items.push({order_id:"FO-TEST-1",product_id:oldId,product_slug:"futbolka-ne-kak-vse",quantity:1});
  assert.throws(()=>testCleanupValidate(mixed),/другим товаром/);
  const wrong=fixtures();wrong.inventory[0].reserved_quantity=1;
  assert.throws(()=>testCleanupValidate(wrong),/резерв/);
});

test("cleanup refuses missing backup confirmation before any database writes",async()=>{
  const {testCleanupDelete}=await api();
  const {db,queries}=mockDB();
  await assert.rejects(testCleanupDelete(db,new FormData()),/резервной копии/);
  assert.equal(queries.length,0);
});

test("cleanup deletes exactly the test product, receipts, payments and orders with SQLite foreign keys",async()=>{
  const {testCleanupDelete}=await api();
  const {db,queries}=mockDB();
  const message=await testCleanupDelete(db,form());
  assert.match(message,/Тест CRM очищен/);
  assert.equal(queries.length,9);
  assert.ok(queries.some(q=>/DELETE FROM finance_supplier_payments/.test(q.sql)));
  assert.ok(queries.some(q=>/DELETE FROM order_items/.test(q.sql)));
  assert.ok(queries.some(q=>/DELETE FROM inventory/.test(q.sql)));
  assert.ok(!queries.some(q=>/DELETE FROM finance_expenses/.test(q.sql)));
  const base=fs.readFileSync("migrations/2026-10-23-finance-mvp.sql","utf8");
  const mig=fs.readFileSync("migrations/2026-10-23-finance-opening-batches.sql","utf8");
  const py=[
    "import json,sqlite3,sys",
    "p=json.load(sys.stdin)",
    "db=sqlite3.connect(':memory:')",
    "db.execute('PRAGMA foreign_keys=ON')",
    "db.executescript(p['base']);db.executescript(p['mig'])",
    "db.executescript('CREATE TABLE inventory (product_slug TEXT NOT NULL,product_id TEXT NOT NULL,size TEXT NOT NULL,total_quantity INTEGER NOT NULL,reserved_quantity INTEGER NOT NULL,PRIMARY KEY(product_slug,size));CREATE TABLE inventory_exclusions(product_slug TEXT,size TEXT,product_id TEXT); CREATE TABLE orders(order_id TEXT PRIMARY KEY,status TEXT);CREATE TABLE order_items(order_id TEXT, product_slug TEXT,product_id TEXT,quantity INTEGER,FOREIGN KEY(order_id) REFERENCES orders(order_id));')",
    "db.execute('INSERT INTO finance_products(product_id,product_slug,title,list_price) VALUES(?,?,?,100)',(p['id'],p['slug'],'TEST'))",
    "db.execute('INSERT INTO finance_products(product_id,product_slug,title,list_price) VALUES(?,?,?,100)',(p['old_id'],'futbolka-ne-kak-vse','REAL'))",
    "db.execute(\"INSERT INTO finance_suppliers(id,name) VALUES(22,'Тестовый поставщик')\")",
    "db.execute(\"INSERT INTO finance_suppliers(id,name) VALUES(23,'Основной поставщик')\")",
    "db.execute(\"INSERT INTO finance_batches(id,supplier_id,name) VALUES(12,22,'Партия № 1')\")",
    "db.execute(\"INSERT INTO finance_batches(id,supplier_id,name) VALUES(13,23,'Партия № 1')\")",
    "db.execute('INSERT INTO finance_receipts(id,product_id,product_slug,stock_size,supplier_id,batch_id,ownership,quantity,unit_cost) VALUES(9,?,?,?,?,?,?,2,40)',(p['id'],p['slug'],'v:black|Без размера',22,12,'purchase'))",
    "db.execute('INSERT INTO finance_receipts(id,product_id,product_slug,stock_size,supplier_id,batch_id,ownership,quantity,unit_cost) VALUES(10,?,?,?,?,?,?,3,1200)',(p['old_id'],'futbolka-ne-kak-vse','v:red|46-48',23,13,'purchase'))",
    "db.execute('INSERT INTO finance_supplier_payments(id,receipt_id,amount) VALUES(7,9,80)')",
    "db.execute(\"INSERT INTO orders(order_id,status) VALUES('FO-TEST-1','sold')\")",
    "db.execute(\"INSERT INTO orders(order_id,status) VALUES('FO-REAL-1','sold')\")",
    "db.execute('INSERT INTO order_items(order_id,product_slug,product_id,quantity) VALUES(?,?,?,1)',('FO-TEST-1',p['slug'],p['id']))",
    "db.execute('INSERT INTO order_items(order_id,product_slug,product_id,quantity) VALUES(?,?,?,1)',('FO-REAL-1','futbolka-ne-kak-vse',p['old_id']))",
    "db.execute('INSERT INTO inventory(product_slug,product_id,size,total_quantity,reserved_quantity) VALUES(?,?,?,1,0)',(p['slug'],p['id'],'v:black|Без размера'))",
    "db.execute('INSERT INTO inventory(product_slug,product_id,size,total_quantity,reserved_quantity) VALUES(?,?,?,5,0)',('futbolka-ne-kak-vse',p['old_id'],'v:red|46-48'))",
    "db.execute(\"INSERT INTO finance_expenses(reason,amount) VALUES('Упаковка',20)\")",
    "db.commit()",
    "db.execute('BEGIN')",
    "for stmt in p['commands']: db.execute(stmt['sql'],stmt['args'])",
    "db.commit()",
    "assert db.execute(\"SELECT COUNT(*) FROM finance_products WHERE product_slug='test_crm'\").fetchone()[0]==0",
    "assert db.execute(\"SELECT COUNT(*) FROM finance_products WHERE product_slug='futbolka-ne-kak-vse'\").fetchone()[0]==1",
    "assert db.execute(\"SELECT COUNT(*) FROM finance_supplier_payments\").fetchone()[0]==0",
    "assert db.execute(\"SELECT COUNT(*) FROM finance_receipts\").fetchone()[0]==1",
    "assert db.execute(\"SELECT COUNT(*) FROM inventory\").fetchone()[0]==1",
    "assert db.execute(\"SELECT COUNT(*) FROM order_items\").fetchone()[0]==1",
    "assert db.execute(\"SELECT COUNT(*) FROM orders\").fetchone()[0]==1",
    "assert db.execute(\"SELECT COUNT(*) FROM finance_expenses\").fetchone()[0]==1",
    "assert db.execute(\"SELECT COUNT(*) FROM finance_batches\").fetchone()[0]==1",
    "assert db.execute(\"SELECT COUNT(*) FROM finance_suppliers\").fetchone()[0]==1",
    "print('SQLite OK: only test records removed, real records retained')"
  ].join("\n");
  const run=spawnSync("python3",["-c",py],{input:JSON.stringify({base,mig,commands:queries,id,slug,old_id:oldId}),encoding:"utf8"});
  assert.equal(run.status,0,run.stderr||run.stdout);
  assert.match(run.stdout,/SQLite OK/);
});
