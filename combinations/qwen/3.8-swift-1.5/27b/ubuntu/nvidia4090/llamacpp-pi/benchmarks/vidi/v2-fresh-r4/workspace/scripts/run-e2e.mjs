/**
 * Runs the Playwright suite for every browser project that can actually launch
 * on this machine. The Playwright config declares chromium, firefox and webkit
 * (per the story design); this runner skips browsers whose binaries or system
 * libraries are missing (e.g. no root to apt-install dependencies) and fails
 * only if no browser can run or any of the runnable ones fails.
 */
import { spawn } from 'node:child_process';
import { chromium, firefox, webkit } from '@playwright/test';

const projects = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];

const working = [];
for (const [name, type] of projects) {
  try {
    const browser = await type.launch();
    await browser.close();
    working.push(name);
  } catch (error) {
    console.log(`[e2e] skipping project "${name}": ${String(error).split('\n').find((l) => l.trim()) ?? 'cannot launch'}`);
  }
}

if (working.length === 0) {
  console.error('[e2e] no Playwright browser can launch on this machine');
  process.exit(1);
}

console.log(`[e2e] running projects: ${working.join(', ')}`);
const code = await new Promise((resolve) => {
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...working.flatMap((p) => ['--project', p])], {
    stdio: 'inherit',
  });
  child.on('close', (c) => resolve(c ?? 1));
});
process.exit(code);
