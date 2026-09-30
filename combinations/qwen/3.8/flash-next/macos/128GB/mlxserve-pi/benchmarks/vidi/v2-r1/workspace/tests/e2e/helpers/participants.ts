// Copyright 2026 Board Room contributors. All rights reserved.
//
// Multiple people on one board, in one test. Each participant is a browser
// context of its own — separate storage, separate WebSocket, nothing shared but
// the room — because that is what "another person" means for this app
// (design: Mock vs real boundaries: e2e runs the real `wrangler dev` path).
//
// Specs: spec/stories/003-see-other-people-s-edits-appear-live-on-the-same-b/
import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../../src/shared/config';
import type { ConnectionState } from '../../../src/client/sync/connectBoard';
import { settle } from './board';

/** Names for the people in these scenarios; the first two are the PRD's. */
const PEOPLE = ['Alex', 'Sam', 'Rae', 'Jo', 'Kim', 'Ana', 'Bo'] as const;

/** A note as one screen shows it, addressed by its id instead of its index. */
export interface NoteOnScreen {
  id: string;
  left: number;
  top: number;
  color: string;
  z: number;
  text: string;
  selected: boolean;
  editing: boolean;
}

export interface Position {
  left: number;
  top: number;
}

/** One person: an isolated context, its page, and what its page says. */
export interface Participant {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Everything the browser itself complained about, for "no console errors". */
  readonly consoleErrors: string[];
  /** Everything it logged, for the teardown assertions. */
  readonly consoleLogs: string[];
  /** The connection state the badge is showing, through the test hook. */
  connectionState(): Promise<ConnectionState | null>;
  /** The badge's text, or null when no badge is on screen. */
  badgeText(): Promise<string | null>;
  /** The badge's `data-state` attribute, or null when there is no badge. */
  badgeState(): Promise<string | null>;
  /** Every note this screen shows, keyed by id in the returned map. */
  notes(): Promise<Map<string, NoteOnScreen>>;
  /** One note, or undefined once it is gone everywhere. */
  note(id: string): Promise<NoteOnScreen | undefined>;
  /** The ids this screen shows, sorted: a snapshot to compare between people. */
  snapshot(): Promise<string>;
  close(): Promise<void>;
}

/** Everything the board shows, read in one pass, keyed by note id. */
const readNotes = async (page: Page): Promise<Map<string, NoteOnScreen>> => {
  const read = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]'),
    );
    return nodes.map((element) => {
      const editor = element.querySelector('textarea');
      const textElement = element.querySelector('[data-testid="sticky-note-text"]');
      return {
        id: element.dataset.id ?? '',
        left: Number.parseFloat(element.style.left),
        top: Number.parseFloat(element.style.top),
        color: element.dataset.color ?? '',
        z: Number(element.dataset.z),
        text: editor ? editor.value : (textElement?.textContent ?? ''),
        selected: element.dataset.selected === 'true',
        editing: !!editor,
      };
    });
  });
  return new Map(read.map((note) => [note.id, note]));
}

/** The centre of one note on this screen, in screen pixels. */
async function centreOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const centre = await page.evaluate((noteId) => {
    const element = document.querySelector(`[data-testid="sticky-note"][data-id="${noteId}"]`);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, id);
  if (!centre) throw new Error(`no note ${id} on this screen`);
  return centre;
}

interface SocketRegistryWindow extends Window {
  __boardRoomSockets?: WebSocket[];
}

type WritableWindow = Omit<SocketRegistryWindow, 'WebSocket'> & {
  WebSocket: typeof WebSocket;
};

/**
 * A test-only registry of the WebSockets a page opens, so that a scenario can
 * take a live one down. It wraps the constructor and hands back the real object,
 * so the client sees nothing out of the ordinary — then `close()` on one of those
 * sockets is the same event to it that a dead access point sends. The constants
 * come with the wrapper, so a page reading `WebSocket.OPEN` still gets a number.
 */
const webSocketRegistry = (): void => {
  const win = window as unknown as WritableWindow;
  const Original = win.WebSocket;
  win.__boardRoomSockets = [];
  const Wrapped = function (this: WebSocket, url: string | URL, protocols?: string | string[]) {
    const socket =
      protocols === undefined ? new Original(url) : new Original(url, protocols);
    win.__boardRoomSockets?.push(socket);
    return socket;
  } as unknown as typeof WebSocket & Record<string, unknown>;
  Wrapped.prototype = Original.prototype;
  // The constants come with the wrapper, so `WebSocket.OPEN` is still a number.
  const statics = Wrapped as unknown as Record<string, unknown>;
  for (const name of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const) {
    statics[name] = Original[name];
  }
  win.WebSocket = Wrapped as unknown as typeof WebSocket;
};

/**
 * One person, at an address of the scenario's choosing — a path against the suite's
 * server, or a whole URL for the specs that run a server of their own
 * (helpers/persistent-server.ts). Everything else is what `openParticipants` makes:
 * a context of their own, their own socket, and a board they arrive in sync with.
 * A scenario that means to meet a board that cannot be read passes
 * `waitUntil: 'loaded'` and reads the badge itself.
 */
export async function openParticipantAt(
  browser: Browser,
  url: string,
  name: string,
  options: {
    outageSwitch?: boolean;
    waitUntil?: 'connected' | 'loaded';
    /** Arrive by creating a board from home, as a person does, rather than
     * opening an address. Story 5 makes a board exist only once it is created,
     * so "the first person on a fresh board" means "the person who made it". */
    create?: boolean;
  } = {},
): Promise<Participant> {
  // A context per person: no shared storage, no shared BroadcastChannel, and
  // separate cookies, so the only thing they have in common is the room.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const outage: Outage = { refusesConnections: false };
  outages.set(context, outage);
  if (options.outageSwitch === true) {
    // Playwright only routes sockets that are opened after the route is in
    // place, so a scenario that means to switch the network off has to have the
    // switch fitted before the page exists. Until it is thrown, the room's
    // traffic passes straight through.
    await context.routeWebSocket(ROOM_SOCKET, (route) => {
      if (outages.get(context)?.refusesConnections === true) {
        // The room will not take the call: closed on the spot, with a code that
        // says nothing permanent, so the client keeps trying.
        void route.close({ code: REFUSED_CODE, reason: 'network down' });
        return;
      }
      route.connectToServer();
    });
  }
  await context.addInitScript(webSocketRegistry);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const consoleLogs: string[] = [];
  page.on('console', (message) => {
    const text = `${message.type()}: ${message.text()}`;
    consoleLogs.push(text);
    if (message.type() === 'error') consoleErrors.push(text);
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(`pageerror: ${String(error)}`);
    consoleLogs.push(`pageerror: ${String(error)}`);
  });

  if (options.create === true) {
    // Create the board the way the product does, then it is on screen at the
    // address the server gave it.
    await page.goto('/');
    await page.getByTestId('new-board-button').click();
  } else {
    await page.goto(url);
  }
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await settle(page);

  const participant: Participant = {
    name,
    context,
    page,
    consoleErrors,
    consoleLogs,
    async connectionState() {
      const state = await page.evaluate(() => window.__vidi6?.connectionState() ?? null);
      return state;
    },
    async badgeText() {
      return page.evaluate(() => {
        const badge = document.querySelector('[data-testid="connection-status"]');
        return badge ? (badge.textContent ?? '') : null;
      });
    },
    async badgeState() {
      return page.evaluate(() => {
        const badge = document.querySelector('[data-testid="connection-status"]');
        return badge ? badge.getAttribute('data-state') : null;
      });
    },
    async notes() {
      return readNotes(page);
    },
    async note(id: string) {
      return (await readNotes(page)).get(id);
    },
    async snapshot() {
      const notes = await readNotes(page);
      return JSON.stringify(
        [...notes.values()]
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((note) => [
            note.id,
            Math.round(note.left * 100) / 100,
            Math.round(note.top * 100) / 100,
            note.color,
            note.z,
            note.text,
          ]),
    );
    },
    async close() {
      outages.delete(context);
      await context.close();
    },
  };

  // The board is not merely open, it is in sync: that is the state a person
  // arrives in, and every scenario starts from it. A scenario that means to meet
  // a board that cannot be read asks for `waitUntil: 'loaded'` instead, because
  // the state it is looking for is the one that is not `connected`.
  if (options.waitUntil !== 'loaded') {
    await expectEventually(`${name} is connected`, () => participant.connectionState(), {
      is: (state) => state === 'connected',
    });
  }
  return participant;
}

/** The board address a page is on, read back as a board id. */
async function boardIdOf(page: Page): Promise<string> {
  const path = await page.evaluate(() => window.location.pathname);
  const match = /^\/b\/([^/?#]+)$/.exec(path);
  if (match === null) throw new Error(`the page is not on a board address (${path})`);
  return decodeURIComponent(match[1] as string);
}

/**
 * `count` people on the same board, each in a context of their own, all of them
 * connected and in sync. The first person makes the board from home — a board
 * only exists once someone creates it (share.not_found) — and the rest arrive at
 * the address it was given, which is exactly how a shared link is used.
 *
 * `outageSwitch` fits the scenario with a way to switch one person's network off
 * and back on (see `goOffline`). It has to be decided up front, because the
 * switch is fitted when the person's context is made.
 */
export async function openParticipants(
  browser: Browser,
  count: number,
  options?: { outageSwitch?: boolean },
): Promise<{ boardId: string; people: Participant[] }> {
  const outageSwitch = options?.outageSwitch === true;
  const people: Participant[] = [];

  const firstName = PEOPLE[0] ?? 'Person 1';
  const creator = await openParticipantAt(browser, '/', firstName, {
    outageSwitch,
    create: true,
  });
  people.push(creator);
  const boardId = await boardIdOf(creator.page);

  for (let index = 1; index < count; index += 1) {
    const name = PEOPLE[index] ?? `Person ${String(index + 1)}`;
    people.push(await openParticipantAt(browser, `/b/${boardId}`, name, { outageSwitch }));
  }
  // Everyone is in the same room, so they are connected to each other, not just
  // to the server: the first note proves the line works in both directions. It
  // goes in a corner, where no scenario means to click.
  const [first, second] = [people[0], people[1]];
  if (first && second) {
    const proof = await createNote(first, 12, 12, 'here');
    await stopEditing(first);
    await expectEventually(`${second.name} sees the first note`, () => second.note(proof), {
      is: (note) => note !== undefined,
    });
  }
  return { boardId, people };
}

/** A fresh board id for scenarios that do not need the shared one. */
export const freshBoardId = (): string => newBoardId();

// --- doing things to a note, by id -------------------------------------------

/**
 * Double-click empty board space: creates a note there and opens its editor.
 * Returns its id, which is how the rest of the scenario refers to it — a
 * position on screen is not stable once other people are moving things.
 */
export async function createNote(
  who: Participant,
  x: number,
  y: number,
  text = '',
): Promise<string> {
  await who.page.mouse.dblclick(x, y);
  await who.page.waitForSelector('[data-testid="sticky-note"] textarea');
  if (text) await who.page.keyboard.type(text);
  const id = await selectedNoteId(who);
  return id;
}

/** The id of the note this screen has selected (there is only ever one). */
export async function selectedNoteId(who: Participant): Promise<string> {
  const id = await who.page.evaluate(() => {
    const element = document.querySelector<HTMLElement>(
      '[data-testid="sticky-note"][data-selected="true"]',
    );
    return element?.dataset.id ?? null;
  });
  if (!id) throw new Error(`${who.name} has no note selected`);
  return id;
}

/** Start editing an existing note (double-click on it). */
export async function startEditing(who: Participant, id: string): Promise<void> {
  const centre = await centreOf(who.page, id);
  await who.page.mouse.dblclick(centre.x, centre.y);
  await expect(noteLocator(who, id).locator('textarea')).toHaveCount(1);
}

/** Stop editing the open editor (Escape): the note stays selected. */
export async function stopEditing(who: Participant): Promise<void> {
  await who.page.keyboard.press('Escape');
  await expect(who.page.getByTestId('note-toolbar').first()).toBeVisible();
}

/** Type into the editor this screen already has open. */
export const type = (who: Participant, text: string): Promise<void> =>
  who.page.keyboard.type(text);

/** Drag a note by (dx, dy) screen pixels. It has to be at rest: no editor open. */
export async function dragNote(who: Participant, id: string, dx: number, dy: number): Promise<void> {
  const note = await who.note(id);
  if (note?.editing) throw new Error(`${who.name} is still typing in ${id}, so it cannot be dragged`);
  const centre = await centreOf(who.page, id);
  await who.page.mouse.move(centre.x, centre.y);
  await who.page.mouse.down();
  await who.page.mouse.move(centre.x + dx / 2, centre.y + dy / 2, { steps: 4 });
  await who.page.mouse.move(centre.x + dx, centre.y + dy, { steps: 4 });
  await who.page.mouse.up();
  await settle(who.page);
}

/** Select a note with a single click. */
export async function selectNote(who: Participant, id: string): Promise<void> {
  const centre = await centreOf(who.page, id);
  await who.page.mouse.click(centre.x, centre.y);
  await settle(who.page);
}

/**
 * One note's corner of the page: its toolbar, its swatches, its bin, its editor.
 * Every interaction with a particular note goes through this, because a board can
 * hold a selected note somewhere else on it — off this person's view, with a
 * toolbar of its own that a page-wide selector would find first.
 */
const noteLocator = (who: Participant, id: string): Locator =>
  who.page.locator(`[data-testid="sticky-note"][data-id="${id}"]`);

/** Recolour a note from the toolbar's swatch (the note has to be selected). */
export async function recolour(who: Participant, id: string, colour: string): Promise<void> {
  await selectNote(who, id);
  const note = noteLocator(who, id);
  await expect(
    note.getByTestId('note-toolbar'),
    `${who.name} has no toolbar up, so ${id} is not selected`,
  ).toBeVisible();
  await note.getByRole('button', { name: `${colour} colour` }).click();
  await settle(who.page);
}

/** Delete a note with the toolbar's bin (the note has to be selected). */
export async function deleteNote(who: Participant, id: string): Promise<void> {
  await selectNote(who, id);
  const note = noteLocator(who, id);
  await expect(
    note.getByTestId('note-toolbar'),
    `${who.name} has no toolbar up, so ${id} is not selected`,
  ).toBeVisible();
  await note.getByRole('button', { name: 'Delete note' }).click();
  await settle(who.page);
}

/** Where a note is on the board, as this screen has it. */
export async function positionOf(
  who: Participant,
  id: string,
): Promise<Position | undefined> {
  const note = await who.note(id);
  return note ? { left: note.left, top: note.top } : undefined;
}

/** The text of a note as this screen shows it, editing or not. */
export async function textOf(who: Participant, id: string): Promise<string | undefined> {
  return (await who.note(id))?.text;
}

/**
 * The parts of a note that two people's screens are meant to agree on: what it
 * is, where it is, what it says. Whether it is selected or being typed into is
 * this screen's own business (`live.local_selection`), so it is not here.
 */
export const sharedOf = (note: NoteOnScreen | undefined): SharedNoteFields | undefined =>
  note && {
    left: note.left,
    top: note.top,
    color: note.color,
    z: note.z,
    text: note.text,
  };

/** What a note looks like on every screen that has it. */
export interface SharedNoteFields {
  left: number;
  top: number;
  color: string;
  z: number;
  text: string;
}

/** The same, read straight off one person's screen. */
export const sharedFieldsOf = async (
  who: Participant,
  id: string,
): Promise<SharedNoteFields | undefined> => sharedOf(await who.note(id));

// --- waiting for other people ------------------------------------------------

/**
 * How long each change took to reach the other person. Reported against
 * LIVE_UPDATE_LATENCY_BUDGET_MS at the end of a run and never asserted: the
 * model, the browsers and the server all share one machine (design: capacity).
 */
const observedLatencies: Array<{ what: string; ms: number }> = [];

export interface EventuallyOptions {
  /** What is being waited for, for the latency log. */
  label?: string;
  /** Polling interval: waiting is not the thing under test. */
  interval?: number;
}

/**
 * Wait for something that another person's edit has to make true, with the
 * suite's generous functional timeout, and note down how long it took.
 */
export async function expectEventually<T>(
  what: string,
  probe: () => Promise<T>,
  conditions: { is: (value: T) => boolean; description?: string },
  options: EventuallyOptions = {},
): Promise<T> {
  const started = Date.now();
  let value: T | undefined;
  await expect
    .poll(
      async () => {
        const next = await probe();
        value = next;
        return conditions.is(next);
      },
      {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        intervals: [options.interval ?? 100],
        message: conditions.description ?? what,
      },
    )
    .toBe(true);
  const ms = Date.now() - started;
  observedLatencies.push({ what, ms });
  const over = ms > LIVE_UPDATE_LATENCY_BUDGET_MS ? ' (over the reported budget)' : '';
  console.log(`[latency] ${what}: ${String(ms)}ms${over}`);
  return value as T;
}

/** Assert now, and report how long it took for it to become true. */
export async function expectChangeEventually<T>(
  what: string,
  probe: () => Promise<T>,
  expected: T,
): Promise<void> {
  await expectEventually(what, probe, {
    is: (value) => JSON.stringify(value) === JSON.stringify(expected),
    description: `${what}: expected ${JSON.stringify(expected)}`,
  });
}

/**
 * The latency report for a run: how many changes were measured and where they
 * landed against the budget. Printed, not asserted.
 */
export function printLatencyReport(title: string): void {
  const times = observedLatencies.map((entry) => entry.ms).sort((a, b) => a - b);
  if (times.length === 0) {
    console.log(`\n${title}: no changes measured`);
    return;
  }
  const percentile = (fraction: number): number =>
    times[Math.min(times.length - 1, Math.floor(fraction * times.length))] ?? 0;
  console.log(
    [
      `\n${title}`,
      `  changes:        ${String(times.length)}`,
      `  p50:            ${String(percentile(0.5))}ms`,
      `  p95:            ${String(percentile(0.95))}ms`,
      `  max:            ${String(times[times.length - 1] ?? 0)}ms`,
      `  budget:         ${String(LIVE_UPDATE_LATENCY_BUDGET_MS)}ms (reported, not asserted)`,
      `  over budget:    ${String(times.filter((ms) => ms > LIVE_UPDATE_LATENCY_BUDGET_MS).length)}`,
    ].join('\n'),
  );
}

/** Everything measured so far, for a scenario that wants the numbers. */
export const latencySamples = (): Array<{ what: string; ms: number }> => [...observedLatencies];

/** A pause the scenario itself defines (an outage that has to last a while). */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The network goes away for one person, and comes back.
 *
 * Two switches, both of them real. Chromium's `Network.emulateNetworkConditions`
 * takes the network itself away, so the client's reconnect attempts genuinely
 * come back `ERR_INTERNET_DISCONNECTED` and the recovery is a real
 * reconnection; and the socket it already had open is closed from the page, which
 * is what a dead access point does to a live connection. Emulation on its own
 * leaves an open WebSocket alone in Chromium, and Playwright has no equivalent
 * switch for the other engines — which is why the outage scenario is a default
 * (chromium) scenario, the way the wheel-driven ones are (see camera.spec).
 */
/** The page's own record of the sockets it opened (see `webSocketRegistry`). */
type Sockets = { __boardRoomSockets?: WebSocket[] };

/**
 * Where the room's socket lives. A predicate, because Playwright's glob patterns
 * do not match a `ws://` URL the way one would expect them to — a function does.
 */
const ROOM_SOCKET = (url: URL): boolean => url.pathname.startsWith('/api/rooms/');

/**
 * An outage in progress: while the flag is up, every new connection to the room
 * is refused. The route itself stays in place for the rest of the scenario and
 * passes traffic through when the flag is down, because Playwright has no way to
 * take a WebSocket route back off — so the switch is a flag, not a route.
 */
interface Outage {
  refusesConnections: boolean;
}

/** The close code a refused connection gets: transient, so the client retries. */
const REFUSED_CODE = 1011;

const outages = new Map<BrowserContext, Outage>();

/**
 * The network goes away for one person, and comes back.
 *
 * Two things happen, in the order a dead access point does them: the socket the
 * client holds is closed, and every connection the client then tries to make to
 * the room is refused. So the client sees a connection go and a network that will
 * not have it back, and coming back is a real reconnection with a real resync.
 * Nobody else is disturbed, and the person who lost the network keeps working in
 * the same tab throughout — the board is in memory, not on the network, so what
 * they type is not lost, only not seen yet.
 *
 * The people have to be opened with `{ outageSwitch: true }`: the switch is
 * fitted to their context before the page exists, because Playwright can only
 * route sockets opened after the route was installed.
 */
export async function goOffline(who: Participant): Promise<void> {
  const outage = requireOutage(who);
  outage.refusesConnections = true;
  await who.page.evaluate(() => {
    const sockets = (window as unknown as Sockets).__boardRoomSockets ?? [];
    // 0 is CONNECTING, 1 is OPEN: the two states a live connection is in.
    for (const socket of sockets) {
      if (socket.readyState === 0 || socket.readyState === 1) socket.close();
    }
  });
}

export async function goOnline(who: Participant): Promise<void> {
  requireOutage(who).refusesConnections = false;
}

const requireOutage = (who: Participant): Outage => {
  const outage = outages.get(who.context);
  if (!outage) {
    throw new Error(
      `${who.name} has no outage switch: open the participants with { outageSwitch: true }`,
    );
  }
  return outage;
};

/**
 * The connection failures an outage of the scenario's own making leaves in the
 * console. They are the network being down, not the board misbehaving: the
 * "no error dialog" checks filter these out and nothing else.
 */
export const outageNoise = (line: string): boolean =>
  /WebSocket connection|route aborted|net::/i.test(line);

/** The console errors of everyone in the scenario, for "no error dialog". */
export const consoleErrorsOf = (people: Participant[]): string[] =>
  people.flatMap((person) => person.consoleErrors.map((line) => `${person.name}: ${line}`));
