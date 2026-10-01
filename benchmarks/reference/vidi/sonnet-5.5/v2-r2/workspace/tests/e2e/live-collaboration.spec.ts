import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { CATCH_UP_TEST_OUTAGE_MS, E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS, STICKY_COLORS } from '../../src/shared/config';
import {
  allSnapshotsEqual, closeAll, createNoteAt, dragNote, expectEventually, notePos, notesOf, openParticipants,
} from './helpers/participants';

// The zoom readout is also an <output role=status>; the connection badge is the div.
const badge = (page: Page) => page.locator('div[role=status]');

test.describe('two-person workshop', () => {
  test('TC-22 every kind of change reaches the other person', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    const id = await createNoteAt(alex.page, 400, 300);
    await expectEventually('create', async () => (await notesOf(sam.page).count()) === 1);

    await alex.page.keyboard.type('Pricing');
    const samNote = sam.page.locator(`[data-note-id="${id}"]`);
    await expectEventually('text', async () => (await samNote.textContent())?.includes('Pricing') ?? false);
    await alex.page.keyboard.press('Escape');

    const alexNote = alex.page.locator(`[data-note-id="${id}"]`);
    const before = await notePos(samNote);
    await dragNote(alex.page, alexNote, 120, 60);
    await expectEventually('move', async () => (await notePos(samNote)).x - before.x > 100);

    await alex.page.getByRole('button', { name: 'Green colour' }).click();
    await expectEventually('recolour', async () =>
      (await samNote.evaluate((el) => (el as HTMLElement).style.background)) !== '' &&
      (await samNote.evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgb(197, 225, 165)');
    expect(STICKY_COLORS.green).toBe('#C5E1A5');

    await alex.page.keyboard.press('Delete');
    await expectEventually('delete', async () => (await notesOf(sam.page).count()) === 0);
    await closeAll([alex, sam]);
  });

  test('TC-23 simultaneous typing keeps every character', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    const id = await createNoteAt(alex.page, 400, 300);
    await alex.page.keyboard.type('green');
    const samNote = sam.page.locator(`[data-note-id="${id}"]`);
    await expectEventually('seed text', async () => (await samNote.textContent())?.includes('green') ?? false);
    await samNote.dblclick();
    await expect(samNote.locator('textarea')).toBeFocused();
    await alex.page.keyboard.type('AAAA');
    await Promise.all([alex.page.keyboard.type('1111'), sam.page.keyboard.type('2222')]);
    await expectEventually('typing converged', async () => {
      const a = await alex.page.locator(`[data-note-id="${id}"] textarea`).inputValue();
      const s = await sam.page.locator(`[data-note-id="${id}"] textarea`).inputValue();
      return a === s && a.length === 'green'.length + 12 &&
        [...'AAAA1111'].every((c) => a.split(c).length > 1) && (a.match(/2/g) ?? []).length === 4;
    });
    await closeAll([alex, sam]);
  });

  test('TC-24 simultaneous drags settle on one position', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    const id = await createNoteAt(alex.page, 400, 300);
    await alex.page.keyboard.press('Escape');
    await expectEventually('note visible to Sam', async () => (await notesOf(sam.page).count()) === 1);
    const aNote = alex.page.locator(`[data-note-id="${id}"]`);
    const sNote = sam.page.locator(`[data-note-id="${id}"]`);
    await Promise.all([dragNote(alex.page, aNote, 200, 0), dragNote(sam.page, sNote, -150, 120)]);
    const settle = await expectEventually('drag settle', async () => {
      const a = await notePos(aNote);
      const s = await notePos(sNote);
      return a.x === s.x && a.y === s.y;
    });
    console.log(`[settle] drag settled in ${settle} ms`);
    await closeAll([alex, sam]);
  });

  test('TC-25 deleting a note someone is editing ends their editing silently', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    const id = await createNoteAt(alex.page, 400, 300);
    await alex.page.keyboard.press('Escape');
    const sNote = sam.page.locator(`[data-note-id="${id}"]`);
    await expect(sNote).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await sNote.dblclick();
    await expect(sNote.locator('textarea')).toBeFocused();
    await sam.page.keyboard.type('typing');

    await alex.page.locator(`[data-note-id="${id}"]`).click();
    await alex.page.keyboard.press('Delete');
    await expectEventually('delete reaches editor', async () => (await notesOf(sam.page).count()) === 0);
    await expect(sam.page.getByLabel('Note text')).toHaveCount(0);
    await expect(sam.page.getByRole('alertdialog')).toHaveCount(0);
    await sam.page.waitForTimeout(500);
    expect(await notesOf(sam.page).count()).toBe(0);
    expect(sam.errors).toEqual([]);
    await closeAll([alex, sam]);
  });

  test('TC-28 selecting and editing stay personal', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    const id = await createNoteAt(alex.page, 400, 300);
    await expect(alex.page.locator(`[data-note-id="${id}"] textarea`)).toBeVisible();
    await expectEventually('note visible to Sam', async () => (await notesOf(sam.page).count()) === 1);
    await sam.page.waitForTimeout(300);
    const sNote = sam.page.locator(`[data-note-id="${id}"]`);
    await expect(sNote).toHaveAttribute('data-selected', 'false');
    await expect(sNote.locator('textarea')).toHaveCount(0);
    await alex.page.keyboard.press('Escape');
    await expect(alex.page.locator(`[data-note-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
    await sam.page.waitForTimeout(300);
    await expect(sNote).toHaveAttribute('data-selected', 'false');
    await closeAll([alex, sam]);
  });
});

test('TC-26 full capacity: every change is seen by every participant', async ({ browser }) => {
  test.setTimeout(180_000);
  const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
  const per = 5;
  let expected = 0;
  // Each person owns a row so double-clicks never land on someone else's note.
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    for (let k = 0; k < per; k++) {
      const id = await createNoteAt(p.page, 150 + k * 200, 100 + i * 130);
      await p.page.keyboard.press('Escape');
      expected += 1;
      await expectEventually(`P${i} create ${k} seen by all`, async () => {
        const counts = await Promise.all(people.map((q) => notesOf(q.page).count()));
        return counts.every((c) => c === expected) && id.length > 0;
      });
    }
  }
  // Move one note per participant and check all pages agree.
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const note = notesOf(p.page).nth(i);
    const id = (await note.getAttribute('data-note-id'))!;
    const before = await notePos(note);
    await note.scrollIntoViewIfNeeded();
    await dragNote(p.page, note, 0, 0 + 40);
    await expectEventually(`P${i} move seen by all`, async () => {
      const posts = await Promise.all(people.map((q) => notePos(q.page.locator(`[data-note-id="${id}"]`))));
      return posts.every((q) => q.y === posts[0].y) && posts[0].y !== before.y;
    });
  }
  await expectEventually('final snapshots identical', () => allSnapshotsEqual(people.map((p) => p.page)));
  await closeAll(people);
});

test('TC-27 flaky Wi-Fi: offline edits catch up in both directions', async ({ browser }) => {
  test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 120_000);
  const [alex, sam] = await openParticipants(browser, 2, newBoardId());
  // Offline emulation starves the socket; the client's no-message watchdog (about 30 s) then reports Reconnecting….
  await alex.context.setOffline(true);
  await expect(badge(alex.page)).toHaveText('Reconnecting…', { timeout: 60_000 });
  for (let k = 0; k < 3; k++) {
    await createNoteAt(alex.page, 100 + k * 220, 150);
    await alex.page.keyboard.press('Escape');
    await createNoteAt(sam.page, 100 + k * 220, 500);
    await sam.page.keyboard.press('Escape');
  }
  await expect(notesOf(alex.page)).toHaveCount(3);
  await alex.page.waitForTimeout(CATCH_UP_TEST_OUTAGE_MS);
  await alex.context.setOffline(false);
  await expect(badge(alex.page)).toHaveText('Connected', { timeout: 30_000 });
  await expect(badge(alex.page)).toHaveCount(0, { timeout: 10_000 });
  await expectEventually('both show six notes', async () =>
    (await notesOf(alex.page).count()) === 6 && (await notesOf(sam.page).count()) === 6);
  await expectEventually('identical boards', () => allSnapshotsEqual([alex.page, sam.page]));
  await closeAll([alex, sam]);
});
