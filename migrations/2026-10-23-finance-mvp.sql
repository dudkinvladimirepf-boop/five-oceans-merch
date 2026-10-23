-- FIVE OCEANS: Finance MVP (apply once in Cloudflare D1 production before merging the PR).
-- New tables only. Existing orders, order_items, inventory and reservations stay unchanged.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS finance_products (
  product_id TEXT PRIMARY KEY,
  product_slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  list_price INTEGER NOT NULL DEFAULT 0 CHECK(list_price >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finance_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finance_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES finance_products(product_id),
  product_slug TEXT NOT NULL,
  stock_size TEXT NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES finance_suppliers(id),
  ownership TEXT NOT NULL CHECK (ownership IN ('purchase','consignment')),
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0 AND unit_cost <= 100000000),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_finance_receipts_sku ON finance_receipts (product_slug, stock_size, id);
CREATE INDEX IF NOT EXISTS idx_finance_receipts_supplier ON finance_receipts (supplier_id);

CREATE TABLE IF NOT EXISTS finance_supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES finance_receipts(id),
  amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_finance_payments_receipt ON finance_supplier_payments (receipt_id);

CREATE TABLE IF NOT EXISTS finance_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reason TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
