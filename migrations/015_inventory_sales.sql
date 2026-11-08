BEGIN IMMEDIATE;

ALTER TABLE sales ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_sales_idempotency_key ON sales(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE purchases ADD COLUMN purchase_no TEXT;
ALTER TABLE purchases ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_purchases_purchase_no ON purchases(purchase_no) WHERE purchase_no IS NOT NULL;
CREATE UNIQUE INDEX idx_purchases_idempotency_key ON purchases(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_purchases_date ON purchases(purchase_date, id);

ALTER TABLE sale_returns ADD COLUMN idempotency_key TEXT;
ALTER TABLE sale_returns ADD COLUMN return_amount INTEGER NOT NULL DEFAULT 0 CHECK (return_amount >= 0);
CREATE UNIQUE INDEX idx_sale_returns_idempotency_key ON sale_returns(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_stock_movements_created ON stock_movements(created_at, id);

INSERT INTO schema_migrations(id, name) VALUES (15, '015_inventory_sales');
COMMIT;
