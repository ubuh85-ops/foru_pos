import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const storageRoot = path.resolve(process.env.STORAGE_DIR || 'storage');

function decodeDataImage(value: string) {
  const match = value.match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match?.[1]) throw new Error('format base64 tidak didukung');
  return Buffer.from(match[1], 'base64');
}

async function convert(input: Buffer) {
  const metadata = await sharp(input, { failOn: 'error' }).metadata();
  if (!metadata.format || !['jpeg', 'jpg', 'png', 'webp'].includes(metadata.format)) throw new Error('format gambar tidak didukung');
  return sharp(input).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 76 }).toBuffer();
}

async function main() {
  const items = await prisma.inventoryItem.findMany({
    where: { photoUrl: { startsWith: 'data:image/' } },
    select: { id: true, businessId: true, name: true, photoUrl: true }
  });
  let migrated = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const output = await convert(decodeDataImage(item.photoUrl || ''));
      const dir = path.join(storageRoot, 'inventory', item.businessId);
      await fs.mkdir(dir, { recursive: true });
      const filename = `inv_${crypto.randomUUID()}.webp`;
      await fs.writeFile(path.join(dir, filename), output);
      await prisma.inventoryItem.update({ where: { id: item.id }, data: { photoUrl: `/storage/inventory/${item.businessId}/${filename}` } });
      migrated += 1;
      console.log(`Migrated: ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`Failed: ${item.name} (${error instanceof Error ? error.message : 'unknown error'})`);
    }
  }
  console.log(`Inventory photo migration complete: ${migrated} migrated, ${failed} failed, ${items.length} found.`);
  if (failed) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
