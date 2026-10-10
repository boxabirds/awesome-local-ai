import { expect, test } from '@playwright/test';
import { dragBy, getNotes } from './helpers/board';
import {
  connectionState,
  LatencyRecorder,
  openParticipants,
  snapshotKey
} from './helpers/participants';

const NIGHTLY = { tag: '@nightly', timeout: 300_000 };

// Badge visibility must never flicker on during an idle session: a Mutation
// observer records any appearance even between polls.
async function watchForBadge(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __vidi6Badged: boolean }).__vidi6Badged = false;
    const badged = (node: Node): boolean =>
      node instanceof Element &&
      (node.matches('.connection-status') || node.querySelector('.connection-status') !== null);
    new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (badged(added)) {
            (window as unknown as { __vidi6Badged: boolean }).__vidi6Badged = true;
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

test.describe('nightly: connection stability and capacity soak @nightly', () => {
  test('TC-29 idle sessions stay connected with no reconnect badge for 45 s', async ({
    browser
  }) => {
    test.setTimeout(NIGHTLY.timeout);
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    try {
      await watchForBadge(alex.page);
      await watchForBadge(sam.page);

      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        for (const p of [alex, sam]) {
          expect(await connectionState(p.page)).toBe('connected');
        }
      }

      for (const p of [alex, sam]) {
        expect(await p.page.evaluate(() => (window as unknown as { __vidi6Badged: boolean }).__vidi6Badged)).toBe(false);
        expect(await p.page.locator('.connection-status').count()).toBe(0);
      }

      // Still fully live after the idle stretch: a note written on one side
      // must appear on the other immediately.
      const id = await dragCreateAndReturnId(alex);
      await expect
        .poll(async () => (await getNotes(sam.page)).some((n) => n.id === id), { timeout: 15_000 })
        .toBe(true);
    } finally {
      await Promise.all([alex.context.close(), sam.context.close()]);
    }
  });

  test('TC-30 capacity soak: five seeded random editors for 60 s converge identically', async ({
    browser
  }) => {
    test.setTimeout(NIGHTLY.timeout);
    const names = ['A', 'B', 'C', 'D', 'E'];
    const recorder = new LatencyRecorder();
    const participants = await openParticipants(browser, names);
    try {
      const cam = { x: -20, y: -20, zoom: 0.5 };
      await Promise.all(
        participants.map(async (p) => {
          await p.page.evaluate((c) => window.__vidi6?.setCamera(c), cam);
        })
      );

      // mulberry32 so a failure can be re-seeded exactly.
      let seed = 1234567;
      const rand = (): number => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };

      const slot = (index: number): { x: number; y: number } => ({
        x: 90 + (index % 8) * 150,
        y: 90 + Math.floor(index / 8) * 150
      });
      let nextSlot = 0;
      const deadline = Date.now() + 60_000;
      let change = 0;

      outer: while (Date.now() < deadline) {
        for (const owner of participants) {
          if (Date.now() >= deadline) break outer;
          const notes = await getNotes(owner.page);
          const op = rand();
          const label = `change ${change} by ${owner.name}`;
          if (op < 0.4 || notes.length === 0) {
            const at = slot(nextSlot++ % 24);
            const before = new Set(notes.map((n) => n.id));
            await owner.page.mouse.dblclick(at.x, at.y);
            await owner.page.keyboard.press('Escape');
            const created = (await getNotes(owner.page)).find((n) => !before.has(n.id));
            if (created === undefined) continue;
            const others = participants.filter((o) => o !== owner);
            await recorder.measure(
              `${label} create`,
              async () => {},
              async () => {
                for (const o of others) {
                  if (!(await getNotes(o.page)).some((n) => n.id === created.id)) return false;
                }
                return true;
              }
            );
          } else {
            const note = notes[Math.floor(rand() * notes.length)];
            const box = await owner.page
              .locator(`[data-testid="sticky-note"][data-id="${note.id}"]`)
              .boundingBox();
            if (box === null) continue;
            const dx = Math.round((rand() - 0.5) * 60);
            const dy = Math.round((rand() - 0.5) * 60);
            await dragBy(
              owner.page,
              { x: box.x + box.width / 2, y: box.y + box.height / 2 },
              dx,
              dy
            );
            const others = participants.filter((o) => o !== owner);
            // Convergence, not exact delta: the drag settles where the owner
            // sees it and every other context must reach the same state.
            const settled = (await getNotes(owner.page)).find((n) => n.id === note.id);
            if (settled === undefined) continue;
            await recorder.measure(
              `${label} move`,
              async () => {},
              async () => {
                for (const o of others) {
                  const seen = (await getNotes(o.page)).find((n) => n.id === note.id);
                  if (seen === undefined) return false;
                  if (Math.abs(seen.x - settled.x) > 3) return false;
                  if (Math.abs(seen.y - settled.y) > 3) return false;
                }
                return true;
              }
            );
          }
          change += 1;
        }
      }

      await expect
        .poll(
          async () => {
            const keys = await Promise.all(
              participants.map(async (p) => snapshotKey(await getNotes(p.page)))
            );
            return new Set(keys).size === 1;
          },
          { timeout: 30_000 }
        )
        .toBe(true);

      const total = await getNotes(participants[0].page);
      expect(total.length).toBeGreaterThan(10);
      expect(change).toBeGreaterThan(0);
    } finally {
      recorder.report('TC-30');
      await Promise.all(participants.map((p) => p.context.close()));
    }
  });
});

async function dragCreateAndReturnId(alex: { page: import('@playwright/test').Page }): Promise<string> {
  await alex.page.mouse.dblclick(500, 350);
  await alex.page.keyboard.press('Escape');
  return (await getNotes(alex.page)).at(-1)!.id;
}
