import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { CATCH_UP_TEST_OUTAGE_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { settle } from './helpers/board';
import { boardSnapshot, eventually, expectEventually, openParticipant, snapshotOf, type Participant } from './helpers/participants';

async function createNote(page: Page, x: number, y: number): Promise<string> {
  await page.mouse.dblclick(x, y);
  await settle(page);
  const testId = await page.getByRole('group', { name: 'Sticky note' }).last().getAttribute('data-testid');
  return (testId ?? '').replace('sticky-', '');
}

async function centerOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(`sticky-${id}`).boundingBox();
  if (box === null) throw new Error('note not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragNote(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await settle(page);
}

function textOf(page: Page, id: string): Promise<string | null> {
  return page.getByTestId(`sticky-text-${id}`).textContent();
}

test.describe('workflow: two-person workshop', () => {
  test('TC-22 every change by Alex appears live for Sam', async ({ browser }) => {
    const boardId = newBoardId();
    const alex = await openParticipant(browser, 'Alex', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);

    let id = await createNote(alex.page, 500, 300);
    await alex.page.keyboard.press('Escape');
    await settle(alex.page);
    await expectEventually('TC-22 create', async () => {
      await eventually(() => boardSnapshot(sam.page), 'Sam sees the note').toBe(await boardSnapshot(alex.page));
    });

    const before = await centerOf(alex.page, id);
    await dragNote(alex.page, before, 120, 60);
    await alex.page.mouse.up();
    await settle(alex.page);
    await expectEventually('TC-22 move', async () => {
      await eventually(() => boardSnapshot(sam.page), 'Sam sees the move').toBe(await boardSnapshot(alex.page));
    });

    await alex.page.getByTestId(`sticky-${id}`).click();
    await alex.page.getByRole('button', { name: 'Pink colour' }).click();
    await expectEventually('TC-22 recolour', async () => {
      await eventually(() => boardSnapshot(sam.page), 'Sam sees the colour').toBe(await boardSnapshot(alex.page));
    });

    await alex.page.getByTestId(`sticky-${id}`).dblclick();
    await alex.page.keyboard.type('live text');
    await alex.page.keyboard.press('Escape');
    await settle(alex.page);
    await expectEventually('TC-22 typing', async () => {
      await eventually(() => textOf(sam.page, id), 'Sam sees the text').toBe('live text');
    });

    await alex.page.getByTestId(`sticky-${id}`).click();
    await alex.page.getByRole('button', { name: 'Delete note' }).click();
    await settle(alex.page);
    await expectEventually('TC-22 delete', async () => {
      await eventually(() => boardSnapshot(sam.page), 'Sam sees the delete').toBe('');
    });
    expect(await boardSnapshot(alex.page)).toBe('');

    expect(alex.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
    await alex.context.close();
    await sam.context.close();
  });

  test('TC-23 both typing into one note at once keeps every character on both screens', async ({ browser }) => {
    const boardId = newBoardId();
    const alex = await openParticipant(browser, 'Alex', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);
    const id = await createNote(alex.page, 600, 350);
    await alex.page.keyboard.press('Escape');
    await settle(alex.page);
    await eventually(() => boardSnapshot(sam.page), 'note visible on Sam').toContain(id);
    await settle(sam.page);

    await alex.page.getByTestId(`sticky-${id}`).dblclick();
    await sam.page.getByTestId(`sticky-${id}`).dblclick();
    await Promise.all([
      alex.page.keyboard.type('AAAA', { delay: 30 }),
      sam.page.keyboard.type('BBBB', { delay: 30 })
    ]);
    await alex.page.keyboard.press('Escape');
    await sam.page.keyboard.press('Escape');
    await settle(alex.page);
    await settle(sam.page);

    await eventually(async () => (await textOf(alex.page, id)) === (await textOf(sam.page, id)), 'texts identical').toBe(true);
    const text = (await textOf(alex.page, id)) ?? '';
    expect(text.split('A').length - 1).toBe(4);
    expect(text.split('B').length - 1).toBe(4);
    await alex.context.close();
    await sam.context.close();
  });

  test('TC-24 both dragging the same note settles on one identical position', async ({ browser }) => {
    const boardId = newBoardId();
    const alex = await openParticipant(browser, 'Alex', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);
    const id = await createNote(alex.page, 600, 350);
    await alex.page.keyboard.press('Escape');
    await settle(alex.page);
    await eventually(() => boardSnapshot(sam.page), 'note on Sam').toContain(id);
    await settle(sam.page);

    const center = await centerOf(alex.page, id);
    await Promise.all([dragNote(alex.page, center, 150, 40), dragNote(sam.page, center, -60, 120)]);
    await Promise.all([alex.page.mouse.up(), sam.page.mouse.up()]);
    await settle(alex.page);
    await settle(sam.page);

    await eventually(
      async () => (await boardSnapshot(alex.page)) === (await boardSnapshot(sam.page)),
      'positions identical'
    ).toBe(true);
    await alex.context.close();
    await sam.context.close();
  });

  test("TC-25 deleting the note Sam is typing in closes Sam's editor with no errors", async ({ browser }) => {
    const boardId = newBoardId();
    const alex = await openParticipant(browser, 'Alex', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);
    const id = await createNote(alex.page, 600, 350);
    await alex.page.keyboard.press('Escape');
    await settle(alex.page);
    await eventually(() => boardSnapshot(sam.page), 'note on Sam').toContain(id);

    await sam.page.getByTestId(`sticky-${id}`).dblclick();
    await sam.page.keyboard.type('mid-typing');
    await alex.page.getByTestId(`sticky-${id}`).click();
    await alex.page.getByRole('button', { name: 'Delete note' }).click();

    await eventually(() => boardSnapshot(sam.page), 'note gone for Sam').toBe('');
    await expect(sam.page.getByTestId('sticky-editor')).toHaveCount(0);
    await expect(sam.page.getByTestId(`sticky-${id}`)).toHaveCount(0);
    expect(await boardSnapshot(alex.page)).toBe('');
    expect(sam.consoleErrors).toEqual([]);
    expect(alex.consoleErrors).toEqual([]);
    await alex.context.close();
    await sam.context.close();
  });
});

test.describe('workflow: full-capacity session', () => {
  test('TC-26 every change of a full board of editors reaches everyone and final states match', async ({ browser }) => {
    test.setTimeout(240_000);
    const boardId = newBoardId();
    const people: Participant[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
      people.push(await openParticipant(browser, `person-${String(i + 1)}`, boardId));
    }
    const ids: string[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
      const person = people[i];
      if (person === undefined) continue;
      for (let n = 0; n < 5; n += 1) {
        ids.push(await createNote(person.page, 200 + i * 180, 180 + n * 110));
        await person.page.keyboard.press('Escape');
        await settle(person.page);
      }
    }
    await expectEventually('TC-26 creates converge', async () => {
      const target = await boardSnapshot(people[0]!.page);
      for (const person of people) {
        await eventually(() => boardSnapshot(person.page), `${person.name} sees all notes`).toBe(target);
      }
    });
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
      const person = people[i];
      if (person === undefined) continue;
      for (let n = 0; n < 5; n += 1) {
        const id = ids[(i * 5 + n) % ids.length]!;
        const center = await centerOf(person.page, id);
        await dragNote(person.page, center, 25 + i * 5, -20 - n * 4);
        await person.page.mouse.up();
        await settle(person.page);
      }
    }
    await expectEventually('TC-26 moves converge', async () => {
      await eventually(async () => {
        const snaps = await snapshotOf(...people);
        return snaps.every((snap) => snap === snaps[0]);
      }, 'all snapshots identical').toBe(true);
    });
    for (const person of people) await person.context.close();
  });
});

test.describe('workflow: flaky wi-fi', () => {
  test('TC-27 a 30 second outage reconnects and both sides catch up on all six notes', async ({ browser }) => {
    test.setTimeout(180_000);
    const boardId = newBoardId();
    const alex = await openParticipant(browser, 'Alex', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);

    const outageMs = CATCH_UP_TEST_OUTAGE_MS * 2; // covers the note-taking below
    const outageStarted = Date.now();
    await alex.page.evaluate((ms) => window.__vidi6?.simulateOutage?.(ms), outageMs);
    await eventually(
      () => alex.page.getByTestId('connection-status').getAttribute('data-state'),
      'Alex badge goes to reconnecting'
    ).toBe('reconnecting');

    for (let i = 0; i < 3; i += 1) {
      await createNote(alex.page, 250 + i * 140, 250);
      await alex.page.keyboard.press('Escape');
    }
    for (let i = 0; i < 3; i += 1) {
      await createNote(sam.page, 620 + i * 240, 620);
      await sam.page.keyboard.press('Escape');
    }
    await settle(sam.page);
    await alex.page.waitForTimeout(Math.max(0, outageMs - (Date.now() - outageStarted)));

    await eventually(
      () => alex.page.locator('[data-testid="connection-status"][data-state="confirmed"]').count(),
      'Alex shows the green confirmation'
    ).toBeGreaterThan(0);
    await eventually(() => alex.page.getByTestId('connection-status').count(), 'badge hides').toBe(0);

    await expectEventually('TC-27 catch-up converge', async () => {
      await eventually(async () => {
        const [alexSnap, samSnap] = await snapshotOf(alex, sam);
        if (alexSnap !== samSnap) console.log('TC-27 snapshots differ\nALEX:\n' + alexSnap + '\nSAM:\n' + samSnap);
        return alexSnap === samSnap && alexSnap.split('\n').filter((line) => line.length > 0).length === 6;
      }, 'both show all six notes').toBe(true);
    });
    await alex.context.close();
    await sam.context.close();
  });
});

test("TC-28 selection and editing stay on the editor's own screen", async ({ browser }) => {
  const boardId = newBoardId();
  const alex = await openParticipant(browser, 'Alex', boardId);
  const sam = await openParticipant(browser, 'Sam', boardId);
  const id = await createNote(alex.page, 600, 350);
  await eventually(() => boardSnapshot(sam.page), 'note on Sam').toContain(id);

  await alex.page.getByTestId(`sticky-${id}`).dblclick();
  await alex.page.keyboard.type('private work');
  await settle(sam.page);

  await expect(sam.page.getByTestId('sticky-editor')).toHaveCount(0);
  await expect(sam.page.getByTestId(`sticky-${id}`)).toHaveAttribute('data-selected', 'false');
  // Sam never gets a toolbar/selection outline for Alex's selection either.
  await alex.page.keyboard.press('Escape');
  await settle(alex.page);
  await settle(sam.page);
  await expect(sam.page.getByTestId(`sticky-${id}`)).toHaveAttribute('data-selected', 'false');
  await expect(sam.page.getByTestId('sticky-editor')).toHaveCount(0);
  // And Sam's own selection never appears for Alex.
  await alex.page.getByTestId('board-viewport').click({ position: { x: 10, y: 700 } });
  await settle(alex.page);
  await expect(alex.page.getByTestId(`sticky-${id}`)).toHaveAttribute('data-selected', 'false');
  await sam.page.getByTestId(`sticky-${id}`).click();
  await settle(alex.page);
  await expect(alex.page.getByTestId(`sticky-${id}`)).toHaveAttribute('data-selected', 'false');
  await alex.context.close();
  await sam.context.close();
});
