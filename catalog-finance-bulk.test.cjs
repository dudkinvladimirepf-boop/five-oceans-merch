"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {spawnSync}=require("node:child_process");
const products=JSON.parse(fs.readFileSync("data/products.json","utf8"));
const shirt=products.find(p=>p.slug==="futbolka-ne-kak-vse");
const source=fs.readFileSync("functions/finance.js","utf8");
const api=()=>import("data:text/javascript;base64,"+Buffer.from(source+
  "\nexport {receiptGroupChoices,receiptSizeLines,allocatePayment,perform,show,calculate};\n").toString("base64"));

function groupForm(quantities,payment=0){
  const f=new FormData();
  for(const [k,v] of Object.entries({
    action:"receipt",operation_mode:"receipt",
    receipt_group:JSON.stringify([shirt.product_id,"red"]),
    supplier_name:"Фабрика для теста",batch_name:"Партия 17",
    ownership:"purchase",unit_cost:"1400",note:"Тест групповой приёмки",
    payment_amount:String(payment),payment_note:payment?"Аванс":""
  })) f.set(k,v);
  for(const [size,qty] of quantities){
    f.append("receipt_size",size);
    f.append("receipt_qty",String(qty));
  }
  return f;
}
function fakeDb(){
  const writes=[];
  const db={
    prepare(sql){
      const statement={sql,params:[]};
      return {
        bind(...params){statement.params=params;return this;},
        get sql(){return statement.sql;},
        get params(){return statement.params;},
        async first(){
          if(sql.includes("FROM finance_products WHERE product_id"))return {ok:1};
          if(sql.includes("FROM inventory_exclusions"))return null;
          throw Error("Unexpected .first: "+sql);
        },
        async all(){
          if(sql.includes("FROM finance_suppliers"))return {results:[]};
          throw Error("Unexpected .all: "+sql);
        }
      };
    },
    async batch(stmts){
      for(const st of stmts)writes.push({sql:st.sql,params:st.params});
      return stmts.map(()=>({meta:{changes:1}}));
    }
  };
  const context={env:{DB:db,ASSETS:{fetch:async()=>new Response(JSON.stringify(products))}},
    request:{url:"https://example.com/finance"}};
  return {context,writes};
}
test("category switches covers every three days and exposes per-color swatches",()=>{
  const html=fs.readFileSync("category.html","utf8");
  assert.match(html,/3 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(html,/createElement\("button","catalog-swatch"\)/);
  assert.match(html,/addEventListener\("mouseenter"/);
  assert.match(html,/addEventListener\("click"/);
  assert.match(html,/addEventListener\("focus"/);
  assert.match(html,/productUrl\(product,v\)/);
  assert.doesNotMatch(html,/"Размеры в наличии:"/);
  const begin=html.indexOf("const COVER_PERIOD_MS =");
  const end=html.indexOf("/* СОЗДАНИЕ КАРТОЧКИ ТОВАРА */",begin);
  assert.ok(begin>0&&end>begin);
  const {coverVariant}=vm.runInNewContext(html.slice(begin,end)+
    "\n;({coverVariant})",{Date});
  const choice={product_id:"consistent-uuid",variants:[
    {code:"red",label:"Красный",available:true,photos:["/red.png"]},
    {code:"navy",label:"Тёмно-синий",available:true,photos:["/navy.png"]},
    {code:"white",label:"Белый",available:false,photos:["/white.png"]}
  ]};
  const day=86_400_000;
  const first=coverVariant(choice,day*180);
  assert.equal(coverVariant(choice,day*182).code,first.code);
  assert.notEqual(coverVariant(choice,day*183).code,first.code);
  assert.notEqual(first.code,"white");
  assert.equal(coverVariant({variants:[choice.variants[0]]},day*200).code,"red");
});

test("one finance color selection exposes all allowed sizes",async()=>{
  const {receiptGroupChoices,show,calculate}=await api();
  const registered=products.map(p=>({product_id:p.product_id,product_slug:p.slug,title:p.title,list_price:p.price}));
  const groups=receiptGroupChoices(products,registered);
  const red=groups.find(x=>x.label.includes("Не как все")&&x.label.includes("Красный"));
  assert.deepEqual(red.sizes,["46-48","48-50","50-52","52-54"]);
  assert.ok(groups.some(x=>x.label.includes("Тёмно-синий")));
  const unused=products.map(p=>({...p,variants:p.variants.map(v=>({...v,finance_enabled:false}))}));
  assert.equal(receiptGroupChoices(unused,registered).length,0);
  const data={products:registered,suppliers:[],receipts:[],payments:[],expenses:[],sales:[],batches:[],
    opening:{snapshot_at:"today",stock_lines:0}};
  const html=show(data,calculate(data),products,"csrf","","");
  assert.match(html,/id="receipt-group-select"/);
  assert.match(html,/data-sizes="/);
  assert.match(html,/class="receipt-size-table"/);
  assert.match(html,/name="payment_amount"/);
  assert.match(html,/<details class="box finance-fold"/);
  assert.match(html,/<summary>Поступления и расчёты/);
});

test("one multi-size receipt makes correct stock rows with no zero quantities",async()=>{
  const {perform}=await api();
  const sim=fakeDb();
  const form=groupForm([["46-48",3],["48-50",0],["50-52",2],["52-54",0]]);
  const result=await perform(sim.context,form);
  assert.match(result,/\+5 шт\. на складе \(2 размеров\)/);
  const receipts=sim.writes.filter(x=>/INSERT INTO finance_receipts/.test(x.sql));
  const stock=sim.writes.filter(x=>/INSERT INTO inventory/.test(x.sql));
  assert.equal(receipts.length,2);
  assert.equal(stock.length,2);
  assert.deepEqual(stock.map(x=>x.params.slice(2)),[["v:red|46-48",3],["v:red|50-52",2]]);
});

test("payment apportions exactly across size receipts and does not create duplicate money",async()=>{
  const {perform,allocatePayment}=await api();
  assert.deepEqual(allocatePayment(1001,[1,2,3]),[166,334,501]);
  const sim=fakeDb();
  await perform(sim.context,groupForm([["46-48",1],["48-50",2],["50-52",3]],1001));
  const paid=sim.writes.filter(x=>/INSERT INTO finance_supplier_payments/.test(x.sql));
  assert.equal(paid.length,3);
  assert.equal(paid.reduce((sum,p)=>sum+p.params[0],0),1001);
  const receipts=sim.writes.filter(x=>/INSERT INTO finance_receipts/.test(x.sql));
  assert.equal(receipts.length,3);
  assert.ok(paid.every(x=>x.sql.includes("last_insert_rowid()")));
});

test("reject forged, duplicate, or all-zero size entries BEFORE database mutation",async()=>{
  const {perform}=await api();
  const invalids=[
    [["46-48",0],["48-50",0]],
    [["46-48",1],["46-48",2]],
    [["46-48",1],["999-000",1]],
    [["46-48",-1]],
    Array.from({length:26},(_,i)=>["46-48",1])
  ];
  for(const quantities of invalids){
    const sim=fakeDb();
    await assert.rejects(perform(sim.context,groupForm(quantities)));
    assert.equal(sim.writes.length,0);
  }
});

test("SQLite financial receipt and payment share exact sizes and batch safely",async()=>{
  const {perform}=await api();
  const sim=fakeDb();
  const f=groupForm([["46-48",2],["48-50",0],["50-52",3]],7000);
  f.append("expense_reason","Доставка");f.append("expense_amount","250");
  await perform(sim.context,f);
  const py=[
    "import json,sqlite3,sys",
    "d=json.load(sys.stdin)",
    "db=sqlite3.connect(':memory:')",
    "db.execute('PRAGMA foreign_keys=ON')",
    "db.executescript(d['base']);db.executescript(d['migration'])",
    "db.executescript('CREATE TABLE inventory(product_slug TEXT,product_id TEXT,size TEXT,total_quantity INTEGER NOT NULL,reserved_quantity INTEGER NOT NULL DEFAULT 0,updated_at TEXT,PRIMARY KEY(product_slug,size));')",
    "db.execute('INSERT INTO finance_products(product_id,product_slug,title,list_price) VALUES(?,?,?,1900)',(d['id'],d['slug'],'Futbolka'))",
    "db.commit()",
    "db.execute('BEGIN')",
    "for stmt in d['statements']:db.execute(stmt['sql'],stmt['params'])",
    "db.commit()",
    "q=db.execute('SELECT stock_size,quantity,supplier_id,batch_id FROM finance_receipts').fetchall()",
    "assert sorted((s,n) for s,n,*_ in q)==[('v:red|46-48',2),('v:red|50-52',3)],q",
    "assert len(set((sup,batch) for _,_,sup,batch in q))==1,q",
    "amount=db.execute('SELECT sum(amount) FROM finance_supplier_payments').fetchone()[0]",
    "assert amount==7000,amount",
    "rows=db.execute('SELECT size,total_quantity FROM inventory ORDER BY size').fetchall()",
    "assert rows==[('v:red|46-48',2),('v:red|50-52',3)],rows",
    "assert db.execute('SELECT sum(amount) FROM finance_expenses').fetchone()[0]==250",
    "print('SQLite group intake OK')"
  ].join("\n");
  const run=spawnSync("python3",["-c",py],{
    input:JSON.stringify({
      base:fs.readFileSync("migrations/2026-10-23-finance-mvp.sql","utf8"),
      migration:fs.readFileSync("migrations/2026-10-23-finance-opening-batches.sql","utf8"),
      id:shirt.product_id,slug:shirt.slug,statements:sim.writes
    }),encoding:"utf8"
  });
  assert.equal(run.status,0,run.stderr||run.stdout);
  assert.match(run.stdout,/SQLite group intake OK/);
});
