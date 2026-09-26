// Local dev loop: rebuild the SPA on change and serve it plus the API with wrangler dev.
// Uses only local data (.wrangler/state); never connects to staging or production.
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const bin = (name: string) => path.join(root, 'node_modules', '.bin', name);

const children = [
  Bun.spawn([bin('vite'), 'build', '--watch'], {
    cwd: path.join(root, 'apps/web'),
    stdout: 'inherit',
    stderr: 'inherit',
  }),
  Bun.spawn([bin('wrangler'), 'dev'], { cwd: root, stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' }),
];

function stopAll() {
  for (const child of children) child.kill();
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

const code = await Promise.race(children.map((child) => child.exited));
stopAll();
process.exit(code);
