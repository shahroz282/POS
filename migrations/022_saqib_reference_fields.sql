BEGIN IMMEDIATE;

ALTER TABLE sales ADD COLUMN work_status TEXT NOT NULL DEFAULT 'COMPLETED'
  CHECK (work_status IN ('PENDING','COMPLETED'));
ALTER TABLE sales ADD COLUMN sale_note TEXT;

ALTER TABLE stamp_paper_transactions ADD COLUMN department TEXT;
ALTER TABLE stamp_paper_transactions ADD COLUMN quantity_100 INTEGER NOT NULL DEFAULT 0 CHECK (quantity_100 >= 0);
ALTER TABLE stamp_paper_transactions ADD COLUMN quantity_200 INTEGER NOT NULL DEFAULT 0 CHECK (quantity_200 >= 0);
ALTER TABLE stamp_paper_transactions ADD COLUMN quantity_300 INTEGER NOT NULL DEFAULT 0 CHECK (quantity_300 >= 0);
ALTER TABLE stamp_paper_transactions ADD COLUMN commission_paisa INTEGER NOT NULL DEFAULT 0 CHECK (commission_paisa >= 0);
ALTER TABLE stamp_paper_transactions ADD COLUMN commission_label TEXT;
ALTER TABLE stamp_paper_transactions ADD COLUMN issue_status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK (issue_status IN ('PENDING','ISSUED'));
ALTER TABLE stamp_paper_transactions ADD COLUMN issued_date TEXT;

CREATE TABLE IF NOT EXISTS deleted_entry_logs (
  id INTEGER PRIMARY KEY,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  module TEXT NOT NULL,
  item_details TEXT NOT NULL,
  original_amount INTEGER,
  original_quantity INTEGER,
  deleted_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_deleted_entry_logs_deleted_at ON deleted_entry_logs(deleted_at);

INSERT OR IGNORE INTO schema_migrations(id, name) VALUES (22, '022_saqib_reference_fields');
COMMIT;
