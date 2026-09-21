export type RecipeGraphRow = {
  id: string;
  productId: string;
  componentProductId?: string | null;
  inventoryItemId?: string | null;
  usageQty: number | string | { toString(): string };
  wastePercent?: number | string | { toString(): string } | null;
  item?: unknown;
  usageUnit?: unknown;
  componentProduct?: { id: string; name: string; status?: string } | null;
};

export type ExpandedRecipeLeaf<T extends RecipeGraphRow = RecipeGraphRow> = {
  row: T;
  requiredQty: number;
  path: string[];
};

export type ExpandedRecipe<T extends RecipeGraphRow = RecipeGraphRow> = {
  leaves: ExpandedRecipeLeaf<T>[];
  missingProductIds: string[];
};

function required(row: RecipeGraphRow, multiplier: number) {
  return Number(row.usageQty) * (1 + Number(row.wastePercent || 0) / 100) * multiplier;
}

export function expandRecipeGraph<T extends RecipeGraphRow>(
  graph: Map<string, T[]>,
  productId: string,
  multiplier = 1,
  path: string[] = [],
): ExpandedRecipe<T> {
  if (path.includes(productId)) {
    throw new Error(`Circular recipe detected: ${[...path, productId].join(' -> ')}`);
  }
  const rows = graph.get(productId) || [];
  if (!rows.length) return { leaves: [], missingProductIds: [productId] };

  const leaves: ExpandedRecipeLeaf<T>[] = [];
  const missing = new Set<string>();
  for (const row of rows) {
    const quantity = required(row, multiplier);
    if (row.componentProductId) {
      if (row.componentProduct?.status && row.componentProduct.status !== 'ACTIVE') {
        missing.add(row.componentProductId);
        continue;
      }
      const child = expandRecipeGraph(graph, row.componentProductId, quantity, [...path, productId]);
      child.leaves.forEach(leaf => leaves.push(leaf));
      child.missingProductIds.forEach(id => missing.add(id));
    } else if (row.inventoryItemId) {
      leaves.push({ row, requiredQty: quantity, path: [...path, productId] });
    }
  }
  return { leaves, missingProductIds: [...missing] };
}

export function createsRecipeCycle(
  edges: Array<{ productId: string; componentProductId: string }>,
  productId: string,
  componentProductIds: string[],
) {
  const graph = new Map<string, string[]>();
  for (const edge of edges) graph.set(edge.productId, [...(graph.get(edge.productId) || []), edge.componentProductId]);
  graph.set(productId, [...new Set(componentProductIds)]);

  const reaches = (current: string, target: string, seen = new Set<string>()): boolean => {
    if (current === target) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    return (graph.get(current) || []).some(next => reaches(next, target, seen));
  };
  return componentProductIds.some(componentId => reaches(componentId, productId));
}
