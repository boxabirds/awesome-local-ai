import { spawn } from 'child_process';
import { rm, mkdir } from 'fs/promises';
import { randomPort } from './port';
import * as path from 'path';

export interface WranglerProcess {
  port: number;
  stateDir: string;
  kill(): Promise<void>;
}

/**
 * Spawn `wrangler dev --persist-to <dir>` on a random free port.
 * Polls a health endpoint for readiness.
 * Kills the process and removes the state dir on teardown.
 */
export async function startWrangler(options?: {
  persistTo?: string;
  configPath?: string;
}): Promise<WranglerProcess> {
  const port = await randomPort();
  const stateDir = options?.persistTo ?? path.join('/tmp', `vidi-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  
  await mkdir(stateDir, { recursive: true });
  
  const args = [
    'wrangler', 'dev',
    '--port', String(port),
    '--ip', '127.0.0.1',
    '--persist-to', stateDir,
  ];
  
  if (options?.configPath) {
    args.push('--config', options.configPath);
  }
  
  const child = spawn('npx', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_DEV_DISABLE_UPDATES: 'true' },
  });
  
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  
  // Poll for readiness
  const deadline = Date.now() + 30000;
  let ready = false;
  
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/`);
      if (resp.status < 500) {
        ready = true;
        break;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  
  if (!ready) {
    child.kill();
    throw new Error(`wrangler dev did not become ready within 30s.\nstderr: ${stderr}`);
  }
  
  return {
    port,
    stateDir,
    kill: async () => {
      child.kill();
      await new Promise<void>(resolve => {
        child.on('exit', () => resolve());
        setTimeout(resolve, 3000);
      });
      await rm(stateDir, { recursive: true, force: true });
    },
  };
}
