UPDATE "inventory_stocks" AS s
SET "average_cost" = i."average_cost"
FROM "inventory_items" AS i
WHERE s."inventory_item_id" = i."id";
