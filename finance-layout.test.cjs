"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const source=fs.readFileSync("functions/finance.js","utf8");
const api=()=>import("data:text/javascript;base64,"+
  Buffer.from(source+"\nexport { layout };\n").toString("base64"));

test("finance has the same dark CRM masthead and four navigation tabs",async()=>{
  const {layout}=await api();
  const html=layout('<p id="content-sentinel">financial-content</p>');
  assert.match(html,/<header class="crm-header">/);
  assert.match(html,/background:#102c43/);
  assert.match(html,/<h1>Для разработчиков<\/h1>/);
  assert.match(html,/<nav class="admin-tabs" aria-label="Разделы CRM">/);
  for(const expected of [
    'href="/developers?tab=orders"','href="/developers?tab=stock"',
    'href="/finance" class="active" aria-current="page"',
    'href="/developers?tab=trash"'
  ])assert.ok(html.includes(expected),expected);
  assert.match(html,/<div class="crm-card">/);
  assert.match(html,/<h2>Финансовый учёт мерча<\/h2>/);
  assert.match(html,/<p id="content-sentinel">financial-content<\/p>/);
});

test("site return is clearly shown as well as linked from brand",async()=>{
  const {layout}=await api();
  const html=layout("");
  assert.match(html,/<a href="\/" class="crm-brand"[^>]*>5 ОКЕАНОВ<\/a>/);
  assert.match(html,/<a href="\/" class="crm-home">← На главную сайта<\/a>/);
  assert.ok(!html.includes('<a href="/">Сайт</a>'));
  assert.match(html,/href="\/finance\?download=xlsx"/);
  assert.match(html,/<script src="\/finance-forms.js" defer><\/script>/);
});

test("finance page layout keeps safe escaping and form controls",async()=>{
  const {layout}=await api();
  const html=layout('<form method="POST" action="/finance"><button>Сохранить</button></form>',
    '<script>alert(1)</script>');
  assert.ok(!html.includes("<title><script>"));
  assert.match(html,/<title>&lt;script&gt;alert\(1\)&lt;\/script&gt; — 5 океанов<\/title>/);
  assert.match(html,/<form method="POST" action="\/finance">/);
  assert.match(html,/\.danger-button\{background:#b53636\}/);
});
