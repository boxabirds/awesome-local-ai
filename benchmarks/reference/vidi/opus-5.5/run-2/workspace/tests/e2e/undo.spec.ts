/**
 * Story 8 e2e (TC-22 to TC-24, undo.controls): personal undo and redo in real browsers
 * against `wrangler dev`, proving that changes arriving through the real provider are never
 * in anyone's history. Boards are seeded with the 12-note undo fixture; the camera is set so
 * world positions map to known screen pixels.
 */
import { expect, test, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import type { Camera, Point } from '../../src/client/canvas/camera';
import { buildUndoBoard, UNDO_BOARD } from '../fixtures/boards';
import { setCamera } from './helpers/board';
import { createBoard, seedBoard } from './helpers/seed';
import { E2E_BASE_URL } from './helpers/server';
import { closeAll, expectWithin, openParticipants, type Participant } from './helpers/participants';

const CAM: Camera = { x: -200, y: -200, zoom: 0.5 };
const NOTE_COUNT = 12;
const MULTI_CONTEXT_TIMEOUT_MS = 120_000;
const UNDO = 'ControlOrMeta+z';

interface RenderedNote {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  color: string;
  text: string;
}

function toScreen(p: Point): Point {
  return { x: (p.x - CAM.x) * CAM.zoom, y: (p.y - CAM.y) * CAM.zoom };
}

/** Screen centre of the fixture note with top-left `p` and the fixture size at index `n`. */
function centreOfFixture(p: Point, n: number): Point {
  const size = UNDO_BOARD.sizes[n % UNDO_BOARD.sizes.length]!;
  return toScreen({ x: p.x + size.width / 2, y: p.y + size.height / 2 });
}

async function seededBoard(): Promise<{ boardId: string; ids: ReturnType<typeof buildUndoBoard> }> {
  const doc = new Y.Doc();
  const ids = buildUndoBoard(doc);
  const boardId = await createBoard(E2E_BASE_URL);
  await seedBoard(E2E_BASE_URL, boardId, doc);
  return { boardId, ids };
}

/** Every rendered note, sorted by id. */
async function board(page: Page): Promise<RenderedNote[]> {
  const list = await page.getByRole('group', { name: 'Sticky note' }).evaluateAll((els) =>
    els.map((el) => {
      const h = el as HTMLElement;
      return {
        id: h.dataset.id ?? '',
        x: parseFloat(h.style.left),
        y: parseFloat(h.style.top),
        width: parseFloat(h.style.width),
        height: parseFloat(h.style.height),
        z: Number(h.style.zIndex),
        color: h.dataset.color ?? '',
        text: h.querySelector('.sticky-text-content')?.textContent ?? '',
      };
    }),
  );
  return list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function ready(people: Participant[]): Promise<void> {
  for (const p of people) {
    await expect(p.page.getByRole('group', { name: 'Sticky note' })).toHaveCount(NOTE_COUNT);
    await setCamera(p.page, CAM);
  }
}

async function marquee(page: Page, from: Point, to: Point): Promise<void> {
  const a = toScreen(from);
  const b = toScreen(to);
  await page.keyboard.down('Shift'); // Shift+drag on empty board box-selects (story 7)
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

async function dragBy(page: Page, from: Point, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
  await page.mouse.up();
}

function undoButton(page: Page) {
  return page.getByRole('button', { name: 'Undo' });
}
function redoButton(page: Page) {
  return page.getByRole('button', { name: 'Redo' });
}

let people: Participant[] = [];

test.afterEach(async () => {
  await closeAll(people);
  people = [];
});

test.describe('undo.controls', () => {
  test('TC-22 Mia recovers an accidental delete while Raj adds a note; redo deletes again', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const { boardId, ids } = await seededBoard();
    people = await openParticipants(browser, ['Mia', 'Raj'], boardId);
    await ready(people);
    const [mia, raj] = people as [Participant, Participant];
    const original = await board(mia.page);
    await expect(undoButton(mia.page)).toBeDisabled();
    await expect(redoButton(mia.page)).toBeDisabled();

    // Mia box-selects the 8-note cluster and presses Delete.
    await marquee(mia.page, { x: -80, y: -80 }, { x: 1080, y: 560 });
    await expect(mia.page.getByTestId('selection-outline')).toHaveCount(ids.cluster.length);
    await mia.page.keyboard.press('Delete');
    for (const p of people) await expectWithin(async () => (await board(p.page)).length).toBe(NOTE_COUNT - 8);
    await expect(undoButton(mia.page)).toBeEnabled();

    // Meanwhile Raj adds a note (his change must survive Mia's undo and redo).
    const empty = toScreen({ x: 500, y: 1000 });
    await raj.page.mouse.dblclick(empty.x, empty.y);
    await raj.page.keyboard.type('Raj was here');
    await raj.page.keyboard.press('Escape');
    for (const p of people) await expectWithin(async () => (await board(p.page)).length).toBe(NOTE_COUNT - 7);
    const rajs = (await board(raj.page)).find((n) => n.text === 'Raj was here')!;
    expect(rajs).toBeDefined();
    // Raj's own history is his; Mia's delete is not in it.
    await expect(undoButton(raj.page)).toBeEnabled();

    // Mia undoes: all 8 come back on both screens with text, colour, size and position.
    await mia.page.keyboard.press(UNDO);
    for (const p of people) {
      await expectWithin(() => board(p.page)).toEqual(
        [...original, rajs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      );
    }
    await expect(undoButton(mia.page)).toBeDisabled(); // Mia's history is exhausted
    await expect(redoButton(mia.page)).toBeEnabled();

    // Redo deletes the 8 again; Raj's note remains.
    await redoButton(mia.page).click();
    for (const p of people) {
      await expectWithin(async () => (await board(p.page)).map((n) => n.id).sort()).toEqual(
        [...ids.others, rajs.id].sort(),
      );
    }
    await expect(redoButton(mia.page)).toBeDisabled();

    // And undo restores them once more.
    await undoButton(mia.page).click();
    for (const p of people) await expectWithin(async () => (await board(p.page)).length).toBe(NOTE_COUNT + 1);
    await expect(undoButton(mia.page)).toBeDisabled();
    expect(mia.errors).toEqual([]);
    expect(raj.errors).toEqual([]);
  });

  test('TC-23 undoing a move of a note Raj deleted does nothing visible; the next undo works', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const { boardId, ids } = await seededBoard();
    people = await openParticipants(browser, ['Mia', 'Raj'], boardId);
    await ready(people);
    const [mia, raj] = people as [Participant, Participant];
    const original = await board(mia.page);
    const keptId = ids.others[0]!;
    const goneId = ids.others[1]!;
    const kept0 = original.find((n) => n.id === keptId)!;

    // Mia moves two notes, one after the other (two steps).
    await dragBy(mia.page, centreOfFixture(UNDO_BOARD.others[0]!, 8), 0, 300);
    await dragBy(mia.page, centreOfFixture(UNDO_BOARD.others[1]!, 9), 0, 150);
    const moved = await board(mia.page);
    const keptMoved = moved.find((n) => n.id === keptId)!;
    const goneMoved = moved.find((n) => n.id === goneId)!;
    expect(keptMoved.y).toBeGreaterThan(kept0.y);
    await expectWithin(async () => (await board(raj.page)).find((n) => n.id === goneId)?.y).toBe(goneMoved.y);

    // Raj deletes the note Mia moved last.
    await raj.page.locator(`[data-id="${goneId}"]`).click();
    await raj.page.keyboard.press('Delete');
    for (const p of people) await expectWithin(async () => (await board(p.page)).length).toBe(NOTE_COUNT - 1);

    // Mia undoes: no error, the note stays gone on both screens, nothing else changes.
    await mia.page.keyboard.press(UNDO);
    const afterFirst = await board(mia.page);
    expect(afterFirst.find((n) => n.id === goneId)).toBeUndefined();
    expect(afterFirst.find((n) => n.id === keptId)).toMatchObject({ x: keptMoved.x, y: keptMoved.y });
    await expect(raj.page.locator(`[data-id="${goneId}"]`)).toHaveCount(0);

    // Her next undo works normally.
    await mia.page.keyboard.press(UNDO);
    for (const p of people) {
      await expectWithin(async () => (await board(p.page)).find((n) => n.id === keptId)).toMatchObject({ x: kept0.x, y: kept0.y });
      expect((await board(p.page)).find((n) => n.id === goneId)).toBeUndefined();
    }
    await expect(undoButton(mia.page)).toBeDisabled();
    expect(mia.errors).toEqual([]);
    expect(mia.dialogs).toEqual([]);
    expect(raj.errors).toEqual([]);
  });

  test('TC-24 MAX_CONCURRENT_EDITORS people each undo only their own changes at once', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const { boardId } = await seededBoard();
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor ${i + 1}`);
    people = await openParticipants(browser, names, boardId);
    await ready(people);
    const original = await board(people[0]!.page);

    // Person i moves a top-row cluster note (or the first right note) down into empty space,
    // then types into a bottom-row cluster note (or the third right note).
    const all = [...UNDO_BOARD.cluster, ...UNDO_BOARD.others];
    const moveIdx = [0, 1, 2, 3, 8].slice(0, MAX_CONCURRENT_EDITORS);
    const typeIdx = [4, 5, 6, 7, 10].slice(0, MAX_CONCURRENT_EDITORS);
    const MOVE_DY = 300; // screen px = 600 world units

    await Promise.all(
      people.map(async (p, i) => {
        await dragBy(p.page, centreOfFixture(all[moveIdx[i]!]!, moveIdx[i]!), 0, MOVE_DY);
        const target = centreOfFixture(all[typeIdx[i]!]!, typeIdx[i]!);
        await p.page.mouse.dblclick(target.x, target.y);
        const editor = p.page.getByRole('textbox', { name: 'Note text' });
        await expect(editor).toBeFocused();
        await editor.press('End');
        await p.page.keyboard.type(` +${p.name}`);
        await p.page.keyboard.press('Escape');
        await expect(editor).toHaveCount(0);
      }),
    );

    // Everyone sees everyone's changes, identically.
    const changed = await board(people[0]!.page);
    for (const p of people) await expectWithin(() => board(p.page)).toEqual(changed);
    for (const p of people) expect(changed.some((n) => n.text.endsWith(` +${p.name}`))).toBe(true);
    const movedIds = moveIdx.map((i) => idAt(original, all, i) ?? '');
    expect(movedIds.every((id) => id !== '')).toBe(true);

    // First undo everywhere: each person's typing is reverted, every move stays.
    await Promise.all(people.map((p) => p.page.keyboard.press(UNDO)));
    for (const p of people) {
      await expectWithin(async () => (await board(p.page)).filter((n) => n.text.includes(' +Editor')).length).toBe(0);
    }
    const afterTyping = await board(people[0]!.page);
    for (const id of movedIds) {
      const before = original.find((n) => n.id === id)!;
      expect(afterTyping.find((n) => n.id === id)!.y).toBeGreaterThan(before.y);
    }

    // Second undo everywhere: each person's move is reverted; all boards are the original.
    await Promise.all(people.map((p) => p.page.keyboard.press(UNDO)));
    for (const p of people) await expectWithin(() => board(p.page)).toEqual(original);
    for (const p of people) {
      await expect(undoButton(p.page)).toBeDisabled();
      expect(p.errors).toEqual([]);
    }
  });
});

/** Id of the rendered note whose top-left matches fixture position `i`. */
function idAt(notes: RenderedNote[], all: Point[], i: number): string | undefined {
  const p = all[i]!;
  return notes.find((n) => n.x === p.x && n.y === p.y)?.id;
}
