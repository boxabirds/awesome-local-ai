/**
 * Story 3 e2e: live collaboration through real browsers + the real
 * `wrangler dev` server path (WebSocket sync via BoardRoom Durable Objects).
 *
 * TC-22..TC-25, TC-28: two-person workflows.
 * TC-26: full-capacity session (MAX_CONCURRENT_EDITORS contexts).
 * TC-27: flaky Wi-Fi catch-up.
 */
import { test, expect, type Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from 'src/shared/config';
import {
  openParticipants,
  createNote,
  moveNote,
  recolorNote,
  deleteNote,
  typeInNote,
  noteById,
  expectWithin,
  BUDGET,
} from './helpers/participants';
import { getNotes, setCamera } from './helpers/board';

/** Screen positions that do not overlap (viewport is 1280x720). */
const SPOTS: { x: number; y: number }[] = [
  { x: 300, y: 250 },
  { x: 500, y: 250 },
  { x: 700, y: 250 },
  { x: 300, y: 450 },
  { x: 500, y: 450 },
  { x: 700, y: 450 },
];

/** Collect console errors + page errors from a page. */
function collectErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return () => errors;
}

test.describe('Workflow: Two-person workshop', () => {
  test('TC-22: Alex create/move/recolour/type/delete are all visible to Sam in budget', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);

    // Create.
    await createNote(alex.page, SPOTS[0].x, SPOTS[0].y, 'A');
    const created = (await getNotes(alex.page))[0];
    await expectWithin(async () => (await getNotes(sam.page)).length, 1);

    // Move.
    await moveNote(alex.page, created.id, 40, 30);
    const moved = await noteById(alex.page, created.id);
    await expectWithin(async () => (await noteById(sam.page, created.id))?.x, moved!.x);
    await expectWithin(async () => (await noteById(sam.page, created.id))?.y, moved!.y);

    // Recolour.
    await recolorNote(alex.page, created.id, 'blue');
    await expectWithin(async () => (await noteById(sam.page, created.id))?.color, 'blue');

    // Type.
    await typeInNote(alex.page, created.id, 'B');
    await expectWithin(async () => (await noteById(sam.page, created.id))?.text, 'AB');

    // Delete.
    await deleteNote(alex.page, created.id);
    await expectWithin(async () => (await getNotes(sam.page)).length, 0);

    alex.context.close();
    sam.context.close();
  });

  test('TC-23: both type into one note simultaneously → identical text with every character', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);

    await createNote(alex.page, 640, 360, 'Start');
    const id = (await getNotes(alex.page))[0].id;
    // The note AND its initial text must be fully synced on both clients before
    // they type concurrently, or the CRDT merge can drop characters.
    await expectWithin(async () => (await noteById(sam.page, id))?.text, 'Start');

    // Both type simultaneously into the same note.
    const a = 'Hello';
    const b = 'World';
    await Promise.all([typeInNote(alex.page, id, a), typeInNote(sam.page, id, b)]);

    // Both settle to identical text.
    const textA = (await noteById(alex.page, id))!.text;
    await expectWithin(async () => (await noteById(sam.page, id))!.text, textA);

    // The merged text contains every typed character the right number of times.
    const expected = 'Start' + a + b;
    const counts = (s: string) => {
      const m = new Map<string, number>();
      for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1);
      return m;
    };
    for (const [ch, n] of counts(expected)) {
      expect(counts(textA).get(ch), `char ${JSON.stringify(ch)}`).toBe(n);
    }

    alex.context.close();
    sam.context.close();
  });

  test('TC-24: both drag the same note at once → identical settled position in budget', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);

    await createNote(alex.page, SPOTS[1].x, SPOTS[1].y, 'N');
    const id = (await getNotes(alex.page))[0].id;
    await expectWithin(async () => (await getNotes(sam.page)).length, 1);

    // Both drag the same note to different spots simultaneously.
    await Promise.all([moveNote(alex.page, id, 60, 20), moveNote(sam.page, id, -40, 40)]);

    // Both pages converge to the identical (x, y). Poll until the two agree
    // with each other: reading one page as a fixed reference right after the
    // drag would capture a still-settling position the other never matches.
    await expect
      .poll(
        async () => {
          const a = await noteById(alex.page, id);
          const s = await noteById(sam.page, id);
          return a !== null && s !== null && a.x === s.x && a.y === s.y;
        },
        { timeout: BUDGET * 2 },
      )
      .toBe(true);

    alex.context.close();
    sam.context.close();
  });

  test('TC-25: Sam editing, Alex deletes → Sam note+editor gone, no console errors', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    const samErrors = collectErrors(sam.page);

    await createNote(alex.page, SPOTS[2].x, SPOTS[2].y, 'X');
    const id = (await getNotes(alex.page))[0].id;
    await expectWithin(async () => (await getNotes(sam.page)).length, 1);

    // Sam starts editing the note.
    const el = sam.page.locator(`[data-note-id="${id}"]`);
    const box = await el.boundingBox();
    await sam.page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(sam.page.getByTestId('sticky-text-editor')).toBeVisible();

    // Alex deletes it.
    await deleteNote(alex.page, id);

    // Sam's note and editor disappear.
    await expectWithin(async () => (await getNotes(sam.page)).length, 0);
    await expect(sam.page.getByTestId('sticky-text-editor')).not.toBeVisible();

    expect(samErrors(), 'no console/page errors on Sam').toEqual([]);

    alex.context.close();
    sam.context.close();
  });

  test('TC-28: Alex selects+edits a note → Sam sees no selection outline or editor', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);

    await createNote(alex.page, SPOTS[3].x, SPOTS[3].y, 'S');
    const id = (await getNotes(alex.page))[0].id;
    await expectWithin(async () => (await getNotes(sam.page)).length, 1);

    // Alex selects and starts editing.
    const el = alex.page.locator(`[data-note-id="${id}"]`);
    const box = await el.boundingBox();
    await alex.page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(alex.page.getByTestId('sticky-text-editor')).toBeVisible();
    await expect(alex.page.locator(`[data-note-id="${id}"][data-selected]`)).toHaveCount(1);

    // Sam sees the note but no selection outline and no editor.
    await expect(sam.page.locator(`[data-note-id="${id}"]`)).toHaveCount(1);
    await expect(sam.page.locator(`[data-note-id="${id}"][data-selected]`)).toHaveCount(0);
    await expect(sam.page.getByTestId('sticky-text-editor')).toHaveCount(0);

    alex.context.close();
    sam.context.close();
  });
});

test.describe('Workflow: Full-capacity session', () => {
  test(`TC-26: ${MAX_CONCURRENT_EDITORS} contexts each create 5 + move 5 → all converge`, async ({ browser }) => {
    const ps = await openParticipants(browser, MAX_CONCURRENT_EDITORS);

    // Zoom out so a 5x5 grid of 200px notes fits without overlap; context i
    // owns row i (5 distinct columns), so all 25 notes land on unique spots.
    const ZOOM = 0.5;
    const CELL = 130; // screen px at ZOOM (=> 260 world > 200 world note size)
    const X0 = 90, Y0 = 90;
    for (let i = 0; i < ps.length; i++) {
      const { width, height } = ps[i].page.viewportSize()!;
      await setCamera(ps[i].page, (width / 2 - 640) / ZOOM, (height / 2 - 360) / ZOOM, ZOOM);
      for (let j = 0; j < 5; j++) {
        await createNote(ps[i].page, X0 + j * CELL, Y0 + i * CELL, `n${i}-${j}`);
      }
    }
    const total = MAX_CONCURRENT_EDITORS * 5;
    for (const p of ps) {
      await expectWithin(async () => (await getNotes(p.page)).length, total);
    }

    // Each context moves its own 5 notes.
    for (let i = 0; i < ps.length; i++) {
      const mine = (await getNotes(ps[i].page)).filter((n) => n.text.startsWith(`n${i}-`));
      for (const n of mine) await moveNote(ps[i].page, n.id, 10 + i, 5 + i);
    }
    // All contexts converge to identical boards (sorted by id).
    const snap = (pg: Page) =>
      getNotes(pg).then((ns) =>
        ns
          .map((n) => `${n.id}:${n.x},${n.y}`)
          .sort(),
      );
    // Poll until every page agrees with the first. Capturing a single reference
    // right after the last local move would race that move's propagation to the
    // reference page, so compare all pages on each poll instead.
    await expect
      .poll(
        async () => {
          const first = JSON.stringify(await snap(ps[0].page));
          for (const p of ps) {
            if (JSON.stringify(await snap(p.page)) !== first) return false;
          }
          return true;
        },
        // Generous margin for a loaded machine: five-way convergence on
        // localhost is well under a second, so this does not mask a real
        // divergence (which would never converge and fail at the timeout).
        { timeout: BUDGET * ps.length * 2 },
      )
      .toBe(true);

    for (const p of ps) p.context.close();
  });
});

test.describe('Workflow: Flaky Wi-Fi', () => {
  test('TC-27: Alex drops connection; both add 3; Reconnecting → Connected; catch-up to 6', async ({ browser }) => {
    test.setTimeout(90_000);
    const [alex, sam] = await openParticipants(browser, 2);

    // Alex's connection drops (provider.disconnect → `disconnected` → badge).
    await alex.page.evaluate(() => (window as any).__vidi6?.dropSocket());
    // The badge flips to "Reconnecting…" while Alex is disconnected.
    await expect(alex.page.getByTestId('connection-status'))
      .toHaveText('Reconnecting…', { timeout: 10_000 });

    // Sam adds 3 notes while Alex is disconnected (Alex must catch up on return).
    for (let j = 0; j < 3; j++) {
      await createNote(sam.page, SPOTS[j].x, SPOTS[j].y, `s${j}`);
    }
    await expectWithin(async () => (await getNotes(sam.page)).length, 3);

    // Alex's connection returns; it reconnects + re-syncs (catch-up), the badge
    // confirms (green) then hides once CONNECTED_CONFIRMATION_MS elapses.
    await alex.page.evaluate(() => (window as any).__vidi6?.resumeSocket());
    await expect(alex.page.getByTestId('connection-status'))
      .toBeHidden({ timeout: 20_000 });

    // Alex caught up to all of Sam's 3 notes.
    await expectWithin(async () => (await getNotes(alex.page)).length, 3);

    // Alex adds 3 of his own (Sam receives them live).
    for (let j = 0; j < 3; j++) {
      await createNote(alex.page, SPOTS[j + 3].x, SPOTS[j + 3].y, `a${j}`);
    }

    // Both show all 6 notes.
    await expectWithin(async () => (await getNotes(alex.page)).length, 6);
    await expectWithin(async () => (await getNotes(sam.page)).length, 6);

    alex.context.close();
    sam.context.close();
  });
});
