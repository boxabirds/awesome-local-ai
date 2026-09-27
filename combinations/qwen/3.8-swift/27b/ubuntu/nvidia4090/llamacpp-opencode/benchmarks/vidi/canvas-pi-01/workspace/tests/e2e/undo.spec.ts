// Story 8 e2e: undo and redo my own changes without undoing anyone else's
// (TC-22 to TC-24).
//
// Runs against `wrangler dev` (see playwright.config.ts) in Chromium,
// Firefox and WebKit. Participants are genuine y-websocket clients of the
// BoardRoom Durable Object; world state is read back from each participant's
// Y.Doc so camera rounding never matters. Undo/redo are driven with the real
// keyboard shortcuts and toolbar buttons, so the provider-origin (remote)
// transactions are proven to never enter the personal undo stacks.

import { expect, test, type Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { settleCamera } from './helpers/board';
import {
  closeParticipant,
  createFreshBoard,
  expectWithin,
  openParticipant,
  type Participant,
} from './helpers/participants';

/** The home camera of a page (100%, world origin centred). */
async function homeCam(page: Page, zoom = 1): Promise<{ x: number; y: number; zoom: number }> {
  const { width, height } = page.viewportSize() ?? { width: 1280, height: 800 };
  return { x: -width / 2, y: -height / 2, zoom };
}

/** World (x,y) → screen px under a camera (screen = (world - cam) * zoom). */
function sx(cam: { x: number; y: number; zoom: number }, wx: number): number {
  return (wx - cam.x) * cam.zoom;
}
function sy(cam: { x: number; y: number; zoom: number }, wy: number): number {
  return (wy - cam.y) * cam.zoom;
}

interface WorldObject {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  z: number;
  color?: string;
  text?: string;
}

/** All objects in the page's Y.Doc, as plain world state. */
async function worldObjects(page: Page): Promise<WorldObject[]> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
    const objects = hook.getDoc().getMap('objects');
    const out: WorldObject[] = [];
    for (const key of objects.keys()) {
      const o = objects.get(key) as import('yjs').Map<unknown>;
      out.push({
        id: String(key),
        type: o.get('type') as string,
        x: o.get('x') as number,
        y: o.get('y') as number,
        width: o.get('width') as number | undefined,
        height: o.get('height') as number | undefined,
        z: o.get('z') as number,
        color: (o.get('color') as string | undefined) ?? undefined,
        text: (o.get('text') as { toString(): string } | undefined)?.toString(),
      });
    }
    return out;
  });
}

/** One object by id (throws if absent). */
function objectById(objects: WorldObject[], id: string): WorldObject {
  const found = objects.find((o) => o.id === id);
  if (found === undefined) throw new Error(`object ${id} not found`);
  return found;
}

/** Create a sticky note with its top-left corner at world (x, y). */
async function placeNote(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ({ x, y }) => {
      const hook = window.__vidi6;
      if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
      return hook.createNoteAt(x + 100, y + 100);
    },
    { x, y },
  );
}

/**
 * Set a note's colour by writing the Y.Doc field directly (a plain local
 * transaction: it propagates to peers and is restored by undo, but it is not
 * part of the personal undo stack).
 */
async function setNoteColorDirect(page: Page, id: string, color: string): Promise<void> {
  await page.evaluate(({ id, color }) => {
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
    const o = hook.getDoc().getMap('objects').get(id) as import('yjs').Map<unknown>;
    o.set('color', color);
  }, { id, color });
}

/**
 * Shift+drag a marquee from world (x0,y0) to (x1,y1). The start point must be
 * on empty board space (the marquee only begins on the viewport itself).
 */
async function marquee(
  page: Page,
  cam: { x: number; y: number; zoom: number },
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(sx(cam, x0), sy(cam, y0));
  await page.mouse.down();
  await page.mouse.move(sx(cam, x1), sy(cam, y1), { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settleCamera(page);
}

/**
 * Marquee until exactly `expectIds` are selected (browsers can drop a drag
 * under load; retry, clearing the selection between attempts).
 */
async function marqueeToSelect(
  page: Page,
  cam: { x: number; y: number; zoom: number },
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  expectIds: string[],
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await marquee(page, cam, x0, y0, x1, y1);
    const sel = await selectedIds(page);
    if (
      sel.length === expectIds.length &&
      expectIds.every((id) => sel.includes(id))
    ) {
      return;
    }
    // Clear any partial selection before retrying (click empty space).
    await page.mouse.click(sx(cam, -630), sy(cam, 390));
    await settleCamera(page);
  }
  throw new Error('marquee never selected the expected notes');
}

/** The ids of the currently selected notes, in DOM order. */
async function selectedIds(page: Page): Promise<string[]> {
  const els = page.locator('[data-testid="sticky-note"][data-selected]');
  const n = await els.count();
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = await els.nth(i).getAttribute('data-id');
    if (id !== null) ids.push(id);
  }
  return ids;
}

/**
 * Click the centre of the note at world (x, y), verifying the selection took
 * (WebKit + Playwright can drop a click under load; retry if so).
 */
async function clickNoteAt(
  page: Page,
  cam: { x: number; y: number; zoom: number },
  x: number,
  y: number,
  expectId?: string,
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.mouse.click(sx(cam, x + 100), sy(cam, y + 100));
    await settleCamera(page);
    const sel = await selectedIds(page);
    if (expectId === undefined ? sel.length === 1 : sel.length === 1 && sel[0] === expectId) {
      return;
    }
    await page.waitForTimeout(100); // let the board settle before retrying
  }
  throw new Error('clicking the note never selected it');
}

/** Drag the note centred at world (cx,cy) by a world delta (dx,dy). */
async function dragWorld(
  page: Page,
  cam: { x: number; y: number; zoom: number },
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): Promise<void> {
  const px = sx(cam, cx);
  const py = sy(cam, cy);
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 5 * cam.zoom, py + 5 * cam.zoom, { steps: 2 });
  await page.mouse.move(px + dx * cam.zoom, py + dy * cam.zoom, { steps: 16 });
  await page.mouse.up();
  await settleCamera(page);
}

/** Double-click the note centred at world (cx,cy) and type `text` into it. */
async function typeInNoteAt(
  page: Page,
  cam: { x: number; y: number; zoom: number },
  cx: number,
  cy: number,
  text: string,
): Promise<void> {
  await page.mouse.dblclick(sx(cam, cx), sy(cam, cy));
  await page.locator('[data-testid="sticky-editor"] textarea').pressSequentially(text, {
    delay: 10,
  });
  // Commit the edit (pointerdown outside the note ends editing).
  await page.mouse.click(10, 10);
  await settleCamera(page);
}

/** Collect uncaught page errors so a test can assert "no error". */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

/**
 * Poll until two participants' world states are identical (sorted by id, z
 * ignored). Used after a burst of local transactions whose propagation may
 * transiently diverge the views.
 */
async function expectBoardsIdentical(a: Page, b: Page): Promise<void> {
  const snapshot = async (page: Page) =>
    (await worldObjects(page))
      .map(({ z: _z, ...rest }) => rest)
      .sort((x, y) => x.id.localeCompare(y.id));
  await expectWithin(
    async () => {
      const sa = await snapshot(a);
      const sb = await snapshot(b);
      return JSON.stringify(sa) === JSON.stringify(sb);
    },
    { timeout: 5000 }, // a burst of undos can take a moment to propagate
  );
}

/** The toolbar Undo / Redo buttons. */
function undoButton(page: Page) {
  return page.getByRole('button', { name: 'Undo' });
}
function redoButton(page: Page) {
  return page.getByRole('button', { name: 'Redo' });
}

test.describe('story 8 e2e', () => {
  test('TC-22 Mia deletes 8 notes, Raj adds one; Mia undoes → 8 back with full content on both screens, Raj\'s note remains; Redo button removes the 8 again; Undo disables when history is exhausted', async ({ browser, request }) => {
    const boardId = await createFreshBoard(request);
    const mia = await openParticipant(browser, boardId);
    const raj = await openParticipant(browser, boardId);
    try {
      const cam = await homeCam(mia.page);
      // Mia places 8 notes in a 4x2 grid fully inside the visible region
      // (the home camera shows world -640..640 / -400..400 at 100%).
      const COLS = [-600, -340, -80, 180];
      const ROWS = [-350, -90];
      const ids: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        ids.push(await placeNote(mia.page, COLS[i % 4], ROWS[Math.floor(i / 4)]));
      }
      // Give the notes distinct colours so a restore is verifiable as full
      // content, not just presence.
      const PALETTE = ['yellow', 'green', 'blue', 'pink'];
      const before = new Map<string, WorldObject>();
      for (let i = 0; i < 8; i += 1) {
        await setNoteColorDirect(mia.page, ids[i], PALETTE[i % PALETTE.length]);
      }
      await expectWithin(async () => (await worldObjects(raj.page)).length === 8);
      for (const o of await worldObjects(mia.page)) before.set(o.id, o);

      // Raj adds his own note far away (off the marquee, off-screen: fine, we
      // assert on world state only).
      const rajNote = await placeNote(raj.page, 1600, 0);

      // Mia marquee-selects the 8 (world -620,-370 → 400,130) and deletes: one step.
      await marqueeToSelect(mia.page, cam, -620, -370, 400, 130, ids);
      await mia.page.keyboard.press('Delete');

      // Both screens now show only Raj's note.
      await expectWithin(async () => (await worldObjects(mia.page)).length === 1);
      await expectWithin(async () => (await worldObjects(raj.page)).length === 1);

      // Mia undoes → the 8 return on BOTH screens with text, colours, sizes
      // and positions; Raj's note is untouched.
      await mia.page.keyboard.press('Control+z');
      await expectWithin(async () => (await worldObjects(mia.page)).length === 9);
      await expectWithin(async () => (await worldObjects(raj.page)).length === 9);
      const rajView = await worldObjects(raj.page);
      expect(rajView.length).toBe(9);
      expect(rajView.some((o) => o.id === rajNote)).toBe(true);
      for (const id of ids) {
        const restored = objectById(rajView, id);
        const original = before.get(id)!;
        expect(restored.x).toBe(original.x);
        expect(restored.y).toBe(original.y);
        expect(restored.width).toBe(original.width);
        expect(restored.height).toBe(original.height);
        expect(restored.color).toBe(original.color);
        expect(restored.text).toBe(original.text);
      }

      // Mia clicks the Redo button → the 8 disappear again on both screens;
      // Raj's note remains.
      await redoButton(mia.page).click();
      await expectWithin(async () => (await worldObjects(mia.page)).length === 1);
      await expectWithin(async () => (await worldObjects(raj.page)).length === 1);
      const afterRedo = await worldObjects(raj.page);
      expect(afterRedo.length).toBe(1);
      expect(objectById(afterRedo, rajNote)).toBeDefined();

      // Exhaust Mia's history: the Undo button becomes disabled.
      for (let i = 0; i < 12; i += 1) {
        if ((await undoButton(mia.page).isDisabled()) === true) break;
        await mia.page.keyboard.press('Control+z');
      }
      await expect(undoButton(mia.page).isDisabled()).toBeTruthy();
      // The 8 are gone from both screens; Raj's note is still there.
      await expectBoardsIdentical(mia.page, raj.page);
      const exhausted = await worldObjects(raj.page);
      expect(exhausted.length).toBe(1);
      expect(objectById(exhausted, rajNote)).toBeDefined();
    } finally {
      await closeParticipant(mia);
      await closeParticipant(raj);
    }
  });

  test('TC-23 Mia moves a note, Raj deletes it, Mia undoes → no error, note absent on both, Mia\'s next undo still works', async ({ browser, request }) => {
    const boardId = await createFreshBoard(request);
    const mia = await openParticipant(browser, boardId);
    const raj = await openParticipant(browser, boardId);
    try {
      const miaCam = await homeCam(mia.page);
      const rajCam = await homeCam(raj.page);
      const id = await placeNote(mia.page, 0, 0);

      // Mia moves the note by (150, 0): top-left is now (150, 0).
      await dragWorld(mia.page, miaCam, 100, 100, 150, 0);
      await expectWithin(async () => objectById(await worldObjects(mia.page), id).x === 150);

      // Raj selects (clicks the synced position) and deletes it.
      await clickNoteAt(raj.page, rajCam, 150, 0, id);
      await raj.page.keyboard.press('Delete');
      await expectWithin(async () => (await worldObjects(raj.page)).length === 0);

      // Mia undoes: the move's inverse targets a deleted object and applies
      // nothing. No error, and the note is NOT resurrected on either screen.
      const miaErrors = collectPageErrors(mia.page);
      await mia.page.keyboard.press('Control+z');
      expect(miaErrors).toEqual([]);
      await mia.page.waitForFunction(
        (noteId) => {
          const hook = window.__vidi6;
          if (hook === undefined) return false;
          return !hook.getDoc().getMap('objects').has(noteId);
        },
        id,
        { timeout: 5000 },
      );
      expect((await worldObjects(raj.page)).some((o) => o.id === id)).toBe(false);

      // Mia's next undo still works: no error, state unchanged.
      await mia.page.keyboard.press('Control+z');
      expect(miaErrors).toEqual([]);
      expect((await worldObjects(mia.page)).some((o) => o.id === id)).toBe(false);
      expect((await worldObjects(raj.page)).some((o) => o.id === id)).toBe(false);
    } finally {
      await closeParticipant(mia);
      await closeParticipant(raj);
    }
  });

  test('TC-24 each of MAX_CONCURRENT_EDITORS moves one note and types in another; two undos revert own changes only, all boards identical', async ({ browser, request }) => {
    const boardId = await createFreshBoard(request);
    const participants: Participant[] = [];
    try {
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        participants.push(await openParticipant(browser, boardId));
      }
      const cams = await Promise.all(participants.map((p) => homeCam(p.page)));

      // Each participant creates TWO of their own notes at unique world x
      // (a 5-column grid fully inside the visible region): one to move, one
      // to type in.
      const X = (i: number): number => -600 + i * 200;
      const movedIds: string[] = [];
      const typedIds: string[] = [];
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        movedIds.push(await placeNote(participants[i].page, X(i), -300));
        typedIds.push(await placeNote(participants[i].page, X(i), 0));
      }
      // Everyone sees all 2N notes before anyone acts.
      for (const p of participants) {
        await expectWithin(async () => (await worldObjects(p.page)).length === 2 * MAX_CONCURRENT_EDITORS);
      }

      // Each participant moves their first note and types in their second.
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        await dragWorld(participants[i].page, cams[i], X(i) + 100, -200, 60, 40);
        await typeInNoteAt(participants[i].page, cams[i], X(i) + 100, 100, `note ${i}`);
      }
      // Everyone sees every move and every typed note.
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        await expectWithin(async () => {
          const objs = await worldObjects(participants[i].page);
          return (
            objectById(objs, movedIds[i]).x === X(i) + 60 &&
            objectById(objs, typedIds[i]).text === `note ${i}`
          );
        });
      }

      // Everyone undoes twice: the typing and the move revert; the note
      // creations (also own) stay.
      for (const p of participants) {
        await p.page.keyboard.press('Control+z');
        await p.page.keyboard.press('Control+z');
      }

      // Final boards are identical: every move reverted, every typed note
      // empty, all 2N notes present, nothing else touched.
      const finals: WorldObject[][] = [];
      for (const p of participants) {
        await expectWithin(async () => {
          const objs = await worldObjects(p.page);
          return (
            objs.length === 2 * MAX_CONCURRENT_EDITORS &&
            movedIds.every((id, i) => objectById(objs, id).x === X(i)) &&
            typedIds.every((id) => objectById(objs, id).text === '')
          );
        });
        finals.push(await worldObjects(p.page));
      }
      for (let i = 1; i < finals.length; i += 1) {
        expect(JSON.stringify(finals[i].map((o) => ({ ...o, z: undefined })).sort((a, b) => a.id.localeCompare(b.id)))).toBe(
          JSON.stringify(finals[0].map((o) => ({ ...o, z: undefined })).sort((a, b) => a.id.localeCompare(b.id))),
        );
      }
    } finally {
      for (const p of participants) await closeParticipant(p);
    }
  });
});
