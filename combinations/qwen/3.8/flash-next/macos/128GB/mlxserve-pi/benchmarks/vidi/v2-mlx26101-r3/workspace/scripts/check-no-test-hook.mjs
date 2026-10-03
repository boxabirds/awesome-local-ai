/**
 * Fails if the built client contains the e2e test hook. The hook is gated on
 * import.meta.env.MODE === 'test', so a production build must not mention it at all
 * (design: "Not exported or referenced in production code paths").
 *
 * Usage: npm run build && npm run check:no-test-hook
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = new URL('../dist/client/assets/', import.meta.url).pathname;
const FORBIDDEN = '__vidi6';

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* files(path);
    } else {
      yield path;
    }
  }
}

let checked = 0;
for (const file of files(ASSETS)) {
  const contents = readFileSync(file, 'utf8');
  checked += 1;
  if (contents.includes(FORBIDDEN)) {
    console.error(`FAIL: ${file} contains the test hook "${FORBIDDEN}"`);
    process.exit(1);
  }
}

if (checked === 0) {
  console.error(`FAIL: no built assets found in ${ASSETS} - run "npm run build" first`);
  process.exit(1);
}

console.log(`OK: ${checked} built asset files contain no test hook`);
