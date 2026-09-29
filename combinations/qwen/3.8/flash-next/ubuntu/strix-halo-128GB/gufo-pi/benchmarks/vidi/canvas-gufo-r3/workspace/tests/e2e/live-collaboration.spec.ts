import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  openParticipants,
  closeParticipants,
  expectWithin,
  getNoteColor,
  newE2eBoardId,
  type Participant,
} from './helpers/participants';
import {
  getNoteIds,
  getNoteWorldPos,
  getNoteText,
  createNoteByDblclick,
  dragNoteBy,
  startEditingNote,
  typeIntoEditor,
  clickEmptyCanvas,
} from './helpers/sticky';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, CATCH_UP_TEST_OUTAGE_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

// A single live change must land within the named budget; final multi-client
// convergence checks get a little more slack to stay non-flaky under load.
const within = expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS);
const wide = expectWithin(10_000);

const noteCount = async (page: Page) => (await getNoteIds(page)).length;

/** Camera-independent, order-normalised description of every note on a board. */
async function boardSignature(page: Page): Promise<string> {
  const notes = await page.$$eval('[data-testid="sticky-note-wrapper"]', (els) =>
    els.map((e) => {
      const h = e as HTMLElement;
      const inner = h.querySelector('[data-testid="sticky-note"]') as HTMLElement;
      const text = h.querySelector('[data-testid="sticky-note-text"]')?.textContent ?? '';
      return `${h.dataset.noteId}|${h.dataset.x}|${h.dataset.y}|${getComputedStyle(inner).backgroundColor}|${text}`;
    }),
  );
  return notes.sort().join('\n');
}

async function selectNote(page: Page, id: string) {
  await page.locator(`[data-testid="sticky-note"][data-note-id="${id}"]`).click();
}

async function deleteNote(page: Page, id: string) {
  await clickEmptyCanvas(page);
  await selectNote(page, id);
  await page.keyboard.press('Delete');
}

test.describe('Workflow: Two-person workshop (live collaboration)', () => {
  test('TC-22: Alex creates, moves, recolours, types and deletes — each is visible to Sam', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, newE2eBoardId(), 2);
    try {
      const id = await createNoteByDblclick(alex.page, 500, 300);
      await within(async () => await noteCount(sam.page)).toBe(1);
      expect((await getNoteIds(sam.page))).toContain(id);

      // Move (leave edit mode first, then drag).
      await clickEmptyCanvas(alex.page);
      await dragNoteBy(alex.page, id, 120, 80);
      const moved = await getNoteWorldPos(alex.page, id);
      await within(async () => {
        const p = await getNoteWorldPos(sam.page, id);
        return p.x === moved.x && p.y === moved.y;
      }).toBe(true);

      // Recolour.
      await clickEmptyCanvas(alex.page);
      await selectNote(alex.page, id);
      await alex.page
        .locator(`[data-testid="sticky-note-wrapper"][data-note-id="${id}"] [aria-label="Green colour"]`)
        .click();
      const green = await getNoteColor(alex.page, id);
      await within(async () => await getNoteColor(sam.page, id)).toBe(green);

      // Type.
      await startEditingNote(alex.page, id);
      await typeIntoEditor(alex.page, 'buy coffee');
      await within(async () => (await getNoteText(sam.page, id).textContent()) ?? '').toContain('buy coffee');

      // Delete.
      await deleteNote(alex.page, id);
      await within(async () => await noteCount(sam.page)).toBe(0);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('TC-23: both type simultaneously into one note → identical text with every character', async ({ browser }) => {
    const [a, b] = await openParticipants(browser, newE2eBoardId(), 2);
    try {
      const id = await createNoteByDblclick(a.page, 500, 300);
      await within(async () => await noteCount(b.page)).toBe(1);
      await clickEmptyCanvas(a.page);

      await startEditingNote(a.page, id);
      await startEditingNote(b.page, id);

      const left = 'AAAA';
      const right = 'BBBB';
      for (let i = 0; i < left.length; i++) {
        await a.page.keyboard.type(left[i], { delay: 20 });
        await b.page.keyboard.type(right[i], { delay: 20 });
      }

      await wide(async () => {
        const ta = (await getNoteText(a.page, id).textContent()) ?? '';
        const tb = (await getNoteText(b.page, id).textContent()) ?? '';
        return ta === tb ? ta : null;
      }).not.toBeNull();

      const final = (await getNoteText(a.page, id).textContent()) ?? '';
      expect(final.split('A').length - 1).toBe(4);
      expect(final.split('B').length - 1).toBe(4);
    } finally {
      await closeParticipants([a, b]);
    }
  });

  test('TC-24: both drag the same note at once → identical settled position', async ({ browser }) => {
    const [a, b] = await openParticipants(browser, newE2eBoardId(), 2);
    try {
      const id = await createNoteByDblclick(a.page, 500, 300);
      await within(async () => await noteCount(b.page)).toBe(1);
      await clickEmptyCanvas(a.page);

      for (let step = 0; step < 6; step++) {
        await dragByStep(a.page, id, 15, 0);
        await dragByStep(b.page, id, 0, 12);
      }
      await wide(async () => {
        const pa = await getNoteWorldPos(a.page, id);
        const pb = await getNoteWorldPos(b.page, id);
        return pa.x === pb.x && pa.y === pb.y;
      }).toBe(true);
    } finally {
      await closeParticipants([a, b]);
    }
  });

  test('TC-25: Sam is editing when Alex deletes — Sam’s note and editor vanish with no console errors', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, newE2eBoardId(), 2);
    const errors: string[] = [];
    sam.page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    sam.page.on('pageerror', (e) => errors.push(String(e)));
    try {
      const id = await createNoteByDblclick(sam.page, 500, 300);
      await within(async () => await noteCount(alex.page)).toBe(1);

      await startEditingNote(sam.page, id);
      await typeIntoEditor(sam.page, 'typing');

      await deleteNote(alex.page, id);

      await within(async () => await noteCount(sam.page)).toBe(0);
      await within(async () => await sam.page.locator('[data-testid="sticky-textarea"]').count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('TC-28: Alex selects and edits a note — Sam sees no selection outline or editor', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, newE2eBoardId(), 2);
    try {
      const id = await createNoteByDblclick(alex.page, 500, 300);
      await within(async () => await noteCount(sam.page)).toBe(1);
      await startEditingNote(alex.page, id);
      await typeIntoEditor(alex.page, 'private editing');

      await within(async () => (await getNoteText(sam.page, id).textContent()) ?? '').toContain('private editing');

      expect(
        await sam.page.locator(`[data-testid="sticky-note"][data-note-id="${id}"]`).getAttribute('data-selected'),
      ).toBe('false');
      expect(await sam.page.locator('[data-testid="sticky-textarea"]').count()).toBe(0);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });
});

test.describe('Workflow: Full-capacity session', () => {
  test('TC-26: MAX_CONCURRENT_EDITORS contexts each create 5 and move 5 — all converge identically', async ({ browser }) => {
    test.setTimeout(150_000);
    const board = newE2eBoardId();
    const parts = await openParticipants(browser, board, MAX_CONCURRENT_EDITORS);

    // Each participant gets a camera panned far away in world space, so their own
    // 5-note grid maps to the same on-screen region while every other participant's
    // notes land far off-screen. The create points are therefore always empty and
    // never obscured by a foreign note or its counter-scaled toolbar. The shared doc
    // still holds all 25 notes at distinct world positions.
    const ZOOM = 0.5;
    const gridX = (j: number) => 60 + j * 150;
    const gridY = (j: number) => 60 + j * 150;

    // Click a corner that is empty for every camera (own notes stay left/top).
    const deselect = async (page: Participant['page']) => {
      await page.mouse.click(1250, 40);
    };
    const createAt = async (page: Participant['page'], x: number, y: number): Promise<string> => {
      await deselect(page);
      await page.mouse.dblclick(x, y);
      const ta = page.locator('[data-testid="sticky-textarea"]').first();
      await ta.waitFor({ state: 'attached', timeout: 2000 });
      const id = await ta.evaluate((el) => (el.closest('[data-note-id]') as HTMLElement).dataset.noteId!);
      await deselect(page);
      return id;
    };

    try {
      const created = await Promise.all(
        parts.map(async (p, i) => {
          await p.page.evaluate(
            (cam) => window.__vidi6!.setCamera(cam),
            { x: -i * 5000, y: 0, zoom: ZOOM },
          );
          const own: string[] = [];
          for (let j = 0; j < 5; j++) own.push(await createAt(p.page, gridX(j), gridY(j)));
          return own;
        }),
      );
      const total = MAX_CONCURRENT_EDITORS * 5;
      for (const p of parts) await wide(async () => await noteCount(p.page)).toBe(total);

      await Promise.all(
        parts.map(async (p, i) => {
          for (let j = 0; j < created[i].length; j++) {
            await dragNoteBy(p.page, created[i][j], 20 + j * 8, 20 + j * 8, 2);
          }
        }),
      );

      const first = await boardSignature(parts[0].page);
      for (const p of parts) await wide(async () => await boardSignature(p.page)).toBe(first);
    } finally {
      await closeParticipants(parts);
    }
  });
});

test.describe('Workflow: Flaky Wi-Fi', () => {
  test('TC-27: Alex goes offline for the outage window, both add notes, reconnect reconciles to 6', async ({ browser }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 60_000);
    const [alex, sam] = await openParticipants(browser, newE2eBoardId(), 2);
    try {
      await alex.ctx.setOffline(true);

      for (let i = 0; i < 3; i++) {
        await createNoteByDblclick(alex.page, 150 + i * 230, 400);
        await clickEmptyCanvas(alex.page, 1250, 40);
      }
      for (let i = 0; i < 3; i++) {
        await createNoteByDblclick(sam.page, 700 + i * 190, 400);
        await clickEmptyCanvas(sam.page, 1250, 40);
      }

      // Stay offline long enough that the provider's 30 s watchdog times out its
      // unanswered ping and maps to the Reconnecting badge before we come back.
      await new Promise((r) => setTimeout(r, CATCH_UP_TEST_OUTAGE_MS));
      await wide(
        async () => alex.page.locator('[data-testid="connection-status"][data-state="reconnecting"]').count(),
      ).toBeGreaterThan(0);

      // Back online: Alex reconnects to a synced state and the boards reconcile to 6.
      await alex.ctx.setOffline(false);
      await alex.page.waitForFunction(
        () => {
          const s = (window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6?.connectionState;
          return s === 'connected' || s === 'confirmed';
        },
        undefined,
        { timeout: 30_000 },
      );
      await wide(async () => await noteCount(alex.page)).toBe(6);
      await wide(async () => await noteCount(sam.page)).toBe(6);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });
});

// --- local helpers ---

async function dragByStep(page: Page, id: string, dx: number, dy: number) {
  const box = await page.locator(`[data-testid="sticky-note-wrapper"][data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error('note box missing');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 2 });
  await page.mouse.up();
}
