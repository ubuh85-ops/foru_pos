import { describe, expect, it } from 'vitest';
import { createsRecipeCycle, expandRecipeGraph, type RecipeGraphRow } from './recipe-graph.js';

describe('nested product recipes', () => {
  it('expands Espresso inside Latte to raw ingredients without double counting', () => {
    const graph = new Map<string, RecipeGraphRow[]>([
      ['latte', [
        { id: 'latte-espresso', productId: 'latte', componentProductId: 'espresso', usageQty: 2, wastePercent: 0 },
        { id: 'latte-milk', productId: 'latte', inventoryItemId: 'milk', usageQty: 150, wastePercent: 0 },
      ]],
      ['espresso', [
        { id: 'espresso-beans', productId: 'espresso', inventoryItemId: 'beans', usageQty: 10, wastePercent: 0 },
      ]],
    ]);
    const result = expandRecipeGraph(graph, 'latte');
    expect(result.missingProductIds).toEqual([]);
    expect(result.leaves.map(leaf => [leaf.row.inventoryItemId, leaf.requiredQty])).toEqual([
      ['beans', 20],
      ['milk', 150],
    ]);
  });

  it('reports a component product that has no recipe', () => {
    const graph = new Map<string, RecipeGraphRow[]>([
      ['latte', [{ id: 'line', productId: 'latte', componentProductId: 'espresso', usageQty: 1 }]],
    ]);
    expect(expandRecipeGraph(graph, 'latte').missingProductIds).toEqual(['espresso']);
  });

  it('does not expand an inactive component product', () => {
    const graph = new Map<string, RecipeGraphRow[]>([
      ['latte', [{ id: 'line', productId: 'latte', componentProductId: 'espresso', componentProduct: { id: 'espresso', name: 'Espresso', status: 'INACTIVE' }, usageQty: 1 }]],
      ['espresso', [{ id: 'beans', productId: 'espresso', inventoryItemId: 'beans', usageQty: 10 }]],
    ]);
    expect(expandRecipeGraph(graph, 'latte')).toEqual({ leaves: [], missingProductIds: ['espresso'] });
  });

  it('rejects direct and indirect circular recipes', () => {
    expect(createsRecipeCycle([], 'espresso', ['espresso'])).toBe(true);
    expect(createsRecipeCycle([
      { productId: 'espresso', componentProductId: 'blend' },
      { productId: 'blend', componentProductId: 'roast' },
    ], 'roast', ['espresso'])).toBe(true);
    expect(createsRecipeCycle([], 'latte', ['espresso'])).toBe(false);
  });
});
