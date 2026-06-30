type ScanResult = { value: string };

const formats = [
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
  'CODE_128',
  'CODE_39',
  'QR_CODE'
];

function isNativeAndroid() {
  const cap = (window as any).Capacitor;
  return !!cap?.isNativePlatform?.() && cap?.getPlatform?.() === 'android';
}

export async function scanInventoryBarcode(): Promise<ScanResult | null> {
  if (!isNativeAndroid()) {
    const value = prompt('Masukkan / simulasi hasil barcode');
    return value?.trim() ? { value: value.trim() } : null;
  }

  const mod: any = await import('@capacitor-mlkit/barcode-scanning');
  const scanner = mod.BarcodeScanner;

  const permission = await scanner.requestPermissions();
  const camera = permission?.camera;
  if (camera !== 'granted' && camera !== 'limited') {
    alert('FORU POS membutuhkan akses kamera untuk scan barcode. Aktifkan izin kamera di pengaturan Android.');
    return null;
  }

  const result = await scanner.scan({
    formats: formats.map((name) => mod.BarcodeFormat?.[name]).filter(Boolean)
  });
  const value = result?.barcodes?.[0]?.rawValue || result?.barcodes?.[0]?.displayValue || '';
  return value ? { value: String(value).trim() } : null;
}
