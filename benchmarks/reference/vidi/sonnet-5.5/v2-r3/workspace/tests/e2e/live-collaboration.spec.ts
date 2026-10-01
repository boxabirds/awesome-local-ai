import { expect, test, type Page } from '@playwright/test';
import { CATCH_UP_TEST_OUTAGE_MS, E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { drag } from './helpers/board';
import {
  boardState,
  closeAll,
  expectEventually,
  latencies,
  logLatencyReport,
  notes,
  openParticipants,
  waitConnected,
  type NoteState,
} from './helpers/participants';

const centre = async (page: Page) => {
  const b = await notes(page).first().boundingBox();
  if (!b) throw new Error('note not visible');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

const first = async (page: Page): Promise<NoteState | undefined> => (await boardState(page))[0];
const count = (page: Page) => notes(page).count();

test.describe('Two-person workshop', () => {
  test('TC-22: create, move, recolour, type and delete appear for the other person', async ({ browser }) => {
    const { people } = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people.map((p) => p.page);

    await alex.mouse.dblclick(400, 300);
    await expectEventually('create', () => count(sam), 1);
    await alex.keyboard.type('Pricing');
    await expectEventually('type', async () => (await first(sam))?.text, 'Pricing');
    await alex.keyboard.press('Escape');

    const before = (await first(sam))!;
    await drag(alex, await centre(alex), 200, 100);
    await expectEventually('move', async () => Math.round(((await first(sam))?.x ?? 0) - before.x), 200);

    await alex.getByRole('button', { name: 'Green colour' }).click();
    await expectEventually('recolour', async () => (await first(sam))?.color, 'green');

    await alex.getByRole('button', { name: 'Delete note' }).click();
    await expectEventually('delete', () => count(sam), 0);
    await closeAll(people);
  });

  test('TC-23: simultaneous typing in one note keeps every character', async ({ browser }) => {
    const { people } = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people.map((p) => p.page);
    await alex.mouse.dblclick(400, 300);
    await expectEventually('create', () => count(sam), 1);
    await alex.keyboard.press('Escape');

    await alex.getByRole('group', { name: 'Sticky note' }).dblclick();
    await sam.getByRole('group', { name: 'Sticky note' }).dblclick();
    await expect(alex.getByRole('textbox')).toBeFocused();
    await expect(sam.getByRole('textbox')).toBeFocused();
    await Promise.all([alex.keyboard.type('AAAAAAAAAA', { delay: 20 }), sam.keyboard.type('BBBBBBBBBB', { delay: 20 })]);

    await expect
      .poll(
        async () => {
          const a = (await first(alex))?.text ?? '';
          const s = (await first(sam))?.text ?? '';
          return a === s && a.length;
        },
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      )
      .toBe(20);
    const text = (await first(alex))!.text;
    expect(text.split('A').length - 1).toBe(10);
    expect(text.split('B').length - 1).toBe(10);
    await closeAll(people);
  });

  test('TC-24: both dragging the same note settle on one position', async ({ browser }) => {
    const { people } = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people.map((p) => p.page);
    await alex.mouse.dblclick(400, 300);
    await expectEventually('create', () => count(sam), 1);
    await alex.keyboard.press('Escape');
    const c = await centre(alex);
    const t0 = Date.now();
    await Promise.all([drag(alex, c, 300, 100), drag(sam, c, -200, 150)]);
    await expect
      .poll(async () => JSON.stringify(await boardState(alex)) === JSON.stringify(await boardState(sam)), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(true);
    console.log(`[latency] settle after concurrent drags: ${Date.now() - t0} ms (not asserted)`);
    await closeAll(people);
  });

  test('TC-25: deleting a note someone is editing ends their editing without errors', async ({ browser }) => {
    const { people } = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people.map((p) => p.page);
    const dialogs: string[] = [];
    sam.on('dialog', (d) => dialogs.push(d.message()));
    await alex.mouse.dblclick(400, 300);
    await alex.keyboard.press('Escape');
    await expectEventually('create', () => count(sam), 1);
    await sam.getByRole('group', { name: 'Sticky note' }).dblclick();
    await expect(sam.getByRole('textbox')).toBeFocused();
    await sam.keyboard.type('typing');

    await alex.getByRole('button', { name: 'Delete note' }).click();
    await expectEventually('delete while editing', () => count(sam), 0);
    await expect(sam.getByRole('textbox')).toHaveCount(0);
    await sam.keyboard.type('more');
    await expect(notes(sam)).toHaveCount(0);
    expect(dialogs).toEqual([]);
    expect(people.flatMap((p) => p.consoleErrors)).toEqual([]);
    await closeAll(people);
  });

  test('TC-28: selecting and editing stays personal', async ({ browser }) => {
    const { people } = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people.map((p) => p.page);
    await alex.mouse.dblclick(400, 300);
    await expectEventually('create', () => count(sam), 1);
    await alex.keyboard.type('mine');
    await expect(alex.getByRole('textbox')).toBeVisible();
    await expect(sam.getByRole('textbox')).toHaveCount(0);
    await expect(sam.locator('[data-selected="true"]')).toHaveCount(0);
    await expect(sam.locator('[data-editing="true"]')).toHaveCount(0);
    await closeAll(people);
  });
});

test.describe('Full-capacity session', () => {
  test('TC-26: MAX_CONCURRENT_EDITORS people create and move notes; all screens end identical', async ({ browser }) => {
    test.setTimeout(180_000);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `P${i + 1}`);
    // Zoomed out to 50% so every participant gets their own row of 5 notes on screen.
    const { people } = await openParticipants(browser, names, { zoom: 0.5 });
    const PER_PERSON = 5;
    const spot = (i: number, j: number) => ({ x: 100 + j * 140, y: 80 + i * 130 });

    await Promise.all(
      people.map(async ({ page }, i) => {
        for (let j = 0; j < PER_PERSON; j++) {
          await page.mouse.dblclick(spot(i, j).x, spot(i, j).y);
          await page.keyboard.type(`n${i}-${j}`);
          await page.keyboard.press('Escape');
        }
      }),
    );
    const total = names.length * PER_PERSON;
    for (const p of people) await expectEventually(`${p.name} sees all creates`, () => count(p.page), total);

    await Promise.all(
      people.map(async ({ page }, i) => {
        for (let j = 0; j < PER_PERSON; j++) {
          await drag(page, spot(i, j), 0, 20 + j * 2);
        }
      }),
    );
    await expect
      .poll(
        async () => {
          const states = await Promise.all(people.map((p) => boardState(p.page)));
          return states.every((s) => JSON.stringify(s) === JSON.stringify(states[0])) && states[0].length;
        },
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      )
      .toBe(total);
    const final = await boardState(people[0].page);
    expect(final.every((n) => n.y > 0)).toBe(true);
    expect(new Set(final.map((n) => n.text)).size).toBe(total);
    logLatencyReport(latencies);
    await closeAll(people);
  });
});

test.describe('Flaky Wi-Fi', () => {
  test('TC-27: edits made during an outage are exchanged after reconnecting', async ({ browser }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 120_000);
    const { people } = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people;
    await alex.setOffline(true);
    await expect(alex.page.locator('.connection-status')).toHaveText('Reconnecting…', { timeout: CATCH_UP_TEST_OUTAGE_MS });

    for (let i = 0; i < 3; i++) {
      await alex.page.mouse.dblclick(150 + i * 220, 150);
      await alex.page.keyboard.type(`alex${i}`);
      await alex.page.keyboard.press('Escape');
      await sam.page.mouse.dblclick(150 + i * 220, 450);
      await sam.page.keyboard.type(`sam${i}`);
      await sam.page.keyboard.press('Escape');
    }
    await expect(notes(alex.page)).toHaveCount(3); // the board stays editable while offline
    await expect(notes(sam.page)).toHaveCount(3);
    await alex.page.waitForTimeout(CATCH_UP_TEST_OUTAGE_MS);

    await alex.setOffline(false);
    await expect(alex.page.locator('.connection-status')).toHaveText('Connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expectEventually('catch-up on Alex', () => count(alex.page), 6);
    await expectEventually('catch-up on Sam', () => count(sam.page), 6);
    await expect.poll(async () => JSON.stringify(await boardState(alex.page)) === JSON.stringify(await boardState(sam.page))).toBe(true);
    await waitConnected(alex.page);
    await expect(alex.page.locator('.connection-status')).toHaveCount(0);
    await closeAll(people);
  });
});
