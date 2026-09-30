import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as net from 'node:net';
import * as path from 'node:path';

// These specs manage their OWN `wrangler dev` (a second server, separate from the
// one Playwright's webServer controls) so they can point local persistence at a
// throwaway directory and kill/restart the process to prove data survives a real
// restart — none of which is possible through the shared webServer.

export interface WranglerProc {
  port: number;
  url: string;
  persistDir: string;
  stderr: string[];
  kill(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.setTimeout(500);
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function waitUntilPortFree(port: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await portOpen(port))) return;
    await sleep(250);
  }
  throw new Error(`port ${port} still busy after ${timeoutMs}ms`);
}

async function waitUntilHttpOk(url: string, stderr: string[], timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await sleep(400);
  }
  throw new Error(
    `wrangler at ${url} not ready after ${timeoutMs}ms (last: ${lastErr})\n` +
      stderr.slice(-40).join('\n'),
  );
}

export interface StartOpts {
  port: number;
  testHooks?: boolean;
  /** Reuse a directory across a restart so persistence is observable. */
  persistDir?: string;
}

export async function startWrangler(opts: StartOpts): Promise<WranglerProc> {
  const persistDir = opts.persistDir ?? mkdtempSync(path.join(tmpdir(), 'vidi6-e2e-'));
  const args = [
    'wrangler',
    'dev',
    '--local',
    '--port',
    String(opts.port),
    '--ip',
    '127.0.0.1',
    '--persist-to',
    persistDir,
  ];
  if (opts.testHooks) args.push('--var', 'TEST_HOOKS:1');

  const stderr: string[] = [];
  // detached:true puts wrangler (and its workerd children) in their own process
  // group so a single kill(-pid) tears the whole thing down.
  const proc = spawn('npx', args, {
    cwd: process.cwd(),
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  proc.stderr?.setEncoding('utf8');
  proc.stderr?.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) if (line.trim()) stderr.push(line.trimEnd());
  });

  const url = `http://127.0.0.1:${opts.port}`;
  try {
    await waitUntilHttpOk(`${url}/`, stderr);
  } catch (e) {
    await killGroup(proc);
    throw e;
  }

  return {
    port: opts.port,
    url,
    persistDir,
    stderr,
    kill: async () => {
      await killGroup(proc);
      await waitUntilPortFree(opts.port);
    },
  };
}

async function killGroup(proc: ChildProcess): Promise<void> {
  if (!proc.pid) return;
  for (const sig of ['SIGTERM', 'SIGKILL'] as const) {
    try {
      process.kill(-proc.pid, sig);
    } catch {
      /* already gone */
    }
    await sleep(sig === 'SIGTERM' ? 500 : 200);
    if (proc.exitCode !== null || proc.signalCode !== null) break;
  }
}

export function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
