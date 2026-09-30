import { spawn, type ChildProcess } from 'child_process';
import { setTimeout as delay } from 'timers/promises';

const PORT = 8899;
const URL = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | null = null;

export async function startServer(): Promise<string> {
  if (server) return URL;

  server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true' },
    cwd: process.cwd(),
  });

  // Log server output for debugging
  server.stdout?.on('data', (data: Buffer) => {
    process.env.DEBUG_SERVER && process.stderr.write('[server] ' + data.toString());
  });
  server.stderr?.on('data', (data: Buffer) => {
    process.env.DEBUG_SERVER && process.stderr.write('[server:err] ' + data.toString());
  });

  // Wait for the server to be ready
  const startTime = Date.now();
  while (Date.now() - startTime < 55000) {
    try {
      const resp = await fetch(`${URL}/`, { method: 'GET' });
      if (resp.status !== 0) {
        return URL;
      }
    } catch {
      // Not ready yet
    }
    await delay(500);
  }
  throw new Error('Server did not start within 30s');
}

export async function stopServer(): Promise<void> {
  if (server) {
    server.kill('SIGTERM');
    await delay(500);
    if (server.exitCode === null) {
      server.kill('SIGKILL');
    }
    server = null;
  }
}

export { PORT, URL };
