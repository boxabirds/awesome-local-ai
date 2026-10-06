import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Story 4 e2e helper: a `wrangler dev` process this test owns.
 *
 * The persistence tests are about *process* lifetime, so they cannot share the
 * webServer the story 1-3 e2e project starts (one server, no `--persist-to`,
 * reused across tests). Each test starts its own `wrangler dev` pointed at its
 * own `--persist-to` directory, stops it, and starts another one against the
 * same directory — which is the board waking up with a cold isolate over warm
 * storage.
 */

/** Port for the persistence project; inside the sandbox's allowed range. */
export const PERSIST_PORT = Number(process.env.E2E_PERSIST_PORT ?? 27850);
export const PERSIST_INSPECTOR_PORT = Number(process.env.E2E_INSPECTOR_PORT ?? 27851);

export interface WranglerHandle {
  readonly port: number;
  readonly persistTo: string;
  /** Everything wrangler has written to stdout/stderr so far. */
  logs(): string;
  stop(): Promise<void>;
}

export interface StartOptions {
  port?: number;
  inspectorPort?: number;
  /** Storage directory; a fresh one is created when omitted. */
  persistTo?: string;
  /** Extra wrangler arguments. */
  args?: string[];
}

/** A storage directory that only this test uses. */
export function newPersistDir(prefix = "vidi6-persist-"): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function removePersistDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Starts `wrangler dev --persist-to <dir>` and waits until it answers HTTP. */
export async function startWrangler(options: StartOptions = {}): Promise<WranglerHandle> {
  const port = options.port ?? PERSIST_PORT;
  const inspectorPort = options.inspectorPort ?? PERSIST_INSPECTOR_PORT;
  const persistTo = options.persistTo ?? newPersistDir();

  const child = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--persist-to",
      persistTo,
      ...(options.args ?? []),
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );

  const chunks: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));

  const logs = () => chunks.join("");

  if (!(await waitForReady(port))) {
    const detail = logs();
    await kill(child, port);
    throw new Error(`wrangler dev did not become ready on port ${port}\n${detail}`);
  }

  return {
    port,
    persistTo,
    logs,
    stop: async () => {
      await kill(child, port);
    },
  };
}

/** Stops this wrangler and starts a new one over the same storage directory. */
export async function restartWrangler(handle: WranglerHandle): Promise<WranglerHandle> {
  await handle.stop();
  return startWrangler({ persistTo: handle.persistTo });
}

async function waitForReady(port: number): Promise<boolean> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

/**
 * Kills the whole process group (`npx` → `wrangler` → `workerd` all share it)
 * and waits until the port is actually free, so the next test — or the
 * restarted server in the same test — can bind it.
 */
async function kill(child: ChildProcess, port: number): Promise<void> {
  const signal = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      /* already gone */
    }
  };

  signal("SIGTERM");
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.exitSignal !== null) return resolve();
    child.once("exit", () => resolve());
    setTimeout(() => {
      signal("SIGKILL");
      resolve();
    }, 10_000);
  });
  await waitForPortFree(port);
}

async function waitForPortFree(port: number): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const server = net.createServer();
    const free = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (free) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}
