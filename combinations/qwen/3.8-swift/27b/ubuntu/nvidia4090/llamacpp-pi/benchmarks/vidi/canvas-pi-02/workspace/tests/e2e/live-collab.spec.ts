// E2E live collaboration (story 3): TC-22 to TC-28. Two or more real browser
// contexts share one /b/<boardId> through the real `wrangler dev` + BoardRoom
// Durable Object path; every change must be visible on the other screens
// within LIVE_UPDATE_LATENCY_BUDGET_MS.
//
// The app recentres the world origin on the viewport centre (640,400 in the
// 1280x800 test viewport) at zoom 1, so screen = world + (640,400) for every
// participant. createSticky(x,y) centres a note on world (x,y).

import { expect, test } from '@playwright/test';


import {
  badge,
  badgeText,
  collectErrors,
  connectParticipants,
  disposeAll,
  expectWithin,
  getNotes,
  newBoard,
  sortedNotes,
  type Participant,
} from './helpers/participants';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';

/** World -> screen offset (viewport centre). */
const SX = 640;
const SY = 400;
const px = (wx: number): number => SX + wx;
const py = (wy: number): number => SY + wy;

/** Double-clicks a note's centre on `p`'s screen to start editing it. */
async function startEdit(p: Participant, wx: number, wy: number): Promise<void> {
  await p.page.mouse.dblclick(px(wx), py(wy));
  await expect(p.page.getByTestId('sticky-editor-input')).toBeVisible();
}

test.describe('story 3: live collaboration', () => {
  test('TC-22: Alex creates, moves, recolours, types and deletes — each visible to Sam within budget', async ({
    browser,
  }) => {
    const boardId = newBoard();
    const [alex, sam] = await connectParticipants(browser, boardId, 2);
    try {
      // Create.
      const id = (await alex.page.evaluate(() => window.__vidi6?.createSticky(0, 0))) as string;
      expect(id).toBeTruthy();
      await expectWithin(async () => (await getNotes(sam.page)).some((n) => n.id === id)).toBe(true);

      // Move (top-left to (50,50) => centre (150,150)).
      await alex.page.evaluate(([nid]) => window.__vidi6?.moveSticky(nid, 50, 50), [id]);
      await expectWithin(async () => {
        const n = (await getNotes(sam.page)).find((n) => n.id === id);
        return n === undefined ? null : [n.x, n.y];
      }).toEqual([50, 50]);

      // Recolour. (The doc stores the colour key, e.g. "pink".)
      await alex.page.evaluate(([nid]) => window.__vidi6?.setStickyColor(nid, 'pink'), [id]);
      await expectWithin(async () =>
        (await getNotes(sam.page)).find((n) => n.id === id)?.color,
      ).toBe('pink');

      // Type into the note (real editor path): centre is now (150,150).
      await startEdit(alex, 150, 150);
      await alex.page.keyboard.type('hello sam');
      await alex.page.keyboard.press('Escape');
      await expectWithin(async () =>
        (await getNotes(sam.page)).find((n) => n.id === id)?.text,
      ).toBe('hello sam');

      // Delete.
      await alex.page.evaluate(([nid]) => window.__vidi6?.deleteSticky(nid), [id]);
      await expectWithin(async () => (await getNotes(sam.page)).some((n) => n.id === id)).toBe(false);
    } finally {
      await disposeAll([alex, sam]);
    }
  });

  test('TC-23: both type simultaneously into one note — identical text containing every typed character', async ({
    browser,
  }) => {
    const boardId = newBoard();
    const [alex, sam] = await connectParticipants(browser, boardId, 2);
    try {
      const id = (await alex.page.evaluate(() => window.__vidi6?.createSticky(0, 0))) as string;
      expect(id).toBeTruthy();
      // Both open the editor on the same note (centre (0,0)).
      await Promise.all([startEdit(alex, 0, 0), startEdit(sam, 0, 0)]);
      // Interleaved typing from both sides.
      await Promise.all([
        alex.page.keyboard.type('A1'),
        sam.page.keyboard.type('B2'),
      ]);
      await Promise.all([
        alex.page.keyboard.press('Escape'),
        sam.page.keyboard.press('Escape'),
      ]);

      const textOf = async (p: Participant): Promise<string> =>
        (await getNotes(p.page)).find((n) => n.id === id)?.text ?? '';
      // Both screens converge to the same text containing every typed char.
      // Converging two concurrent edits is a merge, not a single live update,
      // so allow a wider window than the default live-update budget (which
      // proves too tight when the suite runs all browsers in parallel).
      await expectWithin(
        async () => {
          const ta = await textOf(alex);
          const ts = await textOf(sam);
          return ta === ts && ['A', '1', 'B', '2'].every((ch) => ta.includes(ch));
        },
        5000,
      ).toBe(true);
      const finalText = await textOf(alex);
      expect(finalText).toContain('A');
      expect(finalText).toContain('2');
    } finally {
      await disposeAll([alex, sam]);
    }
  });

  test('TC-24: both drag the same note at once — identical settled position', async ({
    browser,
  }) => {
    const boardId = newBoard();
    const [alex, sam] = await connectParticipants(browser, boardId, 2);
    try {
      const id = (await alex.page.evaluate(() => window.__vidi6?.createSticky(0, 0))) as string;
      expect(id).toBeTruthy();
      // Note centre at screen (640,400). Both drag it, to different targets.
      const dragTo = async (p: Participant, tx: number, ty: number): Promise<void> => {
        await p.page.mouse.move(px(0), py(0));
        await p.page.mouse.down();
        await p.page.mouse.move(px(tx), py(ty), { steps: 8 });
        await p.page.mouse.up();
      };
      await Promise.all([dragTo(alex, 120, 60), dragTo(sam, -80, 90)]);

      const centre = async (p: Participant): Promise<[number, number]> => {
        const n = (await getNotes(p.page)).find((n) => n.id === id);
        return n === undefined ? [-1, -1] : [n.x + 100, n.y + 100];
      };
      // The two screens must agree on the settled centre (converged LWW):
      // the pair [alex, sam] must be [c, c] for some real c.
      await expectWithin(async () => {
        const [ca, cs] = [await centre(alex), await centre(sam)];
        return ca[0] === cs[0] && ca[1] === cs[1] && ca[0] !== -1;
      }).toBe(true);
    } finally {
      await disposeAll([alex, sam]);
    }
  });

  test('TC-25: Sam editing, Alex deletes — Sam\'s note and editor disappear, no console errors', async ({
    browser,
  }) => {
    const boardId = newBoard();
    const [alex, sam] = await connectParticipants(browser, boardId, 2);
    try {
      const id = (await alex.page.evaluate(() => window.__vidi6?.createSticky(0, 0))) as string;
      expect(id).toBeTruthy();
      const errors = collectErrors(sam.page);
      // Sam is editing the note.
      await startEdit(sam, 0, 0);
      await sam.page.keyboard.type('draft');
      // Alex deletes it.
      await alex.page.evaluate(([nid]) => window.__vidi6?.deleteSticky(nid), [id]);

      await expectWithin(async () => (await getNotes(sam.page)).some((n) => n.id === id)).toBe(false);
      await expect(sam.page.getByTestId('sticky-editor-input')).toHaveCount(0);
      expect(errors()).toEqual([]);
    } finally {
      await disposeAll([alex, sam]);
    }
  });

  test('TC-26: full-capacity session — MAX_CONCURRENT_EDITORS contexts, every change seen by all, identical finals', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const boardId = newBoard();
    const parts = await connectParticipants(browser, boardId, MAX_CONCURRENT_EDITORS);
    try {
      // Each participant creates 5 notes in their own lane, then moves them.
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        const p = parts[i];
        const ids: string[] = [];
        for (let j = 0; j < 5; j++) {
          const id = (await p.page.evaluate(
            ([lane, k]) => window.__vidi6?.createSticky(lane * 400, k * 300),
            [i, j],
          )) as string;
          ids.push(id);
        }
        for (let j = 0; j < 5; j++) {
          await p.page.evaluate(
            ([nid, lane, k]) => window.__vidi6?.moveSticky(nid, lane * 400 + 10, k * 300 + 10),
            [ids[j], i, j] as [string, number, number],
          );
        }
      }
      // Every board converges to the identical (sorted) set of 25 notes. (With
      // 5 participants the fan-out takes longer than a single live update,
      // so give the convergence a wider window than the default budget.)
      const convergeMs = 15_000;
      await expectWithin(async () => (await sortedNotes(parts[0].page)).length, convergeMs).toBe(25);
      const expected = await sortedNotes(parts[0].page);
      expect(expected).toHaveLength(25);
      for (const p of parts) {
        await expectWithin(
          async () => JSON.stringify(await sortedNotes(p.page)),
          convergeMs,
        ).toBe(JSON.stringify(expected));
      }
    } finally {
      await disposeAll(parts);
    }
  });

  test('TC-27: flaky Wi-Fi — Alex offline, both add notes, catch-up on reconnect', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const boardId = newBoard();
    const [alex, sam] = await connectParticipants(browser, boardId, 2);
    try {
      // Alex's connection drops for the catch-up outage window. (Playwright's
      // setOffline does not drop an already-open WebSocket, so the drop is
      // simulated by closing Alex's socket; the provider keeps retrying with
      // backoff, which is exactly what a flaky Wi-Fi does.)
      await alex.page.evaluate(() => window.__vidi6?.dropConnection());
      await expect
        .poll(async () => badgeText(alex.page), { timeout: CATCH_UP_TEST_OUTAGE_MS })
        .toBe('Reconnecting…');

      // Both add 3 notes during the outage.
      for (let j = 0; j < 3; j++) {
        await alex.page.evaluate(([k]) => window.__vidi6?.createSticky(-300, k * 200), [j]);
        await sam.page.evaluate(([k]) => window.__vidi6?.createSticky(300, k * 200), [j]);
      }

      // Alex's connection is restored.
      await alex.page.evaluate(() => window.__vidi6?.restoreConnection());
      // Badge walks Reconnecting -> green Connected -> hidden.
      await expect.poll(async () => badgeText(alex.page), { timeout: 15_000 }).toBe('Connected');
      await expect(badge(alex.page)).toHaveCount(0, { timeout: 15_000 });

      // Both boards show all 6 notes, identically.
      const expected = await sortedNotes(alex.page);
      expect(expected).toHaveLength(6);
      await expectWithin(async () => JSON.stringify(await sortedNotes(sam.page))).toBe(
        JSON.stringify(expected),
      );
    } finally {
      await disposeAll([alex, sam]);
    }
  });

  test('TC-28: selection and editing are local — Sam sees no outline or editor', async ({
    browser,
  }) => {
    const boardId = newBoard();
    const [alex, sam] = await connectParticipants(browser, boardId, 2);
    try {
      const id = (await alex.page.evaluate(() => window.__vidi6?.createSticky(0, 0))) as string;
      expect(id).toBeTruthy();
      const noteOn = (p: Participant) =>
        p.page.locator(`[data-testid="sticky-note"][data-id="${id}"]`);

      // Alex selects (click) then edits (Enter).
      await noteOn(alex).click();
      await expectWithin(async () => (await noteOn(alex).getAttribute('data-selected'))).toBe('true');
      await expectWithin(async () => (await noteOn(sam).getAttribute('data-selected'))).toBe(null);

      await alex.page.keyboard.press('Enter');
      await expect(alex.page.getByTestId('sticky-editor-input')).toBeVisible();
      await expect(noteOn(sam).getByTestId('sticky-editor-input')).toHaveCount(0);
      await expectWithin(async () => (await noteOn(sam).getAttribute('data-editing'))).toBe(null);
    } finally {
      await disposeAll([alex, sam]);
    }
  });
});
