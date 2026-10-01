import { expect, test, type Page } from '@playwright/test';
import { CATCH_UP_TEST_OUTAGE_MS, E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { setCamera } from './helpers/board';
import { closeAll, expectEventually, noteViews, openParticipants, waitConnected } from './helpers/participants';

const notes = (page: Page) => page.getByRole('group', { name: 'Sticky note' });
const badge = (page: Page) => page.getByRole('status').filter({ hasText: /onnect/ });

async function centre(page: Page, i = 0) {
  const b = (await notes(page).nth(i).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

async function createNote(page: Page, at: { x: number; y: number }, text?: string) {
  await page.mouse.dblclick(at.x, at.y);
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

test.describe('Two-person workshop', () => {
  test('TC-22 create, move, recolour, type and delete reach the other person', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [alex, sam] = people;
    await createNote(alex.page, { x: 400, y: 300 }, 'Pricing');
    await expectEventually('create', () => notes(sam.page).count(), 1);
    await expectEventually('text', async () => (await noteViews(sam.page))[0]?.text, 'Pricing');

    await alex.page.mouse.click(900, 650);
    await drag(alex.page, await centre(alex.page), { x: 700, y: 400 });
    const moved = (await noteViews(alex.page))[0];
    await expectEventually('move', async () => {
      const v = (await noteViews(sam.page))[0];
      return { x: v.x, y: v.y };
    }, { x: moved.x, y: moved.y });

    await alex.page.getByRole('button', { name: 'Green colour' }).click();
    await expectEventually('recolour', async () => (await noteViews(sam.page))[0].color, 'rgb(197, 225, 165)');

    await alex.page.keyboard.press('Delete');
    await expectEventually('delete', () => notes(sam.page).count(), 0);
    expect(alex.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
    await closeAll(people);
  });

  test('TC-23 simultaneous typing keeps every character on both screens', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [alex, sam] = people;
    await createNote(alex.page, { x: 400, y: 300 }, 'green');
    await expectEventually('create', () => notes(sam.page).count(), 1);
    const note = (p: Page) => notes(p).first();
    await Promise.all([note(alex.page).dblclick(), note(sam.page).dblclick()]);
    await Promise.all([alex.page.getByRole('textbox').waitFor(), sam.page.getByRole('textbox').waitFor()]);
    await Promise.all([alex.page.keyboard.press('End'), sam.page.keyboard.press('End')]);
    await Promise.all([alex.page.keyboard.type('AAAAAA', { delay: 20 }), sam.page.keyboard.type('BBBBBB', { delay: 20 })]);
    await Promise.all([alex.page.keyboard.press('Escape'), sam.page.keyboard.press('Escape')]);
    const read = async (p: Page) => (await noteViews(p))[0].text;
    await expect
      .poll(async () => {
        const [a, s] = [await read(alex.page), await read(sam.page)];
        return a === s && a.length === 'green'.length + 12 && a.split('A').length === 7 && a.split('B').length === 7;
      }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(true);
    await closeAll(people);
  });

  test('TC-24 dragging the same note at once settles to one position', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [alex, sam] = people;
    await createNote(alex.page, { x: 400, y: 300 });
    await expectEventually('create', () => notes(sam.page).count(), 1);
    const from = await centre(alex.page);
    await Promise.all([drag(alex.page, from, { x: 800, y: 200 }), drag(sam.page, from, { x: 300, y: 600 })]);
    const start = Date.now();
    await expect
      .poll(async () => {
        const [a, s] = [(await noteViews(alex.page))[0], (await noteViews(sam.page))[0]];
        return a.x === s.x && a.y === s.y;
      }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(true);
    console.log(`[latency] drag settle: ${Date.now() - start} ms (not asserted)`);
    await closeAll(people);
  });

  test('TC-25 deleting a note ends the other person’s editing without errors', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [alex, sam] = people;
    await createNote(alex.page, { x: 400, y: 300 }, 'x');
    await expectEventually('create', () => notes(sam.page).count(), 1);
    await notes(sam.page).first().dblclick();
    await expect(sam.page.getByRole('textbox')).toBeVisible();
    await notes(alex.page).first().click();
    await alex.page.keyboard.press('Delete');
    await expectEventually('note gone for Sam', () => notes(sam.page).count(), 0);
    await expect(sam.page.getByRole('textbox')).toHaveCount(0);
    await sam.page.keyboard.type('abcdefg') // no V, T or N: those are tool shortcuts once nothing is being edited;
    await expect(notes(sam.page)).toHaveCount(0);
    expect(sam.consoleErrors).toEqual([]);
    expect(alex.consoleErrors).toEqual([]);
    await closeAll(people);
  });

  test('TC-28 selecting and editing stay personal', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [alex, sam] = people;
    await createNote(alex.page, { x: 400, y: 300 }, 'mine');
    await expectEventually('create', () => notes(sam.page).count(), 1);
    await notes(alex.page).first().dblclick();
    await expect(alex.page.getByRole('textbox')).toBeVisible();
    await alex.page.waitForTimeout(500);
    await expect(sam.page.getByRole('textbox')).toHaveCount(0);
    await expect(notes(sam.page).first()).toHaveAttribute('data-selected', 'false');
    await closeAll(people);
  });
});

test.describe('Full-capacity session', () => {
  test('TC-26 MAX_CONCURRENT_EDITORS people create and move notes; everyone ends identical', async ({ browser }) => {
    test.setTimeout(180_000);
    const { people } = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    // Zoom out so 5 × 5 notes fit without overlapping.
    await Promise.all(people.map((p) => setCamera(p.page, 0, 0, 0.25)));
    await Promise.all(people.map((p) => p.page.waitForTimeout(100)));
    const spot = (i: number, j: number) => ({ x: 120 + i * 220, y: 100 + j * 120 });
    const COUNT = 5;
    await Promise.all(
      people.map(async (p, i) => {
        for (let j = 0; j < COUNT; j++) await createNote(p.page, spot(i, j));
      }),
    );
    const total = MAX_CONCURRENT_EDITORS * COUNT;
    for (const p of people) await expectEventually(`${p.name} sees all creates`, () => notes(p.page).count(), total);
    // Each person moves their own notes (found by screen position) a little downwards.
    await Promise.all(
      people.map(async (p, i) => {
        for (let j = 0; j < COUNT; j++) {
          const s = spot(i, j);
          await drag(p.page, s, { x: s.x, y: s.y + 30 });
        }
      }),
    );
    await expect
      .poll(async () => {
        const views = await Promise.all(people.map((p) => noteViews(p.page)));
        return views.every((v) => JSON.stringify(v) === JSON.stringify(views[0])) && views[0].length === total;
      }, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 })
      .toBe(true);
    const ys = new Set((await noteViews(people[0].page)).map((n) => n.y));
    expect(ys.size).toBeGreaterThan(1);
    for (const p of people) expect(p.consoleErrors).toEqual([]);
    await closeAll(people);
  });
});

test.describe('Flaky Wi-Fi', () => {
  test('TC-27 offline edits catch up after the outage', async ({ browser }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 120_000);
    const { people } = await openParticipants(browser, 2);
    const [alex, sam] = people;
    await alex.context.setOffline(true);
    // The provider only notices once the socket dies; force the close the way a real drop would.
    await expect(badge(alex.page)).toHaveText('Reconnecting…', { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 });
    for (let i = 0; i < 3; i++) {
      await createNote(alex.page, { x: 150 + i * 220, y: 150 }, `A${i}`);
      await createNote(sam.page, { x: 150 + i * 220, y: 450 }, `S${i}`);
    }
    await expect(notes(alex.page)).toHaveCount(3);
    await expectEventually('sam local', () => notes(sam.page).count(), 3);
    await alex.page.waitForTimeout(CATCH_UP_TEST_OUTAGE_MS);
    await alex.context.setOffline(false);
    await expect(badge(alex.page)).toHaveText('Connected', { timeout: 60_000 });
    await waitConnected(alex.page);
    await expect(badge(alex.page)).toHaveCount(0);
    await expectEventually('alex has 6', () => notes(alex.page).count(), 6);
    await expectEventually('sam has 6', () => notes(sam.page).count(), 6);
    expect(await noteViews(alex.page)).toEqual(await noteViews(sam.page));
    await closeAll(people);
  });
});
