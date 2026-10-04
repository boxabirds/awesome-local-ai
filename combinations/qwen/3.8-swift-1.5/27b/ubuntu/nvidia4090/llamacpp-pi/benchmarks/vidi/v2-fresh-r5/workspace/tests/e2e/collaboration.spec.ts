import { test, expect } from '@playwright/test';
import { Participant, createParticipants, expectEventually } from './helpers/participants';
import { MAX_CONCURRENT_EDITORS, CATCH_UP_TEST_OUTAGE_MS } from '../../src/shared/config';

/** TC-22 and TC-23 must pass on every browser; the rest are chromium-only. */
function chromiumOnly(): void {
  test.skip(test.info().project.name !== 'chromium', 'chromium only');
}

/** Track a participant's mapped connection states while a transition happens. */
async function trackStates(p: Participant, ms: number): Promise<string[]> {
  const seen: string[] = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await p.connectionState();
    if (seen[seen.length - 1] !== s) seen.push(s);
    await new Promise((r) => setTimeout(r, 50));
  }
  return seen;
}

test.describe('story 3: live collaboration', () => {
  test('TC-22: Alex creates, moves, recolours, types, deletes → each change appears for Sam', async ({ browser }) => {
    const [alex, sam] = await createParticipants(browser, 2);
    try {
      // Create
      await alex.createNote('AlexNote', 640, 400);
      await expectEventually('Sam sees AlexNote', async () => (await sam.note('AlexNote').count()) === 1);

      // Move by (150, 80)
      const before = (await sam.note('AlexNote').boundingBox())!;
      await alex.dragNote('AlexNote', 150, 80);
      await expectEventually('Sam sees the moved note', async () => {
        const b = (await sam.note('AlexNote').boundingBox())!;
        return Math.abs(b.x - (before.x + 150)) <= 2 && Math.abs(b.y - (before.y + 80)) <= 2;
      });

      // Recolour to pink
      await alex.selectNote('AlexNote');
      await alex.recolorSelected('pink', 'rgb(244, 143, 177)');
      await expectEventually('Sam sees pink', async () => {
        const bg = await sam.note('AlexNote').evaluate((el) => getComputedStyle(el).backgroundColor);
        return bg === 'rgb(244, 143, 177)'; // #F48FB1
      });

      // Type into the note (Alex only; Sam watches it appear live)
      await alex.note('AlexNote').dblclick();
      await alex.page.getByTestId('sticky-textarea').press('End');
      await alex.page.keyboard.type('Hi Sam');
      await alex.page.keyboard.press('Escape');
      await expectEventually("Sam's text contains 'Hi Sam'", async () =>
        (await sam.note('AlexNote').locator('[data-testid="sticky-text-display"]').textContent())?.includes('Hi Sam') ?? false,
      );

      // Delete
      await alex.selectNote('AlexNote');
      await alex.deleteSelected('AlexNote');
      await expectEventually('Sam sees the note deleted', async () => (await sam.note('AlexNote').count()) === 0);
    } finally {
      await alex.close();
      await sam.close();
    }
  });

  test('TC-23: both type simultaneously into one note → identical text with every typed character', async ({ browser }) => {
    const [alex, sam] = await createParticipants(browser, 2);
    try {
      await alex.createNote('Shared', 640, 400);
      await expectEventually('Sam sees Shared', async () => (await sam.note('Shared').count()) === 1);

      // Both enter edit mode on the same note.
      await alex.note('Shared').dblclick();
      await sam.note('Shared').dblclick();
      const alexTa = alex.page.getByTestId('sticky-textarea');
      const samTa = sam.page.getByTestId('sticky-textarea');
      await expect(alexTa).toBeVisible();
      await expect(samTa).toBeVisible();

      // Interleave typing: alex A/C/E, sam B/D/F.
      const seq: Array<[Participant, string]> = [
        [alex, 'A'], [sam, 'B'], [alex, 'C'],
        [sam, 'D'], [alex, 'E'], [sam, 'F'],
      ];
      for (const [p, ch] of seq) {
        await p.page.keyboard.type(ch);
      }

      // Both exit edit mode; the notes must show identical text.
      await alex.page.keyboard.press('Escape');
      await sam.page.keyboard.press('Escape');

      const texts: string[] = [];
      await expectEventually('both notes show the same text', async () => {
        const a = (await alex.note('Shared').locator('[data-testid="sticky-text-display"]').textContent()) ?? '';
        const s = (await sam.note('Shared').locator('[data-testid="sticky-text-display"]').textContent()) ?? '';
        texts.length = 0;
        texts.push(a, s);
        return a.length > 0 && a === s;
      });

      for (const ch of ['Shared', 'A', 'B', 'C', 'D', 'E', 'F']) {
        expect(texts[0]).toContain(ch);
      }
    } finally {
      await alex.close();
      await sam.close();
    }
  });

  test('TC-24: both drag the same note at once → identical settled position on both', async ({ browser }) => {
    chromiumOnly();
    const [alex, sam] = await createParticipants(browser, 2);
    try {
      await alex.createNote('Drag', 640, 400);
      await expectEventually('Sam sees Drag', async () => (await sam.note('Drag').count()) === 1);

      const box = (await sam.note('Drag').boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      // Both grab the note at its original centre, then drag interleaved.
      await alex.page.mouse.move(cx, cy);
      await alex.page.mouse.down();
      await sam.page.mouse.move(cx, cy);
      await sam.page.mouse.down();

      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        await alex.page.mouse.move(cx + (100 * i) / steps, cy, { steps: 1 });
        await sam.page.mouse.move(cx, cy + (100 * i) / steps, { steps: 1 });
      }
      await alex.page.mouse.up();
      await sam.page.mouse.up();

      await expectEventually('both pages settle on the same position', async () => {
        const a = (await alex.note('Drag').boundingBox())!;
        const s = (await sam.note('Drag').boundingBox())!;
        return Math.abs(a.x - s.x) <= 2 && Math.abs(a.y - s.y) <= 2;
      });
    } finally {
      await alex.close();
      await sam.close();
    }
  });

  test('TC-25: Sam editing, Alex deletes → Sam note and editor disappear, no console errors', async ({ browser }) => {
    chromiumOnly();
    const [alex, sam] = await createParticipants(browser, 2);
    const errors: string[] = [];
    const wire = (p: Participant) => {
      p.page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      p.page.on('pageerror', (e) => errors.push(String(e)));
    };
    wire(alex);
    wire(sam);
    try {
      await alex.createNote('Doomed', 640, 400);
      await expectEventually('Sam sees Doomed', async () => (await sam.note('Doomed').count()) === 1);

      // Sam enters edit mode on the note.
      await sam.note('Doomed').dblclick();
      await expect(sam.page.getByTestId('sticky-textarea')).toBeVisible();
      await sam.page.keyboard.type('my thoughts');

      // Alex selects and deletes it while Sam is typing.
      await alex.selectNote('Doomed');
      await alex.deleteSelected('Doomed');

      await expectEventually("Sam's note and editor disappear", async () =>
        (await sam.note('Doomed').count()) === 0 && (await sam.page.getByTestId('sticky-textarea').count()) === 0,
      );
      // Alex's side is empty too.
      expect(await alex.note('Doomed').count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await alex.close();
      await sam.close();
    }
  });

  test(`TC-26: ${MAX_CONCURRENT_EDITORS} participants × 5 create + 5 move → all changes seen by all; identical final snapshots`, async ({ browser }) => {
    chromiumOnly();
    test.setTimeout(180_000);
    const n = MAX_CONCURRENT_EDITORS;
    const ps = await createParticipants(browser, n);
    try {
      // Zoom everyone out so 5×5 grid of 200px notes fits the viewport.
      for (const p of ps) {
        await p.page.evaluate(() => (window as any).__vidi6.setCamera({ x: -1280, y: -800, zoom: 0.5 }));
      }

      // Each participant creates 5 notes in their row.
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 5; k++) {
          await ps[i].createNote(`P${i}${k}`, 240 + k * 150, 160 + i * 150);
        }
      }

      // Every participant sees all 25 notes.
      for (let i = 0; i < n; i++) {
        await expectEventually(`P${i} sees all 25 notes`, async () => {
          if ((await ps[i].notes().count()) !== 25) return false;
          for (let j = 0; j < n; j++) {
            for (let k = 0; k < 5; k++) {
              if ((await ps[i].note(`P${j}${k}`).count()) !== 1) return false;
            }
          }
          return true;
        });
      }

      // Each participant moves their own 5 notes.
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 5; k++) {
          await ps[i].dragNote(`P${i}${k}`, 30, 20);
        }
      }

      // Final DOM snapshots identical on every participant.
      const snaps: string[][] = [];
      await expectEventually('all snapshots identical', async () => {
        snaps.length = 0;
        for (const p of ps) snaps.push(await p.boardSnapshot());
        const baseline = snaps[0].join('\n');
        return snaps[0].length === 25 && snaps.every((s) => s.join('\n') === baseline);
      });
    } finally {
      await Promise.all(ps.map((p) => p.close()));
    }
  });

  test('TC-27: Alex offline during an outage → both add notes → catch-up, badge Reconnecting → Connected, 6 notes each', async ({ browser }) => {
    chromiumOnly();
    test.setTimeout(180_000);
    const [alex, sam] = await createParticipants(browser, 2);
    try {
      // Drop Alex's network. Order matters: tear down the socket first (its
      // close event only fires while the network can deliver the close
      // frame), then go offline so the provider's reconnection attempts
      // fail for the duration of the outage.
      await alex.page.evaluate(() => (window as any).__vidi6.dropConnection());
      await alex.context.setOffline(true);
      await expectEventually('Alex badge goes Reconnecting', async () =>
        (await alex.connectionState()) === 'reconnecting',
      );

      // Both add 3 notes while Alex is offline.
      for (let k = 0; k < 3; k++) {
        await alex.createNote(`A${k}`, 300, 200 + k * 200);
        await sam.createNote(`S${k}`, 900, 200 + k * 200);
      }
      // Hold the outage for the configured duration.
      await new Promise((r) => setTimeout(r, CATCH_UP_TEST_OUTAGE_MS));
      // Each sees their own 3 notes locally.
      expect(await alex.notes().count()).toBe(3);
      expect(await sam.notes().count()).toBe(3);

      // Alex comes back online: track the state transition.
      let seen: string[] = [];
      const track = trackStates(alex, 15_000).then((s) => (seen = s));
      await alex.context.setOffline(false);

      // Badge: green "Connected" confirmation appears after re-sync.
      await expectEventually('Alex badge shows Connected', async () =>
        (await alex.page.locator('[data-testid="connection-status"]').textContent()) === 'Connected',
      );
      await expectEventually('Alex sees all 6 notes', async () => (await alex.notes().count()) === 6);
      await expectEventually('Sam sees all 6 notes', async () => (await sam.notes().count()) === 6);
      await expectEventually('Alex back to steady connected', async () =>
        (await alex.connectionState()) === 'connected',
      );

      // The observed state sequence went through the reconnect and settled.
      await track;
      expect(seen).toContain('reconnecting');
      expect(seen[seen.length - 1]).toBe('connected');
    } finally {
      await alex.close();
      await sam.close();
    }
  });

  test('TC-28: Alex selects and edits a note → Sam sees no selection outline or editor', async ({ browser }) => {
    chromiumOnly();
    const [alex, sam] = await createParticipants(browser, 2);
    try {
      await alex.createNote('Mine', 640, 400);
      await expectEventually('Sam sees Mine', async () => (await sam.note('Mine').count()) === 1);

      // Alex selects (click) and enters edit mode (double-click).
      // (In edit mode the note shows a textarea, whose value is not text
      // content — so locate the note structurally, not by text.)
      const alexNote = alex.notes().first();
      await alexNote.dblclick();
      await expect(alex.page.getByTestId('sticky-textarea')).toBeVisible();
      await expect(alexNote).toHaveAttribute('data-selected', 'true');

      // Sam: the same note exists, but with no selection marker and no editor.
      const samNote = sam.note('Mine');
      expect(await samNote.count()).toBe(1);
      expect(await samNote.locator('[data-selected]').count()).toBe(0);
      expect(await sam.page.getByTestId('sticky-textarea').count()).toBe(0);
    } finally {
      await alex.close();
      await sam.close();
    }
  });
});
