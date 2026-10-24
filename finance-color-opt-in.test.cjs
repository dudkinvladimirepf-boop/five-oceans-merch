"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

const products=JSON.parse(fs.readFileSync("data/products.json","utf8"));
const pages=fs.readFileSync(".pages.yml","utf8");
const action=fs.readFileSync(".github/workflows/finance-import.yml","utf8");
const finance=fs.readFileSync("functions/finance.js","utf8");
let modulePromise;
function api(){
  return modulePromise||(modulePromise=import("data:text/javascript;base64,"+
    Buffer.from(finance+"\nexport { financeApprovedVariant, financeApprovedProduct, receiptCatalogChoices, perform };\n").toString("base64")));
}
function mockContext(list){
  const writes=[];
  const db={prepare(sql){
    return {bind(...vals){this.params=vals;return this;},
      async run(){writes.push({sql,params:this.params});return {meta:{changes:1}};}};
  }};
  return {writes,context:{env:{DB:db,ASSETS:{fetch:async()=>new Response(JSON.stringify(list),{status:200})}},
    request:{url:"https://five-oceans-merch.pages.dev/finance"}}};
}
function receiptForm(productId,size){
  const data={action:"receipt",sku:JSON.stringify([productId,size]),
    supplier_name:"Тест",batch_name:"Партия № 1",ownership:"purchase",
    quantity:"1",unit_cost:"1400",note:""};
  const form=new FormData();
  for(const [k,v] of Object.entries(data))form.set(k,v);
  return form;
}

test("Pages CMS financial toggle is inside a color and defaults to off",()=>{
  const root=pages.split("      - name: variants")[0];
  const variantSection=pages.split("      - name: variants")[1].split("  - name: categories")[0];
  assert.doesNotMatch(root,/name: finance_enabled/);
  assert.match(variantSection,/          - name: finance_enabled\n            label: Передать в финансовый учёт — этот цвет\n            type: boolean\n            default: false/);
  assert.match(variantSection,/          - name: available/);
  assert.match(variantSection,/          - name: featured/);
  assert.match(variantSection,/          - name: new_arrival/);
  assert.match(pages,/    list: true/);
});

test("all existing stock colors retain finance permission, navy is ready and price 1900",()=>{
  assert.ok(products.length>=9);
  assert.ok(products.every(p=>!("finance_enabled" in p)));
  assert.ok(products.reduce((total,p)=>total+p.variants.length,0)>=11);
  assert.ok(products.every(p=>p.variants.every(v=>v.finance_enabled===true)));
  const shirt=products.find(p=>p.slug==="futbolka-ne-kak-vse");
  assert.equal(shirt.price,1900);
  assert.equal(shirt.product_id,"1cab5aa8-9717-4756-88e7-317ba95dc9be");
  assert.ok(shirt.variants.some(v=>v.code==="red"));
  const navy=shirt.variants.find(v=>v.code==="navy");
  assert.ok(navy,"existing navy color remains");
  assert.ok(navy.sizes.includes("44-46"));
  assert.equal(navy.photos.length,6);
});

test("registered product exposes only checked colors; newly marked color appears independently",async()=>{
  const {financeApprovedProduct,receiptCatalogChoices}=await api();
  const shirt=products.find(p=>p.slug==="futbolka-ne-kak-vse");
  const financeRows=[{product_id:shirt.product_id,product_slug:shirt.slug}];
  const disabled={...shirt,variants:shirt.variants.map(v=>({...v,finance_enabled:v.code==="red"}))};
  const choices=receiptCatalogChoices([disabled],financeRows);
  assert.equal(choices.length,shirt.variants.find(v=>v.code==="red").sizes.length);
  assert.ok(choices.every(c=>!c.label.includes("Тёмно-синий")));
  assert.equal(financeApprovedProduct({...shirt,variants:shirt.variants.map(v=>({...v,finance_enabled:false}))}),false);
  const enabled=receiptCatalogChoices([shirt],financeRows);
  assert.equal(enabled.length,shirt.variants.reduce((n,v)=>n+v.sizes.length,0));
  assert.ok(enabled.some(c=>c.label.includes("Тёмно-синий")&&c.label.includes("44-46")));
  assert.ok(enabled.some(c=>c.label.includes("Красный")));
  assert.equal(receiptCatalogChoices([shirt],[]).length,0);
});

test("server refuses intake of unchecked color even when product registered; no write attempted",async()=>{
  const {perform}=await api();
  const shirt=products.find(p=>p.slug==="futbolka-ne-kak-vse");
  const list=products.map(p=>p.slug===shirt.slug?{...p,variants:p.variants.map(v=>({...v,finance_enabled:v.code==="red"}))}:p);
  const sim=mockContext(list);
  await assert.rejects(
    perform(sim.context,receiptForm(shirt.product_id,"v:navy|44-46")),
    /Этот цвет не отмечен/);
  assert.equal(sim.writes.length,0);
});

test("finance admin synchronization registers a whole product only if some color is approved",async()=>{
  const {perform}=await api();
  const base=products.find(p=>p.slug==="futbolka-ne-kak-vse");
  const inactive={...base,product_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",slug:"unapproved-model",variants:[{code:"black",sizes:["M"],finance_enabled:false}]};
  const one={...base,product_id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",slug:"approved-model",variants:[{code:"navy",sizes:["M"],finance_enabled:true},{code:"red",sizes:["L"],finance_enabled:false}]};
  const sim=mockContext([inactive,one]);
  const form=new FormData();form.set("action","import");
  const result=await perform(sim.context,form);
  assert.match(result,/1/);
  assert.equal(sim.writes.length,1);
  const saved=JSON.parse(sim.writes[0].params[0]);
  assert.deepEqual(saved.map(v=>v[1]),["approved-model"]);
});

test("Pages GitHub finance-import workflow uses color-level opt-in",()=>{
  assert.ok(action.includes("(p.variants || []).some(v => v.finance_enabled === true)"));
  assert.ok(!action.includes("p.finance_enabled === true"));
  assert.match(action,/FINANCE_SYNC_TOKEN/);
});
