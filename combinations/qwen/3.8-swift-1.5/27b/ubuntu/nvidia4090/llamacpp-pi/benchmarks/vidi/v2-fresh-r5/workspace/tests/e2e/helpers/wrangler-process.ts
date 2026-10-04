/**
 * Start/stop a real `wrangler dev --persist-to <dir>` process per test.
 *
 * The persistence E2E cases prove the room survives a *real process restart*:
 * the Durable Object state is persisted to a local directory by workerd, and a
 * fresh `wrangler dev` process over the same directory reloads it. Each test
 * gets its own process (and its own persist directory unless one is supplied),
 * so this helper owns the process lifecycle. The Playwright project that uses
 * it has no shared `webServer` (see playwright.persistence.config.ts).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface WranglerProcess {
  port: number;
  persistDir: string;
  baseUrl: string;
  stop: () => Promise<void>;
}

export interface WranglerProcessOptions {
  /**
   * An alternate wrangler config file (relative to the project root), passed
   * as `--config`. Used to enable the test-only `/__test/` storage hooks
   * (e.g. `wrangler.test-hooks.jsonc`, which sets `TEST_HOOKS=1`). The `--var`
   * CLI flag and a `.dev.vars` file are both unreliable for a spawned
   * `wrangler dev` in wrangler 3.x, so a dedicated config file is used.
   */
  config?: string;
}

/**
 * Spawn `wrangler dev --port <port> --persist-to <dir>` and resolve once the
 * server answers HTTP. `persistDir` is created under the OS temp dir when
 * omitted; pass an existing one to reuse state across a restart. `config`
 * selects an alternate wrangler config (used to enable the `/__test/` hooks).
 *
 * The child is spawned in its own process group (`detached`) so `stop()` can
 * kill the whole tree (wrangler + workerd) and never leaves a stale server
 * bound to the port.
 */
export async function startWranglerProcess(
  port: number,
  persistDir?: string,
  options: WranglerProcessOptions = {},
): Promise<WranglerProcess> {
  const dir = persistDir ?? mkdtempSync(join(tmpdir(), 'vidi6-e2e-'));
  // `wranglerBin` is the wrangler CLI itself, so the args start at `dev`.
  const args = [
    'dev',
    '--port',
    String(port),
    '--ip',
    '127.0.0.1',
    '--persist-to',
    dir,
  ];
  if (options.config) {
    args.push('--config', join(process.cwd(), options.config));
  }
  const wranglerBin = join(process.cwd(), 'node_modules', '.bin', 'wrangler');
  const proc = spawn(wranglerBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: process.cwd(),
  });
  let output = '';
  proc.stdout?.on('data', (d: Buffer) => {
    output += d.toString();
  });
  proc.stderr?.on('data', (d: Buffer) => {
    output += d.toString();
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(baseUrl, proc);
  } catch (err) {
    proc.kill('SIGKILL');
    throw new Error(
      `wrangler dev failed to start: ${(err as Error).message}\n--- output ---\n${output.slice(-4000)}`,
    );
  }
  return {
    port,
    persistDir: dir,
    baseUrl,
    stop: async () => {
      if (proc.exitCode !== null) return;
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve();
        }, 8000);
        proc.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

/** Poll until the server returns a non-5xx response (or the process dies). */
async function waitForReady(
  baseUrl: string,
  proc: ChildProcess,
  timeoutMs = 90_000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (proc.exitCode !== null) {
      throw new Error(`wrangler dev exited early (code ${proc.exitCode})`);
    }
    try {
      const res = await fetch(`${baseUrl}/`);
      if (res.status < 500) return;
    } catch {
      // Server not accepting connections yet.
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('wrangler dev did not become ready in time');
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}
