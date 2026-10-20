-- Run once in Cloudflare D1 Console for five-oceans-store, before merging this PR.
-- Existing and new orders default to "not_shipped".
-- Independent of orders.status and inventory.
ALTER TABLE orders
ADD COLUMN shipping_status TEXT NOT NULL DEFAULT 'not_shipped'
CHECK (shipping_status IN ('not_shipped', 'shipped'));
