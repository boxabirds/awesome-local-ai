/**
 * A self-managed `wrangler dev` child process for the nightly restart / catch-up tests.
 *
 * Playwright owns the suite's main dev server, so a mid-test *process* restart cannot go
 * through the harness. These tests therefore drive a dedicated second `wrangler dev` on
 * their own port and kill / relaunch it themselves — a true server restart that drops the
 * Durable Object's in-memory `Y.Doc` (there is no storage yet), which is exactly the state
 * the story's restart-safety must recover from.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface DevServer {
  readonly base: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface PersistedDevServer extends DevServer {
  /** The directory `--persist-to` writes into; it survives stop/start and is removed on cleanup. */
  readonly persistDir: string;
  /** Reap the persistence directory (call once, after the final stop). */
  cleanup(): void;
}

/** Spawn `wrangler dev` on `port` bound to `persistTo`, resolving once it answers. */
const launch = async (port: number, persistTo: string, vars: Record<string, string>): Promise<ChildProcess> => {
  const varArgs = Object.entries(vars).flatMap(([key, value]) => ['--var', `${key}:${value}`]);
  const proc = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--config',
      'wrangler.jsonc',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--persist-to',
      persistTo,
      ...varArgs,
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, VIDI_PORT: String(port) },
      // Own process group so a kill signals the workerd children too, not just npx.
      detached: true,
    },
  );
  proc.stdout!.resume();
  proc.stderr!.resume();
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    let ready = false;
    try {
      ready = (await fetch(`${base}/`)).ok;
    } catch {
      ready = false;
    }
    if (ready) break;
    if (Date.now() > deadline) throw new Error(`dev server on :${port} did not become ready`);
    await new Promise((r) => setTimeout(r, 500));
  }
  return proc;
};

/** Wait until `port` stops answering (the old process group is really gone). */
const waitForGone = async (port: number): Promise<void> => {
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    let gone = false;
    try {
      await fetch(base, { signal: AbortSignal.timeout(1000) });
      gone = false;
    } catch {
      gone = true;
    }
    if (gone) break;
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 250));
  }
};

/** Kill a process group and wait for its port to free. */
const killAndWait = async (proc: ChildProcess, port: number): Promise<void> => {
  try {
    process.kill(-proc.pid!, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
  await new Promise<void>((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) resolve();
    else proc.once('exit', () => resolve());
  });
  await waitForGone(port);
};

/**
 * A `wrangler dev` that keeps ONE `--persist-to` directory across stop / start, so stopping
 * the process (which drops the Durable Object's in-memory `Y.Doc`) and starting a new one
 * proves the board reloads from durable storage. `cleanup` reaps the directory.
 */
export function createPersistedDevServer(port: number, vars: Record<string, string> = {}): PersistedDevServer {
  const persistDir = mkdtempSync(join(tmpdir(), 'vidi-persist-'));
  let proc: ChildProcess | null = null;
  return {
    base: `http://127.0.0.1:${port}`,
    persistDir,
    async start(): Promise<void> {
      if (proc !== null) throw new Error('dev server already started');
      proc = await launch(port, persistDir, vars);
    },
    async stop(): Promise<void> {
      if (proc === null) return;
      await killAndWait(proc, port);
      proc = null; // the persistence directory is deliberately kept for the next start
    },
    cleanup(): void {
      try {
        rmSync(persistDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

/** `wrangler dev` with no persistence on `port`; the client build is served from `dist/`. */
export function createDevServer(port: number): DevServer {
  let proc: ChildProcess | null = null;

  const ready = async (): Promise<boolean> => {
    try {
      const res = await fetch(`${base}/`);
      return res.ok;
    } catch {
      return false;
    }
  };

  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    async start(): Promise<void> {
      if (proc !== null) throw new Error('dev server already started');
      // A fresh persistence dir per start so the restart genuinely begins with an empty
      // room state (the in-memory `Y.Doc` is never written to storage in this story).
      const persistTo = mkdtempSync(join(tmpdir(), 'vidi-nightly-'));
      proc = spawn(
        'npx',
        [
          'wrangler',
          'dev',
          '--config',
          'wrangler.jsonc',
          '--ip',
          '127.0.0.1',
          '--port',
          String(port),
          '--persist-to',
          persistTo,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, VIDI_PORT: String(port) },
          // Own process group so `stop` can signal the workerd children too, not just npx.
          detached: true,
        },
      );
      const running = proc;
      proc.stdout!.resume();
      proc.stderr!.resume();
      (running as unknown as { _persistTo: string })._persistTo = persistTo;
      const deadline = Date.now() + 60_000;
      while (!(await ready())) {
        if (Date.now() > deadline) throw new Error(`dev server on :${port} did not become ready`);
        await new Promise((r) => setTimeout(r, 500));
      }
    },
    async stop(): Promise<void> {
      if (proc === null) return;
      const running = proc;
      const persistTo = (running as unknown as { _persistTo?: string })._persistTo;
      // Signal the whole process group (negative pid) so the workerd child that actually
      // binds the port dies too, then wait until the port is free before returning.
      try {
        process.kill(-running.pid!, 'SIGKILL');
      } catch {
        try {
          running.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
      await new Promise<void>((resolve) => {
        if (running.exitCode !== null || running.signalCode !== null) resolve();
        else running.once('exit', () => resolve());
      });
      proc = null;
      const gone = async (): Promise<boolean> => {
        try {
          await fetch(base, { signal: AbortSignal.timeout(1000) });
          return false;
        } catch {
          return true;
        }
      };
      const deadline = Date.now() + 15_000;
      while (!(await gone())) {
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      if (persistTo) {
        try {
          rmSync(persistTo, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    },
  };
}
