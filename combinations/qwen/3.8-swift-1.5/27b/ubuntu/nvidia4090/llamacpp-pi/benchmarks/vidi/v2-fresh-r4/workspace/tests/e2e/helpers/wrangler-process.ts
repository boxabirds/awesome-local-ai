/**
 * Starts / stops / restarts a real `wrangler dev --persist-to <dir>` process so
 * E2E tests can exercise persistence across genuine process restarts.
 *
 * The process is spawned detached (its own process group) so it can be killed
 * wholesale (wrangler spawns workerd as a child). Proxy env vars are stripped:
 * the ambient http(s)_proxy would otherwise intercept localhost traffic.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';

export interface WranglerOptions {
  port: number;
  inspectorPort: number;
  /** Directory for `--persist-to`; DO state survives restarts within it. */
  persistDir: string;
  /** Repository root (where node_modules and wrangler.jsonc live). */
  cwd: string;
  /** When true, starts the worker with TEST_HOOKS=1 (enables /test/corrupt+repair). */
  testHooks?: boolean;
}

export class WranglerProcess {
  private child: ChildProcess | null = null;
  private readonly port: number;
  private readonly inspectorPort: number;
  private readonly persistDir: string;
  private readonly cwd: string;
  private readonly testHooks: boolean;

  constructor(opts: WranglerOptions) {
    this.port = opts.port;
    this.inspectorPort = opts.inspectorPort;
    this.persistDir = opts.persistDir;
    this.cwd = opts.cwd;
    this.testHooks = opts.testHooks ?? false;
  }

  get url(): string {
    return `http://localhost:${this.port}`;
  }

  async start(): Promise<void> {
    if (this.child) return;
    const wrangler = path.join(this.cwd, 'node_modules', '.bin', 'wrangler');
    const logStream = createWriteStream(path.join(this.persistDir, 'wrangler.log'), { flags: 'a' });
    const args = [
      'dev',
      '--port',
      String(this.port),
      '--inspector-port',
      String(this.inspectorPort),
      '--persist-to',
      this.persistDir,
    ];
    // wrangler dev neither forwards arbitrary process env vars nor honours
    // `--var` for the worker `env` in this setup; a `vars` entry in the config
    // does. Generate a temp config (main config + TEST_HOOKS=1) for the TC-24
    // suite so the /test/corrupt + /test/repair hooks are enabled.
    if (this.testHooks) {
      const mainConfig = JSON.parse(readFileSync(path.join(this.cwd, 'wrangler.jsonc'), 'utf8'));
      mainConfig.vars = { ...(mainConfig.vars ?? {}), TEST_HOOKS: '1' };
      // The temp config lives in the persistDir, so make the (relative) entry
      // point and assets directory absolute so they still resolve to the repo.
      if (mainConfig.main) {
        mainConfig.main = path.join(this.cwd, mainConfig.main);
      }
      if (mainConfig.assets?.directory) {
        mainConfig.assets.directory = path.join(this.cwd, mainConfig.assets.directory);
      }
      const tempConfig = path.join(this.persistDir, 'wrangler.test.jsonc');
      writeFileSync(tempConfig, JSON.stringify(mainConfig, null, 2));
      args.push('--config', tempConfig);
    }
    this.child = spawn(
      wrangler,
      args,
      {
        cwd: this.cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          http_proxy: '',
          https_proxy: '',
          HTTP_PROXY: '',
          HTTPS_PROXY: '',
          no_proxy: 'localhost,127.0.0.1',
          NO_PROXY: 'localhost,127.0.0.1',
        },
      },
    );
    this.child.stdout?.pipe(logStream);
    this.child.stderr?.pipe(logStream);
    this.child.on('exit', () => {
      this.child = null;
    });
    await this.waitForReady();
  }

  private async waitForReady(timeoutMs = 120_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(this.url);
        if (res.status === 200) return;
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error('wrangler dev did not become ready in time');
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child) return;
    const pid = child.pid;
    if (pid) {
      // Kill the whole process group (wrangler + workerd), then the process.
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
}
