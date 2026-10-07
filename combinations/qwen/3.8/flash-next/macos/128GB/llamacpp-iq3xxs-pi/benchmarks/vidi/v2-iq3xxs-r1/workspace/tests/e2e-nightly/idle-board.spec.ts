import { expect, test, type Page } from '@playwright/test';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';
import { dragTo, noteBox, snapshot } from '../e2e/helpers/sticky';
import {
  closeScreens,
  connectionState,
  createNote,
  expectNoteText,
  expectNoBadge,
  gotoNewBoard,
  liveNoteIds,
  networkLog,
  noteText,
  openSecondScreen,
  waitForSynced,
} from '../e2e/helpers/sync';
import { seededRandom, WORDS } from '../integration/random-ops';

/**
 * Story 3 — nightly soak (TC-29, TC-30).
 *
 * These are the scenarios that are about *time* rather than about a behaviour: a
 * board left open during an exercise must not change its appearance, its camera or
 * its connection, and a room must keep up with a whole exercise group. They are
 * tagged `@nightly` and live in their own project so a normal story run does not
 * spend 45 seconds waiting for nothing to happen.
 *
 * Latency is reported, never asserted: the model, the browsers and the server all
 * share one machine, so wall-clock timing here is not a reliable pass/fail signal.
 * What *is* asserted is convergence — that every change reached every screen.
 */

const CAMERA_CX = 640;
const CAMERA_CY = 400; // the camera starts at the world origin at zoom 1

const IDLE_SPOTS = [
  { x: 380, y: 280 },
  { x: 660, y: 280 },
];

const cameraOf = (page: Page): Promise<{ x: number; y: number; zoom: number }> =>
  page.evaluate(() => window.__vidi6!.getCamera());

const badgeCount = (page: Page): Promise<number> =>
  page.getByTestId('connection-status').count();

/** The idle window itself, watched every few seconds for anything that appears. */
async function watchIdle(
  screens: readonly Page[],
  seconds: number,
  log: (line: string) => void,
): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  let check = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    check += 1;
    const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const states = await Promise.all(
      screens.map(async (page) => `${await connectionState(page)}:${await badgeCount(page)}`),
    );
    log(`  t+${seconds - remaining}s  ${states.join('  ')}`);
    for (const state of states) {
      // "state:badgeCount" — a badge appearing, or a state that is not the quiet
      // connected one, is the failure this soak exists to catch.
      expect(state).toBe('connected:0');
    }
  }
}

test.describe('@nightly idle board (TC-29)', () => {
  test('two screens left open for 45 seconds stay quiet, connected and one keystroke apart', async ({
    page,
  }, testInfo) => {
    const lines: string[] = [];
    const log = (line: string): void => {
      lines.push(line);
      console.info(line);
    };

    const extra: Page[] = [];
    const id = await gotoNewBoard(page);
    const other = await openSecondScreen(page);
    extra.push(other);
    try {
      await Promise.all([waitForSynced(page), waitForSynced(other)]);
      const note = await createNote(page, IDLE_SPOTS[0]!, 'retro item 4');
      await expectNoteText(other, note, 'retro item 4');
      const cameraBefore = await cameraOf(page);
      const receivedBefore = (await networkLog(page)).received;

      await watchIdle([page, other], 45, log);

      // Nothing about the board changed while nobody was using it.
      await expectNoBadge(page);
      await expectNoBadge(other);
      expect(await cameraOf(page)).toEqual(cameraBefore);

      // The room did not go anywhere: it was still talking to both screens
      // (awareness keeps the socket warm), and every byte went to the room URL.
      const logAfter = await networkLog(page);
      expect(logAfter.received).toBeGreaterThan(receivedBefore);
      for (const url of logAfter.sockets) {
        expect(new URL(url).pathname).toBe(`/api/rooms/${id}`);
      }
      expect(logAfter.broadcastChannels).toBe(0);
      expect(new URL((await networkLog(other)).sockets[0]!).pathname).toBe(`/api/rooms/${id}`);

      // One keystroke apart, still. Timed from before the note is created, so the
      // number includes this client's own creating and committing: a conservative
      // upper bound on what the other screen waits to see.
      const started = Date.now();
      const created = await createNote(page, IDLE_SPOTS[1]!, 'after the quiet');
      await expectNoteText(other, created, 'after the quiet', 2_000);
      const latency = Date.now() - started;
      log(`edit after 45s idle reached the other screen in ${latency} ms`);
      expect(latency).toBeLessThan(2_000);

      await testInfo.attach('idle-report.json', {
        body: JSON.stringify(
          {
            boardId: id,
            idleSeconds: 45,
            framesReceivedDuringIdle: logAfter.received - receivedBefore,
            latencyMs: latency,
            lines,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    } finally {
      await closeScreens(extra);
    }
  });
});

/* ------------------------------------------------------------------ *
 * TC-30 — continuous edits at capacity                              *
 * ------------------------------------------------------------------ */

/** Grid of double-click spots, spaced further apart than a note is wide. */
const GRID = { left: 150, top: 150, stepX: 260, stepY: 260, cols: 5, rows: 3 };
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];
const SOAK_MS = 60_000;
const MEASURE_TIMEOUT_MS = 10_000;

interface RecordedOp {
  kind: string;
  actor: number;
  measured: boolean;
  /** Worst sender-to-receiver delay for this change, across the other screens. */
  latencyMs?: number;
  converged: boolean;
}

const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index]!;
};

/** Where the notes of one screen currently are, in screen coordinates. */
async function noteRects(page: Page): Promise<{ id: string; x: number; y: number }[]> {
  const snap = await snapshot(page);
  return snap.map((note) => ({
    id: note.id,
    // The camera stays at the origin for the whole soak: nobody pans or zooms.
    x: CAMERA_CX + note.x + STICKY_SIZE_WORLD / 2,
    y: CAMERA_CY + note.y + STICKY_SIZE_WORLD / 2,
  }));
}

/** A double-click spot that no note covers, so it creates rather than opens. */
async function freeSpot(page: Page, random: () => number): Promise<{ x: number; y: number }> {
  const cells: { x: number; y: number }[] = [];
  for (let col = 0; col < GRID.cols; col += 1) {
    for (let row = 0; row < GRID.rows; row += 1) {
      cells.push({ x: GRID.left + col * GRID.stepX, y: GRID.top + row * GRID.stepY });
    }
  }
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [cells[i], cells[j]] = [cells[j]!, cells[i]!];
  }
  const occupied = await noteRects(page);
  const half = STICKY_SIZE_WORLD / 2 + 12;
  for (const cell of cells) {
    if (!occupied.some((note) => Math.abs(note.x - cell.x) < half && Math.abs(note.y - cell.y) < half)) {
      return cell;
    }
  }
  throw new Error('no free spot on the board');
}

/**
 * Wait for one change to reach every other screen, recording how long each took.
 * A screen that never converges is a failure, but the soak keeps going so the
 * report shows every change, not just the first bad one.
 */
async function converge(
  screens: readonly Page[],
  actorIndex: number,
  started: number,
  check: (screen: Page) => Promise<boolean>,
  op: RecordedOp,
): Promise<void> {
  // All the other screens are watched at the same time, so the wall time of this
  // call is the delay of the slowest one — the number the report is about.
  await Promise.all(
    screens
      .filter((_, index) => index !== actorIndex)
      .map(async (screen) => {
        try {
          await expect
            .poll(() => check(screen), { timeout: MEASURE_TIMEOUT_MS, intervals: [25, 50, 100] })
            .toBe(true);
        } catch {
          op.converged = false;
        }
      }),
  );
  if (op.measured) op.latencyMs = Date.now() - started;
}

test.describe('@nightly capacity soak (TC-30)', () => {
  test(`${MAX_CONCURRENT_EDITORS} screens keep up with 60 seconds of continuous edits`, async (
    { page },
    testInfo,
  ) => {
    const seed = 20_260_206;
    const random = seededRandom(seed);
    const extra: Page[] = [];
    const screens: Page[] = [page];
    const ops: RecordedOp[] = [];
    let word = 0;

    try {
      const id = await gotoNewBoard(page);
      for (let index = 1; index < MAX_CONCURRENT_EDITORS; index += 1) {
        const next = await openSecondScreen(page);
        extra.push(next);
        screens.push(next);
      }
      await Promise.all(screens.map(async (screen) => waitForSynced(screen)));
      for (const screen of screens) {
        expect(new URL(screen.url()).pathname).toBe(`/b/${id}`);
      }

      const deadline = Date.now() + SOAK_MS;
      let round = 0;
      while (Date.now() < deadline) {
        const actorIndex = round % screens.length;
        const actor = screens[actorIndex]!;
        const pick = random();
        const kind =
          pick < 0.15
            ? 'create'
            : pick < 0.6
              ? 'type'
              : pick < 0.8
                ? 'move'
                : pick < 0.9
                  ? 'colour'
                  : 'delete';
        const notes = await noteRects(actor);
        round += 1;

        if (kind === 'create') {
          const spot = await freeSpot(actor, random);
          const marker = `${WORDS[Math.floor(random() * WORDS.length)]}${word++}`;
          const before = new Set(await liveNoteIds(actor));
          const started = Date.now();
          await actor.mouse.dblclick(spot.x, spot.y);
          await actor.keyboard.type(marker);
          await actor.keyboard.press('Escape');
          const created = (await liveNoteIds(actor)).filter((note) => !before.has(note));
          if (created.length !== 1) continue; // the spot was taken; try again next round
          const createdId = created[0]!;
          const op: RecordedOp = { kind, actor: actorIndex, measured: true, converged: true };
          ops.push(op);
          await converge(
            screens,
            actorIndex,
            started,
            async (screen) => {
              const ids = await liveNoteIds(screen);
              if (ids.includes(createdId)) return true;
              // Or a third screen deleted it before this one saw it, in which case
              // there is nothing left to show; the deletion itself is covered by the
              // final snapshot comparison.
              return !ids.includes(createdId) && !(await liveNoteIds(actor)).includes(createdId);
            },
            op,
          );
          continue;
        }

        if (notes.length === 0) continue;
        const target = notes[Math.floor(random() * notes.length)]!;

        if (kind === 'type') {
          const marker = ` ${WORDS[Math.floor(random() * WORDS.length)]}${word++}`;
          const started = Date.now();
          await actor.mouse.dblclick(target.x, target.y);
          await actor.waitForSelector('[data-testid="sticky-note-input"]');
          await actor.keyboard.type(marker);
          await actor.keyboard.press('Escape');
          const op: RecordedOp = { kind, actor: actorIndex, measured: true, converged: true };
          ops.push(op);
          await converge(
            screens,
            actorIndex,
            started,
            async (screen) => {
              if ((await noteText(screen, target.id))?.includes(marker.trim()) ?? false) return true;
              const ids = await liveNoteIds(screen);
              // The note was deleted while this change was on the wire.
              return !ids.includes(target.id) && !(await liveNoteIds(actor)).includes(target.id);
            },
            op,
          );
          continue;
        }

        // The unmeasured edits are background noise for the convergence check, and
        // another screen may have taken the note away between the snapshot and the
        // gesture. Losing one is fine; the board state stays consistent either way.
        const noise = async (): Promise<void> => {
          if (kind === 'move') {
            const box = await noteBox(actor, target.id);
            await dragTo(
              actor,
              { x: box.x, y: box.y },
              {
                x: box.x + Math.round((random() - 0.5) * 120),
                y: box.y + Math.round((random() - 0.5) * 90),
              },
            );
            return;
          }
          if (kind === 'colour') {
            const color = COLORS[Math.floor(random() * COLORS.length)]!;
            await actor.mouse.click(target.x, target.y);
            await actor.click(`[data-testid="sticky-color-swatch-${color}"]`, { timeout: 5_000 });
            return;
          }
          await actor.mouse.click(target.x, target.y);
          await actor.keyboard.press('Backspace');
        };

        try {
          await noise();
          ops.push({ kind, actor: actorIndex, measured: false, converged: true });
        } catch {
          ops.push({ kind: `${kind} (skipped)`, actor: actorIndex, measured: false, converged: true });
        }
      }

      // Every change, measured or not, must have reached every screen.
      const signatureOf = (screen: Page): Promise<string> =>
        screen.evaluate(() => JSON.stringify(window.__vidi6!.getSnapshot()));
      const divergence = async (): Promise<number> => {
        const all = await Promise.all(screens.map(signatureOf));
        return new Set(all).size;
      };
      await expect
        .poll(divergence, { timeout: 30_000, intervals: [200, 500, 1000] })
        .toBe(1);

      const measured = ops.filter((op) => op.measured);
      const latencies = measured.map((op) => op.latencyMs ?? 0);
      const failed = ops.filter((op) => !op.converged);
      const report = {
        boardId: id,
        seed,
        screens: screens.length,
        soakSeconds: SOAK_MS / 1000,
        ops: ops.length,
        byKind: Object.fromEntries(
          [...new Set(ops.map((op) => op.kind))].map((kind) => [
            kind,
            ops.filter((op) => op.kind === kind).length,
          ]),
        ),
        latencyBudgetMs: LIVE_UPDATE_LATENCY_BUDGET_MS,
        measuredOps: measured.length,
        p50Ms: percentile(latencies, 50),
        p95Ms: percentile(latencies, 95),
        maxMs: percentile(latencies, 100),
        notConverged: failed.length,
        notesAtEnd: (await snapshot(page)).length,
      };
      console.info(
        `soak report: ${report.ops} ops on ${screens.length} screens (seed ${seed}) — ` +
          `measured ${report.measuredOps} changes: p50 ${report.p50Ms} ms, ` +
          `p95 ${report.p95Ms} ms, max ${report.maxMs} ms ` +
          `(budget ${report.latencyBudgetMs} ms, reported only)`,
      );
      await testInfo.attach('capacity-report.json', {
        body: JSON.stringify({ ...report, operations: ops }, null, 2),
        contentType: 'application/json',
      });
      expect(failed).toEqual([]);

      // Teardown. Closing a screen destroys its connection, and the screen that
      // stayed must not care about it: no new sockets, no reconnect, no badge, and
      // still able to reach the room. A closed page cannot be observed any more, so
      // this watches the client that survived the others leaving.
      const beforeClose = await networkLog(page);
      await closeScreens(extra);
      extra.length = 0;
      await page.waitForTimeout(5_000);
      const afterClose = await networkLog(page);
      expect(afterClose.sockets.length).toBe(beforeClose.sockets.length);
      expect(
        afterClose.sockets.every((url) => new URL(url).pathname === `/api/rooms/${id}`),
      ).toBe(true);
      await expectNoBadge(page);
      expect(await connectionState(page)).toBe('connected');

      const spot = await freeSpot(page, random);
      const sentBefore = (await networkLog(page)).sent;
      const kept = await createNote(page, spot, 'after the others left');
      expect((await liveNoteIds(page)).includes(kept)).toBe(true);
      expect((await networkLog(page)).sent).toBeGreaterThan(sentBefore);
    } finally {
      await closeScreens(extra);
    }
  });
});
