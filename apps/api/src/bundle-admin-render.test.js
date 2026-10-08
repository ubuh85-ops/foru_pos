import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from '../../web/node_modules/react/index.js';
import { renderToStaticMarkup } from '../../web/node_modules/react-dom/server.node.js';
import { newBundle } from '../../web/src/bundleAdmin.ts';

vi.mock('../../web/src/api', () => ({ API: 'http://test.local/api', api: vi.fn(), handleUnauthorizedSession: vi.fn(), rupiah: value => `Rp ${value}` }));
afterEach(() => vi.unstubAllGlobals());
async function render(draft) {
  vi.stubGlobal('React', React);
  const { BundleEditor } = await import('../../web/src/pages/BundlesPage.tsx');
  return renderToStaticMarkup(React.createElement(BundleEditor, { initial: draft,
    products: [{ id: 'coffee', name: 'Coffee', status: 'ACTIVE', variants: [{ id: 'large', variantName: 'Large', status: 'ACTIVE' }], variantGroups: [] }],
    categories: [{ id: 'cat', name: 'Coffee category', status: 'ACTIVE' }], outlets: [{ id: 'out', name: 'Test outlet', status: 'ACTIVE' }], onClose: vi.fn(), onSaved: vi.fn() }));
}
describe('bundle admin editor render smoke', () => {
  it('renders accessible dialog, outlet pricing, upload and save actions', async () => {
    const html = await render(newBundle('out'));
    for (const text of ['role="dialog"', 'aria-modal="true"', 'Tambah Paket', 'Test outlet', 'GoFood', 'GrabFood', 'ShopeeFood', 'Upload Foto', 'Simpan Paket']) expect(html).toContain(text);
  });
  it('renders choice bounds and existing legacy variants', async () => {
    const draft = newBundle('out'); draft.groups[0].items[0].productId = 'coffee';
    const html = await render(draft);
    for (const text of ['Minimal pilihan', 'Maksimal pilihan', 'Pilihan default', 'Customer memilih variant', 'Large']) expect(html).toContain(text);
  });
  it('hides choice bounds/default for fixed combos without hiding component controls', async () => {
    const draft = newBundle('out'); draft.groups[0].isFixed = true;
    const html = await render(draft);
    expect(html).not.toContain('Minimal pilihan'); expect(html).not.toContain('Pilihan default');
    expect(html).toContain('Unit produk per paket'); expect(html).toContain('Tambahan harga / unit');
  });
});
