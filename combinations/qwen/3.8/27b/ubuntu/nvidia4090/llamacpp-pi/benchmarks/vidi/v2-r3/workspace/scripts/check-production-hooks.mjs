/**
 * Production hook check (story 4, task 9).
 *
 * The /__test hook routes must only exist when env.TEST_HOOKS === '1' (the
 * `test` wrangler environment). A production build runs the *default*
 * environment, where TEST_HOOKS is unset, so any request to /__test/... must
 * fall through to the assets/SPA handler and return HTML (or 404) — never
 * application/json.
 *
 * This script builds the production client, starts `wrangler dev` on the
 * default environment (no --env test) on the reserved ports 29046/29047,
 * probes the hook routes, and asserts none of them return JSON.
 *
 * Run with: npm run check:production-hooks
 */
import { spawn, execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const PORT = 29046;
const INSPECTOR_PORT = 29047;
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 120_000;

function buildProduction() {
  console.log('>> building production client (npm run build)');
  execSync('npm run build', { stdio: 'inherit' });
}

function spawnWrangler() {
  // Default environment: no --env test, so TEST_HOOKS is unset.
  const proc = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(PORT), '--inspector-port', String(INSPECTOR_PORT), '--ip', '127.0.0.1', '--log-level', 'error'],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let out = '';
  proc.stdout?.on('data', (d) => (out += String(d)));
  proc.stderr?.on('data', (d) => (out += String(d)));
  return { proc, getOutput: () => out };
}

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`wrangler did not become ready in ${READY_TIMEOUT_MS}ms`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function killGroup(proc) {
  if (!proc.pid) return;
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    try {
      process.kill(-proc.pid, sig);
    } catch {
      /* already gone */
    }
  }
}

async function main() {
  buildProduction();
  const { proc, getOutput } = spawnWrangler();
  let failures = 0;
  try {
    await waitForReady();
    const boardId = randomBytes(16).toString('base64url');

    // Hook routes must NOT return JSON in production.
    for (const op of ['store-status', 'corrupt-snapshot', 'repair-snapshot']) {
      const res = await fetch(`${BASE}/__test/boards/${boardId}/${op}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const ct = res.headers.get('content-type') ?? '';
      const isJson = ct.includes('application/json');
      const body = (await res.text()).slice(0, 60).replace(/\s+/g, ' ').trim();
      const ok = !isJson;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  POST /__test/boards/:id/${op} -> HTTP ${res.status}, content-type=${ct || '(none)'}, body="${body}"`,
      );
      if (!ok) failures++;
    }

    // A GET to a hook path is not JSON either: the asset handler serves the
    // SPA fallback (200 text/html) or 404 — matching "request returns SPA/404".
    const getHook = await fetch(`${BASE}/__test/boards/${boardId}/store-status`);
    const getHookCt = getHook.headers.get('content-type') ?? '';
    const getHookOk = getHook.status === 404 || getHookCt.includes('text/html');
    console.log(
      `${getHookOk ? 'PASS' : 'FAIL'}  GET /__test/boards/:id/store-status -> HTTP ${getHook.status}, content-type=${getHookCt || '(none)'} (SPA/404, not JSON)`,
    );
    if (!getHookOk) failures++;

    // Sanity: the SPA is still served for a board route.
    const spa = await fetch(`${BASE}/b/${boardId}`);
    const spaCt = spa.headers.get('content-type') ?? '';
    const spaOk = spa.ok && spaCt.includes('text/html');
    console.log(`${spaOk ? 'PASS' : 'FAIL'}  GET /b/:id -> HTTP ${spa.status}, content-type=${spaCt} (SPA served)`);
    if (!spaOk) failures++;

    if (failures > 0) {
      console.error(`\n${failures} check(s) FAILED — /__test routes are reachable in production.`);
      console.error(getOutput());
      process.exitCode = 1;
    } else {
      console.log('\nAll production hook checks passed: no /__test routes in the default environment.');
    }
  } finally {
    killGroup(proc);
    await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
