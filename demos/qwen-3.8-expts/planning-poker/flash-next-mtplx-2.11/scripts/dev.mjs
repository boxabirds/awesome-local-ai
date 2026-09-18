import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isBun = typeof globalThis.Bun !== 'undefined';
const run = (cmd, args, opts = {}) =>
  spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: false, ...opts });

const server = run(isBun ? 'bun' : 'node', ['server/server.js']);
const client = run(isBun ? 'bunx' : 'npx', ['vite']);

function shutdown() {
  server.kill();
  client.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
