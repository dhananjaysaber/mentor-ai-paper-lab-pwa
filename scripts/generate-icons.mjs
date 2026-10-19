import sharp from 'sharp';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
const artwork = await readFile(new URL('../icon.svg', import.meta.url));
await mkdir(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const size of [192, 512]) {
  await sharp(artwork, { density: 400 }).resize(size, size).png({ compressionLevel: 9 })
    .toFile(new URL(`../public/icons/mentor-ai-${size}.png`, import.meta.url).pathname);
}
await sharp(artwork, { density: 400 }).resize(180, 180).png({ compressionLevel: 9 })
  .toFile(new URL('../public/icons/apple-touch-icon-180.png', import.meta.url).pathname);
await copyFile(new URL('../manifest.webmanifest', import.meta.url), new URL('../public/manifest.webmanifest', import.meta.url));
await copyFile(new URL('../icon.svg', import.meta.url), new URL('../public/icon.svg', import.meta.url));
console.log('Generated PWA icons, manifest and SVG asset');
