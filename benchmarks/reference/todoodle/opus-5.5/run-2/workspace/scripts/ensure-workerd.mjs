// Runs workerd's own postinstall for every installed copy. Some bun versions fail to
// spawn workerd's lifecycle script ("CouldntReadCurrentDirectory"); this makes
// `bun install` self-healing. Safe to run repeatedly.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

function* findWorkerd(dir, depth = 0) {
  if (depth > 6 || !existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin' || entry.name === '.cache') continue;
    const full = join(dir, entry.name);
    if (entry.name === 'workerd' && existsSync(join(full, 'install.js'))) yield full;
    else if (entry.name === 'node_modules' || entry.name.startsWith('@') || dir.endsWith('node_modules')) {
      yield* findWorkerd(full, depth + 1);
    }
  }
}

const root = join(dirname(new URL(import.meta.url).pathname), '..', 'node_modules');
for (const pkg of findWorkerd(root)) {
  execFileSync(process.execPath, ['install.js'], { cwd: pkg, stdio: 'inherit' });
}
