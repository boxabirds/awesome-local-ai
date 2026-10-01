import { expect, test } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS, E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS, STICKY_COLORS,
} from '../../src/shared/config';
import { settled } from './helpers/board';
import {
  badge, boardSnapshot, drag, expectEventually, logLatencyReport, notesOf, openParticipants,
} from './helpers/participants';

const EVENTUALLY = { timeout: E2E_EVENTUAL_TIMEOUT_MS };

function toRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}

const pos = (loc: ReturnType<typeof notesOf>) =>
  loc.first().evaluate((el) => `${el.getAttribute('data-x')},${el.getAttribute('data-y')}`);

test.describe('workflow: two-person workshop', () => {
  test('TC-22 every kind of change reaches Sam; TC-25 delete during edit', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);

    // create
    await alex.page.mouse.dblclick(400, 300);
    await alex.page.keyboard.type('Pricing');
    await expectEventually('create', async () => notesOf(sam.page).count(), 1);
    // text arrives as it is typed
    await expectEventually('text', async () => notesOf(sam.page).first().textContent(), 'Pricing');
    await alex.page.mouse.click(900, 600); // end editing

    // move
    const box = (await notesOf(alex.page).first().boundingBox())!;
    const before = await pos(notesOf(sam.page));
    await drag(alex.page, { x: box.x + 30, y: box.y + 40 }, 150, 60);
    await settled(alex.page);
    const moved = await pos(notesOf(alex.page));
    expect(moved).not.toBe(before);
    await expectEventually('move', () => pos(notesOf(sam.page)), moved);

    // recolour
    await notesOf(alex.page).first().click();
    await alex.page.getByRole('button', { name: 'Pink colour' }).click();
    await expectEventually(
      'recolour',
      () => notesOf(sam.page).first().evaluate((el) => getComputedStyle(el).backgroundColor),
      toRgb(STICKY_COLORS.pink),
    );

    // Sam starts editing; Alex deletes the note (TC-25)
    await notesOf(sam.page).first().dblclick();
    await expect(sam.page.getByLabel('Note text')).toBeFocused();
    await alex.page.getByRole('button', { name: 'Delete note' }).click();
    await expectEventually('delete', async () => notesOf(alex.page).count(), 0);
    await expectEventually('delete reaches editor', async () => notesOf(sam.page).count(), 0);
    await expect(sam.page.getByLabel('Note text')).toHaveCount(0);
    await expect(sam.page.getByRole('alert')).toHaveCount(0);
    expect(sam.errors).toEqual([]);
    expect(alex.errors).toEqual([]);
    logLatencyReport('TC-22');
    await alex.context.close();
    await sam.context.close();
  });

  test('TC-23 simultaneous typing keeps every character', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    await alex.page.mouse.dblclick(400, 300);
    await alex.page.keyboard.type('x');
    await alex.page.keyboard.press('Escape');
    await expectEventually('create', async () => notesOf(sam.page).count(), 1);
    await alex.page.keyboard.press('Enter');
    await notesOf(sam.page).first().dblclick();
    await expect(sam.page.getByLabel('Note text')).toBeFocused();
    const a = 'AAAAAAAA';
    const s = 'sssssss';
    await Promise.all([alex.page.keyboard.type(a, { delay: 20 }), sam.page.keyboard.type(s, { delay: 20 })]);
    const sorted = (t: string | null) => [...(t ?? '')].sort().join('');
    const expected = [...`x${a}${s}`].sort().join('');
    await expect.poll(async () => sorted(await alex.page.getByLabel('Note text').inputValue()), EVENTUALLY).toBe(expected);
    await expect.poll(async () => sorted(await sam.page.getByLabel('Note text').inputValue()), EVENTUALLY).toBe(expected);
    const ta = await alex.page.getByLabel('Note text').inputValue();
    await expect.poll(() => sam.page.getByLabel('Note text').inputValue(), EVENTUALLY).toBe(ta);
    await alex.context.close();
    await sam.context.close();
  });

  test('TC-24 simultaneous drags settle on one position', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    await alex.page.mouse.dblclick(400, 300);
    await alex.page.keyboard.press('Escape');
    await expectEventually('create', async () => notesOf(sam.page).count(), 1);
    await alex.page.mouse.click(900, 600);
    const box = (await notesOf(alex.page).first().boundingBox())!;
    const grab = { x: box.x + 30, y: box.y + 40 };
    await Promise.all([drag(alex.page, grab, 200, 100), drag(sam.page, grab, -150, 120)]);
    const start = Date.now();
    await expect.poll(async () => (await pos(notesOf(alex.page))) === (await pos(notesOf(sam.page))), EVENTUALLY).toBe(true);
    console.log(`[latency] TC-24 settle: ${Date.now() - start}ms`);
    await alex.context.close();
    await sam.context.close();
  });

  test('TC-28 selecting and editing stays personal', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    await alex.page.mouse.dblclick(400, 300);
    await alex.page.keyboard.type('mine');
    await expectEventually('create', async () => notesOf(sam.page).count(), 1);
    await expect(alex.page.getByLabel('Note text')).toBeFocused();
    await expect(notesOf(sam.page).first()).toHaveAttribute('data-selected', 'false');
    await expect(notesOf(sam.page).first()).toHaveAttribute('data-editing', 'false');
    await expect(sam.page.getByLabel('Note text')).toHaveCount(0);
    await alex.page.keyboard.press('Escape');
    await expect(alex.page.locator('[data-selected="true"]')).toHaveCount(1);
    await expect(sam.page.locator('[data-selected="true"]')).toHaveCount(0);
    await alex.context.close();
    await sam.context.close();
  });
});

test('TC-26 full-capacity session: every change reaches everyone', async ({ browser }) => {
  test.setTimeout(180_000);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `P${i + 1}`);
  const people = await openParticipants(browser, names);
  const perPerson = 5;
  await Promise.all(people.map(async (p, i) => {
    for (let n = 0; n < perPerson; n++) {
      await p.page.mouse.dblclick(120 + i * 40, 80 + n * 130);
      await p.page.keyboard.type(`${p.name}-${n}`);
      await p.page.keyboard.press('Escape');
      await p.page.mouse.click(1250, 780);
    }
  }));
  const total = people.length * perPerson;
  for (const p of people) await expectEventually(`all created (${p.name})`, async () => notesOf(p.page).count(), total);
  // each person moves their own notes
  await Promise.all(people.map(async (p) => {
    for (let n = 0; n < perPerson; n++) {
      const note = notesOf(p.page).filter({ hasText: `${p.name}-${n}` });
      const box = (await note.boundingBox())!;
      await drag(p.page, { x: box.x + 100, y: box.y + 100 }, 20 + n * 5, 7 + n * 3);
      await p.page.mouse.click(1250, 780);
    }
  }));
  await expect.poll(async () => {
    const snaps = await Promise.all(people.map((p) => boardSnapshot(p.page)));
    return snaps.every((s) => JSON.stringify(s) === JSON.stringify(snaps[0])) && snaps[0].length === total;
  }, EVENTUALLY).toBe(true);
  logLatencyReport('TC-26');
  for (const p of people) await p.context.close();
});

test('TC-27 flaky Wi-Fi: offline edits catch up in both directions', async ({ browser }) => {
  test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 120_000);
  const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
  await alex.context.setOffline(true);
  await expect(badge(alex.page)).toHaveText('Reconnecting…', { timeout: CATCH_UP_TEST_OUTAGE_MS + E2E_EVENTUAL_TIMEOUT_MS });
  const outageStart = Date.now();
  for (let i = 0; i < 3; i++) {
    await alex.page.mouse.dblclick(200 + i * 40, 150 + i * 150);
    await alex.page.keyboard.type(`alex${i}`);
    await alex.page.keyboard.press('Escape');
    await alex.page.mouse.click(1250, 780);
    await sam.page.mouse.dblclick(700 + i * 40, 150 + i * 150);
    await sam.page.keyboard.type(`sam${i}`);
    await sam.page.keyboard.press('Escape');
    await sam.page.mouse.click(1250, 780);
  }
  await expect(notesOf(alex.page)).toHaveCount(3);
  await expect(notesOf(sam.page)).toHaveCount(3);
  await alex.page.waitForTimeout(Math.max(0, CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outageStart)));
  await alex.context.setOffline(false);
  await expect(badge(alex.page)).toHaveText('Connected', { timeout: 60_000 });
  await expect(notesOf(alex.page)).toHaveCount(6, EVENTUALLY);
  await expect(notesOf(sam.page)).toHaveCount(6, EVENTUALLY);
  await expect(badge(alex.page)).toHaveCount(0, { timeout: 10_000 });
  expect(await boardSnapshot(alex.page)).toEqual(await boardSnapshot(sam.page));
  await alex.context.close();
  await sam.context.close();
});
