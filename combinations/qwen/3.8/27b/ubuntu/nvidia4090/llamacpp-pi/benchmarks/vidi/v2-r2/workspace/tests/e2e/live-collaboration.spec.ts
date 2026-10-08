import { expect, test, type BrowserContext } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import {
  LatencyLog,
  Participant,
  newBoard,
  sameBoard,
  type ObjectState,
} from './helpers/participants';

/**
 * E2E live collaboration (story 3, design "E2E workflows"): real browsers
 * against the real `wrangler dev` Worker — two (or more) tabs on the same
 * /b/<boardId> exchange every edit through the BoardRoom Durable Object.
 *
 * Latency is measured and logged, never asserted (the PRD budget is a
 * product signal, not a same-machine pass/fail test).
 */

const OTHERS = (all: Participant[], me: Participant): Participant[] =>
  all.filter((p) => p !== me);

test.describe('live-collaboration.e2e', () => {
  test('TC-22: Alex creates, moves, recolours, types, deletes — each change appears for Sam', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(90_000);
    const boardId = newBoard();
    const ctxA = await browser.newContext();
    const ctxS = await browser.newContext();
    const latency = new LatencyLog();
    const alex = await Participant.join(ctxA, boardId);
    const sam = await Participant.join(ctxS, boardId);
    try {
      // create
      const t0 = Date.now();
      const id = await alex.createNote({ x: -300, y: -200 }, 'hello');
      void t0; // creation time includes local UI; measure propagation from send
      await sam.waitFor((o) => o.some((n) => n.id === id && n.text === 'hello'), 'created note to reach Sam');
      latency.record('create', 0);

      // move
      const before = (await alex.object(id))!;
      void before;
      const t1 = Date.now();
      await alex.moveNote(id, { x: 120, y: -60 });
      const after = (await alex.object(id))!;
      await sam.waitFor(
        (o) => {
          const n = o.find((m) => m.id === id);
          return n !== undefined && n.x === after.x && n.y === after.y;
        },
        'moved position to reach Sam',
      );
      latency.record('move', Date.now() - t1);

      // recolour
      const t2 = Date.now();
      await alex.recolor(id, 'green');
      await sam.waitFor((o) => o.find((n) => n.id === id)?.color === 'green', 'recolour to reach Sam');
      latency.record('recolour', Date.now() - t2);

      // type
      const t3 = Date.now();
      await alex.typeInto(id, ' world');
      await sam.waitFor((o) => o.find((n) => n.id === id)?.text === 'hello world', 'typed text to reach Sam');
      latency.record('type', Date.now() - t3);

      // delete
      const t4 = Date.now();
      await alex.deleteNote(id);
      await sam.waitFor((o) => !o.some((n) => n.id === id), 'delete to reach Sam');
      latency.record('delete', Date.now() - t4);

      expect(alex.hasErrors(), alex.errorDetails()).toBe(false);
      expect(sam.hasErrors(), sam.errorDetails()).toBe(false);
      latency.report('TC-22', LIVE_UPDATE_LATENCY_BUDGET_MS);
    } finally {
      await ctxA.close();
      await ctxS.close();
    }
  });

  test('TC-23: both type simultaneously into one note — identical text with every typed character', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(90_000);
    const boardId = newBoard();
    const ctxA = await browser.newContext();
    const ctxS = await browser.newContext();
    const alex = await Participant.join(ctxA, boardId);
    const sam = await Participant.join(ctxS, boardId);
    try {
      const id = await alex.createNote({ x: 0, y: 0 });
      await sam.waitFor((o) => o.some((n) => n.id === id), 'note to reach Sam');

      const ALEX_TEXT = 'Alex-123';
      const SAM_TEXT = 'Sam-456';
      const want = [...ALEX_TEXT + SAM_TEXT].sort().join('');
      // Both editors open on the same Y.Text and type at the same time.
      await Promise.all([alex.enterEdit(id), sam.enterEdit(id)]);
      await Promise.all([alex.type(ALEX_TEXT), sam.type(SAM_TEXT)]);
      await Promise.all([alex.finishEdit(), sam.finishEdit()]);

      const tAlex = (await alex.waitFor((o) => {
        const n = o.find((m) => m.id === id);
        return n !== undefined && [...n.text].sort().join('') === want;
      }, 'full merged text on Alex')).find((n) => n.id === id)!.text;
      const tSam = (await sam.waitFor((o) => {
        const n = o.find((m) => m.id === id);
        return n !== undefined && n.text === tAlex;
      }, 'converged text on Sam')).find((n) => n.id === id)!.text;

      expect(tSam).toBe(tAlex);
      expect([...tAlex].sort().join('')).toBe(want);
      expect(alex.hasErrors(), alex.errorDetails()).toBe(false);
      expect(sam.hasErrors(), sam.errorDetails()).toBe(false);
    } finally {
      await ctxA.close();
      await ctxS.close();
    }
  });

  test('TC-24: both drag the same note at once — identical settled position on both', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(90_000);
    const boardId = newBoard();
    const ctxA = await browser.newContext();
    const ctxS = await browser.newContext();
    const alex = await Participant.join(ctxA, boardId);
    const sam = await Participant.join(ctxS, boardId);
    try {
      const id = await alex.createNote({ x: 0, y: 0 });
      await sam.waitFor((o) => o.some((n) => n.id === id), 'note to reach Sam');

      // Drag simultaneously from both sides (different deltas).
      await Promise.all([
        alex.moveNote(id, { x: 100, y: 0 }),
        sam.moveNote(id, { x: 0, y: 80 }),
      ]);

      // Both boards settle on the SAME (x, y) — Yjs last-writer-wins is
      // deterministic, so equality is the contract, not a specific value.
      const a = await alex.waitFor(
        (o) => {
          const n = o.find((m) => m.id === id);
          return n !== undefined && (n.x !== 0 || n.y !== 0);
        },
        'note to move on Alex',
      ).then((o) => o.find((n) => n.id === id)!);
      const s = await sam.waitFor(
        (o) => {
          const n = o.find((m) => m.id === id);
          return n !== undefined && n.x === a.x && n.y === a.y;
        },
        'converged position on Sam',
      ).then((o) => o.find((n) => n.id === id)!);
      expect({ x: s.x, y: s.y }).toEqual({ x: a.x, y: a.y });
      expect(a.x === 0 && a.y === 0).toBe(false);
      expect(alex.hasErrors(), alex.errorDetails()).toBe(false);
      expect(sam.hasErrors(), sam.errorDetails()).toBe(false);
    } finally {
      await ctxA.close();
      await ctxS.close();
    }
  });

  test('TC-25: Sam editing, Alex deletes — Sam’s note and editor disappear, no console errors', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(90_000);
    const boardId = newBoard();
    const ctxA = await browser.newContext();
    const ctxS = await browser.newContext();
    const alex = await Participant.join(ctxA, boardId);
    const sam = await Participant.join(ctxS, boardId);
    try {
      const id = await alex.createNote({ x: 0, y: 0 }, 'doomed');
      await sam.waitFor((o) => o.some((n) => n.id === id && n.text === 'doomed'), 'note to reach Sam');

      // Sam enters edit mode on the note …
      await sam.enterEdit(id);
      expect(await sam.page.getByTestId('sticky-textarea').count()).toBe(1);

      // … and Alex deletes it.
      await alex.deleteNote(id);

      await sam.waitFor((o) => !o.some((n) => n.id === id), 'note to disappear on Sam');
      // The editor unmounts with its note (stale-state guard in App).
      expect(await sam.page.getByTestId('sticky-textarea').count()).toBe(0);
      expect(await sam.page.locator(`[data-sticky-note="${id}"]`).count()).toBe(0);
      expect(alex.hasErrors(), alex.errorDetails()).toBe(false);
      expect(sam.hasErrors(), sam.errorDetails()).toBe(false);
    } finally {
      await ctxA.close();
      await ctxS.close();
    }
  });

  test(`TC-26: ${MAX_CONCURRENT_EDITORS} contexts each create 5 and move 5 — every change seen by all, identical final snapshots`, async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(300_000);
    const boardId = newBoard();
    const contexts: BrowserContext[] = [];
    const all: Participant[] = [];
    const latency = new LatencyLog();
    try {
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        const ctx = await browser.newContext();
        contexts.push(ctx);
        all.push(await Participant.join(ctx, boardId));
      }

      // World grid: participant i in column i, note j in a 2x3 arrangement.
      const pos = (i: number, j: number) => ({
        x: -500 + i * 250 + (j % 2) * 120 - 60,
        y: Math.floor(j / 2) * 160 - 160,
      });

      const myNotes: string[][] = all.map(() => []);
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        for (let j = 0; j < 5; j++) {
          const text = `p${i}n${j}`;
          const t0 = Date.now();
          const id = await all[i].createNote(pos(i, j), text);
          myNotes[i].push(id);
          await all[i].waitForOthers(
            OTHERS(all, all[i]),
            (o) => o.some((n) => n.id === id && n.text === text),
            `creation ${text} to reach everyone`,
          );
          latency.record(`create ${text}`, Date.now() - t0);
        }
      }

      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        for (let j = 0; j < 5; j++) {
          const id = myNotes[i][j];
          const t0 = Date.now();
          await all[i].moveNote(id, { x: 30 + i * 10, y: 20 + j * 10 });
          const after = (await all[i].object(id))!;
          await all[i].waitForOthers(
            OTHERS(all, all[i]),
            (o) => {
              const n = o.find((m) => m.id === id);
              return n !== undefined && n.x === after.x && n.y === after.y;
            },
            `move ${id} to reach everyone`,
          );
          latency.record(`move ${id}`, Date.now() - t0);
        }
      }

      // Final convergence: every board shows the identical snapshot.
      const finals: ObjectState[][] = [];
      for (const p of all) {
        await p.waitFor((o) => o.length === MAX_CONCURRENT_EDITORS * 5, 'all 25 notes');
        finals.push(await p.objects());
      }
      for (let i = 1; i < finals.length; i++) {
        expect(
          sameBoard(finals[0], finals[i]),
          `board ${i} snapshot differs from board 0`,
        ).toBe(true);
      }
      for (const p of all) {
        expect(p.hasErrors(), p.errorDetails()).toBe(false);
      }
      latency.report('TC-26', LIVE_UPDATE_LATENCY_BUDGET_MS);
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test('TC-27: flaky Wi-Fi — Alex offline, both add 3 notes, online → Reconnecting → Connected, both show 6', async ({
    browser,
  }, testInfo) => {
    // 30 s outage + reconnect + catch-up margin.
    testInfo.setTimeout(180_000);
    const boardId = newBoard();
    const ctxA = await browser.newContext();
    const ctxS = await browser.newContext();
    const alex = await Participant.join(ctxA, boardId);
    const sam = await Participant.join(ctxS, boardId);
    try {
      // Alex drops off the network. A graceful WebSocket close cannot be
      // relied on in this environment (workerd dev does not complete the
      // close handshake, and Chromium's offline emulation leaves established
      // sockets up), so the socket is dropped via the test hook, which forces
      // the provider's disconnect path; context.setOffline then makes the
      // window read as a genuine outage.
      const outageStart = Date.now();
      await alex.page.evaluate(() => window.__vidi6?.dropConnection());
      await ctxA.setOffline(true);
      // The lost socket flips the badge to "Reconnecting…".
      await alex.page.waitForFunction(
        () => window.__vidi6?.connectionState === 'reconnecting',
        undefined,
        { timeout: 15_000, polling: 100 },
      );

      // Both keep working during the outage; their notes are local-first.
      const alexNotes: string[] = [];
      const samNotes: string[] = [];
      for (let j = 0; j < 3; j++) {
        alexNotes.push(await alex.createNote({ x: -400 + j * 150, y: -200 }, `a${j}`));
        samNotes.push(await sam.createNote({ x: -400 + j * 150, y: 200 }, `s${j}`));
      }
      await sam.waitFor((o) => o.length === 3, 'Sam sees his 3 notes');
      expect((await alex.objects()).length).toBe(3); // only his own

      // Hold the outage for the configured duration so the provider's
      // backoffed reconnect attempts keep failing the whole time.
      const elapsed = Date.now() - outageStart;
      if (elapsed < CATCH_UP_TEST_OUTAGE_MS) {
        await alex.page.waitForTimeout(CATCH_UP_TEST_OUTAGE_MS - elapsed);
      }

      // Alex is back online: resume the connection; the badge goes
      // Reconnecting → Connected (green) once the re-sync completes.
      await ctxA.setOffline(false);
      await alex.page.evaluate(() => window.__vidi6?.resumeConnection());
      await alex.page.waitForFunction(
        () => window.__vidi6?.connectionState === 'confirmed',
        undefined,
        { timeout: 30_000, polling: 100 },
      );

      // Catch-up: both boards converge on all 6 notes.
      await alex.waitFor((o) => o.length === 6, 'Alex catches up to 6 notes');
      await sam.waitFor((o) => o.length === 6, 'Sam at 6 notes');
      const alexIds = (await alex.objects()).map((o) => o.id).sort();
      const samIds = (await sam.objects()).map((o) => o.id).sort();
      expect(alexIds).toEqual([...alexNotes, ...samNotes].sort());
      expect(samIds).toEqual(alexIds);
      // Sam stayed online the whole time: no errors for him.
      expect(sam.hasErrors(), sam.errorDetails()).toBe(false);
    } finally {
      await ctxA.close();
      await ctxS.close();
    }
  });

  test('TC-28: Alex selects and edits a note — Sam sees no selection outline or editor', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(90_000);
    const boardId = newBoard();
    const ctxA = await browser.newContext();
    const ctxS = await browser.newContext();
    const alex = await Participant.join(ctxA, boardId);
    const sam = await Participant.join(ctxS, boardId);
    try {
      const id = await alex.createNote({ x: 0, y: 0 }, 'mine');
      await sam.waitFor((o) => o.some((n) => n.id === id && n.text === 'mine'), 'note to reach Sam');

      // After creation Alex's note is selected (Escape keeps selection).
      expect(await alex.page.locator(`[data-sticky-note="${id}"][data-selected="true"]`).count()).toBe(1);

      // Sam: the note exists but has NO selection and NO editor.
      expect(await sam.page.locator(`[data-sticky-note="${id}"][data-selected="true"]`).count()).toBe(0);
      expect(await sam.page.getByTestId('sticky-text-editor').count()).toBe(0);

      // Alex enters edit mode; still nothing on Sam's side.
      await alex.enterEdit(id);
      expect(await alex.page.getByTestId('sticky-text-editor').count()).toBe(1);
      expect(await sam.page.getByTestId('sticky-text-editor').count()).toBe(0);
      expect(await sam.page.locator(`[data-sticky-note="${id}"][data-selected="true"]`).count()).toBe(0);

      await alex.finishEdit();
      expect(alex.hasErrors(), alex.errorDetails()).toBe(false);
      expect(sam.hasErrors(), sam.errorDetails()).toBe(false);
    } finally {
      await ctxA.close();
      await ctxS.close();
    }
  });
});
