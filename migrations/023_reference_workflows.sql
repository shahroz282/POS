BEGIN IMMEDIATE;

ALTER TABLE sales ADD COLUMN mobile TEXT;
ALTER TABLE sales ADD COLUMN cleared_date TEXT;

ALTER TABLE sale_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'STOCK'
  CHECK (source_type IN ('STOCK','CUSTOM'));
ALTER TABLE sale_items ADD COLUMN item_name TEXT;
ALTER TABLE sale_items ADD COLUMN extra_details TEXT;

ALTER TABLE stamp_paper_transactions ADD COLUMN register_number TEXT;
ALTER TABLE stamp_paper_transactions ADD COLUMN ticket TEXT;

ALTER TABLE deleted_entry_logs ADD COLUMN reason TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_work_status ON sales(work_status, created_at);
CREATE INDEX IF NOT EXISTS idx_stamp_issue_status ON stamp_paper_transactions(issue_status, issued_date);
CREATE INDEX IF NOT EXISTS idx_stamp_department ON stamp_paper_transactions(department);

INSERT OR IGNORE INTO schema_migrations(id, name) VALUES (23, '023_reference_workflows');
COMMIT;
