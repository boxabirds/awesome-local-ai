import { expect, test, type Page } from '@playwright/test';
import {
  dragBy,
  getNotes,
  noteLocator,
  typeIntoEditor,
  type ViewportPoint
} from './helpers/board';
import {
  LatencyRecorder,
  noteAppears,
  noteMatches,
  openParticipants,
  snapshotKey,
  snapshotsAgree,
  type Participant
} from './helpers/participants';
import { CATCH_UP_TEST_OUTAGE_MS } from '../../src/shared/config';

const EMPTY_CLICK: ViewportPoint = { x: 1200, y: 760 };

async function createNote(page: Page, at: ViewportPoint): Promise<string> {
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();
  await page.keyboard.press('Escape');
  const notes = await getNotes(page);
  const id = notes[notes.length - 1].id;
  await page.mouse.click(EMPTY_CLICK.x, EMPTY_CLICK.y);
  return id;
}

async function openEditorOn(page: Page, id: string): Promise<void> {
  const box = await noteLocator(page, id).boundingBox();
  if (box === null) throw new Error(`note ${id} has no box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();
}

function charCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return counts;
}

test.describe('live collaboration', () => {
  test('TC-22 Alex creates, moves, recolours, types, deletes — Sam sees each change', async ({
    browser
  }) => {
    test.setTimeout(180_000);
    const recorder = new LatencyRecorder();
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    try {
      const at: ViewportPoint = { x: 400, y: 300 };
      let id = '';
      const box = () => noteLocator(alex.page, id).boundingBox();

      await recorder.measure(
        'create',
        async () => {
          await alex.page.mouse.dblclick(at.x, at.y);
          await alex.page.keyboard.press('Escape');
          await alex.page.mouse.click(EMPTY_CLICK.x, EMPTY_CLICK.y);
          id = (await getNotes(alex.page)).at(-1)!.id;
        },
        async () => id !== '' && (await noteAppears([sam], id)())
      );

      // Note top-left world pos at the default camera was (-340,-200); a
      // (+100,+60) viewport drag at zoom 1 is the same delta in world units.
      await recorder.measure(
        'move',
        async () => {
          const b = await box();
          await dragBy(alex.page, { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 }, 100, 60);
        },
        noteMatches(sam, id, (n) => Math.abs(n.x + 240) <= 2 && Math.abs(n.y + 140) <= 2)
      );

      await recorder.measure(
        'recolour',
        async () => {
          const b = await box();
          await alex.page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2);
          await alex.page.getByRole('button', { name: 'Pink colour' }).click();
        },
        noteMatches(sam, id, (n) => n.color === 'pink')
      );

      await recorder.measure(
        'text',
        async () => {
          await openEditorOn(alex.page, id);
          await typeIntoEditor(alex.page, 'Hello from Alex');
          await alex.page.keyboard.press('Escape');
        },
        noteMatches(sam, id, (n) => n.text === 'Hello from Alex')
      );

      await recorder.measure(
        'delete',
        async () => {
          await openEditorOn(alex.page, id);
          await alex.page.keyboard.press('Escape');
          const b = await box();
          await alex.page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2);
          await alex.page.keyboard.press('Delete');
        },
        async () => (await getNotes(sam.page)).length === 0
      );

      await expect(sam.page).toHaveTitle(/.+/); // Sam's page stayed healthy
    } finally {
      recorder.report('TC-22');
      await Promise.all([alex.context.close(), sam.context.close()]);
    }
  });

  test('TC-23 both type simultaneously into one note — identical text, every character present', async ({
    browser
  }) => {
    test.setTimeout(180_000);
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    try {
      const id = await createNote(alex.page, { x: 400, y: 300 });
      await expect.poll(noteAppears([sam], id), { timeout: 15_000 }).toBe(true);

      // Alex re-opens the editor; Sam opens an editor on the same note.
      await openEditorOn(alex.page, id);
      await openEditorOn(sam.page, id);

      const alexText = 'AlexWasHere123';
      const samText = 'SamWasHere456';
      await Promise.all([
        typeIntoEditor(alex.page, alexText),
        typeIntoEditor(sam.page, samText)
      ]);

      const merged = alexText + samText;
      const identicalAndComplete = async (): Promise<boolean> => {
        const a = (await getNotes(alex.page))[0]?.text ?? '';
        const s = (await getNotes(sam.page))[0]?.text ?? '';
        if (a !== s || a.length !== merged.length) return false;
        const ca = charCounts(a);
        const cm = charCounts(merged);
        for (const [ch, n] of cm) if (ca.get(ch) !== n) return false;
        return true;
      };
      await expect.poll(identicalAndComplete, { timeout: 15_000 }).toBe(true);

      const notesA = await getNotes(alex.page);
      expect(notesA[0].text.length).toBeGreaterThanOrEqual(merged.length);
      expect(alexText.split('').every((ch) => notesA[0].text.includes(ch))).toBe(true);
      expect(samText.split('').every((ch) => notesA[0].text.includes(ch))).toBe(true);
    } finally {
      await Promise.all([alex.context.close(), sam.context.close()]);
    }
  });

  test('TC-24 both drag the same note at once — identical settled position', async ({
    browser
  }) => {
    test.setTimeout(180_000);
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    try {
      const id = await createNote(alex.page, { x: 400, y: 300 });
      await expect.poll(noteAppears([sam], id), { timeout: 15_000 }).toBe(true);
      const before = (await getNotes(alex.page)).find((n) => n.id === id)!;
      const box = await noteLocator(alex.page, id).boundingBox();
      const centre = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };

      await Promise.all([
        dragBy(alex.page, centre, 80, 40),
        dragBy(sam.page, centre, 80, 40)
      ]);

      await expect.poll(() => snapshotsAgree([alex.page, sam.page]), { timeout: 15_000 }).toBe(true);
      const settled = (await getNotes(alex.page)).find((n) => n.id === id)!;
      expect(Math.abs(settled.x - (before.x + 80)) <= 2).toBe(true);
      expect(Math.abs(settled.y - (before.y + 40)) <= 2).toBe(true);
    } finally {
      await Promise.all([alex.context.close(), sam.context.close()]);
    }
  });

  test('TC-25 Alex deletes the note Sam is editing — Sam loses note and editor cleanly', async ({
    browser
  }) => {
    test.setTimeout(180_000);
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    const samErrors: string[] = [];
    sam.page.on('pageerror', (err) => samErrors.push(String(err)));
    sam.page.on('console', (msg) => {
      if (msg.type() === 'error') samErrors.push(msg.text());
    });
    try {
      const id = await createNote(alex.page, { x: 400, y: 300 });
      await expect.poll(noteAppears([sam], id), { timeout: 15_000 }).toBe(true);

      await openEditorOn(sam.page, id);
      await typeIntoEditor(sam.page, 'typing while…');

      const box = await noteLocator(alex.page, id).boundingBox();
      await alex.page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await alex.page.keyboard.press('Delete');

      await expect
        .poll(async () => (await getNotes(sam.page)).length === 0, { timeout: 15_000 })
        .toBe(true);
      await expect(sam.page.locator('[data-testid="sticky-textarea"]')).toHaveCount(0);
      await expect(sam.page.locator('[data-testid="sticky-note"]')).toHaveCount(0);
      expect(samErrors).toEqual([]);
    } finally {
      await Promise.all([alex.context.close(), sam.context.close()]);
    }
  });

  test('TC-26 full capacity: five editors, each creates 5 and moves 5 — all converge', async ({
    browser
  }) => {
    test.setTimeout(300_000);
    const names = ['A', 'B', 'C', 'D', 'E'];
    const recorder = new LatencyRecorder();
    const participants = await openParticipants(browser, names);
    try {
      // Zoom all cameras out so 25 non-overlapping grid slots fit on screen.
      const cam = { x: -20, y: -20, zoom: 0.5 };
      await Promise.all(
        participants.map(async (p) => {
          await p.page.evaluate((c) => window.__vidi6?.setCamera(c), cam);
        })
      );
      const slot = (index: number): ViewportPoint => ({
        x: 90 + (index % 6) * 140,
        y: 90 + Math.floor(index / 6) * 140
      });

      const created: { owner: Participant; id: string; from: ViewportPoint }[] = [];
      for (const [p, owner] of participants.entries()) {
        for (let i = 0; i < 5; i += 1) {
          const at = slot(p * 5 + i);
          const before = new Set((await getNotes(owner.page)).map((n) => n.id));
          await owner.page.mouse.dblclick(at.x, at.y);
          await owner.page.keyboard.press('Escape');
          const after = await getNotes(owner.page);
          const id = after.find((n) => !before.has(n.id))!.id;
          const others = participants.filter((o) => o !== owner);
          await recorder.measure(
            `create by ${owner.name} #${i}`,
            async () => {},
            noteAppears(others, id)
          );
          created.push({ owner, id, from: at });
        }
      }

      for (const { owner, id, from } of created) {
        const x0 = (await getNotes(owner.page)).find((n) => n.id === id)!.x;
        const y0 = (await getNotes(owner.page)).find((n) => n.id === id)!.y;
        await dragBy(owner.page, from, 15, 10);
        const others = participants.filter((o) => o !== owner);
        await recorder.measure(
          `move by ${owner.name} of ${id.slice(0, 6)}`,
          async () => {},
          async () => {
            for (const o of others) {
              const seen = await noteMatches(
                o,
                id,
                (n) => Math.abs(n.x - (x0 + 30)) <= 2 && Math.abs(n.y - (y0 + 20)) <= 2
              )();
              if (!seen) return false;
            }
            return true;
          }
        );
      }

      await expect.poll(() => snapshotsAgree(participants.map((p) => p.page)), { timeout: 30_000 }).toBe(true);
      const notes = await getNotes(participants[0].page);
      expect(notes).toHaveLength(25);
      const keys = await Promise.all(
        participants.map(async (p) => snapshotKey(await getNotes(p.page)))
      );
      expect(new Set(keys).size).toBe(1);
    } finally {
      recorder.report('TC-26');
      await Promise.all(participants.map((p) => p.context.close()));
    }
  });

  test('TC-27 flaky Wi-Fi: offline outage, catch-up, badge Reconnecting → Connected', async ({
    browser
  }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 120_000);
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    try {
      await alex.context.setOffline(true);

      for (let i = 0; i < 3; i += 1) {
        await createNote(alex.page, { x: 200 + i * 230, y: 200 });
      }
      for (let i = 0; i < 3; i += 1) {
        await createNote(sam.page, { x: 200 + i * 230, y: 500 });
      }

      // The outage outlives the provider ping timeout, so Alex must be back
      // in "Reconnecting…" by now (y-websocket retries with backoff).
      await expect
        .poll(() => alex.page.locator('.connection-status').textContent(), { timeout: CATCH_UP_TEST_OUTAGE_MS + 30_000 })
        .toContain('Reconnecting');

      await new Promise((resolve) => setTimeout(resolve, CATCH_UP_TEST_OUTAGE_MS));
      await alex.context.setOffline(false);

      await expect(alex.page.locator('.connection-status')).toContainText('Connected', { timeout: 30_000 });
      for (const p of [alex, sam]) {
        await expect
          .poll(async () => (await getNotes(p.page)).length, { timeout: 30_000 })
          .toBe(6);
      }
      // Badge hides again once confirmation elapses; the board is fully live.
      await expect(alex.page.locator('.connection-status')).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await Promise.all([alex.context.close(), sam.context.close()]);
    }
  });

  test('TC-28 selection and editor are local: Sam sees neither outline nor editor', async ({
    browser
  }) => {
    test.setTimeout(120_000);
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    try {
      const id = await createNote(alex.page, { x: 400, y: 300 });
      await expect.poll(noteAppears([sam], id), { timeout: 15_000 }).toBe(true);
      await openEditorOn(alex.page, id);
      await typeIntoEditor(alex.page, 'private caret');

      // Sanity: Alex really is selecting and editing.
      await expect(alex.page.locator(`[data-testid="sticky-note"][data-selected="true"]`)).toHaveCount(1);
      await expect(alex.page.locator('[data-testid="sticky-textarea"]')).toHaveCount(1);

      // Sam's view: no selection outline, no editor — and let a few sync
      // frames pass so this is a negative on live data, not a race.
      await expect
        .poll(async () => (await getNotes(sam.page))[0]?.text === 'private caret', { timeout: 15_000 })
        .toBe(true);
      await expect(sam.page.locator('[data-testid="sticky-note"][data-selected="true"]')).toHaveCount(0);
      await expect(sam.page.locator('[data-testid="sticky-textarea"]')).toHaveCount(0);
    } finally {
      await Promise.all([alex.context.close(), sam.context.close()]);
    }
  });
});
