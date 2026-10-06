/**
 * A `wrangler dev` process that a test owns, over its own storage directory.
 *
 * Story 4's promises are about what survives the process going away, and the only honest way to
 * test that is to make it go away: these servers are killed with `SIGKILL`, so nothing gets a
 * chance to flush, tidy up or finish a transaction - which is exactly the moment a "we saved it"
 * claim has to hold up.
 *
 * Two things about the setup matter:
 *
 * - the storage directory is a fresh temporary directory *outside the source tree*. The suite's
 *   shared server keeps its own state in `.wrangler/e2e`; a restart test that reused it could
 *   destroy another test's board, and a test that deleted its directory before its server had
 *   stopped would leave a process pointing at a path that no longer exists (so `dispose` stops
 *   the process, waits for the port to fall silent, and only then removes the directory);
 * - each server gets its own port pair from the range reserved for this agent, keyed by the
 *   Playwright worker index, so restart tests can run alongside the shared server on 28816 and
 *   alongside each other.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root: this file lives in `tests/e2e/helpers`. */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** First port a restart test may use; the shared server has 28816/28817. */
const PORT_FIRST = Number(process.env.VIDI6_E2E_RESTART_PORT_FIRST ?? 28820);
/** Six (server, inspector) pairs, ending exactly at the last port this agent may bind. */
const PORT_PAIRS = 6;

/** The port pair for the nth concurrently possible restart server. */
export function restartPorts(index: number): { port: number; inspectorPort: number } {
  const slot = ((index % PORT_PAIRS) + PORT_PAIRS) % PORT_PAIRS;
  const port = PORT_FIRST + slot * 2;
  return { port, inspectorPort: port + 1 };
}

const START_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 15_000;

export interface WranglerProcessOptions {
  /**
   * Whether this server answers the test-only storage hooks at `/__test/boards/...`
   * (`TEST_HOOKS=1`). On by default, because a restart test is the kind of test that wants them;
   * switched off to see what a server without them does, which is what production is.
   */
  readonly testHooks?: boolean;
}

export class WranglerProcess {
  /** Where this server's Durable Object storage lives, kept until the server is stopped. */
  readonly persistDir: string;
  readonly port: number;
  readonly inspectorPort: number;

  #child: ChildProcess | null = null;
  #log = '';
  readonly #testHooks: boolean;

  constructor(workerIndex = 0, options: WranglerProcessOptions = {}) {
    const ports = restartPorts(workerIndex);
    this.port = ports.port;
    this.inspectorPort = ports.inspectorPort;
    this.persistDir = join(tmpdir(), `vidi6-restart-${ports.port}-${process.pid}`);
    this.#testHooks = options.testHooks ?? true;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** The address a WebSocket client (a seeding script) connects to. */
  get wsUrl(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  get running(): boolean {
    return this.#child !== null;
  }

  /** The last thing the server printed, for failure messages. */
  get log(): string {
    return this.#log.slice(-4000);
  }

  /**
   * Starts the server over `persistDir` and waits until it answers.
   *
   * The client bundle has to exist because, like production, this server serves `dist/client`
   * through the Worker. The suite's shared server builds it; a run that started only this project
   * builds it here, once.
   */
  async start(): Promise<void> {
    if (this.running) throw new Error('this server is already running');
    await ensureClientBuild();
    // a directory per server, recreated on restart so the same board is found again
    const bin = existsSync(join(ROOT, 'node_modules/.bin/wrangler'))
      ? join(ROOT, 'node_modules/.bin/wrangler')
      : 'wrangler';
    const child = spawn(
      bin,
      [
        'dev',
        '--config',
        join(ROOT, 'wrangler.jsonc'),
        '--ip',
        '127.0.0.1',
        '--port',
        String(this.port),
        '--inspector-port',
        String(this.inspectorPort),
        '--persist-to',
        this.persistDir,
        '--log-level',
        'log',
        // the storage hooks: the two routes that make this server's boards unreadable and readable
        // again. Production config never mentions them.
        ...(this.#testHooks ? ['--var', 'TEST_HOOKS:1'] : []),
      ],
      {
        cwd: ROOT,
        // its own process group: `wrangler dev` starts workd (and on some platforms a helper),
        // and "the process died" has to mean all of them, or the port stays taken
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      },
    );
    this.#child = child;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.#collect(chunk));
    child.stderr?.on('data', (chunk: string) => this.#collect(chunk));

    const died = new Promise<never>((_resolve, reject) => {
      child.once('exit', (code, signal) => {
        reject(new Error(`wrangler dev exited early (${code ?? signal})\n${this.log}`));
      });
    });
    const ready = this.#waitForReady();
    try {
      await Promise.race([ready, died]);
    } catch (error) {
      await this.stop();
      throw error;
    }
    // the exit listener that reports an early death must not fire once the server stops on
    // purpose, and a listener per start would pile up over a restart
    child.removeAllListeners('exit');
    child.once('exit', () => {
      this.#child = null;
    });
  }

  /**
   * Kills the server as if the machine lost it: `SIGKILL` to the whole process group, then wait
   * until the port stops answering so the next start cannot talk to the old one.
   */
  async stop(): Promise<void> {
    const child = this.#child;
    if (!child || child.pid === undefined) {
      this.#child = null;
      return;
    }
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // the group was already gone
    }
    await withTimeout(exited, STOP_TIMEOUT_MS, 'wrangler dev would not die');
    this.#child = null;
    await this.#waitForSilence();
  }

  /** Stop, then start again over the same storage: the restart the story is about. */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Stops the server and removes its storage. Safe to call twice. */
  async dispose(): Promise<void> {
    await this.stop();
    await rm(this.persistDir, { recursive: true, force: true });
  }

  #collect(chunk: string): void {
    this.#log = (this.#log + chunk).slice(-64_000);
  }

  async #waitForReady(): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
      try {
        const response = await fetch(`${this.baseUrl}/`, { signal: AbortSignal.timeout(2000) });
        if (response.status < 500) return;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        throw new Error(`wrangler dev on port ${this.port} never became ready\n${this.log}`);
      }
      await rest(250);
    }
  }

  async #waitForSilence(): Promise<void> {
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    for (;;) {
      try {
        await fetch(`${this.baseUrl}/`, { signal: AbortSignal.timeout(1000) });
      } catch {
        return; // refused: the port is free
      }
      if (Date.now() > deadline) return;
      await rest(100);
    }
  }
}

/** Builds the client if it is not built yet (the shared webServer normally does this). */
async function ensureClientBuild(): Promise<void> {
  if (existsSync(join(ROOT, 'dist/client/index.html'))) return;
  const { status, stderr } = await new Promise<{ status: number; stderr: string }>(
    (resolve) => {
      const child = spawn('npm', ['run', 'build:test'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.once('exit', (code) => resolve({ status: code ?? 1, stderr }));
    },
  );
  if (status !== 0 || !existsSync(join(ROOT, 'dist/client/index.html'))) {
    throw new Error(`the client build needed by the restart server failed:\n${stderr}`);
  }
}

function rest(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise: Promise<void>, ms: number, message: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    await Promise.race([promise, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
