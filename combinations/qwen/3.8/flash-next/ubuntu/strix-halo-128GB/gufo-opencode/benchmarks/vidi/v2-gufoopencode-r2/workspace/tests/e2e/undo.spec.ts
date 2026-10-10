// Task 5 (story 8): undo/redo across two real browsers (TC-22, TC-23) and
// MAX_CONCURRENT_EDITORS contexts (TC-24). Personal scope must hold through
// the real provider: undoing mine never touches anyone else's changes, and a
// change undone remotely degrades silently instead of throwing.

import { test, expect } from '@playwright/test';
import { getNotes } from './helpers/board';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  closeParticipants,
  dragFromTo,
  eventually,
  noteCenter,
  openParticipants,
  signature,
  waitForNoteCount,
  waitForSync,
  type Participant,
} from './helpers/participants';

function watchErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

test.describe('Undo my mistakes while colleagues work', () => {
  test('TC-22: undo restores my eight deleted notes without touching Raj’s note; redo removes them again', async ({
    browser,
  }) => {
    const [mia, raj] = await openParticipants(browser, ['Mia', 'Raj']);
    try {
      for (let i = 0; i < 8; i += 1) {
        await mia.page.mouse.dblclick(160 + (i % 4) * 260, 160 + Math.floor(i / 4) * 280);
        await mia.page.keyboard.press('Escape');
      }
      await waitForSync([mia, raj], 8);

      // Mia deletes everything in one step.
      await mia.page.keyboard.press('Control+a');
      await mia.page.keyboard.press('Delete');
      await waitForSync([mia, raj], 0);

      // Raj adds his own note after the deletion.
      await raj.page.mouse.dblclick(600, 500);
      await raj.page.keyboard.type('Raj');
      await raj.page.keyboard.press('Escape');
      await waitForSync([mia, raj], 1);

      await mia.page.keyboard.press('Control+z');
      await eventually('TC-22 eight notes back on Mia', () =>
        getNotes(mia.page).then((n) => n.length), 9);
      await eventually('TC-22 eight notes back on Raj too', () =>
        getNotes(raj.page).then((n) => n.length), 9);
      const hasRajNote = (p: Participant) =>
        getNotes(p.page).then((n) => n.some((x) => x.text === 'Raj'));
      await eventually('TC-22 Raj note intact on Mia', () => hasRajNote(mia), true);
      await eventually('TC-22 Raj note intact on Raj', () => hasRajNote(raj), true);

      await mia.page.keyboard.press('Control+Shift+z');
      await eventually('TC-22 redo removes the eight on Mia', () =>
        getNotes(mia.page).then((n) => n.length), 1);
      await eventually('TC-22 redo removes the eight on Raj', () =>
        getNotes(raj.page).then((n) => n.length), 1);
      await eventually('TC-22 still only Raj note', () => hasRajNote(mia), true);
    } finally {
      await closeParticipants([mia, raj]);
    }
  });

  test('TC-23: undoing my move of a note Raj deleted mid-flight errors nowhere and keeps it gone', async ({
    browser,
  }) => {
    const [mia, raj] = await openParticipants(browser, ['Mia', 'Raj']);
    const miaErrors = watchErrors(mia.page);
    try {
      await mia.page.mouse.dblclick(300, 300);
      await mia.page.keyboard.press('Escape');
      await waitForSync([mia, raj], 1);
      const [note] = await getNotes(mia.page);

      // Mia moves it, then Raj deletes it remotely.
      const center = await noteCenter(mia.page, note.id);
      await dragFromTo(mia.page, [center.x, center.y], [center.x + 150, center.y + 100]);
      await eventually('TC-23 move on Raj', async () => {
        const onRaj = await getNotes(raj.page);
        const onMia = await getNotes(mia.page);
        const r = onRaj.find((n) => n.id === note.id);
        const m = onMia.find((n) => n.id === note.id);
        return r !== undefined && m !== undefined && Math.round(r.x) === Math.round(m.x);
      }, true);

      const rajCenter = await noteCenter(raj.page, note.id);
      await raj.page.mouse.click(rajCenter.x, rajCenter.y);
      await raj.page.keyboard.press('Delete');
      await waitForSync([mia, raj], 0);

      // My inverse targets a struct Yjs deleted remotely: consumed silently.
      await mia.page.keyboard.press('Control+z');
      await mia.page.keyboard.press('Control+z');
      await mia.page.waitForTimeout(500);
      await waitForNoteCount(mia.page, 0);
      await waitForNoteCount(raj.page, 0);
      expect(miaErrors).toEqual([]);

      // The board still works afterwards.
      await raj.page.mouse.dblclick(700, 250);
      await raj.page.keyboard.press('Escape');
      await waitForSync([mia, raj], 1);
    } finally {
      await closeParticipants([mia, raj]);
    }
  });

  test('TC-24: five concurrent editors each undo their own create/type/move; boards converge identical', async ({
    browser,
  }) => {
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `p${i + 1}`);
    const parts = await openParticipants(browser, names);
    try {
      const spots: Array<[number, number]> = [
        [240, 180],
        [480, 180],
        [720, 180],
        [240, 420],
        [480, 420],
      ];
      const ids: string[] = [];
      for (const [p, spot] of parts.map((part, i) => [part, spots[i]] as const)) {
        await p.page.mouse.dblclick(spot[0], spot[1]);
        await p.page.keyboard.type(p.name);
        await p.page.keyboard.press('Escape');
      }
      await waitForSync(parts, MAX_CONCURRENT_EDITORS);
      for (const p of parts) {
        const mine = (await getNotes(p.page)).find((n) => n.text === p.name);
        if (!mine) throw new Error(`${p.name} note missing`);
        ids.push(mine.id);
      }

      // Each moves their own note; everything converges first.
      for (const [i, p] of parts.entries()) {
        const c = await noteCenter(p.page, ids[i]);
        await dragFromTo(p.page, [c.x, c.y], [c.x + 30, c.y + 30]);
      }
      await eventually('TC-24 all five boards identical mid-state', async () => {
        const sigs = await Promise.all(parts.map((p) => getNotes(p.page).then(signature)));
        return sigs.every((s) => s === sigs[0]);
      }, true);

      // Each undoes exactly their own three steps (move, type, create).
      await Promise.all(
        parts.map(async (p) => {
          for (let i = 0; i < 3; i += 1) {
            await p.page.keyboard.press('Control+z');
            await p.page.waitForTimeout(50);
          }
        }),
      );

      for (const p of parts) await waitForNoteCount(p.page, 0);
      await eventually('TC-24 identical final boards', async () => {
        const sigs = await Promise.all(parts.map((p) => getNotes(p.page).then(signature)));
        return sigs.every((s) => s === sigs[0]) && sigs[0] === '[]';
      }, true);
    } finally {
      await closeParticipants(parts);
    }
  });
});
