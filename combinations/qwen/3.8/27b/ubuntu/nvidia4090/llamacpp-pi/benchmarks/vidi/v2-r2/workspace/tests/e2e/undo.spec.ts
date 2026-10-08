import { expect, test, type Page } from '@playwright/test';
import type { Camera, Point } from '../../src/client/canvas/camera';
import type { StickyColor } from '../../src/shared/config';
import type { NoteSpec } from '../fixtures/boards';
import { settle, setCamera } from './helpers/board';
import { NodeWsClient } from './helpers/node-ws-client';
import {
  Participant,
  createBoard,
  sameBoard,
  sharedServerUrl,
} from './helpers/participants';
import { agentPort } from './helpers/wrangler-process';

/**
 * E2E undo/redo for story 8 (design "E2E workflows"):
 *
 *   TC-22: Lee marquee-selects a cluster of 8 notes and drags it; while the
 *          drag is held open, Sam recolours two of the selected notes. One
 *          undo by Lee puts all eight back at their start positions and z —
 *          and Sam's recolours survive (peer changes are never in Lee's
 *          history).
 *   TC-23: Lee drags a 3-note selection; Sam deletes one of the dragged
 *          notes; Lee's undo throws nothing, does not resurrect the deleted
 *          note, restores the other two, and the boards stay consistent.
 *   TC-24: a 5-row × 2-note grid is moved as a single gesture; one undo
 *          click puts every note back at its start, whatever the frame count.
 *
 * Boards are seeded from Node through the real sync protocol (NodeWsClient);
 * every assertion reads the model through the test-only window.__vidi6 hook.
 *
 * Camera (1280x800 viewport, the playwright default):
 *   MAIN: {x:-1280, y:-800, zoom:0.5} → screen = world*0.5 + (640, 400)
 */

const MAIN_CAM: Camera = { x: -1280, y: -800, zoom: 0.5 };
const s05 = (x: number, y: number): Point => ({ x: x * 0.5 + 640, y: y * 0.5 + 400 });

/** The model state of every object (test hook). */
interface Obj {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
}

async function objects(page: Page): Promise<Obj[]> {
  return page.evaluate(() => (window.__vidi6?.getObjects() ?? []) as Obj[]);
}

async function byText(page: Page, text: string): Promise<Obj> {
  const all = await objects(page);
  const found = all.find((o) => o.text === text);
  if (found === undefined) {
    throw new Error(`no object with text ${text}; have: ${all.map((o) => o.text).join(',')}`);
  }
  return found;
}

/** Start positions keyed by note text (x,y,z are exact model numbers). */
type Start = { x: number; y: number; z: number; color: string };
function startsOf(all: Obj[]): Map<string, Start> {
  return new Map(all.map((o): [string, Start] => [o.text, { x: o.x, y: o.y, z: o.z, color: o.color }]));
}

function expectAtStart(actual: Obj, start: Start, what: string): void {
  expect(actual.x, `${what} x`).toBe(start.x);
  expect(actual.y, `${what} y`).toBe(start.y);
  expect(actual.z, `${what} z`).toBe(start.z);
}

/** Shift+drag a marquee from screen point `from` to `to` (both on empty space). */
async function marquee(page: Page, from: Point, to: Point): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);
}

/** Drags a pointer that starts at screen point `from` by a screen-px delta. */
async function dragAt(page: Page, from: Point, delta: Point, steps = 10): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps });
  await page.mouse.up();
  await settle(page);
}

/** Selects the count and returns the ids (data-selected="true"). */
async function selectedCount(page: Page): Promise<number> {
  return page.locator('[data-object-id][data-selected="true"]').count();
}

/** Creates the board, seeds it from Node and returns the id. */
async function seededBoard(specs: NoteSpec[]): Promise<string> {
  const boardId = await createBoard(sharedServerUrl());
  const seeder = await NodeWsClient.connect(agentPort(1), boardId);
  await seeder.waitForSync();
  seeder.seed(specs);
  await seeder.waitForNotes(specs.length);
  seeder.close();
  return boardId;
}

test.describe('undo.e2e', () => {
  test('TC-22: undoing a drag keeps a colleague’s mid-drag recolours', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    // 8-note cluster (2 cols × 4 rows) + 4 outside notes on the right.
    const clusterCenters: { x: number; y: number }[] = [];
    for (const y of [-300, -100, 100, 300]) {
      clusterCenters.push({ x: -300, y }, { x: 0, y });
    }
    const clusterColors: StickyColor[] = ['yellow', 'green', 'blue', 'pink'];
    const specs: NoteSpec[] = clusterCenters.map((c, i) => ({
      x: c.x,
      y: c.y,
      text: `C${i + 1}`,
      color: clusterColors[i % 4],
    }));
    const outsideColors: StickyColor[] = ['violet', 'orange', 'yellow', 'green'];
    for (let i = 0; i < 4; i += 1) {
      specs.push({ x: 700, y: -300 + i * 200, text: `O${i + 1}`, color: outsideColors[i] });
    }
    const boardId = await seededBoard(specs);
    const ctxL = await browser.newContext();
    const ctxS = await browser.newContext();
    const lee = await Participant.join(ctxL, boardId);
    const sam = await Participant.join(ctxS, boardId);
    try {
      await setCamera(lee.page, MAIN_CAM);
      await setCamera(sam.page, MAIN_CAM);
      expect(await objects(lee.page)).toHaveLength(12);
      expect(await objects(sam.page)).toHaveLength(12);

      // Marquee the cluster: world (-460,-460)..(160,460) fully contains the
      // 8 cluster boxes (x -400..100, y -400..400) and none of the outside
      // notes (x 600..800).
      await marquee(lee.page, s05(-460, -460), s05(160, 460));
      expect(await selectedCount(lee.page)).toBe(8);

      const before = startsOf(await objects(lee.page));

      // Hold the drag open (C1 centre + partway) while Sam recolours two of
      // the selected notes in his own browser.
      const c1 = await byText(lee.page, 'C1');
      const c1Screen = s05(c1.x + 100, c1.y + 100);
      await lee.page.mouse.move(c1Screen.x, c1Screen.y);
      await lee.page.mouse.down();
      await lee.page.mouse.move(c1Screen.x + 25, c1Screen.y + 15, { steps: 4 });

      const c3 = await byText(sam.page, 'C3');
      const c4 = await byText(sam.page, 'C4');
      await sam.recolor(c3.id, 'orange');
      await sam.recolor(c4.id, 'violet');

      // Finish the drag: +75px / +50px screen = +150 / +100 world.
      await lee.page.mouse.move(c1Screen.x + 75, c1Screen.y + 50, { steps: 6 });
      await lee.page.mouse.up();
      await settle(lee.page);

      const afterDrag = startsOf(await objects(lee.page));
      expect(afterDrag.get('C1')!.x).toBe(before.get('C1')!.x + 150);
      expect(afterDrag.get('C1')!.y).toBe(before.get('C1')!.y + 100);

      // ONE undo: every cluster note returns to its exact start (x, y and z —
      // the drag brought the cluster to the front), outside notes untouched.
      await lee.page.getByTestId('undo-button').click();
      const undoneObjs = await lee.waitFor((o) => {
        const c1 = o.find((x) => x.text === 'C1');
        return c1 !== undefined && c1.x === before.get('C1')!.x;
      }, 'the drag to be undone');
      for (const o of undoneObjs) {
        expectAtStart(o, before.get(o.text)!, `cluster ${o.text}`);
      }
      // Sam's recolours survive the undo (they were never Lee's changes).
      const undone = startsOf(undoneObjs);
      expect(undone.get('C3')!.color).toBe('orange');
      expect(undone.get('C4')!.color).toBe('violet');
      expect(undone.get('C1')!.color).toBe('yellow');

      // Lee's history is empty now: the undo button is disabled, and the
      // boards agree.
      const undoBtn = lee.page.getByTestId('undo-button');
      await expect(undoBtn).toBeDisabled();
      // Wait for Lee's undo (and Sam's recolours) to converge on Sam.
      const samState = await sam.waitFor((o) => {
        const c1 = o.find((x) => x.text === 'C1');
        const c3 = o.find((x) => x.text === 'C3');
        return c1 !== undefined && c3 !== undefined
          && c1.x === before.get('C1')!.x
          && c3.color === 'orange';
      }, 'Sam to converge to the final state');
      expect(sameBoard(undoneObjs, samState)).toBe(true);
      expect(lee.hasErrors(), lee.errorDetails()).toBe(false);
      expect(sam.hasErrors(), sam.errorDetails()).toBe(false);
    } finally {
      await ctxL.close();
      await ctxS.close();
    }
  });

  test('TC-23: colleague deletes a dragged note during the undo → no exceptions, no resurrection', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    const specs: NoteSpec[] = [
      { x: -300, y: 0, text: 'D1', color: 'yellow' },
      { x: -100, y: 0, text: 'D2', color: 'green' },
      { x: 100, y: 0, text: 'D3', color: 'blue' },
      { x: 700, y: -150, text: 'E1', color: 'pink' },
      { x: 700, y: 150, text: 'E2', color: 'orange' },
    ];
    const boardId = await seededBoard(specs);
    const ctxL = await browser.newContext();
    const ctxS = await browser.newContext();
    const lee = await Participant.join(ctxL, boardId);
    const sam = await Participant.join(ctxS, boardId);
    try {
      await setCamera(lee.page, MAIN_CAM);
      await setCamera(sam.page, MAIN_CAM);

      // Marquee D1..D3 (world -420..220 × -140..140); E1/E2 stay out.
      await marquee(lee.page, s05(-420, -140), s05(220, 140));
      expect(await selectedCount(lee.page)).toBe(3);

      const before = startsOf(await objects(lee.page));
      const d1 = await byText(lee.page, 'D1');
      await dragAt(lee.page, s05(d1.x + 100, d1.y + 100), { x: 75, y: 50 });

      // Sam deletes D2 — one of Lee's dragged notes — through the normal UI.
      const d2 = await byText(sam.page, 'D2');
      await sam.deleteNote(d2.id);

      // Lee undoes the drag: the inverse skips the deleted id (no exception,
      // no resurrection) and restores D1 and D3 exactly.
      await lee.page.getByTestId('undo-button').click();
      const undone = await lee.waitFor(
        (o) => o.length === 4 && o.find((x) => x.text === 'D1')!.x === before.get('D1')!.x,
        'Lee to see the undo (4 notes, D1 back)',
      );
      expect(undone.map((o) => o.text).sort()).toEqual(['D1', 'D3', 'E1', 'E2']);
      for (const o of undone) {
        expectAtStart(o, before.get(o.text)!, `${o.text}`);
      }

      // The boards stay consistent and nobody threw (wait for Lee's undo to
      // propagate to Sam, not just for the count).
      const samState = await sam.waitFor(
        (o) => o.length === 4 && o.find((x) => x.text === 'D1')!.x === before.get('D1')!.x,
        'Sam to see 4 notes with D1 restored',
      );
      expect(sameBoard(undone, samState)).toBe(true);
      expect(lee.hasErrors(), lee.errorDetails()).toBe(false);
      expect(sam.hasErrors(), sam.errorDetails()).toBe(false);
    } finally {
      await ctxL.close();
      await ctxS.close();
    }
  });

  test('TC-24: a 5×2 grid dragged in one gesture → one undo restores all 10 starts', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    const colors: StickyColor[] = ['yellow', 'green', 'blue', 'pink', 'violet', 'orange'];
    const specs: NoteSpec[] = [];
    for (let k = 0; k < 5; k += 1) {
      for (const x of [-300, -50]) {
        specs.push({ x, y: (k - 2) * 200, text: `R${k + 1}${x === -300 ? 'A' : 'B'}`, color: colors[(k + (x === -300 ? 0 : 1)) % 6] });
      }
    }
    const boardId = await seededBoard(specs);
    const ctxL = await browser.newContext();
    const ctxS = await browser.newContext();
    const lee = await Participant.join(ctxL, boardId);
    const sam = await Participant.join(ctxS, boardId);
    try {
      await setCamera(lee.page, MAIN_CAM);
      await setCamera(sam.page, MAIN_CAM);
      expect(await objects(lee.page)).toHaveLength(10);

      // Marquee the whole grid: world (-460,-560)..(110,560) fully contains
      // all 10 boxes (x -400..50, y -500..500).
      await marquee(lee.page, s05(-460, -560), s05(110, 560));
      expect(await selectedCount(lee.page)).toBe(10);

      const before = startsOf(await objects(lee.page));
      const r1a = await byText(lee.page, 'R1A');
      // One gesture: +150px screen = +300 world x.
      await dragAt(lee.page, s05(r1a.x + 100, r1a.y + 100), { x: 150, y: 0 }, 12);
      const afterDrag = startsOf(await objects(lee.page));
      expect(afterDrag.get('R1A')!.x).toBe(before.get('R1A')!.x + 300);
      expect(afterDrag.get('R5B')!.x).toBe(before.get('R5B')!.x + 300);

      // ONE undo click: every note of every row is back at its exact start,
      // whatever number of animation frames the gesture took.
      await lee.page.getByTestId('undo-button').click();
      const undone = await lee.waitFor((o) => {
        const first = o.find((x) => x.text === 'R1A');
        return first !== undefined && first.x === before.get('R1A')!.x;
      }, 'the grid to be restored');
      for (const o of undone) {
        expectAtStart(o, before.get(o.text)!, `grid ${o.text}`);
      }

      const samState = await sam.waitFor(
        (o) => o.find((x) => x.text === 'R1A')!.x === before.get('R1A')!.x,
        'Sam to see the grid restored',
      );
      expect(sameBoard(undone, samState)).toBe(true);
      expect(lee.hasErrors(), lee.errorDetails()).toBe(false);
      expect(sam.hasErrors(), sam.errorDetails()).toBe(false);
    } finally {
      await ctxL.close();
      await ctxS.close();
    }
  });
});
