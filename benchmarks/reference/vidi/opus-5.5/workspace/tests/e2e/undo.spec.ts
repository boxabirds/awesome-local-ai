import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  UNDO_CLUSTER_NOTES,
  UNDO_CLUSTER_ORIGIN,
  UNDO_CLUSTER_SPACING,
  UNDO_RETRO_NOTES,
  undoRetroBoard,
} from '../fixtures/boards';
import { getNotes, nextFrames, noteLocator, setCamera, type CameraState, type NoteState } from './helpers/board';
import { closeParticipants, expectWithin, openParticipants, type Participant } from './helpers/participants';
import { seedBoard } from './helpers/seed';

/**
 * Story 8 e2e (undo.controls through real browsers and the real sync provider) on the 12-note
 * retro board: a 2 × 4 cluster of 8 notes and 4 more to its right.
 */

/** The whole fixture fits the 1280 × 800 viewport at 100%. */
const CAMERA: CameraState = { x: UNDO_CLUSTER_ORIGIN.x - 50, y: UNDO_CLUSTER_ORIGIN.y - 50, zoom: 1 };
const MARGIN = 20;
const DRAG_STEPS = 10;
const MOVE_WORLD = { x: 60, y: 420 } as const;
const HALF = 2;
const MULTI_CONTEXT_TIMEOUT_MS = 120_000;
/** Empty board (screen px) below the notes, where Raj adds his note. */
const EMPTY_SPOT = { x: 1100, y: 680 } as const;
/** A grab point inside a note, away from its edges (world units from its top-left). */
const GRAB = 40;

interface Pt {
  x: number;
  y: number;
}

function toScreen(p: Pt): Pt {
  return { x: (p.x - CAMERA.x) * CAMERA.zoom, y: (p.y - CAMERA.y) * CAMERA.zoom };
}

async function prepare(people: readonly Participant[]): Promise<void> {
  for (const { page } of people) {
    await expect(noteLocator(page)).toHaveCount(UNDO_RETRO_NOTES);
    await setCamera(page, CAMERA);
    await nextFrames(page);
  }
}

function sortById(notes: NoteState[]): NoteState[] {
  return [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function board(page: Page): Promise<NoteState[]> {
  return sortById(await getNotes(page));
}

function undoButton(page: Page) {
  return page.getByRole('button', { name: 'Undo', exact: true });
}

function redoButton(page: Page) {
  return page.getByRole('button', { name: 'Redo', exact: true });
}

/** Screen point inside a note, GRAB units in from its top-left. */
function grabPoint(n: NoteState): Pt {
  return toScreen({ x: n.x + GRAB, y: n.y + GRAB });
}

async function dragBy(page: Page, from: Pt, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: DRAG_STEPS });
  await page.mouse.up();
  await nextFrames(page);
}

/** Shift+drag a rectangle between two world points (box selection). */
async function marquee(page: Page, from: Pt, to: Pt): Promise<void> {
  const a = toScreen(from);
  const b = toScreen(to);
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: DRAG_STEPS });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** The cluster: every note whose top-left lies inside the 2 × 4 grid. */
function clusterOf(notes: NoteState[]): NoteState[] {
  const maxX = UNDO_CLUSTER_ORIGIN.x + UNDO_CLUSTER_SPACING * (UNDO_CLUSTER_NOTES / HALF);
  return notes.filter((n) => n.x < maxX);
}

async function openRetro(names: readonly string[], browser: Parameters<typeof openParticipants>[0], baseURL: string) {
  const boardId = newBoardId();
  await seedBoard(baseURL, boardId, undoRetroBoard());
  const people = await openParticipants(browser, names, boardId);
  await prepare(people);
  return people;
}

test.describe('Workflow: recover an accidental delete while a colleague works', () => {
  test("TC-22 Mia deletes 8, Raj adds a note, Mia's Ctrl/Cmd+Z restores the 8 on both screens; Redo removes them again", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const people = await openRetro(['Mia', 'Raj'], browser, baseURL!);
    const [mia, raj] = people.map((p) => p.page) as [Page, Page];
    try {
      const original = await board(mia);
      const cluster = clusterOf(original);
      expect(cluster).toHaveLength(UNDO_CLUSTER_NOTES);
      await expect(undoButton(mia)).toBeDisabled();
      await expect(redoButton(mia)).toBeDisabled();

      // Mia box-selects the cluster and presses Delete.
      const last = UNDO_CLUSTER_ORIGIN.x + UNDO_CLUSTER_SPACING * (UNDO_CLUSTER_NOTES / HALF - 1);
      await marquee(
        mia,
        { x: UNDO_CLUSTER_ORIGIN.x - MARGIN, y: UNDO_CLUSTER_ORIGIN.y - MARGIN },
        { x: last + UNDO_CLUSTER_SPACING - MARGIN, y: UNDO_CLUSTER_ORIGIN.y + UNDO_CLUSTER_SPACING * HALF },
      );
      await expect(mia.getByRole('toolbar', { name: 'Selection' })).toContainText(`${UNDO_CLUSTER_NOTES} selected`);
      await mia.keyboard.press('Delete');
      await expect(noteLocator(mia)).toHaveCount(UNDO_RETRO_NOTES - UNDO_CLUSTER_NOTES);
      await expectWithin(() => noteLocator(raj).count()).toBe(UNDO_RETRO_NOTES - UNDO_CLUSTER_NOTES);
      await expect(undoButton(mia)).toBeEnabled();

      // Meanwhile Raj adds a note.
      await raj.getByTestId('board-viewport').dblclick({ position: EMPTY_SPOT });
      await raj.keyboard.type('Raj: parking lot');
      await raj.keyboard.press('Escape');
      await expectWithin(() => noteLocator(mia).count()).toBe(UNDO_RETRO_NOTES - UNDO_CLUSTER_NOTES + 1);
      const rajNote = (await board(raj)).find((n) => n.text === 'Raj: parking lot');
      expect(rajNote).toBeDefined();
      await expectWithin(async () => (await board(mia)).find((n) => n.id === rajNote!.id)?.text).toBe('Raj: parking lot');

      // Mia undoes: the 8 come back exactly as they were, on both screens; Raj's note stays.
      await mia.keyboard.press('ControlOrMeta+z');
      const expected = sortById([...original, (await board(raj)).find((n) => n.id === rajNote!.id)!]);
      await expectWithin(() => board(mia)).toEqual(expected);
      await expectWithin(() => board(raj)).toEqual(expected);
      for (const page of [mia, raj]) await expect(noteLocator(page)).toHaveCount(UNDO_RETRO_NOTES + 1);
      await expect(undoButton(mia)).toBeDisabled();
      await expect(redoButton(mia)).toBeEnabled();

      // Redo removes the 8 again on both; Raj's note still stays.
      await redoButton(mia).click();
      const withoutCluster = expected.filter((n) => !cluster.some((c) => c.id === n.id));
      await expectWithin(() => board(mia)).toEqual(withoutCluster);
      await expectWithin(() => board(raj)).toEqual(withoutCluster);
      await expect(redoButton(mia)).toBeDisabled();

      // Undo again restores them; then Mia's history is exhausted.
      await mia.keyboard.press('ControlOrMeta+z');
      await expectWithin(() => board(raj)).toEqual(expected);
      await expect(undoButton(mia)).toBeDisabled();
      // Raj never had anything of Mia's in his history: his Undo removes only his own typing.
      await expect(undoButton(raj)).toBeEnabled();
      for (const p of people) expect(p.errors).toEqual([]);
    } finally {
      await closeParticipants(people);
    }
  });
});

test.describe('Workflow: undo after a colleague deleted my object', () => {
  test('TC-23 Mia moves a note, Raj deletes it, Mia undoes: no error, still absent everywhere, next undo works', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const people = await openRetro(['Mia', 'Raj'], browser, baseURL!);
    const [mia, raj] = people.map((p) => p.page) as [Page, Page];
    try {
      const original = await board(mia);
      const [first, second] = clusterOf(original);
      // Mia first recolours one note (an earlier step), then moves another.
      await mia.mouse.click(grabPoint(first!).x, grabPoint(first!).y);
      const colour = first!.color === 'blue' ? 'violet' : 'blue';
      await mia.getByRole('button', { name: `${colour.charAt(0).toUpperCase()}${colour.slice(1)} colour` }).click();
      await expectWithin(async () => (await board(raj)).find((n) => n.id === first!.id)?.color).toBe(colour);
      await dragBy(mia, grabPoint(second!), MOVE_WORLD.x, MOVE_WORLD.y);
      await expectWithin(async () => (await board(raj)).find((n) => n.id === second!.id)?.y).toBe(
        second!.y + MOVE_WORLD.y,
      );

      // Raj deletes the moved note.
      const moved = (await board(raj)).find((n) => n.id === second!.id)!;
      await raj.mouse.click(grabPoint(moved).x, grabPoint(moved).y);
      await raj.keyboard.press('Delete');
      await expectWithin(() => noteLocator(mia, second!.id).count()).toBe(0);

      // Mia's undo of the move changes nothing visible and shows no error.
      const before = await board(mia);
      await mia.keyboard.press('ControlOrMeta+z');
      await nextFrames(mia);
      await expect(noteLocator(mia, second!.id)).toHaveCount(0);
      await expect(noteLocator(raj, second!.id)).toHaveCount(0);
      expect(await board(mia)).toEqual(before);
      expect(await board(raj)).toEqual(before);

      // Her next undo still works: the colour goes back on both screens.
      await expect(undoButton(mia)).toBeEnabled();
      await undoButton(mia).click();
      await expectWithin(async () => (await board(mia)).find((n) => n.id === first!.id)?.color).toBe(first!.color);
      await expectWithin(async () => (await board(raj)).find((n) => n.id === first!.id)?.color).toBe(first!.color);
      await expect(noteLocator(raj, second!.id)).toHaveCount(0);
      for (const p of people) {
        expect(p.errors).toEqual([]);
        expect(p.dialogs).toEqual([]);
      }
    } finally {
      await closeParticipants(people);
    }
  });
});

test.describe('Workflow: everyone undoing at once', () => {
  test('TC-24 MAX_CONCURRENT_EDITORS people each move and type, then all undo twice at once → original board everywhere', async ({
    browser,
    browserName,
    baseURL,
  }) => {
    // As story 7's TC-36: Firefox delivers simultaneous input to only some of several windows.
    test.skip(browserName !== 'chromium', 'simultaneous multi-window input is Chromium-only');
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor ${i + 1}`);
    const people = await openRetro(names, browser, baseURL!);
    const pages = people.map((p) => p.page);
    try {
      const original = await board(pages[0]!);
      const cluster = clusterOf(original);
      const others = original.filter((n) => !cluster.includes(n));
      // Person i moves cluster note i and types in note i of the rest (cluster 5–7, then others).
      const typedIn = [...cluster.slice(MAX_CONCURRENT_EDITORS), ...others];
      const edits = pages.map((_, i) => ({ move: cluster[i]!, text: typedIn[i]!, suffix: ` +${i + 1}` }));
      for (const [i, page] of pages.entries()) {
        await page.bringToFront();
        const { move, text, suffix } = edits[i]!;
        await dragBy(page, grabPoint(move), MOVE_WORLD.x, MOVE_WORLD.y);
        const target = grabPoint(text);
        await page.mouse.dblclick(target.x, target.y);
        await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.type(suffix);
        await page.keyboard.press('Escape');
      }
      // Everyone sees everyone's changes before undoing.
      const changed = sortById(
        original.map((n) => {
          const byMove = edits.find((e) => e.move.id === n.id);
          const byText = edits.find((e) => e.text.id === n.id);
          return {
            ...n,
            x: byMove ? n.x + MOVE_WORLD.x : n.x,
            y: byMove ? n.y + MOVE_WORLD.y : n.y,
            text: byText ? n.text + byText.suffix : n.text,
          };
        }),
      );
      const shape = (notes: NoteState[]) => notes.map(({ id, x, y, text, color }) => ({ id, x, y, text, color }));
      for (const page of pages) await expectWithin(async () => shape(await board(page))).toEqual(shape(changed));

      // All press Ctrl/Cmd+Z twice at the same time.
      await Promise.all(
        pages.map(async (page) => {
          await page.keyboard.press('ControlOrMeta+z');
          await page.keyboard.press('ControlOrMeta+z');
        }),
      );
      for (const page of pages) await expectWithin(() => board(page)).toEqual(original);
      const finals = await Promise.all(pages.map((page) => board(page)));
      for (const f of finals) expect(f).toEqual(finals[0]);
      for (const page of pages) await expect(undoButton(page)).toBeDisabled();
      for (const p of people) expect(p.errors).toEqual([]);
    } finally {
      await closeParticipants(people);
    }
  });
});
