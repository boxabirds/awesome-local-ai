import { expect, test, type Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createBoard, settle } from './helpers/board';
import { eventually, expectEventually, openParticipant, type Participant } from './helpers/participants';

function textSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll<HTMLElement>('[data-testid]')]
      .map((el) => el.getAttribute('data-testid') ?? '')
      .filter((id) => /^text-[0-9a-f]{8}-/.test(id));
    const rows = ids.map((testId) => {
      const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
      const style = getComputedStyle(el);
      const content =
        document.querySelector(`[data-testid="text-content-${testId.slice('text-'.length)}"]`)?.textContent ?? '';
      return `${testId} @ ${style.left},${style.top} ${style.fontSize} "${content}"`;
    });
    rows.sort();
    return rows.join('\n');
  });
}

function textCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('[data-testid]')].filter((el) =>
        /^text-[0-9a-f]{8}-/.test(el.getAttribute('data-testid') ?? '')
      ).length
  );
}

function textContentOf(page: Page, id: string): Promise<string | null> {
  return page.getByTestId(`text-content-${id}`).textContent();
}

// Press T, click a point, type. Returns the new object's id.
async function createTextViaTool(page: Page, x: number, y: number, text = ''): Promise<string> {
  await page.keyboard.press('t');
  await page.mouse.click(x, y);
  await settle(page);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid]')]
      .map((el) => el.getAttribute('data-testid') ?? '')
      .filter((id) => /^text-editor-[0-9a-f]{8}-/.test(id))
      .map((id) => id.slice('text-editor-'.length))
  );
  if (ids.length !== 1) throw new Error(`expected one text editor, got ${String(ids.length)}`);
  if (text.length > 0) await page.keyboard.type(text, { delay: 20 });
  return ids[0];
}

async function elementCenter(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox();
  if (box === null) throw new Error(`${testId} not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const LONG_SENTENCE =
  ('the quick brown fox jumps over the lazy dog during the annual retro week review '.repeat(5).slice(0, 300));

test.describe('workflow: free text (story 9)', () => {
  test('TC-26 a 300-character annotation wraps at the auto width cap', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const alex = await openParticipant(browser, 'Alex', boardId);
    const id = await createTextViaTool(alex.page, 500, 300, LONG_SENTENCE);
    await alex.page.keyboard.press('Escape');
    await settle(alex.page);
    const box = await alex.page.getByTestId(`text-${id}`).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(598);
    expect(box!.width).toBeLessThanOrEqual(602);
    // Several lines are rendered, not one clipped line.
    expect(box!.height).toBeGreaterThanOrEqual(4 * 20 * 1.3);
    expect(await textContentOf(alex.page, id)).toBe(LONG_SENTENCE);

    expect(alex.consoleErrors).toEqual([]);
    await alex.context.close();
  });

  test('TC-27 dragging the right handle narrower rewraps the text and grows the height', async ({
    browser,
    request
  }) => {
    const boardId = await createBoard(request);
    const alex = await openParticipant(browser, 'Alex', boardId);
    const id = await createTextViaTool(alex.page, 500, 300, 'alpha beta gamma delta epsilon zeta eta theta iota kappa');
    await alex.page.keyboard.press('Escape');
    await settle(alex.page);
    const before = await alex.page.getByTestId(`text-${id}`).boundingBox();
    expect(before).not.toBeNull();
    await alex.page.getByTestId(`text-${id}`).click();
    expect(alex.page.getByTestId('resize-handle-n')).toHaveCount(0);
    expect(alex.page.getByTestId('resize-handle-s')).toHaveCount(0);
    const handle = await alex.page.getByTestId('resize-handle-e').boundingBox();
    expect(handle).not.toBeNull();
    await alex.page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await alex.page.mouse.down();
    await alex.page.mouse.move(handle!.x - 220, handle!.y + handle!.height / 2, { steps: 10 });
    await alex.page.mouse.up();
    await settle(alex.page);
    const after = await alex.page.getByTestId(`text-${id}`).boundingBox();
    expect(after!.width).toBeLessThan(before!.width - 150);
    expect(after!.height).toBeGreaterThan(before!.height);
    expect(await textContentOf(alex.page, id)).toBe('alpha beta gamma delta epsilon zeta eta theta iota kappa');
    await alex.context.close();
  });

  test('TC-28 golden path: XL heading, move, delete, undo restores', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const alex = await openParticipant(browser, 'Alex', boardId);
    // A small sticky cluster as context.
    await alex.page.mouse.dblclick(500, 500);
    await alex.page.keyboard.press('Escape');
    await settle(alex.page);

    const id = await createTextViaTool(alex.page, 400, 150, 'Went well');
    await alex.page.keyboard.press('Escape');
    await alex.page.getByRole('button', { name: 'Text size XL' }).click();
    await settle(alex.page);
    expect(await alex.page.getByTestId(`text-${id}`).evaluate((el) => getComputedStyle(el).fontSize)).toBe('56px');

    const from = await elementCenter(alex.page, `text-${id}`);
    await alex.page.mouse.move(from.x, from.y);
    await alex.page.mouse.down();
    await alex.page.mouse.move(500, 460, { steps: 10 });
    await alex.page.mouse.up();
    await settle(alex.page);

    await alex.page.keyboard.press('Delete');
    await settle(alex.page);
    await expect(alex.page.getByTestId(`text-${id}`)).toHaveCount(0);

    await alex.page.keyboard.press('Control+z');
    await settle(alex.page);
    await expect(alex.page.getByTestId(`text-${id}`)).toHaveCount(1);
    expect(await textContentOf(alex.page, id)).toBe('Went well');
    await alex.context.close();
  });

  test('TC-29 both typing into one text at once keeps every character on both screens', async ({
    browser,
    request
  }) => {
    const boardId = await createBoard(request);
    const alex = await openParticipant(browser, 'Alex', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);
    const id = await createTextViaTool(alex.page, 500, 300, 'alpha ');
    await settle(alex.page);
    await expectEventually('TC-29 seed', async () => {
      await eventually(() => textContentOf(sam.page, id), 'Sam sees the seed').toBe('alpha ');
    });
    // Sam enters the same text by double-clicking it.
    await sam.page.getByTestId(`text-${id}`).dblclick();
    await Promise.all([
      alex.page.keyboard.type('AAAA', { delay: 15 }),
      sam.page.keyboard.type('BBBB', { delay: 15 })
    ]);
    // End both editing sessions so the rendered text (not the editor) is
    // readable on both screens.
    await alex.page.keyboard.press('Escape');
    await sam.page.keyboard.press('Escape');
    await settle(alex.page);
    await settle(sam.page);
    await expectEventually('TC-29 merge', async () => {
      await eventually(() => textContentOf(sam.page, id), 'Sam matches Alex').toBe(
        await textContentOf(alex.page, id)
      );
    });
    const final = (await textContentOf(alex.page, id)) ?? '';
    expect(final.startsWith('alpha ')).toBe(true);
    expect((final.match(/A/g) ?? []).length).toBe(4);
    expect((final.match(/B/g) ?? []).length).toBe(4);
    await alex.context.close();
    await sam.context.close();
  });

  test('TC-30 five concurrent creators: every heading visible on every screen', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const names = ['Ana', 'Bo', 'Cy', 'Di', 'Ee'];
    const people: Participant[] = [];
    for (const name of names.slice(0, MAX_CONCURRENT_EDITORS)) {
      people.push(await openParticipant(browser, name, boardId));
    }
    await Promise.all(
      people.map(async (person, index) => {
        await createTextViaTool(person.page, 300 + index * 90, 200 + index * 60, `heading ${person.name}`);
        await person.page.keyboard.press('Escape');
      })
    );
    for (const person of people) {
      await expectEventually(`TC-30 ${person.name}`, async () => {
        await eventually(() => textCount(person.page), `${person.name} sees all headings`).toBe(
          MAX_CONCURRENT_EDITORS
        );
      });
    }
    const snapshots = await Promise.all(people.map((person) => textSnapshot(person.page)));
    for (const snap of snapshots.slice(1)) expect(snap).toBe(snapshots[0]);
    for (const person of people) expect(person.consoleErrors).toEqual([]);
    for (const person of people) await person.context.close();
  });

  test('TC-31 Escape without typing leaves no object and nothing to marquee', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const alex = await openParticipant(browser, 'Alex', boardId);
    await createTextViaTool(alex.page, 500, 300);
    await alex.page.keyboard.press('Escape');
    await settle(alex.page);
    expect(await textCount(alex.page)).toBe(0);
    // A marquee over the abandoned spot selects nothing (no count bar).
    await alex.page.keyboard.down('Shift');
    await alex.page.mouse.move(420, 240);
    await alex.page.mouse.down();
    await alex.page.mouse.move(620, 380, { steps: 10 });
    await alex.page.mouse.up();
    await alex.page.keyboard.up('Shift');
    await settle(alex.page);
    await expect(alex.page.getByTestId('selection-count')).toHaveCount(0);
    expect(await textCount(alex.page)).toBe(0);
    expect(alex.consoleErrors).toEqual([]);
    await alex.context.close();
  });
});
