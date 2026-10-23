const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const source=fs.readFileSync("functions/finance.js","utf8");
let modulePromise;
function moduleUnderTest() {
  if(!modulePromise)modulePromise=import("data:text/javascript;base64,"+
    Buffer.from(source+"\nexport { calculate,sheetXml,zipStore,excelDownload };").toString("base64"));
  return modulePromise;
}
function sample() {
  return {
    products:[{product_id:"p1",product_slug:"hat",title:"Шапка"}],
    suppliers:[{id:1,name:"Поставщик"}],
    receipts:[
      {id:1,product_slug:"hat",stock_size:"v:blue|Без размера",ownership:"purchase",quantity:10,unit_cost:100,supplier:"Поставщик",created_at:"2026-10-23"},
      {id:2,product_slug:"hat",stock_size:"v:blue|Без размера",ownership:"consignment",quantity:5,unit_cost:300,supplier:"Поставщик",created_at:"2026-10-23"}
    ],
    sales:[{order_id:"FO-A",product_slug:"hat",size:"v:blue|Без размера",quantity:12,unit_price:500,updated_at:"2026-10-23"}],
    payments:[{id:1,receipt_id:1,amount:1000,created_at:"2026-10-23"}],
    expenses:[{id:1,reason:"Упаковка",amount:50,created_at:"2026-10-23"}]
  };
}
test("FIFO purchase/consignment and six percent tax",async()=>{
  const {calculate}=await moduleUnderTest();const v=calculate(sample());
  assert.deepEqual([v.revenue,v.cogs,v.tax,v.spent,v.supplierLiability,v.inventoryCost,v.profit,v.unknownQty],
    [6000,1600,360,1050,600,900,3990,0]);
  assert.equal(v.rows[0].qty_sold,10);
  assert.equal(v.rows[1].qty_sold,2);
});
test("unknown historical sale cost is explicitly flagged",async()=>{
  const {calculate}=await moduleUnderTest();const d=sample();
  d.sales[0].quantity=20;const v=calculate(d);
  assert.equal(v.unknownQty,5);
});
test("consignment creates no supplier obligation before sale",async()=>{
  const {calculate}=await moduleUnderTest();const d=sample();
  d.sales=[];const v=calculate(d);
  assert.equal(v.revenue,0);assert.equal(v.supplierLiability,0);
  assert.equal(v.rows[1].liability,0);
});
test("excel download contains valid workbook parts and formula-looking text is safe",async()=>{
  const {calculate,excelDownload,sheetXml}=await moduleUnderTest();const d=sample();
  const res=excelDownload(d,calculate(d));
  assert.equal(res.status,200);
  assert.match(res.headers.get("Content-Type"),/spreadsheetml/);
  const buf=Buffer.from(await res.arrayBuffer());
  assert.equal(buf.readUInt32LE(0),0x04034b50);
  const required=["[Content_Types].xml","xl/workbook.xml","xl/worksheets/sheet1.xml","xl/worksheets/sheet6.xml"];
  const names=[];let offset=0;
  while(offset+30<=buf.length && buf.readUInt32LE(offset)===0x04034b50){
    const len=buf.readUInt16LE(offset+26),extra=buf.readUInt16LE(offset+28);
    const size=buf.readUInt32LE(offset+18);
    names.push(buf.subarray(offset+30,offset+30+len).toString("utf8"));
    offset+=30+len+extra+size;
  }
  for(const name of required)assert.ok(names.includes(name),name+" missing");
  const xml=sheetXml([["A"],["=1+2"]]);
  assert.match(xml,/t="inlineStr"/);
  assert.match(xml,/=1\+2/);
});
