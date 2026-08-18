import XLSX from 'xlsx';
import path from 'node:path';

const output = process.argv.slice(2).find(arg => arg !== '--') || 'product-category-recipe-import-template.xlsx';

const rows = [
  {
    category: 'Iced Coffee',
    category_id: '',
    ingredient_code: 'UHT001',
    ingredient_sku: '8999999999999',
    ingredient_name: 'UHT Diamond',
    qty: 100,
    unit: 'Ml',
    waste_percent: 5,
  },
  {
    category: 'Hot Coffee',
    category_id: '',
    ingredient_code: 'UHT001',
    ingredient_sku: '8999999999999',
    ingredient_name: 'UHT Diamond',
    qty: 150,
    unit: 'Ml',
    waste_percent: 5,
  },
];

const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.json_to_sheet(rows, {
  header: [
    'category',
    'category_id',
    'ingredient_code',
    'ingredient_sku',
    'ingredient_name',
    'qty',
    'unit',
    'waste_percent',
  ],
});

sheet['!cols'] = [
  { wch: 28 },
  { wch: 24 },
  { wch: 20 },
  { wch: 24 },
  { wch: 32 },
  { wch: 10 },
  { wch: 12 },
  { wch: 14 },
];

XLSX.utils.book_append_sheet(workbook, sheet, 'category_recipes');
XLSX.writeFile(workbook, path.resolve(output));
console.log(`Template created: ${path.resolve(output)}`);
