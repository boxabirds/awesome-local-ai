import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';

let wranglerProcess: ChildProcess | null = null;

export const PORT = 8799;
export const WS_BASE = `ws://localhost:${PORT}`;
export const HTTP_BASE = `http://localhost:${PORT}`;

export async function setup() {
  // Kill any existing process on this port
  try {
    const { execSync } = await import('node:child_process');
    execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`);
  } catch {}

  await new Promise<void>((resolvePromise, reject) => {
    wranglerProcess = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--local'], {
      cwd: resolve(import.meta.dirname, '../..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'development' },
    });

    let output = '';
    let resolved = false;
    const onData = (data: Buffer) => {
      output += data.toString();
      if (!resolved && (output.includes(`localhost:${PORT}`) || output.includes('Ready'))) {
        resolved = true;
        setTimeout(resolvePromise, 1000);
      }
    };

    wranglerProcess.stdout?.on('data', onData);
    wranglerProcess.stderr?.on('data', onData);

    wranglerProcess.on('error', (err) => {
      if (!resolved) reject(new Error(`Failed to start wrangler dev: ${err.message}`));
    });

    // Fallback: resolve after 30s regardless
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolvePromise();
      }
    }, 30000);
  });
}

export async function teardown() {
  if (wranglerProcess) {
    wranglerProcess.kill('SIGKILL');
    await new Promise<void>((res) => {
      wranglerProcess!.on('exit', () => res());
      setTimeout(res, 3000);
    });
    wranglerProcess = null;
  }
}
