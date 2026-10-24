"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const page = fs.readFileSync("index.html", "utf8");
const style = fs.readFileSync("site-theme.css", "utf8");
const scriptMatch = page.match(/<script>\s*([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, "homepage inline JS");
const script = scriptMatch[1].replace(/\bloadHomepage\(\);\s*$/, "");

class MockNode {
  constructor(tag) { this.tagName = tag; this.children = []; this.className = ""; this.textContent = ""; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
}
const ctx = { document:{createElement:tag=>new MockNode(tag)}, Date, Intl, console };
vm.runInNewContext(script, ctx);
const PERIOD = 3 * 24 * 60 * 60 * 1000;
const items = Array.from({length:9}, (_,i)=>({
  product_id:"test-"+i, slug:"shirt-"+i, title:"Shirt "+i,
  category:"футболки",price:1900,
  variants:[{code:"black",available:true,featured:true,new_arrival:true,photos:["/black-"+i+".png"]}]
}));

test("homepage rotates a max of five distinct highlighted products every three days",()=>{
  const a=ctx.showcaseProducts(items,"new-arrivals",0);
  const within=ctx.showcaseProducts(items,"new-arrivals",PERIOD-1);
  const next=ctx.showcaseProducts(items,"new-arrivals",PERIOD);
  assert.equal(a.length,5);
  assert.equal(new Set(a.map(p=>p.slug)).size,5);
  assert.equal(a.map(p=>p.slug).join("|"),within.map(p=>p.slug).join("|"));
  assert.notEqual(a.map(p=>p.slug).join("|"),next.map(p=>p.slug).join("|"));
  assert.equal(ctx.showcaseProducts(items,"new-arrivals",PERIOD*9).map(p=>p.slug).join("|"),
    a.map(p=>p.slug).join("|"),"cycle returns to start");
  const all = new Set();
  for(let i=0;i<items.length;i++)
    for(const p of ctx.showcaseProducts(items,"new-arrivals",PERIOD*i)) all.add(p.slug);
  assert.equal(all.size,items.length,"every flagged product gets a turn");
  const f=ctx.showcaseProducts(items,"featured",0);
  assert.equal(f.length,5);
  assert.notEqual(f[0].slug,a[0].slug,"independent showcase offset");
  assert.equal(ctx.showcaseProducts([], "featured").length,0);
  assert.equal(ctx.showcaseProducts(items.slice(0,3),"featured",0).length,3);
});

test("homepage also rotates eligible color covers without revealing disabled or unflagged colors",()=>{
  const product={product_id:"rotation-test",variants:[
    {code:"red",available:true,featured:true,new_arrival:true,photos:["/red.png"]},
    {code:"navy",available:true,featured:true,new_arrival:true,photos:["/navy.png"]},
    {code:"black",available:false,featured:true,new_arrival:true,photos:["/black.png"]},
    {code:"white",available:true,featured:false,new_arrival:false,photos:["/white.png"]}
  ]};
  const first=ctx.catalogVariant(product,"new_arrival",0);
  const stable=ctx.catalogVariant(product,"new_arrival",PERIOD-1);
  const after=ctx.catalogVariant(product,"new_arrival",PERIOD);
  assert.equal(first.code,stable.code);
  assert.notEqual(first.code,after.code);
  assert.ok(["red","navy"].includes(first.code));
  assert.ok(["red","navy"].includes(after.code));
  assert.equal(ctx.catalogVariant({variants:[]},"featured"),null);
});

test("homepage showcase cards link to precisely the color shown and never exceed five",()=>{
  const section=ctx.createShowcase("new-arrivals","Новинки","Описание",items,[]);
  const grid=section.children[2];
  assert.equal(grid.children.length,5);
  for(const card of grid.children){
    const color=card.href.split("color=")[1];
    const img=card.children[0].children[0];
    assert.equal(color,"black");
    assert.ok(img.src.endsWith(".png"));
  }
  assert.equal(ctx.createShowcase("featured","Наш выбор","Описание",[],[]),null);
});

test("homepage reverses layout prominence and leaves full-collection links",()=>{
  assert.match(style,/#new-arrivals \.categories\s*\{\s*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(style,/#featured \.categories\s*\{\s*grid-template-columns:repeat\(auto-fill,minmax\(170px,220px\)\)/);
  assert.match(style,/#new-arrivals \.category-info\s*\{[\s\S]*?position:absolute;/);
  assert.match(style,/@media\s*\(max-width:650px\)[\s\S]*?#new-arrivals \.categories\s*\{\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(page,/id === "new-arrivals" \? "Все новинки →" : "Весь наш выбор →"/);
  assert.match(page,/\/search\.html\?collection=/);
});

test("finance Pages synchronization is unique and immediately below summary metrics",async()=>{
  const source=fs.readFileSync("functions/finance.js","utf8");
  const api=await import("data:text/javascript;base64,"+
    Buffer.from(source+"\nexport {show,calculate};").toString("base64"));
  const products=JSON.parse(fs.readFileSync("data/products.json","utf8"));
  const registered=products.map(p=>({product_id:p.product_id,product_slug:p.slug,title:p.title,list_price:p.price}));
  const data={products:registered,suppliers:[],receipts:[],payments:[],expenses:[],sales:[],batches:[],
    opening:{snapshot_at:"today",stock_lines:0}};
  const html=api.show(data,api.calculate(data),products,"csrf-test","","");
  const stats=html.indexOf('<div class="stats">');
  const sync=html.indexOf('<div class="finance-sync"');
  const productsFold=html.indexOf('<details class="box finance-fold"');
  assert.ok(stats>=0&&sync>stats&&productsFold>sync,"sync is above collapsible inventory");
  assert.equal((html.match(/Синхронизировать товары из Pages CMS/g)||[]).length,1);
  assert.equal((html.match(/name="action" value="import"/g)||[]).length,1);
  assert.match(html,/class="finance-sync" aria-label="Синхронизация товаров с Pages CMS"/);
});
