/**
 * Owning the `wrangler dev` process, because these tests are about what happens
 * when it goes away (persist.room, story 4's e2e).
 *
 * The integration project can evict a Durable Object; only this file can produce
 * the thing the PRD is actually about — a server process that stops knowing the
 * board at all, while the SQLite file on disk still knows it. So the suite starts
 * `wrangler dev --persist-to <own directory>`, waits for it to answer, and kills
 * it: politely, the way a deploy that lets the request finish does, or without
 * warning, the way a machine that stops does. Both are exercised, because the
 * guarantee is supposed to hold either way.
 *
 * The state directory belongs to one run and is deleted at the end, so no test
 * can inherit a board from the previous one by accident.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/** How long a `wrangler dev` gets to serve its first request. */
const START_TIMEOUT_MS = 180_000;

export interface WranglerOptions {
  /** Where the app is served; must be free. */
  port: number;
  /** `wrangler dev`'s inspector port; also inside the allocated range. */
  inspectorPort: number;
  /** Reuse this state directory instead of making one (a run that restarts). */
  persistTo?: string;
}

/** How a run ends. */
export type StopHow =
  /** SIGTERM, then SIGKILL if it will not go: a deploy that lets the request finish. */
  | "shutdown"
  /** SIGKILL immediately: the machine stopped, nothing got to say goodbye. */
  | "crash";

interface StorageFile {
  readonly name: string;
  readonly bytes: number;
}

/**
 * One `wrangler dev`, with its own local state directory.
 *
 * Child processes are signalled as a group: `wrangler dev` runs the worker in a
 * workerd child, and a test that killed only the parent would leave that child
 * holding the port — which would show up as a mysterious failure in the *next*
 * test instead of in this one.
 */
export class WranglerProcess {
  readonly port: number;
  readonly inspectorPort: number;
  /** Where this board's SQLite file lives between runs. */
  readonly persistTo: string;
  /** Everything the process wrote, kept for the failure message. */
  readonly log: string[] = [];

  #child: ChildProcess | undefined;
  #stopped = true;

  constructor(options: WranglerOptions) {
    this.port = options.port;
    this.inspectorPort = options.inspectorPort;
    this.persistTo =
      options.persistTo ?? mkdtempSync(join(tmpdir(), "vidi6-persist-"));
  }

  /** The app's origin. */
  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Start it, and do not answer until it answers a request. */
  async start(): Promise<this> {
    if (this.#child) throw new Error("this wrangler has already been started");
    this.#stopped = false;
    const child = spawn(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "dev",
        "--port",
        String(this.port),
        "--ip",
        "127.0.0.1",
        "--inspector-port",
        String(this.inspectorPort),
        // The test-only routes of `src/worker/test-hooks.ts`: on for every server
        // a test starts, off for everything that ships.
        "--var",
        "TEST_HOOKS:1",
        "--persist-to",
        this.persistTo,
      ],
      {
        cwd: process.cwd(),
        // Its own process group, so `stop` can take the workerd child with it.
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.#child = child;
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding("utf8");
      stream?.on("data", (chunk: string) =>
        this.log.push(...chunk.split("\n")),
      );
    }
    // A process that dies early would otherwise take the test runner with it.
    child.on("error", (error) =>
      this.log.push(`spawn error: ${error.message}`),
    );
    child.on("exit", (code, signal) => {
      this.log.push(
        `exited (code=${code ?? "none"} signal=${signal ?? "none"})`,
      );
      this.#stopped = true;
    });
    await this.#waitUntilReady();
    return this;
  }

  /** Stop it, and do not answer until nothing serves the port any more. */
  async stop(how: StopHow = "shutdown"): Promise<void> {
    const child = this.#child;
    this.#child = undefined;
    const pid = child?.pid;
    if (!pid) {
      this.#stopped = true;
      return;
    }
    const signalGroup = (signal: NodeJS.Signals): void => {
      try {
        // A negative pid is the whole group, workerd child included.
        process.kill(-pid, signal);
      } catch {
        // Already gone, which is normal for the child of a killed parent.
      }
    };
    signalGroup(how === "crash" ? "SIGKILL" : "SIGTERM");
    if (how === "shutdown") {
      // A graceful stop gets a moment to finish what it is answering.
      const until = Date.now() + 8_000;
      while (!this.#stopped && Date.now() < until) await sleep(50);
      if (!this.#stopped) signalGroup("SIGKILL");
    }
    const dead = Date.now() + 8_000;
    while (!this.#stopped && Date.now() < dead) await sleep(50);
    if (!this.#stopped) throw new Error(`wrangler (pid ${pid}) would not die`);
    await this.#waitUntilPortFree();
  }

  /** Stop and start again over the same directory: a deploy, a restart, a crash. */
  async restart(how: StopHow = "shutdown"): Promise<void> {
    const bytes = this.storageBytes();
    await this.stop(how);
    this.log.push(
      `--- restarting (${how}); local state before: ${bytes} bytes ---`,
    );
    await this.start();
  }

  /** Delete the local state. Only for a run that is finished with its boards. */
  dispose(): void {
    if (this.#child)
      throw new Error("wrangler is still running; stop it before disposing");
    rmSync(this.persistTo, { recursive: true, force: true });
  }

  /**
   * How much local state there is, in bytes, across every file of the state
   * directory. A restart that "kept" a board while the files went to zero would
   * be a test proving nothing, so the number behind the claim is logged with it.
   */
  storageBytes(): number {
    return this.storageFiles(Infinity).reduce(
      (total, file) => total + file.bytes,
      0,
    );
  }

  /** The state directory as `name`/`bytes` entries (bounded, for a log line). */
  storageFiles(limit = 12): StorageFile[] {
    const walk = (dir: string, depth: number): StorageFile[] => {
      if (depth > 6) return [];
      const found: StorageFile[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...walk(path, depth + 1));
        else if (entry.isFile())
          found.push({
            name: relative(this.persistTo, path),
            bytes: statSync(path).size,
          });
      }
      return found;
    };
    try {
      const all = walk(this.persistTo, 0);
      return Number.isFinite(limit) ? all.slice(-limit) : all;
    } catch {
      return [];
    }
  }

  /** What the process wrote, newest last. */
  logTail(lines = 40): string {
    return this.log
      .filter((line) => line.trim() !== "")
      .slice(-lines)
      .join("\n");
  }

  /** Fail a test with the server's own last words attached. */
  failWithLog(what: string): never {
    throw new Error(`${what}\n--- wrangler, last words ---\n${this.logTail()}`);
  }

  async #waitUntilReady(): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
      if (await this.#answers()) return;
      if (this.#stopped)
        this.failWithLog("wrangler dev exited before it served the app");
      if (Date.now() > deadline) {
        this.failWithLog(
          `wrangler dev did not serve ${this.url} within ${START_TIMEOUT_MS}ms`,
        );
      }
      await sleep(250);
    }
  }

  /** The app itself, not merely a port that answers. */
  async #answers(): Promise<boolean> {
    try {
      const response = await fetch(`${this.url}/`, {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Wait until nothing answers on the port. The next run cannot start until the
   * port is really free, and a `wrangler dev` left behind would make a later
   * test silently talk to the wrong server.
   */
  async #waitUntilPortFree(): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      if (!(await this.#answers())) return;
      if (Date.now() > deadline)
        throw new Error(`port ${this.port} is still serving after stopping`);
      await sleep(100);
    }
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
