/**
 * E2E global setup: makes the image fixtures available under
 * dist/client/test-fixtures/images/ (served by `wrangler dev`).
 *
 * The small images come from the vite build (public/ copy); this setup
 * backfills them if the build is stale and generates the 11 MB JPEG that
 * is too large to keep in git.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function globalSetup(): Promise<void> {
  const distDir = join(process.cwd(), 'dist', 'client', 'test-fixtures', 'images');
  const srcDir = join(process.cwd(), 'tests', 'fixtures', 'images');
  mkdirSync(distDir, { recursive: true });

  for (const name of ['screenshot-1440x900.png', 'sample-320x200.png', 'animated.gif']) {
    const dest = join(distDir, name);
    const src = join(srcDir, name);
    if (!existsSync(dest) && existsSync(src)) {
      copyFileSync(src, dest);
    }
  }

  const big = join(distDir, 'big-11mb.jpg');
  if (!existsSync(big)) {
    const buf = Buffer.alloc(11 * 1024 * 1024);
    buf[0] = 0xff;
    buf[1] = 0xd8;
    buf[2] = 0xff;
    buf[3] = 0xe0; // JPEG magic bytes
    writeFileSync(big, buf);
  }
}
