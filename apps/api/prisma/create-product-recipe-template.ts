import XLSX from 'xlsx';
import path from 'node:path';

const output = process.argv.slice(2).find(arg => arg !== '--') || 'product-recipe-import-template.xlsx';

const rows = [
  {
    product_sku: 'RB001',
    product_name: 'Roti Bakar Coklat',
    ingredient_code: 'UHT001',
    ingredient_sku: '8999999999999',
    ingredient_name: 'UHT Diamond',
    qty: 100,
    unit: 'Ml',
    waste_percent: 5,
  },
  {
    product_sku: 'RB001',
    product_name: 'Roti Bakar Coklat',
    ingredient_code: 'ROT1BGR',
    ingredient_sku: '',
    ingredient_name: 'Benardi Roti Burger',
    qty: 1,
    unit: 'Pcs',
    waste_percent: 0,
  },
];

const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.json_to_sheet(rows, {
  header: [
    'product_sku',
    'product_name',
    'ingredient_code',
    'ingredient_sku',
    'ingredient_name',
    'qty',
    'unit',
    'waste_percent',
  ],
});

sheet['!cols'] = [
  { wch: 18 },
  { wch: 32 },
  { wch: 20 },
  { wch: 24 },
  { wch: 32 },
  { wch: 10 },
  { wch: 12 },
  { wch: 14 },
];

XLSX.utils.book_append_sheet(workbook, sheet, 'recipes');
XLSX.writeFile(workbook, path.resolve(output));
console.log(`Template created: ${path.resolve(output)}`);
