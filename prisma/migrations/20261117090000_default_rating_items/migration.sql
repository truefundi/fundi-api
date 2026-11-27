-- Customers rate every active rating item, so a fresh install needs a starting
-- set. Only fills an empty table: anything an admin has configured is kept.
INSERT INTO "rating_items" ("id", "name", "description", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, item.name, item.description, item.sort_order, true, now(), now()
FROM (VALUES
  ('Quality of work', 'Was the job done properly?', 1),
  ('Professionalism', 'Courteous, tidy and respectful.', 2),
  ('Punctuality', 'Arrived and finished when agreed.', 3),
  ('Communication', 'Kept you informed along the way.', 4),
  ('Value for money', 'Fair price for the work done.', 5)
) AS item(name, description, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "rating_items");
