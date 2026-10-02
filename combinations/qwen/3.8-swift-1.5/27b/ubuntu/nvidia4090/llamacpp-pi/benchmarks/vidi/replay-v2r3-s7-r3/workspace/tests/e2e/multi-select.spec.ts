import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { createBoard, openBoardInPage } from './helpers/board';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
  MAX_CONCURRENT_EDITORS,
  E2E_EVENTUAL_TIMEOUT_MS,
} from '../../src/shared/config';

/**
 * Story 7 E2E: select, move, resize and delete several objects at once.
 *
 * The default camera on a fresh board maps screen pixels 1:1 to world units
 * (origin, zoom 1). TC-33 works at zoom 0.5 so a 3×2 cluster plus the resize
 * drags all fit inside the 1280×800 viewport.
 */

async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  await page.evaluate((c) => (window as any).__vidi6.setCamera(c), cam);
  // The camera ref updates synchronously, but the React state (and hence the
  // rendered world layer + screen↔world conversions used by the UI) follows
  // one animation frame later. Wait for the rendered transform so that
  // subsequent clicks land where the UI expects.
  await page.waitForFunction(
    (z) => {
      const layer = document.querySelector('[data-testid="world-layer"]');
      return layer?.getAttribute('style')?.includes(`scale(${z})`) ?? false;
    },
    cam.zoom,
  );
}

function notes(page: Page): Locator {
  return page.locator('[data-testid^="sticky-note-"]');
}

/** Create a note centred on a screen point and exit edit mode. */
async function addNote(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
  await page.keyboard.press('Escape');
}

/** Shift+drag a marquee on the viewport in screen coordinates. */
async function marquee(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 3 });
  await page.mouse.move(x2, y2, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Drag on an element (note or handle) from its current centre to a delta. */
async function dragFrom(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 3 });
  await page.mouse.move(x + dx, y + dy, { steps: 3 });
  await page.mouse.up();
}

function expectClose(value: number, target: number, tol: number) {
  expect(Math.abs(value - target), `expected ${value} to be within ${tol} of ${target}`).toBeLessThanOrEqual(tol);
}

async function openBoard(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await openBoardInPage(page, boardId);
  return page;
}

test.describe('Story 7: multi-select (E2E)', () => {
  // TC-32 (also expected to pass in firefox/webkit)
  test('TC-32: Shift+drag marquee selects only the fully-inside note', async ({ page }) => {
    const boardId = await createBoard();
    await openBoardInPage(page, boardId);

    // A spans world 100..300, B 400..600, C 800..1000 (all y 100..300).
    await addNote(page, 200, 200); // A
    await addNote(page, 500, 200); // B
    await addNote(page, 900, 200); // C
    expect(await notes(page).count()).toBe(3);

    // Drop the create-and-edit selection (marquee is additive).
    await page.keyboard.press('Escape');

    // Marquee world rect (50,50)-(450,350): A fully inside, B half inside,
    // C outside.
    await marquee(page, 50, 50, 450, 350);

    const flags = await notes(page).evaluateAll((els) =>
      els.map((el) => ({
        selected: el.hasAttribute('data-selected'),
        x: el.getBoundingClientRect().x,
      })),
    );
    expect(flags.filter((f) => f.selected)).toHaveLength(1);
    // The selected one is A — the note at world (100,100), fully inside
    // (B at (400,100) is only half inside, C at (800,100) is outside).
    expectClose(flags.find((f) => f.selected)!.x, 100, 2);
    // A single sticky shows its NoteToolbar (not the multi-select bar).
    await expect(page.getByTestId('note-toolbar')).toBeVisible();
  });

  // TC-33
  test('TC-33: move a 6-note cluster 300 world units; se-resize scales proportionally; min size stops the shrink', async ({
    page,
  }) => {
    const boardId = await createBoard();
    await openBoardInPage(page, boardId);
    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });

    // 3×2 grid at zoom 0.5: world centres (200/500/800, 200/500).
    for (const cy of [100, 250]) {
      for (const cx of [100, 250, 400]) {
        await addNote(page, cx, cy);
      }
    }
    // A 7th note below the cluster (world centre (200,800)) that stays
    // unselected.
    await addNote(page, 100, 400);
    expect(await notes(page).count()).toBe(7);

    // Drop the create-and-edit selection (marquee is additive).
    await page.keyboard.press('Escape');

    // Marquee world (50,50)-(950,650) selects exactly the 6 grid notes.
    await marquee(page, 25, 25, 475, 325);
    const selCount = await notes(page).evaluateAll((els) =>
      els.filter((el) => el.hasAttribute('data-selected')).length,
    );
    expect(selCount).toBe(6);

    // Drag the top-left note (screen centre (100,100)) by 150 screen px =
    // 300 world units.
    const before = await notes(page).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, selected: el.hasAttribute('data-selected') };
      }),
    );
    await dragFrom(page, 100, 100, 150, 0);

    const afterMove = await notes(page).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, selected: el.hasAttribute('data-selected') };
      }),
    );
    // The 6 selected notes moved +150 screen px; the 7th (unselected) did
    // not. (DOM order is by id, so match on the selected flag.)
    const movedSel = afterMove.filter((n) => n.selected);
    const movedUnsel = afterMove.filter((n) => !n.selected);
    expect(movedSel).toHaveLength(6);
    expect(movedUnsel).toHaveLength(1);
    for (const n of movedSel) {
      const b = before.find((o) => o.selected && Math.abs(o.x - (n.x - 150)) < 5 && Math.abs(o.y - n.y) < 5);
      expect(b, 'pre-move counterpart of a selected note').toBeDefined();
      expectClose(n.x - (b as { x: number }).x, 150, 2);
      expectClose(n.y - (b as { y: number }).y, 0, 2);
    }
    const unselBefore = before.find((o) => !o.selected);
    expectClose(movedUnsel[0].x - (unselBefore as { x: number }).x, 0, 2);

    // The moved cluster now renders above the 7th (unselected) note.
    const zAll = await notes(page).evaluateAll((els) =>
      els.map((el) => ({
        selected: el.hasAttribute('data-selected'),
        z: parseInt(getComputedStyle(el).zIndex, 10),
      })),
    );
    const zSel = Math.min(...zAll.filter((n) => n.selected).map((n) => n.z));
    const zUnsel = Math.max(...zAll.filter((n) => !n.selected).map((n) => n.z));
    expect(zSel).toBeGreaterThan(zUnsel);

    // Selection bounding box is now screen (200..600, 50..300); the se
    // handle sits at (600,300). Drag it by (100,125) screen = (200,250)
    // world: the box scales by 1.25 (aspect-locked, width-driven).
    const se = page.getByLabel('Resize bottom-right');
    await expect(se).toBeVisible();
    const seBox0 = (await se.boundingBox())!;
    await dragFrom(page, seBox0.x + seBox0.width / 2, seBox0.y + seBox0.height / 2, 100, 125);

    const afterResize = await notes(page).evaluateAll((els) =>
      els
        .filter((el) => el.hasAttribute('data-selected'))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
    );
    // Every note scales 200→250 world = 100→125 screen and stays square.
    for (const n of afterResize) {
      expectClose(n.w, 125, 2);
      expectClose(n.h, 125, 2);
      expectClose(n.w - n.h, 0, 2);
    }
    // Gaps scale too: the horizontal gap between adjacent notes in the top
    // row goes from 100 world (50 screen) to 125 world (62.5 screen).
    const topRow = [...afterResize]
      .filter((n) => n.y < 100)
      .sort((a, b) => a.x - b.x);
    expectClose(topRow[1].x - (topRow[0].x + topRow[0].w), 62.5, 3);

    // Shrink: drag the se handle far past the minimum: the group stops at
    // STICKY_MIN_SIZE_WORLD (50 world = 25 screen), not at the requested
    // size. Start from the handle's current on-screen position.
    const seBox = (await se.boundingBox())!;
    const seCx = seBox.x + seBox.width / 2;
    const seCy = seBox.y + seBox.height / 2;
    await dragFrom(page, seCx, seCy, -425, 0);
    const afterMin = await notes(page).evaluateAll((els) =>
      els
        .filter((el) => el.hasAttribute('data-selected'))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height };
        }),
    );
    for (const n of afterMin) {
      expectClose(n.w, STICKY_MIN_SIZE_WORLD * 0.5, 2);
      expectClose(n.h, STICKY_MIN_SIZE_WORLD * 0.5, 2);
    }
  });

  // TC-34
  test('TC-34: arrow keys nudge the selection (×3 + one large), Delete removes it all', async ({
    page,
  }) => {
    const boardId = await createBoard();
    await openBoardInPage(page, boardId);
    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });

    for (const cy of [100, 250]) {
      for (const cx of [100, 250, 400]) {
        await addNote(page, cx, cy);
      }
    }
    expect(await notes(page).count()).toBe(6);

    // Select all.
    await page.keyboard.press('Control+a');
    await expect(page.getByTestId('selection-count')).toContainText('6 selected');

    const before = (await notes(page).first().boundingBox())!;
    const camBefore = await page.evaluate(() => (window as any).__vidi6.getCamera());

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');

    const after = (await notes(page).first().boundingBox())!;
    // 3×NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD world units = 13 world
    // = 6.5 screen px at zoom 0.5.
    const expected = (3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD) * 0.5;
    expectClose(after.x - before.x, expected, 1);
    expectClose(after.y - before.y, 0, 1);

    // The page did not scroll and the camera did not move.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const camAfter = await page.evaluate(() => (window as any).__vidi6.getCamera());
    expect(camAfter).toEqual(camBefore);

    // Delete removes the whole selection.
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(0);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });

  // TC-35
  test('TC-35: a colleague deletes one of my selected notes → selection prunes', async ({
    browser,
  }) => {
    const boardId = await createBoard();
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const me = await openBoard(ctx1, boardId);
    const colleague = await openBoard(ctx2, boardId);

    // Me: two notes, both selected.
    await addNote(me, 300, 300);
    await addNote(me, 700, 300);
    const a = notes(me).first();
    const b = notes(me).nth(1);
    await a.click();
    await b.click({ modifiers: ['Shift'] });
    await expect(me.getByTestId('selection-count')).toContainText('2 selected');

    const aTestId = (await a.getAttribute('data-testid'))!;

    // The colleague deletes A.
    await colleague.locator(`[data-testid="${aTestId}"]`).click();
    await colleague.keyboard.press('Delete');

    // Me: A disappears; the selection prunes to {B} → the single-note
    // toolbar replaces the multi-select bar.
    await expect(me.locator(`[data-testid="${aTestId}"]`)).toHaveCount(0, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    await expect(me.getByTestId('selection-bar')).toHaveCount(0);
    await expect(me.getByTestId('note-toolbar')).toBeVisible();

    await ctx1.close();
    await ctx2.close();
  });

  // TC-36
  test('TC-36: MAX_CONCURRENT_EDITORS contexts each move a different selection at the same time → identical final positions', async ({
    browser,
  }) => {
    const boardId = await createBoard();
    const contexts = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS }, () => browser.newContext()),
    );
    const pages = await Promise.all(
      contexts.map((ctx) => openBoard(ctx, boardId)),
    );

    // Each context creates its own note at a distinct spot.
    const ids: string[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const id = `tc36-${i}`;
      ids.push(id);
      await pages[i].evaluate(({ id, i }) => {
        const hook = (window as any).__VIDI_DEBUG__;
        const doc = hook.doc;
        const Y = (window as any).__VIDI_Y__;
        const objects = doc.getMap('objects');
        doc.transact(() => {
          objects.set(
            id,
            new Y.Map(
              Object.entries({
                id,
                type: 'sticky',
                x: 50 + i * 220,
                y: 100,
                color: 'yellow',
                text: new Y.Text(),
                z: i + 1,
                createdAt: Date.now(),
              }),
            ),
          );
        });
      }, { id, i });
    }

    // Wait until every context sees all five notes.
    await Promise.all(
      pages.map(
        (p) =>
          expect
            .poll(
              () => p.evaluate(() => (window as any).__VIDI_DEBUG__.doc.getMap('objects').size),
              { timeout: E2E_EVENTUAL_TIMEOUT_MS },
            )
            .toBe(MAX_CONCURRENT_EDITORS),
      ),
    );

    // Simultaneously: each context drags its OWN note by a distinct delta.
    await Promise.all(
      pages.map(async (p, i) => {
        const cx = 50 + i * 220 + STICKY_SIZE_WORLD / 2;
        const cy = 100 + STICKY_SIZE_WORLD / 2;
        await dragFrom(p, cx, cy, 40 + i * 10, 30 + i * 10);
      }),
    );

    // Every context must show the identical final positions (absolute writes
    // converge).
    await Promise.all(
      pages.map(async (p) => {
        await expect
          .poll(
            async () => {
              const pos = await p.evaluate((allIds) => {
                const objects = (window as any).__VIDI_DEBUG__.doc.getMap('objects');
                return allIds.map((id) => {
                  const m = objects.get(id);
                  return `${m.get('x')}:${m.get('y')}`;
                });
              }, ids);
              return pos.join('|');
            },
            { timeout: E2E_EVENTUAL_TIMEOUT_MS },
          )
          .toBe(
            ids
              .map((_, i) => `${50 + i * 220 + 40 + i * 10}:${100 + 30 + i * 10}`)
              .join('|'),
          );
      }),
    );

    await Promise.all(contexts.map((ctx) => ctx.close()));
  });
});
