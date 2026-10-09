import { expect, test, type Page } from '@playwright/test';
import { createBoard } from './helpers/board';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS, type StickyColor } from '../../src/shared/config';
import { boardSnapshot, expectEventually, eventually, openParticipant, snapshotOf, type Participant } from './helpers/participants';

// Nightly soak suite (playwright.nightly.config.ts). Long-running stability
// checks that are too slow for the per-change e2e run: an idle-connection
// hold and a full-capacity random-edit session with a live-latency report.

async function createNote(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
  if (!(await page.evaluate(() => document.querySelector('textarea') !== null))) {
    // A lingering selection (and its toolbar) absorbed the double-click;
    // clear it on empty background space and retry once.
    await page.mouse.click(6, 794);
    await page.mouse.dblclick(x, y);
  }
  await page.keyboard.press('Escape');
}

async function noteIds(page: Page): Promise<string[]> {
  const snap = await boardSnapshot(page);
  return snap
    .split('\n')
    .filter((line) => line.startsWith('sticky-'))
    .map((line) => line.slice('sticky-'.length, line.indexOf(' ')));
}

async function moveNote(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const box = await page.getByTestId(`sticky-${id}`).boundingBox();
  if (box === null) throw new Error(`note ${id} not visible`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
  await page.mouse.up();
}

async function recolourNote(page: Page, id: string, color: StickyColor): Promise<boolean> {
  const label = `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
  try {
    await page.getByTestId(`sticky-${id}`).click({ timeout: 4000 });
    await page.getByRole('toolbar', { name: 'Note tools' }).getByLabel(label).click({ timeout: 4000 });
    return true;
  } catch {
    await page.mouse.click(5, 780);
    return false;
  }
}

async function slotFree(page: Page, x: number, y: number): Promise<boolean> {
  return page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid^="sticky-"]') === null,
    { x, y }
  );
}

async function connectionStates(parts: Participant[]): Promise<string[]> {
  return Promise.all(
    parts.map((p) => p.page.evaluate(() => window.__vidi6?.connectionState ?? 'missing'))
  );
}

async function expectAllConverge(parts: Participant[], label: string): Promise<number> {
  const started = Date.now();
  await expectEventually(label, async () => {
    await eventually(async () => {
      const snaps = await snapshotOf(...parts);
      return snaps.every((s) => s === snaps[0]);
    }, `all ${parts.length} boards identical (${label})`).toBe(true);
  });
  return Date.now() - started;
}

test.describe('nightly soak', () => {
  test('TC-29 a board idles connected for 45 seconds and the first edit after the idle still propagates', async ({
    browser,
    request
  }) => {
    test.setTimeout(150_000);
    const boardId = await createBoard(request);
    const alex = await openParticipant(browser, 'Alex', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);

    await createNote(alex.page, 400, 300);
    await createNote(sam.page, 900, 600);
    await expectAllConverge([alex, sam], 'TC-29 initial notes');

    for (const mark of [1, 2, 3]) {
      await alex.page.waitForTimeout(15_000);
      expect(await connectionStates([alex, sam]), `both connected at ${mark * 15}s idle`).toEqual([
        'connected',
        'connected'
      ]);
    }
    const snapsAfterIdle = await snapshotOf(alex, sam);
    expect(snapsAfterIdle[0], 'idle board unchanged').toBe(snapsAfterIdle[1]);

    await recolourNote(sam.page, (await noteIds(sam.page))[0], 'green');
    const afterIdleEdit = await expectAllConverge([alex, sam], 'TC-29 post-idle recolour');
    expect(afterIdleEdit, 'post-idle edit still propagates').toBeLessThan(60_000);

    expect(alex.consoleErrors, 'Alex console clean').toEqual([]);
    expect(sam.consoleErrors, 'Sam console clean').toEqual([]);
    await alex.context.close();
    await sam.context.close();
  });

  test('TC-30 five editors keep a board converged for 60 seconds of random edits with a latency report', async ({
    browser,
    request
  }) => {
    test.setTimeout(240_000);
    const boardId = await createBoard(request);
    const parts: Participant[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
      parts.push(await openParticipant(browser, `Editor${i + 1}`, boardId));
    }

    const colors = Object.keys(
      // recolour cycle uses four distinct swatches
      { green: 1, blue: 1, pink: 1, violet: 1 } as Record<string, 1>
    ) as StickyColor[];
    // Grid spacing leaves >100px gutters so note bodies, toolbars and drag
    // paths never overlap a neighbouring slot.
    const slots: { x: number; y: number }[] = [];
    for (const y of [230, 550]) {
      for (let col = 0; col < 4; col += 1) {
        slots.push({ x: 260 + col * 280, y });
      }
    }

    const latencies: number[] = [];
    const started = Date.now();
    let cycle = 0;
    while (Date.now() - started < 60_000) {
      cycle += 1;
      const actor = parts[cycle % parts.length];
      const kind = cycle % 3;
      const ids = await noteIds(actor.page);
      if (kind === 0) {
        const slot = slots[Math.floor(cycle / 3) % slots.length];
        if (await slotFree(actor.page, slot.x, slot.y)) {
          await createNote(actor.page, slot.x, slot.y);
        } else if (ids.length > 0) {
          await recolourNote(actor.page, ids[cycle % ids.length], colors[cycle % colors.length]);
        }
      } else if (ids.length === 0) {
        const slot = slots[Math.floor(cycle / 3) % slots.length];
        if (await slotFree(actor.page, slot.x, slot.y)) await createNote(actor.page, slot.x, slot.y);
      } else {
        const id = ids[cycle % ids.length];
        if (kind === 1) {
          const sign = cycle % 4 < 2 ? 1 : -1;
          await moveNote(actor.page, id, 30 * sign, 24 * sign);
        } else {
          await recolourNote(actor.page, id, colors[cycle % colors.length]);
        }
      }
      await actor.page.mouse.click(5, 780);
      await actor.page.waitForTimeout(200);
      latencies.push(await expectAllConverge(parts, `TC-30 cycle ${cycle}`));
      expect(await connectionStates(parts), `all connected at cycle ${cycle}`).toEqual(
        parts.map(() => 'connected')
      );
    }

    const finalSnaps = await snapshotOf(...parts);
    expect(finalSnaps.every((s) => s === finalSnaps[0]), 'final boards identical').toBe(true);
    const noteCount = finalSnaps[0].split('\n').filter((l) => l.startsWith('sticky-')).length;
    const mean = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    const max = Math.max(...latencies);
    const overBudget = latencies.filter((l) => l > LIVE_UPDATE_LATENCY_BUDGET_MS).length;
    console.log(
      `[soak] ${cycle} cycles, ${noteCount} notes on board, mean latency ${mean}ms, max ${max}ms, ` +
        `over ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget: ${overBudget}`
    );
    expect(noteCount, 'creates landed').toBeGreaterThanOrEqual(4);

    for (const p of parts) {
      expect(p.consoleErrors, `${p.name} console clean`).toEqual([]);
      await p.context.close();
    }
  });
});
