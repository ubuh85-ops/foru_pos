-- Products now use only products.category_id as their category source.
-- The primary category was already stored separately when multiple categories
-- were introduced, so removing this display-only join table does not change it.
DROP TABLE IF EXISTS "product_categories";
