BEGIN IMMEDIATE;

CREATE TRIGGER products_name_unique_insert
BEFORE INSERT ON products
WHEN EXISTS (
  SELECT 1 FROM products WHERE lower(trim(name)) = lower(trim(NEW.name))
)
BEGIN
  SELECT RAISE(ABORT, 'A product with this name already exists');
END;

CREATE TRIGGER products_name_unique_update
BEFORE UPDATE OF name ON products
WHEN EXISTS (
  SELECT 1 FROM products
  WHERE id <> NEW.id AND lower(trim(name)) = lower(trim(NEW.name))
)
BEGIN
  SELECT RAISE(ABORT, 'A product with this name already exists');
END;

INSERT INTO schema_migrations(id, name) VALUES (17, '017_unique_product_names');
COMMIT;
