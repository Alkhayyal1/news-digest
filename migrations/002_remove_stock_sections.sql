-- The stock-market and Tadawul-company sections were removed from the product.
-- Their stories move to the Saudi economy section; financial data entry is dropped.

UPDATE events SET section = 'sa_economy' WHERE section IN ('sa_market', 'sa_companies');
UPDATE bulletin_items SET section = 'sa_economy' WHERE section IN ('sa_market', 'sa_companies');
UPDATE sources SET section_hint = NULL WHERE section_hint IN ('sa_market', 'sa_companies');
DELETE FROM sources WHERE key IN ('saudiexchange', 'argaam')
  AND NOT EXISTS (SELECT 1 FROM items i WHERE i.source_id = sources.id)
  AND NOT EXISTS (SELECT 1 FROM fetch_logs f WHERE f.source_id = sources.id);

DROP TABLE IF EXISTS financial_reports;
DROP TABLE IF EXISTS prices;
