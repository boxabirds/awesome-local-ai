/**
 * Story 7's e2e helpers: the ways a person changes several objects at once —
 * a Shift+drag rectangle, the eight handles around a selection, the arrow keys
 * and the delete key — plus the reading of what the board ended up with.
 *
 * Every point handed to a mouse here is a *screen* point taken from a real
 * element (`noteBox`, a handle's box), so nothing in these specs depends on the
 * camera a board opens with; board positions are asserted in world units, read
 * back from each note's data attributes.
 */
import { expect, type Page } from '@playwright/test';

import type { Handle } from '../../../src/shared/geometry';
import type { SeedPlacement } from '../../fixtures/boards';
import type { Point } from './board';
import { noteBox } from './live';
import { notes, readNotes } from './notes';

/** A note as the board holds it: where it is, how big, on top of what. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
}

/** The id the seeder answered with, checked: a missing note is a broken test. */
export function pick(ids: readonly string[], index: number): string {
  const id = ids[index];
  if (!id) throw new Error(`the seeder gave no note at index ${index}`);
  return id;
}

/** Create notes through the client's own board model, and wait for the screen. */
export async function seedNotes(page: Page, placements: readonly SeedPlacement[]): Promise<string[]> {
  const before = (await readNotes(page)).map((note) => note.id);
  const seeds = placements.map(({ x, y, text, color }) => ({ x, y, text, color }));
  const ids = await page.evaluate((batch) => window.__vidi6Board?.seed(batch) ?? [], seeds);
  expect(ids).toHaveLength(placements.length);
  await expect(notes(page)).toHaveCount(before.length + placements.length);
  return ids;
}

/** Every note on this screen, by id, in board units. */
export async function placements(page: Page): Promise<Map<string, Placement>> {
  const seen = new Map<string, Placement>();
  for (const note of await readNotes(page)) {
    seen.set(note.id, {
      x: at(note.x),
      y: at(note.y),
      width: at(note.width),
      height: at(note.height),
      z: note.z,
    });
  }
  return seen;
}

/**
 * Ids this screen has selected, sorted so two screens can be compared. Every
 * object type is asked, because a selection is generic and a test that says
 * "nothing is selected" means it about all of them (`sel.all_types`).
 */
export async function selectedIds(page: Page): Promise<string[]> {
  const selected = await page.locator('[data-selected="true"]').evaluateAll((elements) =>
    elements.map((element) => {
      const object = element as HTMLElement;
      return (
        object.dataset.noteId ??
        object.dataset.textId ??
        object.dataset.boxId ??
        object.dataset.objectId ??
        ''
      );
    }),
  );
  return selected.sort();
}

/** Exactly these notes, and no others, carry an outline. */
export async function expectSelected(page: Page, ids: readonly string[]): Promise<void> {
  const wanted = [...ids].sort();
  await expect
    .poll(async () => (await selectedIds(page)).join(','), {
      message: `selection never became ${wanted.join(',')}`,
    })
    .toBe(wanted.join(','));
}

/** The bar above a selection of `count`: what it says, and that it deletes. */
export async function expectSelectionBar(page: Page, count: number): Promise<void> {
  await expect(page.getByTestId('selection-count')).toHaveText(`${count} selected`);
  await expect(page.getByRole('button', { name: 'Delete selection' })).toBeVisible();
}

/** The bar above one selected sticky note is story 2's toolbar, not a count. */
export async function expectNoteToolbar(page: Page): Promise<void> {
  await expect(page.getByTestId('selection-count')).toHaveCount(0);
  await expect(page.getByTestId('note-toolbar')).toBeVisible();
}

/**
 * Shift+drag over empty board: the marquee, from one screen point to another.
 * The rectangle is waited for halfway, so a drag that the board did not read as
 * a marquee (a press that lost its Shift, a press on some page's own control)
 * fails here, where it says that, instead of later as "nothing was selected".
 */
export async function marquee(page: Page, from: Point, to: Point): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await expect
    .poll(() => page.getByTestId('marquee-rect').count(), {
      message: `no marquee rectangle under a Shift+drag from ${Math.round(from.x)},${Math.round(from.y)}`,
    })
    .toBe(1);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Press a resize handle and pull it by `delta` screen pixels. */
export async function dragHandle(page: Page, handle: Handle, delta: Point): Promise<void> {
  const box = await page.getByTestId(`handle-${handle}`).boundingBox();
  if (!box) throw new Error(`no ${handle} resize handle on the screen`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 14 });
  await page.mouse.up();
}

/** The eight handles of one selection are where the screen says they are. */
export async function expectHandles(page: Page): Promise<void> {
  const handles: Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  await expect(page.getByTestId(/^handle-/)).toHaveCount(handles.length);
  for (const handle of handles) {
    await expect(page.getByTestId(`handle-${handle}`)).toBeVisible();
  }
}

/** Drag a note by id by `delta` screen pixels (a group move drags the rest). */
export async function dragNoteBy(page: Page, id: string, delta: Point): Promise<void> {
  const box = await noteBox(page, id);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 14 });
  await page.mouse.up();
}

/** What may be compared between two readings of one board. */
type Field = 'x' | 'y' | 'width' | 'height';

/**
 * Poll until each of these notes shows the given change, in board units, since
 * `before`. Saying it in board units is the point: the assertion is what the
 * person did ("300 units right"), not what the screen had to do to show it.
 */
async function expectDeltas(
  page: Page,
  before: ReadonlyMap<string, Placement>,
  ids: readonly string[],
  deltas: Partial<Record<Field, number>>,
  tolerance: number,
  message: string,
): Promise<void> {
  const fields = Object.keys(deltas) as Field[];
  async function problems(): Promise<string> {
    const now = await placements(page);
    return ids
      .map((id) => {
        const was = before.get(id);
        const atNow = now.get(id);
        if (!was || !atNow) return `${id} is missing`;
        return fields
          .map((field) => {
            const wanted = deltas[field] ?? 0;
            const actual = atNow[field] - was[field];
            return Math.abs(actual - wanted) <= tolerance
              ? ''
              : `${id}.${field} changed by ${at(actual)} instead of ${wanted}`;
          })
          .filter((problem) => problem !== '')
          .join(' ');
      })
      .filter((problem) => problem !== '')
      .join(' ; ');
  }
  await expect
    .poll(problems, { message })
    .toBe('');
}

export async function expectMoved(
  page: Page,
  before: ReadonlyMap<string, Placement>,
  ids: readonly string[],
  delta: { x: number; y: number },
  tolerance = 2,
): Promise<void> {
  await expectDeltas(page, before, ids, delta, tolerance, 'the notes did not move together');
}

/** These did not change at all: neither where they are nor how big they are. */
export async function expectStill(
  page: Page,
  before: ReadonlyMap<string, Placement>,
  ids: readonly string[],
): Promise<void> {
  await expectDeltas(page, before, ids, { x: 0, y: 0, width: 0, height: 0 }, 0.5, 'notes that were not selected changed');
}

const at = (value: number): number => Math.round(value * 100) / 100;
