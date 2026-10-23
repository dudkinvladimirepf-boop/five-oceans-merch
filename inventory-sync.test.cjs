"use strict";

// Run with: node --test inventory-sync.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { TextEncoder } = require("node:util");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(
  path.join(__dirname, "functions/developers.js"), "utf8"
).replace(/^export /gm, "");
const runtime = vm.createContext({
  TextEncoder, crypto: webcrypto, Request, Response, URL, console, atob, btoa
});
vm.runInContext(source, runtime, { filename: "developers.js" });
const syncCatalog = vm.runInContext("syncCatalog", runtime);

const SHIRT_ID = "a1e8f4b3-8bca-4868-a95c-efac003b16e0";
const HAT_ID = "a75a90a1-8534-46c8-b94b-6f278fc7c7dd";
const shirt = {
  slug: "futbolka", product_id: SHIRT_ID, title: "Футболка",
  variants: [{ code: "red", sizes: ["L"] }]
};
const hat = {
  slug: "shapka-polosatka", product_id: HAT_ID, title: "Шапка «Полосатка»",
  variants: [{ code: "navy-white", sizes: ["Без размера"] }]
};
const shirtStock = {
  product_slug: "futbolka", product_id: SHIRT_ID, size: "v:red|L",
  total_quantity: 17, reserved_quantity: 5
};
const hatStock = {
  product_slug: "shapka-polosatka", product_id: HAT_ID,
  size: "v:navy-white|Без размера", total_quantity: 0, reserved_quantity: 0
};

function setup(products, stock = [], excluded = []) {
  const reads = [];
  const writes = [];
  const db = {
    prepare(sql) {
      const statement = { sql, params: [] };
      statement.bind = (...params) => {
        statement.params = params;
        return statement;
      };
      statement.all = async () => {
        reads.push(sql);
        if (sql.includes("FROM inventory_exclusions")) return { results: excluded };
        if (sql.includes("FROM inventory")) return { results: stock };
        throw new Error("Unexpected SELECT " + sql);
      };
      return statement;
    },
    async batch(statements) {
      writes.push(...statements);
      return statements.map(s => ({
        meta: { changes: JSON.parse(s.params[0]).length }
      }));
    }
  };
  const context = {
    env: {
      DB: db,
      ASSETS: { fetch: async () => ({ ok: true, json: async () => products }) }
    },
    request: { url: "https://example.pages.dev/developers?tab=stock" }
  };
  return { context, reads, writes, run: () => syncCatalog(context) };
}

test("adds the one-size striped hat with a bounded number of D1 queries", async () => {
  const sim = setup([shirt, hat], [shirtStock]);
  const report = await sim.run();
  assert.equal(report.created, 1);
  assert.equal(report.archived, 0);
  assert.equal(report.unchanged, 1);
  assert.equal(sim.reads.length, 2);
  assert.equal(sim.writes.length, 1);
  const rows = JSON.parse(sim.writes[0].params[0]);
  assert.deepEqual(rows, [["shapka-polosatka", HAT_ID, "v:navy-white|Без размера"]]);
  assert.ok(sim.reads.length + sim.writes.length < 50);
});

test("repeated synchronization makes no writes or duplicate rows", async () => {
  const sim = setup([shirt, hat], [shirtStock, hatStock]);
  const report = await sim.run();
  assert.equal(report.unchanged, 2);
  assert.equal(report.created, 0);
  assert.equal(sim.writes.length, 0);
});

test("preserves manually excluded products", async () => {
  const sim = setup([shirt, hat], [shirtStock], [hatStock]);
  const report = await sim.run();
  assert.equal(report.excluded, 1);
  assert.equal(report.created, 0);
  assert.equal(sim.writes.length, 0);
});

test("renaming a slug preserves quantities rather than archiving the row", async () => {
  const oldRow = { ...shirtStock, product_slug: "old-futbolka" };
  const sim = setup([shirt, hat], [oldRow]);
  const report = await sim.run();
  assert.equal(report.updated, 1);
  assert.equal(report.archived, 0);
  assert.equal(report.created, 1);
  assert.ok(sim.writes.some(s => s.sql.includes("UPDATE inventory")));
  assert.ok(!sim.writes.some(s => s.sql.includes("inventory_exclusions")));
});

test("links legacy rows with empty product_id", async () => {
  const sim = setup([shirt], [{ ...shirtStock, product_id: null }]);
  const report = await sim.run();
  assert.equal(report.linked, 1);
  assert.equal(report.created, 0);
  assert.equal(sim.writes.length, 1);
});

test("archives missing positions without deleting inventory or orders", async () => {
  const sim = setup([hat], [shirtStock]);
  const report = await sim.run();
  assert.equal(report.archived, 1);
  assert.equal(report.created, 1);
  assert.ok(sim.writes.some(s => s.sql.includes("INSERT OR IGNORE INTO inventory_exclusions")));
  assert.ok(!sim.writes.some(s => /\bDELETE\b/.test(s.sql)));
});

test("rejects an empty catalog without changing the database", async () => {
  const sim = setup([], [shirtStock]);
  await assert.rejects(sim.run(), /Каталог Pages CMS пуст/);
  assert.equal(sim.reads.length, 0);
  assert.equal(sim.writes.length, 0);
});

test("rejects invalid product IDs without changing the database", async () => {
  const sim = setup([{ ...hat, product_id: "invalid" }], [shirtStock]);
  await assert.rejects(sim.run(), /product_id/);
  assert.equal(sim.reads.length, 0);
  assert.equal(sim.writes.length, 0);
});
