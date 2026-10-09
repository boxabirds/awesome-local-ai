import { expect, test, type Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createBoard, settle } from './helpers/board';
import { boardSnapshot, eventually, openParticipant, snapshotOf, type Participant } from './helpers/participants';

async function seedStickies(page: Page, count: number): Promise<string[]> {
  await expect
    .poll(() => page.evaluate(() => typeof window.__vidi6?.seedStickies === 'function'), { timeout: 30_000 })
    .toBe(true);
  const ids = await page.evaluate((n) => window.__vidi6!.seedStickies!(n), count);
  await eventually(() => countNotes(page), 'seeded notes render').toBe(count);
  return ids;
}

function countNotes(page: Page): Promise<number> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid]')]
      .map((el) => el.getAttribute('data-testid') ?? '')
      .filter((id) => id.startsWith('sticky-') && !id.startsWith('sticky-text-') && !id.startsWith('sticky-fade-'))
      .length
  );
}

async function noteBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId(`sticky-${id}`).boundingBox();
  if (box === null) throw new Error(`note ${id} not visible`);
  return box;
}

async function dragElementCenter(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const box = await noteBox(page, id);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 6 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
  await page.mouse.up();
  await settle(page);
}

async function typeInNote(page: Page, id: string, text: string): Promise<void> {
  await page.getByTestId(`sticky-${id}`).dblclick();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await settle(page);
}

async function textOf(page: Page, id: string): Promise<string | null> {
  return page.getByTestId(`sticky-text-${id}`).textContent();
}

// Shift-marquee from a corner outside the top-left note to one outside the
// bottom-right note of the seed grid (240px steps, 4 columns, 200px notes).
async function marqueeGrid(page: Page, firstId: string, count: number): Promise<void> {
  const origin = await noteBox(page, firstId);
  const last = Math.floor((count - 1) / 4);
  await page.keyboard.down('Shift');
  await page.mouse.move(origin.x - 30, origin.y - 30);
  await page.mouse.down();
  await page.mouse.move(origin.x + 240 * 3.5, origin.y + 240 * last * 0.5, { steps: 5 });
  await page.mouse.move(origin.x + 240 * 3 + 230, origin.y + 240 * last + 230, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);
}

async function allSnapshotsEqual(people: Participant[], message: string): Promise<void> {
  await eventually(async () => {
    const snaps = await snapshotOf(...people);
    return snaps.every((snap) => snap === snaps[0]);
  }, message).toBe(true);
}

test.describe('story 8 workflows', () => {
  test('TC-22 recover an accidental mass delete while a colleague works', async ({ browser, request }) => {
    test.setTimeout(180_000);
    const boardId = await createBoard(request);
    const mia = await openParticipant(browser, 'Mia', boardId);
    const raj = await openParticipant(browser, 'Raj', boardId);
    const ids = await seedStickies(mia.page, 8);
    await eventually(() => boardSnapshot(raj.page), 'Raj sees all eight').toBe(await boardSnapshot(mia.page));

    // Raj decorates two notes; the content lives inside the notes Mia will
    // delete and restore.
    await raj.page.getByTestId(`sticky-${ids[0]}`).click();
    await raj.page.getByRole('button', { name: 'Pink colour' }).click();
    await typeInNote(raj.page, ids[2], 'raj text');
    await allSnapshotsEqual([mia, raj], 'decoration converges');
    const preDelete = await boardSnapshot(mia.page);
    expect(preDelete).toContain('raj text');
    expect(preDelete).toContain('rgb(244, 143, 177)');

    // Mia box-selects all eight and deletes them.
    await marqueeGrid(mia.page, ids[0], 8);
    await mia.page.keyboard.press('Delete');
    await eventually(() => boardSnapshot(mia.page), 'notes gone for Mia').toBe('');
    await eventually(() => boardSnapshot(raj.page), 'notes gone for Raj').toBe('');

    // Raj adds a note of his own.
    await raj.page.getByTestId('board-viewport').dblclick({ position: { x: 1100, y: 640 } });
    await raj.page.keyboard.press('Escape');
    await settle(raj.page);
    await eventually(async () => (await countNotes(mia.page)) === 1 && (await countNotes(raj.page)) === 1, 'raj note on both').toBe(true);
    const rajNoteLine = (await boardSnapshot(mia.page)).split('\n')[0] ?? '';

    // Mia's Ctrl+Z brings the eight back with everything intact — hers only:
    // Raj's note stays.
    await mia.page.keyboard.press('Control+z');
    await eventually(() => boardSnapshot(mia.page), 'Mia sees the eight restored').toContain('raj text');
    await allSnapshotsEqual([mia, raj], 'restored board identical on both screens');
    const restored = await boardSnapshot(mia.page);
    expect(restored.split('\n').length).toBe(9);
    expect(restored).toContain(rajNoteLine);
    for (const line of preDelete.split('\n')) expect(restored).toContain(line);

    // Mia's history is exhausted: Undo disabled, Redo enabled.
    await expect(mia.page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await expect(mia.page.getByRole('button', { name: 'Redo' })).toBeEnabled();

    // Redo removes the eight again on both screens, leaving Raj's note.
    await mia.page.getByRole('button', { name: 'Redo' }).click();
    await eventually(() => boardSnapshot(mia.page), 'notes gone again for Mia').toBe(rajNoteLine);
    await eventually(() => boardSnapshot(raj.page), 'notes gone again for Raj').toBe(rajNoteLine);

    expect(mia.consoleErrors).toEqual([]);
    expect(raj.consoleErrors).toEqual([]);
    await mia.context.close();
    await raj.context.close();
  });

  test('TC-23 colleague deleted my object: undo is a no-op, no errors, next undo works', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const mia = await openParticipant(browser, 'Mia', boardId);
    const raj = await openParticipant(browser, 'Raj', boardId);
    const ids = await seedStickies(mia.page, 2);

    await dragElementCenter(mia.page, ids[0], 90, 50);
    await allSnapshotsEqual([mia, raj], 'Mia move converges');
    const moved = await boardSnapshot(mia.page);

    // Raj deletes the very note Mia moved.
    await raj.page.getByTestId(`sticky-${ids[0]}`).click();
    await raj.page.getByRole('button', { name: 'Delete note' }).click();
    await eventually(() => boardSnapshot(mia.page), 'note gone for Mia').not.toContain(ids[0]);
    const afterDelete = await boardSnapshot(mia.page);

    // Mia undoes: the move targets an item that no longer exists.
    await mia.page.keyboard.press('Control+z');
    await mia.page.waitForTimeout(400);
    await settle(mia.page);
    expect(await boardSnapshot(mia.page)).toBe(afterDelete);
    expect(await boardSnapshot(mia.page)).not.toBe(moved);

    // The next undo is still callable and harmless.
    await mia.page.keyboard.press('Control+z');
    await mia.page.waitForTimeout(400);
    await settle(mia.page);
    expect(await boardSnapshot(mia.page)).toBe(afterDelete);
    expect(mia.consoleErrors).toEqual([]);
    expect(raj.consoleErrors).toEqual([]);
    await mia.context.close();
    await raj.context.close();
  });

  test('TC-24 everyone undoing at once reverts only their own changes', async ({ browser, request }) => {
    test.setTimeout(240_000);
    const boardId = await createBoard(request);
    const people: Participant[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
      people.push(await openParticipant(browser, `person-${String(i + 1)}`, boardId));
    }
    const ids = await seedStickies(people[0].page, MAX_CONCURRENT_EDITORS * 2);
    await allSnapshotsEqual(people, 'seed converges to all');
    const pristine = await boardSnapshot(people[0].page);
    const initialBoxes: { x: number; y: number }[] = [];
    for (let i = 0; i < people.length; i += 1) {
      const box = await noteBox(people[0].page, ids[i * 2]!);
      initialBoxes.push({ x: box.x, y: box.y });
    }

    // Person i moves note 2i and types into note 2i+1.
    for (let i = 0; i < people.length; i += 1) {
      const person = people[i]!;
      await dragElementCenter(person.page, ids[i * 2]!, 40 + i * 12, 30);
      await typeInNote(person.page, ids[i * 2 + 1]!, `m${i}`);
    }
    await allSnapshotsEqual(people, 'edits converge to all');
    const edited = await boardSnapshot(people[0].page);
    for (let i = 0; i < people.length; i += 1) expect(edited).toContain(`m${i}`);

    // Round one: each Ctrl+Z reverts that person's typing, nothing else.
    for (const person of people) {
      await person.page.keyboard.press('Control+z');
    }
    await allSnapshotsEqual(people, 'first undos converge');
    const afterFirst = await boardSnapshot(people[0].page);
    for (let i = 0; i < people.length; i += 1) {
      expect(await textOf(people[0].page, ids[i * 2 + 1]!), `own typing undone for m${i}`).not.toBe(`m${i}`);
    }
    // The moves are all still there (each person's own undo consumed only
    // their typing, not their move, and nobody else's either).
    expect(afterFirst.split('\n').length).toBe(MAX_CONCURRENT_EDITORS * 2);
    for (let i = 0; i < people.length; i += 1) {
      const box = await noteBox(people[0].page, ids[i * 2]!);
      const initial = initialBoxes[i]!;
      expect(Math.abs(box.x - initial.x), `move of person ${i} still intact`).toBeGreaterThan(10);
    }

    // Round two: each Ctrl+Z reverts that person's move; the board returns to
    // exactly the pre-edit state, identical on every screen.
    for (const person of people) {
      await person.page.keyboard.press('Control+z');
    }
    await allSnapshotsEqual(people, 'second undos converge');
    await eventually(() => boardSnapshot(people[0].page), 'board back to pristine state').toBe(pristine);
    await eventually(async () => {
      const texts: string[] = [];
      for (let i = 0; i < people.length; i += 1) texts.push((await textOf(people[0].page, ids[i * 2 + 1]!)) ?? '');
      return texts.every((text) => text === '');
    }, 'all typed text gone').toBe(true);

    for (const person of people) expect(person.consoleErrors).toEqual([]);
    for (const person of people) await person.context.close();
  });
});
