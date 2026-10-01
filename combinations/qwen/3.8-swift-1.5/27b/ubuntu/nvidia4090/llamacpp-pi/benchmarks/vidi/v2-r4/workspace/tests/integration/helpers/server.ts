import { startTestServer, stopTestServer } from './test-server.ts';

let started = false;
let startPromise: Promise<void> | null = null;

async function isServerRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch('http://127.0.0.1:8891/', { signal: controller.signal });
    clearTimeout(timeout);
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function ensureServer(): Promise<void> {
  if (started) return;
  if (await isServerRunning()) {
    started = true;
    return;
  }
  if (startPromise) return startPromise;

  startPromise = (async () => {
    await startTestServer();
    started = true;
  })();

  return startPromise;
}

export async function stopServer(): Promise<void> {
  if (started) {
    try {
      await stopTestServer();
    } catch {
      // Server might already be stopped
    }
    started = false;
    startPromise = null;
  }
}
