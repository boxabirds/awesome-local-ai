import { execSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const PORT = Number(process.env.INTEGRATION_PORT ?? 9111);

let serverProcess: ChildProcess | undefined;

export async function setup() {
  // Build client assets first (required by wrangler's assets binding)
  execSync('npx vite build --mode test', { cwd: root, stdio: 'pipe' });

  // Start wrangler dev as a child process
  serverProcess = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(PORT)], {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env },
  });

  // Capture stderr for debugging
  serverProcess.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    if (process.env.DEBUG_INTEGRATION) process.stderr.write(text);
  });
  serverProcess.stdout?.on('data', (data: Buffer) => {
    if (process.env.DEBUG_INTEGRATION) process.stdout.write(data.toString());
  });

  // Wait for server to be ready
  const url = `http://localhost:${PORT}`;
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 200) {
        process.env.INTEGRATION_BASE_URL = url;
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Integration server did not start within 60 seconds`);
}

export async function teardown() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (!serverProcess) { resolve(); return; }
      serverProcess.on('exit', () => resolve());
      setTimeout(() => { serverProcess?.kill('SIGKILL'); resolve(); }, 5000);
    });
  }
}
