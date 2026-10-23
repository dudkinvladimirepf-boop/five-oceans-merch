-- Step 2: run ONCE in production D1 after finance-mvp.sql; backup first.
-- This migration does not modify inventory quantities or orders.
CREATE TABLE IF NOT EXISTS finance_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES finance_suppliers(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 150),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (supplier_id, name)
);

CREATE INDEX IF NOT EXISTS idx_finance_batches_supplier ON finance_batches(supplier_id);

CREATE TABLE IF NOT EXISTS finance_opening_state (
  id TEXT PRIMARY KEY CHECK (id = 'legacy-v1'),
  snapshot_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  stock_lines INTEGER NOT NULL CHECK (stock_lines >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE finance_receipts ADD COLUMN batch_id INTEGER REFERENCES finance_batches(id);
ALTER TABLE finance_receipts ADD COLUMN is_opening INTEGER NOT NULL DEFAULT 0 CHECK (is_opening IN (0,1));

CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_opening_once
  ON finance_receipts(product_slug, stock_size) WHERE is_opening = 1;

CREATE INDEX IF NOT EXISTS idx_finance_receipts_batch ON finance_receipts(batch_id);
