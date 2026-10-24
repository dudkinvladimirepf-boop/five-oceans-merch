const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {spawnSync}=require("node:child_process");

const source=fs.readFileSync("functions/finance.js","utf8");
let imported;
async function api(){
  if(!imported)imported=import("data:text/javascript;base64,"+Buffer.from(
    source+"\nexport { importOpening,calculate,LEGACY_UNIT_COSTS };\n").toString("base64"));
  return imported;
}
const catalog=JSON.parse(fs.readFileSync("data/products.json","utf8"));
const oldHat=catalog.find(p=>p.slug==="shapka-polosatka");
const oldHood=catalog.find(p=>p.slug==="hudi-klub-5-okeanov");
const inventory=[
  {product_slug:oldHat.slug,size:"v:navy-white|Без размера",total_quantity:6,reserved_quantity:2},
  {product_slug:oldHood.slug,size:"v:red|46-48",total_quantity:4,reserved_quantity:1}
];
function mockDb({previous=false,financialLots=0,stocks=inventory}={}){
  const queries=[],readQueries=[];
  const db={
    prepare(sql){
      const state={sql,params:[]};
      return {
        bind(...args){state.params=args;return this;},
        async first(){
          readQueries.push(sql);
          if(sql.includes("FROM finance_opening_state"))return previous?{id:"legacy-v1"}:null;
          if(sql.includes("COUNT(*) AS n FROM finance_receipts"))return {n:financialLots};
          throw Error("Unexpected first "+sql);
        },
        async all(){
          readQueries.push(sql);
          if(sql.includes("FROM inventory i"))return {results:stocks};
          throw Error("Unexpected all "+sql);
        },
        get sql(){return sql;},get params(){return state.params}
      };
    },
    async batch(statements){
      for(const s of statements)queries.push([s.sql,s.params]);
      return statements.map(()=>({meta:{changes:1}}));
    }
  };
  const context={env:{DB:db,ASSETS:{fetch:async()=>({ok:true,json:async()=>catalog})}},
    request:{url:"https://five-oceans-merch.pages.dev/finance"}};
  return {context,queries,readQueries};
}
test("nine existing products are priced by immutable IDs; new goods excluded",async()=>{
  const {LEGACY_UNIT_COSTS}=await api();
  assert.equal(LEGACY_UNIT_COSTS.size,9);
  const check={"hudi-klub-5-okeanov":2950,
    "svitshot-klub-5-okeanov":2175,
    "shapka-polosatka":700};
  for(const [slug,cost] of Object.entries(check)){
    const p=catalog.find(x=>x.slug===slug);
    assert.equal(LEGACY_UNIT_COSTS.get(p.product_id),cost,slug);
  }
  const legacyShirts=catalog.filter(p=>p.slug.startsWith("futbolka-")&&
    LEGACY_UNIT_COSTS.has(p.product_id));
  assert.equal(legacyShirts.length,6,"six historical graphic t-shirts");
  for(const p of legacyShirts)
    assert.equal(LEGACY_UNIT_COSTS.get(p.product_id),1400,p.slug);
  assert.ok(!LEGACY_UNIT_COSTS.has(catalog.find(p=>p.slug==="futbolka-planka-sposobnostey").product_id),
    "new Pages items must not acquire invented historical purchasing costs");
});
test("one-click opening checks preserve inventory and use SQL stock values",async()=>{
  const {importOpening}=await api();
  const sim=mockDb();
  const message=await importOpening(sim.context);
  assert.match(message,/9 товаров/);
  assert.equal(sim.queries.length,5);
  assert.ok(sim.queries.every(([sql])=>!/\bUPDATE\s+inventory\b|\bINSERT\s+INTO\s+inventory\b/i.test(sql)));
  assert.match(sim.queries[0][0],/COUNT\(\*\)/);
  assert.match(sim.queries[4][0],/i\.total_quantity/);
  assert.match(sim.queries[4][0],/is_opening/);
  assert.match(sim.queries[4][0],/NOT EXISTS/);
  const skuPairs=JSON.parse(sim.queries[4][1][0]);
  assert.ok(skuPairs.some(x=>x[1]===oldHat.slug&&x[2]==="v:navy-white|Без размера"&&x[3]===700));
  assert.ok(skuPairs.some(x=>x[1]===oldHood.slug&&x[3]===2950));
});
test("prevents repeat opening and preexisting manually recorded finance lots",async()=>{
  const {importOpening}=await api();
  const repeated=mockDb({previous:true});
  await assert.rejects(importOpening(repeated.context),/Повторять его нельзя/);
  assert.equal(repeated.queries.length,0);
  const manual=mockDb({financialLots:1});
  await assert.rejects(importOpening(manual.context),/уже есть зарегистрированные партии/);
  assert.equal(manual.queries.length,0);
});
test("opening costs never invent a debt, historical paid orders excluded by SQL cutoff",async()=>{
  const {calculate}=await api();
  const p=oldHat;
  const v=calculate({
    products:[{product_id:p.product_id,product_slug:p.slug,title:p.title,list_price:1100}],
    suppliers:[{id:1,name:"Неизвестный поставщик"}],
    receipts:[{id:7,product_slug:p.slug,stock_size:"v:navy-white|Без размера",supplier_id:1,
      ownership:"purchase",is_opening:1,quantity:6,unit_cost:700}],
    payments:[],expenses:[],sales:[{order_id:"NEW",product_slug:p.slug,
      size:"v:navy-white|Без размера",quantity:2,unit_price:1100}]
  });
  assert.equal(v.cogs,1400);
  assert.equal(v.supplierLiability,0);
  assert.equal(v.inventoryCost,2800);
  assert.equal(v.revenue,2200);
  assert.match(source,/o\.updated_at > \(SELECT snapshot_at FROM finance_opening_state/);
});
test("both SQL migrations, live opening statements, repeat guard and supplier-scoped batches work in real SQLite",async()=>{
  const {importOpening}=await api();
  const sim=mockDb();
  await importOpening(sim.context);
  const input={
    base:fs.readFileSync("migrations/2026-10-23-finance-mvp.sql","utf8"),
    migration:fs.readFileSync("migrations/2026-10-23-finance-opening-batches.sql","utf8"),
    queries:sim.queries,
    inventory
  };
  const python=String.raw`
import sys,json,sqlite3
p=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
db.executescript(p['base'])
db.executescript(p['migration'])
db.executescript('''
  CREATE TABLE inventory(product_slug TEXT NOT NULL,size TEXT NOT NULL,total_quantity INTEGER NOT NULL,reserved_quantity INTEGER NOT NULL);
  CREATE TABLE inventory_exclusions(product_slug TEXT NOT NULL,size TEXT NOT NULL);
''')
db.executemany('INSERT INTO inventory VALUES(?,?,?,?)',[
 (r['product_slug'],r['size'],r['total_quantity'],r['reserved_quantity']) for r in p['inventory']])
db.commit()
before=db.execute('SELECT * FROM inventory ORDER BY product_slug').fetchall()
for sql,args in p['queries']:
 db.execute(sql,args)
db.commit()
after=db.execute('SELECT * FROM inventory ORDER BY product_slug').fetchall()
assert before==after, 'Stock changed during opening import'
assert db.execute('SELECT count(*) FROM finance_products').fetchone()[0]==9
assert db.execute('SELECT stock_lines FROM finance_opening_state').fetchone()[0]==2
costs=db.execute("SELECT product_slug,unit_cost,quantity,is_opening FROM finance_receipts ORDER BY product_slug").fetchall()
assert costs==sorted([(p['inventory'][0]['product_slug'],700,6,1),
                      (p['inventory'][1]['product_slug'],2950,4,1)])
assert db.execute('SELECT count(*) FROM finance_suppliers').fetchone()[0]==1
try:
 for sql,args in p['queries']: db.execute(sql,args)
 db.commit()
 raise AssertionError('Duplicate opening allowed')
except sqlite3.IntegrityError:
 db.rollback()
assert db.execute('SELECT count(*) FROM finance_receipts').fetchone()[0]==2
db.execute("INSERT INTO finance_suppliers(name) VALUES('Другой поставщик')")
id2=db.execute("SELECT id FROM finance_suppliers WHERE name='Другой поставщик'").fetchone()[0]
db.execute("INSERT INTO finance_batches(supplier_id,name) VALUES(?,?)",(id2,'Начальная партия № 1'))
assert db.execute("SELECT count(*) FROM finance_batches WHERE name='Начальная партия № 1'").fetchone()[0]==2
print('OK; 9 products, two actual opening SKUs, zero inventory change, one-time guard, separate supplier batches')
`;
  const run=spawnSync("python3",["-c",python],{input:JSON.stringify(input),encoding:"utf8"});
  assert.equal(run.status,0,run.stderr||run.stdout);
  assert.match(run.stdout,/^OK;/);
});
