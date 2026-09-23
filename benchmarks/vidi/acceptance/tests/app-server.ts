// The implementation under test, served by `wrangler dev` from the workspace.
//
// Owned by globalSetup (the runner's main process) rather than a worker
// fixture: Playwright restarts a worker after every failed test, and a worker
// fixture would re-launch wrangler each time. Tests that need a restart ask the
// control endpoint, which runs in the same process as the server.
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const APP_PORT = Number(process.env.ACCEPT_PORT ?? 18787);
export const CONTROL_PORT = APP_PORT + 1;
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;
export const CONTROL_URL = `http://127.0.0.1:${CONTROL_PORT}`;

const SERVER_READY_TIMEOUT_MS = 120_000;
const SERVER_POLL_MS = 500;
const SERVER_STOP_GRACE_MS = 3_000;
const HTTP_SERVER_ERROR = 500;

export class AppServer {
  private proc: ChildProcess | null = null;
  private readonly persistDir = mkdtempSync(join(tmpdir(), 'vidi-accept-'));

  constructor(private readonly workspace: string) {}

  async start() {
    this.proc = spawn(
      'npx',
      ['wrangler', 'dev', '--port', String(APP_PORT), '--ip', '127.0.0.1',
       '--persist-to', this.persistDir, '--log-level', 'warn',
       '--show-interactive-dev-session=false'],
      { cwd: this.workspace, detached: true, stdio: 'ignore',
        env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } },
    );
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.proc.exitCode !== null) throw new Error(`wrangler dev exited with ${this.proc.exitCode}`);
      try {
        const r = await fetch(APP_URL + '/');
        if (r.status < HTTP_SERVER_ERROR) return;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, SERVER_POLL_MS));
    }
    throw new Error('wrangler dev did not become ready');
  }

  async stop() {
    const pid = this.proc?.pid;
    if (!pid) return;
    try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ }
    await new Promise((r) => setTimeout(r, SERVER_STOP_GRACE_MS));
    try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
    this.proc = null;
  }

  async restart() {
    await this.stop();
    await this.start();
  }
}

// POST /restart → restarts wrangler (same persisted state), 200 when ready.
export function controlServer(app: AppServer): Server {
  return createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/restart') {
      try { await app.restart(); res.writeHead(200).end('ok'); }
      catch (e) { res.writeHead(HTTP_SERVER_ERROR).end(String(e)); }
      return;
    }
    res.writeHead(404).end();
  }).listen(CONTROL_PORT, '127.0.0.1');
}
