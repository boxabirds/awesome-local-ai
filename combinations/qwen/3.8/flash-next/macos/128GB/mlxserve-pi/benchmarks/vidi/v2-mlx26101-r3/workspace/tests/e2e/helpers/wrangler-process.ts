import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A `wrangler dev` process that a test starts and stops.
 *
 * The ordinary browser tests share one dev server, started by Playwright before the run and reused
 * from one test to the next - which is the right thing for a story about what two people see, and
 * the wrong thing for this one: a board that comes back after the service forgets its memory can
 * only be tested against a service that really does forget. So these tests own the process: start
 * it, work on a board, stop it, start it again with the same storage directory, and look at the
 * board.
 *
 * What that buys, and the three things that make it worth having:
 *
 * - the storage directory is the same on both halves, so the only place the second process can get
 *   the board from is the file the first one wrote;
 * - the process is a different one, and the process ids are logged;
 * - the port it answers on was free before it bound, so whoever replies to the test's questions is
 *   the new process and not something left over from the old one.
 *
 * The third one matters more than it sounds. A dev server is a small tree - `npx`, wrangler, and
 * workd at the bottom - and workd does not always go when its parent is told to: on this machine
 * a `workerd` was found holding the port after `wrangler` had exited. A leftover server is the one
 * thing that makes a persistence test pass while proving nothing, because it answers every question
 * about a restarted board out of the memory it never lost. Hence the asking below, which is done
 * rather than assumed: the machine's own list of listening sockets is looked at for a port, and a
 * process that dies saying the port was already bound is started again on another one.
 */

/** How long a dev server is allowed to take to answer its first request. */
const READY_TIMEOUT_MS = 180_000;
/** How long a stopped server is given to go before it is made to go. */
const STOP_TIMEOUT_MS = 20_000;
/** How long a stopped server is given to hand its ports back before being insisted upon. */
const PORT_GIVES_UP_MS = 5_000;
/** How many ports to look at for one server before giving up on finding one. */
const PORTS_TO_TRY = 20;
/** Lines of server output kept, for the failure message of a test that could not start a server. */
const OUTPUT_KEPT = 400;

export interface ServerOptions {
  /** The port to ask for; the inspector takes the next one, as the shared config does. */
  port: number;
  /** Where storage lives. Two servers given the same directory are the same service. */
  persistTo?: string;
}

/** Whether anything is listening on a port, asked of the machine. This is the fallback question. */
function somethingIsListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(1_000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Remembered answer to "will `netstat` talk about sockets on this machine". */
let askedNetstatAboutSockets: boolean | null = null;

/**
 * Every socket listening on a local port, with the process ids behind it, or nothing where the
 * machine will not say.
 *
 * `netstat -anv -p tcp` is the machine's own list, which is a better answer than a connect: in this
 * sandbox a connect to parts of the port range is refused by the sandbox itself and not by whoever
 * might be holding the port, and a "nobody home" that came from the middle of the network says
 * nothing about the port at the end of it. Where that is not available this says nothing, and the
 * connect probe is asked instead - which on a normal machine gives the same answer.
 */
function socketsBeingListenedTo(): Map<number, number[]> | null {
  if (askedNetstatAboutSockets === false) {
    return null;
  }
  let output = '';
  try {
    output = execFileSync('netstat', ['-anv', '-p', 'tcp'], { encoding: 'utf8' });
  } catch {
    askedNetstatAboutSockets = false;
    return null;
  }
  const listening = new Map<number, number[]>();
  for (const line of output.split('\n')) {
    const match = /^\S+\s+\S+\s+\S+\s+127\.0\.0\.1\.(\d+)\s+\S+\s+LISTEN\b(.*)$/.exec(line.trim());
    if (match === null) {
      continue;
    }
    const port = Number(match[1]);
    // The process column names the process and its pid after a colon, like `workerd:75199`.
    const column = match[2]!.split(/\s+/).filter((field) => field.includes(':')).pop() ?? '';
    const pid = /:(\d+)$/.exec(column);
    const holder = pid === null ? NaN : Number(pid[1]);
    const held = listening.get(port) ?? [];
    if (Number.isInteger(holder) && holder > 0 && !held.includes(holder)) {
      held.push(holder);
    }
    listening.set(port, held);
  }
  if (listening.size === 0) {
    // A machine with nothing listening anywhere is not a machine that answered; it is one that did
    // not. Ask it the other way next time rather than believing an empty list.
    return null;
  }
  askedNetstatAboutSockets = true;
  return listening;
}

/** Whether a port is free: the machine's list where it has one, a connect where it has not. */
async function portIsFree(port: number, listening: Map<number, number[]> | null): Promise<boolean> {
  if (listening !== null) {
    return !listening.has(port);
  }
  return !(await somethingIsListening(port));
}

/**
 * The process ids holding a port, where the machine will say.
 *
 * What it takes to stop the worker a dev server leaves behind: it has no parent this test can see
 * and leaves no pid file. Where the machine will not say this names nobody, and the group kill is
 * left to do the work by itself - which on a normal machine it does.
 */
function holdersOf(port: number): number[] {
  return socketsBeingListenedTo()?.get(port) ?? [];
}

/** Tell a process, or a whole group of them, to stop - and be unmoved if it has already gone. */
function signal(target: number, signalName: NodeJS.Signals): void {
  try {
    process.kill(target, signalName);
  } catch {
    // Already gone, which is the other way a process stops.
  }
}

/**
 * Whether a process that died before answering says the port was somebody else's.
 *
 * This is the failure worth starting again for. Anything else - a missing binary, a bad
 * configuration - is the same on every port, and repeating it twenty times would only be slower.
 */
function wasBoundBySomebodyElse(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /Address already in use/i.test(text) || /EADDRINUSE/i.test(text);
}

/**
 * Whether a failed request was refused by the machine before it reached anything.
 *
 * `EPERM`/`EACCES` on a connect to localhost is not a server that has not started; it is a policy
 * that says this process may not speak to that port, and a test that waits for one waits until its
 * timeout with nothing to show for it.
 */
function theMachineRefusesThePort(error: unknown): boolean {
  const withItsCause =
    error instanceof Error
      ? `${error.message} ${String((error as { cause?: unknown }).cause ?? '')}`
      : String(error);
  return /\bEPERM\b/.test(withItsCause) || /\bEACCES\b/.test(withItsCause);
}

/** A moment to wait before asking the same question again. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** A directory for storage that outlives one server, which is what a restart needs. */
export function storageDir(): string {
  return mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
}

export class BoardServer {
  /** Where storage lives. Given to the next process to make it the same service. */
  readonly persistTo: string;
  /** Whatever the server printed, newest last, for when a test fails and nobody knows why. */
  readonly output: string[] = [];
  private readonly askedPort: number;
  /** Ports this server tried and could not bind, so that the next look skips past them. */
  private readonly triedAndFailed = new Set<number>();
  private ownsTheStorage = false;
  private child: ChildProcess | null = null;
  private servingPort: number;

  private constructor(options: ServerOptions) {
    this.askedPort = options.port;
    this.servingPort = options.port;
    if (options.persistTo === undefined) {
      this.persistTo = storageDir();
      this.ownsTheStorage = true;
    } else {
      this.persistTo = options.persistTo;
    }
  }

  /** Start a server and wait until it is serving the built client. */
  static async start(options: ServerOptions): Promise<BoardServer> {
    const server = new BoardServer(options);
    await server.run();
    return server;
  }

  /** Where the board is answered from. Pages are opened on this, not on a port someone assumes. */
  get origin(): string {
    return `http://127.0.0.1:${String(this.servingPort)}`;
  }

  get port(): number {
    return this.servingPort;
  }

  /** What the process was called, for a test that has to know a restart really happened. */
  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  /** The address of a board, the way a person types it. */
  boardUrl(boardId: string): string {
    return `${this.origin}/b/${boardId}`;
  }

  /** The address a client's socket goes to, which is the room's own door. */
  socketUrl(boardId: string): string {
    return `ws://127.0.0.1:${String(this.servingPort)}/api/rooms/${boardId}`;
  }

  /**
   * Stop the server.
   *
   * Asked politely by default, which is what a restart, a deploy and a `Ctrl-C` all are: the
   * process is told to stop and gets to finish what it is writing. `kill` is for a test that wants
   * the process gone without that courtesy - and it is worth knowing that what a hard kill can lose
   * is SQLite's own write-back, which is the platform's disk rather than anything this story is
   * responsible for, so no test here needs it.
   */
  async stop(how: 'stop' | 'kill' = 'stop'): Promise<void> {
    const child = this.child;
    if (child === null || child.pid === undefined) {
      return;
    }
    const pid = child.pid;
    // The process group, not just the process: `npx` sits on top of wrangler, wrangler sits on top
    // of workd, and the one that matters is whichever of them is holding the port.
    signal(-pid, how === 'kill' ? 'SIGKILL' : 'SIGTERM');
    await new Promise<void>((resolve) => {
      const impatient = setTimeout(() => {
        signal(-pid, 'SIGKILL');
        resolve();
      }, STOP_TIMEOUT_MS);
      child.once('exit', () => {
        clearTimeout(impatient);
        resolve();
      });
    });
    this.child = null;
    await this.waitForThePortsToBeGivenUp(pid);
  }

  /** Stop it and take its storage with it, which is what a test finished with it wants. */
  async dispose(): Promise<void> {
    await this.stop();
    if (this.ownsTheStorage) {
      rmSync(this.persistTo, { recursive: true, force: true });
    }
  }

  /**
   * Stop, and come back with the same storage.
   *
   * This is the operation the story is about, so it is on the object rather than something each
   * test assembles: a new process - no memory, no room, no document - reading the same rows. The
   * logged process ids are not decoration, and neither is the port being asked for again: a
   * "restart" that left the old server answering would still show the board, and the test would
   * pass while nothing had been shown. See the note at the top of this file.
   */
  async restart(): Promise<BoardServer> {
    const previous = this.pid;
    await this.stop();
    await this.run();
    console.log(
      `[persist] restarted: pid ${String(previous)} has gone, pid ${String(this.pid)} answers on ` +
        `${this.origin} from ${this.persistTo}`,
    );
    return this;
  }

  /** Everything it printed, for a failure message. */
  tail(): string {
    return this.output.slice(-40).join('\n');
  }

  private async run(): Promise<void> {
    if (this.child !== null) {
      throw new Error('this server is already running');
    }
    let lastFailure: unknown = null;
    // A port that was free when it was asked can be taken by the time workd binds it, and on this
    // machine the asking is not always able to see who holds what. A server that dies on a bind
    // error is therefore started again elsewhere rather than being this test's last word. That is
    // worth the loop because of the one thing these tests rest on: whatever answers a question about
    // a restarted board has to be the process that was started for the question, and a server that
    // quietly failed to start while an older one carries on answering is exactly how a persistence
    // test passes while proving nothing.
    for (let attempt = 0; attempt < PORTS_TO_TRY; attempt += 1) {
      this.servingPort = await this.findAPort();
      try {
        await this.startTheProcess();
        return;
      } catch (error) {
        lastFailure = error;
        if (!wasBoundBySomebodyElse(error)) {
          throw error;
        }
        this.triedAndFailed.add(this.servingPort);
        this.triedAndFailed.add(this.servingPort + 1);
        console.log(
          `[persist] ${this.origin} was free when it was asked and taken when it was bound; ` +
            'looking for another port',
        );
      }
    }
    throw lastFailure instanceof Error
      ? lastFailure
      : new Error(`no dev server could be started from port ${String(this.askedPort)}`);
  }

  /** The process itself: spawn it, and do not count it as running until it has answered once. */
  private async startTheProcess(): Promise<void> {
    const child = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--ip',
        '127.0.0.1',
        '--port',
        String(this.servingPort),
        '--inspector-port',
        String(this.servingPort + 1),
        '--persist-to',
        this.persistTo,
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.child = child;
    const collect = (chunk: Buffer): void => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim() !== '') {
          this.output.push(line);
        }
      }
      if (this.output.length > OUTPUT_KEPT) {
        this.output.splice(0, this.output.length - OUTPUT_KEPT);
      }
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    // A server that dies before it answers is this test's problem; one that dies afterwards is the
    // stop that was always going to happen, and must not come back as an unhandled rejection in a
    // test that has already passed.
    await new Promise<void>((resolve, reject) => {
      const died = (code: number | null): void => {
        reject(
          new Error(`the dev server exited with ${String(code)} before it was ready:\n${this.tail()}`),
        );
      };
      child.once('exit', died);
      this.waitUntilItIsAnswering().then(
        () => {
          child.removeListener('exit', died);
          console.log(
            `[persist] serving ${this.origin} as pid ${String(child.pid)} from ${this.persistTo}`,
          );
          resolve();
        },
        (error: unknown) => {
          child.removeListener('exit', died);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  /**
   * A port this server can have, which means this port and the inspector's are both free.
   *
   * The requested one is asked for first and, if something is holding it, the next few are looked
   * at - because the alternative is a test that talks to whatever is already there, and on this
   * machine that something is occasionally a workd that outlived the server it belonged to. Ports
   * this server has already failed to bind are left out of the asking, so that a second attempt
   * looks for a different port and not for the same one.
   */
  private async findAPort(): Promise<number> {
    const listening = socketsBeingListenedTo();
    const held = (port: number): string => {
      const who = listening?.get(port) ?? holdersOf(port);
      return who.length > 0 ? `held by ${who.join(', ')}` : 'not free';
    };
    for (let offset = 0; offset < PORTS_TO_TRY; offset += 1) {
      const port = this.askedPort + offset;
      if (this.triedAndFailed.has(port) || this.triedAndFailed.has(port + 1)) {
        continue;
      }
      if ((await portIsFree(port, listening)) && (await portIsFree(port + 1, listening))) {
        if (port !== this.askedPort) {
          console.log(
            `[persist] port ${String(this.askedPort)} is ${held(this.askedPort)} ` +
              `(pids ${holdersOf(this.askedPort).join(', ') || 'unnamed'}); serving ${String(port)} instead`,
          );
        }
        return port;
      }
    }
    throw new Error(
      `no free port found from ${String(this.askedPort)} to ${String(
        this.askedPort + PORTS_TO_TRY - 1,
      )}; something is holding all of them`,
    );
  }

  /**
   * Wait for the ports to come back, and insist once.
   *
   * A leftover that will not be moved is reported rather than fatal, and that is safe only because
   * of what happens next: the next server takes a port that was verified free, so a leftover can
   * answer a test's questions about a board no more than a stranger can. Its storage directory is a
   * different one, which is the other half of why a leftover cannot help but be irrelevant.
   */
  private async waitForThePortsToBeGivenUp(pid: number): Promise<void> {
    const patient = Date.now() + PORT_GIVES_UP_MS;
    let held = await this.heldPorts();
    while (held.length > 0 && Date.now() < patient) {
      await sleep(200);
      held = await this.heldPorts();
    }
    if (held.length === 0) {
      return;
    }
    signal(-pid, 'SIGKILL');
    for (const port of held) {
      for (const holder of holdersOf(port)) {
        signal(holder, 'SIGKILL');
      }
    }
    await sleep(1_000);
    const still = await this.heldPorts();
    if (still.length > 0) {
      console.log(
        `[persist] ports ${still.join(', ')} are still held (pids ${
          holdersOf(still[0]!).join(', ') || 'unnamed'
        }) after pid ${String(pid)} was stopped; the next server is served elsewhere, so this ` +
          'leftover cannot answer for the board',
      );
    }
  }

  /** Which of this server's ports something is still listening on. */
  private async heldPorts(): Promise<number[]> {
    const listening = socketsBeingListenedTo();
    const ports = [this.servingPort, this.servingPort + 1];
    const free = await Promise.all(ports.map((port) => portIsFree(port, listening)));
    return ports.filter((_port, index) => free[index] === false);
  }

  private async waitUntilItIsAnswering(): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      try {
        const response = await fetch(`${this.origin}/`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (response.ok || response.status === 404) {
          return;
        }
      } catch (error) {
        if (theMachineRefusesThePort(error)) {
          // Not "not listening yet". The request was refused before it went anywhere, which means no
          // amount of waiting is going to be answered - and the port is the only thing worth saying.
          throw new Error(
            `this test cannot reach ${this.origin} at all: the connection to port ${String(
              this.servingPort,
            )} was refused by the machine rather than by a server. Some sandboxes carry traffic to a\n` +
              `few ports and refuse the rest; this server is looking for a free one from port ${String(
                this.askedPort,
              )}.\nRun it with PERSIST_E2E_PORT set to a port this machine will carry to, or move\n` +
              `the starting port in tests/e2e/persistence.spec.ts. What the server said:\n${this.tail()}`,
          );
        }
        // Anything else is a server that is not listening yet, which is the normal first few seconds.
      }
      if (Date.now() > deadline) {
        throw new Error(`the dev server on ${this.origin} never answered:\n${this.tail()}`);
      }
      await sleep(250);
    }
  }
}
