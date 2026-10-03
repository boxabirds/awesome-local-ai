/**
 * Several people on one board, for e2e.
 *
 * A participant is a browser context (its own storage, its own provider, no
 * BroadcastChannel shortcut) with a page open on the board, plus the things a
 * person does: create, move, recolour, type, delete — and drop off the network
 * and come back. Reads go through the DOM, because what the *screen* shows is
 * what is under test; `window.__vidi6` is used for the connection state (there is
 * no badge element once the badge is hidden) and for operations applied at volume.
 */
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type WebSocketRoute,
} from '@playwright/test';
import {
  CLOSE_SERVER_ERROR,
  E2E_EVENTUAL_TIMEOUT_MS,
  STICKY_COLORS,
  type StickyColor,
} from '../../../src/shared/config';
import type { ConnectionState } from '../../../src/client/sync/connectBoard';
import { createBoard } from './board';
import {
  createByToolbar,
  dragNote,
  editorBox,
  endEditing,
  noteSelected,
  noteTestId,
  noteTextContent,
  noteWorldPos,
  stickyIds,
} from './sticky';

/** The room socket route: whatever a page opens to reach a board. */
const ROOM_ROUTE = /\/api\/rooms\//;

/** One note as a person's screen shows it. */
export interface NoteState {
  id: string;
  /** World coordinates as painted (the note's own style), not as modelled. */
  x: number;
  y: number;
  /** Text as painted. Empty while this person has the note open for editing. */
  text: string;
  /** Background as painted, so a recolour that never repainted is caught. */
  color: string;
  /** Whether an editor is open on this note on this screen. */
  editing: boolean;
}

/** An operation on the shared document, applied the way the UI applies it. */
export type Op =
  | { kind: 'move'; index: number; dx: number; dy: number }
  | { kind: 'color'; index: number; color: StickyColor }
  | { kind: 'text'; index: number; text: string }
  | { kind: 'create' }
  | { kind: 'delete'; index: number };

export interface Participant {
  readonly name: string;
  readonly page: Page;
  readonly context: BrowserContext;
  /** Uncaught exceptions and dialogs: a test asserts these stay empty. */
  readonly pageErrors: string[];
  readonly dialogs: string[];
  ids(): Promise<string[]>;
  screen(): Promise<NoteState[]>;
  noteText(id: string): Promise<string>;
  notePos(id: string): Promise<{ x: number; y: number }>;
  connectionState(): Promise<ConnectionState | null>;
  badgeText(): Promise<string | null>;
  createNote(text?: string): Promise<string>;
  startEditing(id: string): Promise<void>;
  type(text: string): Promise<void>;
  /** Open a note, add text to the end of it and close it again. */
  typeIntoNote(id: string, text: string): Promise<void>;
  stopEditing(): Promise<void>;
  selectNote(id: string): Promise<void>;
  dragNote(id: string, dx: number, dy: number): Promise<void>;
  recolorNote(id: string, color: StickyColor): Promise<void>;
  deleteNote(id: string): Promise<void>;
  /** Cut the socket and refuse reconnection until `comeBack`. */
  goOffline(): Promise<void>;
  comeBack(): Promise<void>;
  reload(): Promise<void>;
  applyOps(ops: readonly Op[]): Promise<void>;
  close(): Promise<void>;
}

/**
 * Poll `read` until `predicate` holds, reporting how long it took so tests can
 * log the real latency instead of hiding it behind a generous timeout.
 */
export async function expectEventually<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean | Promise<boolean>,
  timeout = E2E_EVENTUAL_TIMEOUT_MS,
  label = 'condition',
): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  let latest: T | undefined;
  await expect
    .poll(
      async () => {
        const value = await read();
        latest = value;
        return await predicate(value);
      },
      { timeout, intervals: [25, 50, 100, 250, 500], message: `timed out: ${label}` },
    )
    .toBe(true);
  return { value: latest as T, ms: Date.now() - started };
}

/** Wait until every listed person's provider has synced with the room. */
export async function everyoneSynced(
  participants: readonly Participant[],
  timeout = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<void> {
  await expectEventually(
    () => Promise.all(participants.map((p) => p.connectionState())),
    (states) => states.every((s) => s === 'connected' || s === 'confirmed'),
    timeout,
    'providers still not synced',
  );
}

function key(screen: readonly NoteState[]): string {
  return JSON.stringify(screen);
}

/** True when all these people's screens show the same board right now. */
export async function screensMatch(
  participants: readonly Participant[],
): Promise<boolean> {
  const screens = await Promise.all(participants.map((p) => p.screen()));
  return screens.every((screen) => key(screen) === key(screens[0]!));
}

/** Wait until all screens agree, and report the screen and how long it took. */
export async function waitForSameScreen(
  participants: readonly Participant[],
  timeout = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<{ screen: NoteState[]; ms: number }> {
  const { ms } = await expectEventually(
    () => screensMatch(participants),
    (same) => same,
    timeout,
    'screens never agreed',
  );
  return { screen: await participants[0]!.screen(), ms };
}

/** Wait until every person sees exactly `count` notes. */
export async function everyoneSeesNotes(
  participants: readonly Participant[],
  count: number,
  timeout = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<{ ms: number }> {
  return expectEventually(
    () => Promise.all(participants.map((p) => p.ids())),
    (lists) => lists.every((list) => list.length === count),
    timeout,
    `not everyone sees ${count} notes`,
  );
}

/**
 * A board that exists, for the tests that put several people on one board: asks the
 * service for a link, which is the same thing the New board button does. Story 5 retired
 * the version of this that invented an address and hoped a board was waiting there.
 */
export async function createFreshBoard(request: APIRequestContext): Promise<string> {
  return createBoard(request);
}

/**
 * One person: a fresh context on the board, not necessarily synced yet.
 */
export async function openParticipant(
  browser: Browser,
  boardId: string,
  name: string,
): Promise<Participant> {
  const context = await browser.newContext();
  const pageErrors: string[] = [];
  const dialogs: string[] = [];

  // How the network drops: the room socket is closed and every reconnection
  // attempt is refused for as long as the outage lasts. (context.setOffline does
  // not drop an established WebSocket in this browser, so it cannot simulate one.)
  let outage = false;
  let live: { toPage: WebSocketRoute; toServer: WebSocketRoute } | null = null;
  await context.routeWebSocket(ROOM_ROUTE, (route) => {
    if (outage) {
      // Refuse the reconnection attempt for as long as the outage lasts.
      void route.close({ code: CLOSE_SERVER_ERROR });
      return;
    }
    const toServer = route.connectToServer();
    live = { toPage: route, toServer };
    toServer.onClose(() => {
      if (live?.toServer === toServer) live = null;
    });
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error.message ?? error)));
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-viewport"]');

  return {
    name,
    page,
    context,
    pageErrors,
    dialogs,
    ids: () => stickyIds(page),
    screen: () => readScreen(page),
    noteText: (id) => noteTextContent(page, id),
    notePos: (id) => noteWorldPos(page, id),
    connectionState: () =>
      page.evaluate(() => window.__vidi6?.connectionState ?? null),
    badgeText: () => badgeTextOf(page),
    createNote: async (text) => {
      const id = await createByToolbar(page);
      if (text !== undefined) await page.keyboard.type(text, { delay: 15 });
      await endEditing(page);
      return id;
    },
    startEditing: async (id) => {
      await page.getByTestId(noteTestId(id)).dblclick();
      await expect(editorBox(page)).toBeVisible();
    },
    type: (text) => page.keyboard.type(text, { delay: 15 }),
    typeIntoNote: async (id, text) => {
      await page.getByTestId(noteTestId(id)).dblclick();
      await expect(editorBox(page)).toBeVisible();
      await page.keyboard.type(text, { delay: 15 });
      await endEditing(page);
    },
    stopEditing: () => endEditing(page),
    selectNote: async (id) => {
      await page.keyboard.press('Escape');
      await page.getByTestId(noteTestId(id)).click();
    },
    dragNote: (id, dx, dy) => dragNote(page, id, dx, dy),
    recolorNote: async (id, color) => {
      await ensureSelected(page, id);
      await colorSwatch(page, color).click();
    },
    deleteNote: async (id) => {
      await ensureSelected(page, id);
      await page.getByRole('button', { name: 'Delete note' }).click();
    },
    goOffline: async () => {
      outage = true;
      const current = live;
      live = null;
      // Closing the page side of the socket is what the person experiences as the
      // network dropping; the provider then starts its reconnect schedule.
      if (current) await current.toPage.close({ code: CLOSE_SERVER_ERROR });
    },
    comeBack: async () => {
      outage = false;
    },
    reload: async () => {
      await page.reload();
      await page.waitForSelector('[data-testid="board-viewport"]');
    },
    applyOps: (ops) => applyBoardOps(page, ops),
    close: () => context.close(),
  };
}

/**
 * Several people on one board, all synced with the room before the test starts.
 * Each is a separate context, so the only way they can see each other is the
 * worker.
 */
export async function createParticipants(
  browser: Browser,
  boardId: string,
  names: readonly string[],
): Promise<Participant[]> {
  const people: Participant[] = [];
  for (const name of names) {
    people.push(await openParticipant(browser, boardId, name));
  }
  await everyoneSynced(people);
  return people;
}

/**
 * Make sure this person has the note selected, so the note's own toolbar (colours,
 * bin) is on screen. Clicking a note that is already selected deselects it, which
 * is what a click does, so a selected note is left alone.
 */
async function ensureSelected(page: Page, id: string): Promise<void> {
  const toolbar = page.getByTestId('note-toolbar');
  if (!(await noteSelected(page, id))) await page.getByTestId(noteTestId(id)).click();
  if ((await toolbar.count()) === 0) {
    // A click on a selected note deselects it, so a note that looks selected but
    // has no toolbar gets clicked twice: off, then back on.
    await page.getByTestId(noteTestId(id)).click();
    await page.getByTestId(noteTestId(id)).click();
  }
  await expect(toolbar, 'the note toolbar never appeared').toBeVisible({
    timeout: 3_000,
  });
}

function colorSwatch(page: Page, color: StickyColor) {
  const name = color.charAt(0).toUpperCase() + color.slice(1);
  return page.getByRole('button', { name: `${name} colour` });
}

/** The badge's text, or null while it is hidden (which is how 'connected' looks). */
export async function badgeTextOf(page: Page): Promise<string | null> {
  // The badge is a live region whose state is its text; it is absent from the DOM
  // entirely while everything is fine. (Other live regions exist on the board, so
  // it is addressed by its own test id.)
  const badge = page.getByTestId('connection-status');
  if ((await badge.count()) === 0) return null;
  return (await badge.textContent())?.trim() ?? null;
}

/**
 * The board as this person's screen shows it: where each note is painted, its
 * text and colour as painted. Compared between people by note id.
 */
export async function readScreen(page: Page): Promise<NoteState[]> {
  const notes = await page.evaluate(() => {
    const api = window.__vidi6TestBoard;
    if (!api) throw new Error('window.__vidi6TestBoard missing');
    return api.notes().map((note) => {
      const el = document.querySelector<HTMLElement>(
        `[data-note-id="${note.id}"]`,
      );
      const painted = document.querySelector(
        `[data-note-id="${note.id}"] [data-testid="sticky-note-text"]`,
      );
      return {
        id: note.id,
        x: el ? Math.round(parseFloat(el.style.left)) : Number.NaN,
        y: el ? Math.round(parseFloat(el.style.top)) : Number.NaN,
        text: painted?.textContent ?? '',
        color: el ? getComputedStyle(el).backgroundColor : '',
        editing: Boolean(
          document.querySelector(`[data-note-id="${note.id}"] textarea`),
        ),
      };
    });
  });
  return notes.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Apply operations to the shared document from inside the page, through the same
 * model functions the UI calls, so a scripted change propagates and renders like
 * a person's. Used where hundreds of operations with the mouse would take minutes.
 */
export async function applyBoardOps(
  page: Page,
  ops: readonly Op[],
): Promise<void> {
  await page.evaluate((list) => {
    const api = window.__vidi6TestBoard;
    if (!api) throw new Error('window.__vidi6TestBoard missing');
    for (const op of list) {
      if (op.kind === 'create') {
        api.create({
          x: -250 + Math.floor(Math.random() * 500),
          y: -250 + Math.floor(Math.random() * 500),
        });
        continue;
      }
      const ids = api.notes().map((n) => n.id);
      const id = ids[op.index % Math.max(ids.length, 1)];
      if (!id) continue;
      if (op.kind === 'move') {
        const note = api.notes().find((n) => n.id === id);
        if (note) api.moveTo(id, note.x + op.dx, note.y + op.dy);
      } else if (op.kind === 'color') {
        api.color(id, op.color);
      } else if (op.kind === 'text') {
        api.write(id, op.text);
      } else {
        api.remove(id);
      }
    }
  }, ops as Op[]);
}

const WORDS = [
  'sync',
  'merge',
  'relay',
  'board',
  'room',
  'doc',
  'note',
  'typing',
  'live',
  'converge',
];

/** A deterministic list of operations for the capacity soak. */
export function randomBoardOps(
  count: number,
  seed: number,
  colors: readonly StickyColor[] = Object.keys(STICKY_COLORS) as StickyColor[],
): Op[] {
  let state = seed >>> 0;
  const next = (): number => {
    // mulberry32: small, deterministic, good enough to spread operations around.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  const ops: Op[] = [];
  for (let i = 0; i < count; i += 1) {
    const roll = next();
    const index = Math.floor(next() * 12);
    if (roll < 0.1) ops.push({ kind: 'create' });
    else if (roll < 0.2) ops.push({ kind: 'delete', index });
    else if (roll < 0.35) ops.push({ kind: 'color', index, color: pick(colors) });
    else if (roll < 0.5)
      ops.push({ kind: 'text', index, text: `${pick(WORDS)}-${i}` });
    else
      ops.push({
        kind: 'move',
        index,
        dx: Math.round((next() - 0.5) * 300),
        dy: Math.round((next() - 0.5) * 300),
      });
  }
  return ops;
}
