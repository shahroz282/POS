BEGIN IMMEDIATE;

CREATE TABLE udhaar_sale_allocations (
  id INTEGER PRIMARY KEY,
  udhaar_entry_id INTEGER NOT NULL REFERENCES udhaar_entries(id),
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  UNIQUE (udhaar_entry_id, sale_id)
);

CREATE INDEX idx_udhaar_sale_allocations_sale ON udhaar_sale_allocations(sale_id);

INSERT INTO schema_migrations(id, name) VALUES (16, '016_udhaar_sale_allocations');
COMMIT;
