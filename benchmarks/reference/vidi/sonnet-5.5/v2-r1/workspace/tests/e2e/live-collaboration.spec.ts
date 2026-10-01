import { expect, test } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import { setCamera } from './helpers/board';
import {
  badge,
  closeAll,
  controlNetwork,
  dragNote,
  expectEventually,
  logLatencyReport,
  newNoteAt,
  noteView,
  noteViews,
  notes,
  openParticipants,
  sameBoard,
} from './helpers/participants';

test.describe('Two-person workshop', () => {
  test('TC-22 every kind of change reaches the other person', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      let t = Date.now();
      const id = await newNoteAt(alex.page, 400, 300);
      await expectEventually('create', async () => (await noteViews(sam.page)).length === 1, t);

      t = Date.now();
      await alex.page.keyboard.type('Pricing');
      await expectEventually('text', async () => (await noteView(sam.page, id))?.text === 'Pricing', t);
      await alex.page.keyboard.press('Escape');

      const startPos = await noteView(sam.page, id);
      t = Date.now();
      await dragNote(alex.page, id, 120, 60);
      await expectEventually(
        'move',
        async () => {
          const v = await noteView(sam.page, id);
          return !!v && !!startPos && Math.abs(v.left - startPos.left - 120) < 1 && Math.abs(v.top - startPos.top - 60) < 1;
        },
        t,
      );

      const before = (await noteView(sam.page, id))?.background;
      t = Date.now();
      await alex.page.getByRole('button', { name: 'Green colour' }).click();
      await expectEventually('recolour', async () => {
        const bg = (await noteView(sam.page, id))?.background;
        return !!bg && bg !== before;
      }, t);
      expect((await noteView(sam.page, id))?.background).toBe((await noteView(alex.page, id))?.background);

      t = Date.now();
      await alex.page.keyboard.press('Delete');
      await expectEventually('delete', async () => (await noteViews(sam.page)).length === 0, t);
      expect(alex.errors).toEqual([]);
      expect(sam.errors).toEqual([]);
    } finally {
      await closeAll([alex, sam]);
    }
  });

  test('TC-23 simultaneous typing keeps every character', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      const id = await newNoteAt(alex.page, 400, 300);
      await alex.page.keyboard.type('green');
      await expectEventually('seed text', async () => (await noteView(sam.page, id))?.text === 'green');
      // Sam opens the same note for editing.
      await sam.page.locator(`[data-note-id="${id}"]`).dblclick();
      await expect(sam.page.getByRole('textbox')).toBeFocused();
      await alex.page.keyboard.press('Home');
      await sam.page.keyboard.press('End');
      await Promise.all([alex.page.keyboard.type('red ', { delay: 30 }), sam.page.keyboard.type(' blue', { delay: 30 })]);
      await expectEventually('merged text', async () => {
        const a = (await noteView(alex.page, id))?.text ?? '';
        const s = (await noteView(sam.page, id))?.text ?? '';
        return a === s && a === 'red green blue';
      });
      const text = (await noteView(alex.page, id))?.text ?? '';
      expect(text).toContain('red ');
      expect(text).toContain(' blue');
      expect(text).toContain('green');
    } finally {
      await closeAll([alex, sam]);
    }
  });

  test('TC-24 dragging the same note at once settles to one position', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      const id = await newNoteAt(alex.page, 400, 300);
      await alex.page.keyboard.press('Escape');
      await expectEventually('note visible', async () => (await noteViews(sam.page)).length === 1);
      const t = Date.now();
      await Promise.all([dragNote(alex.page, id, 200, 50), dragNote(sam.page, id, -150, 120)]);
      await expectEventually(
        'drag settle',
        async () => {
          const a = await noteView(alex.page, id);
          const s = await noteView(sam.page, id);
          return !!a && !!s && a.left === s.left && a.top === s.top;
        },
        t,
      );
    } finally {
      await closeAll([alex, sam]);
    }
  });

  test('TC-25 deleting a note someone is typing in removes it without errors', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      const id = await newNoteAt(alex.page, 400, 300);
      await alex.page.keyboard.type('draft');
      await alex.page.keyboard.press('Escape');
      await expectEventually('note visible', async () => (await noteView(sam.page, id))?.text === 'draft');
      await sam.page.locator(`[data-note-id="${id}"]`).dblclick();
      await expect(sam.page.getByRole('textbox')).toBeFocused();
      await sam.page.keyboard.type('!');

      await alex.page.locator(`[data-note-id="${id}"]`).click();
      await alex.page.keyboard.press('Delete');

      await expectEventually('delete while editing', async () => (await noteViews(sam.page)).length === 0);
      await expect(sam.page.getByRole('textbox')).toHaveCount(0);
      await sam.page.keyboard.type('more'); // typing into nothing must not resurrect or throw
      await sam.page.waitForTimeout(300);
      expect(await noteViews(alex.page)).toHaveLength(0);
      expect(await noteViews(sam.page)).toHaveLength(0);
      expect(alex.errors).toEqual([]);
      expect(sam.errors).toEqual([]);
    } finally {
      await closeAll([alex, sam]);
    }
  });

  test('TC-28 selecting and editing stay personal', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      const id = await newNoteAt(alex.page, 400, 300);
      await alex.page.keyboard.type('mine');
      await expectEventually('note visible', async () => (await noteView(sam.page, id))?.text === 'mine');
      await expect(alex.page.getByRole('textbox')).toHaveCount(1);
      await expect(sam.page.getByRole('textbox')).toHaveCount(0);
      await expect(sam.page.locator(`[data-note-id="${id}"]`)).toHaveAttribute('data-selected', 'false');
      await expect(sam.page.locator('.sticky-note--selected')).toHaveCount(0);
      await expect(sam.page.getByRole('toolbar', { name: 'Note tools' })).toHaveCount(0);
    } finally {
      await closeAll([alex, sam]);
    }
  });
});

test.describe('Full-capacity session', () => {
  test(`TC-26 ${MAX_CONCURRENT_EDITORS} editors each create and move notes`, async ({ browser }) => {
    test.setTimeout(180_000);
    const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    try {
      const camera = { x: -1280, y: -800, zoom: 0.5 };
      await Promise.all(people.map((p) => setCamera(p.page, camera)));
      const latencies: number[] = [];
      const perPerson = 5;
      const ids: string[][] = people.map(() => []);

      for (let k = 0; k < perPerson; k++) {
        for (const [i, p] of people.entries()) {
          const t = Date.now();
          const id = await newNoteAt(p.page, 160 + k * 120, 100 + i * 130);
          await p.page.keyboard.press('Escape');
          ids[i].push(id);
          const watcher = people[(i + 1) % people.length];
          await expectEventually(`create ${p.name}#${k}`, async () => !!(await noteView(watcher.page, id)), t);
          latencies.push(Date.now() - t);
        }
      }
      for (const [i, p] of people.entries()) {
        for (const id of ids[i]) {
          const t = Date.now();
          const before = await noteView(p.page, id);
          await dragNote(p.page, id, 20, 20);
          const watcher = people[(i + 1) % people.length];
          await expectEventually(
            `move ${p.name}`,
            async () => {
              const v = await noteView(watcher.page, id);
              return !!v && !!before && Math.abs(v.left - before.left - 40) < 1;
            },
            t,
          );
          latencies.push(Date.now() - t);
        }
      }
      await expectEventually('all screens identical', async () => (await sameBoard(people)) && (await noteViews(people[0].page)).length === MAX_CONCURRENT_EDITORS * perPerson);
      logLatencyReport('TC-26 create+move (incl. UI action time)', latencies);
    } finally {
      await closeAll(people);
    }
  });
});

test.describe('Flaky Wi-Fi', () => {
  test('TC-27 edits made during an outage catch up in both directions', async ({ browser }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 120_000);
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      const network = await controlNetwork(alex);
      await alex.page.reload(); // so the board socket goes through the proxy
      await alex.page.waitForFunction(() => window.__vidi6?.connectionState === 'connected');
      await network.setOffline(true);
      await expect(badge(alex.page)).toHaveText('Reconnecting…', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      const outageStart = Date.now();

      for (let i = 0; i < 3; i++) {
        await newNoteAt(alex.page, 200 + i * 220, 200);
        await alex.page.keyboard.type(`alex ${i}`);
        await alex.page.keyboard.press('Escape');
        await newNoteAt(sam.page, 200 + i * 220, 500);
        await sam.page.keyboard.type(`sam ${i}`);
        await sam.page.keyboard.press('Escape');
      }
      // Alex keeps working locally while nobody else sees it.
      await expect(notes(alex.page)).toHaveCount(3);
      await expect(notes(sam.page)).toHaveCount(3);
      await alex.page.waitForTimeout(Math.max(0, CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outageStart)));

      await network.setOffline(false);
      await expect(badge(alex.page)).toHaveText('Connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 });
      await expect(notes(alex.page)).toHaveCount(6, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      await expect(notes(sam.page)).toHaveCount(6, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      await expectEventually('identical after catch-up', () => sameBoard([alex, sam]));
      await expect(badge(alex.page)).toHaveCount(0, { timeout: 5000 });
    } finally {
      await closeAll([alex, sam]);
    }
  });
});
