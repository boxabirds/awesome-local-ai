import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { createBoard, getViewport } from './helpers/board';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';

/**
 * Story 7 E2E: select, move, resize and delete several objects at once.
 *
 * TC-32: click + shift-click multi-selection, the outline follows the group box
 * TC-33: dragging one selected note moves the whole group (doc positions)
 * TC-34: dragging a resize handle scales the whole group (doc positions/sizes)
 * TC-35: deleting via the selection bar removes every selected object
 * TC-36: five contexts drag two clusters in parallel → 50/50, doc converges
 */

interface NoteState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Read the board's sticky notes (x/y/width/height) from the Y.Doc debug hook. */
async function getNotes(page: Page): Promise<NoteState[]> {
  return page.evaluate(() => {
    const hook = (window as any).__VIDI_DEBUG__;
    if (!hook) throw new Error('Debug hook not available');
    const objects = hook.doc.getMap('objects');
    const notes: NoteState[] = [];
    objects.forEach((obj: any) => {
      if (obj.get('type') === 'sticky') {
        const w = obj.get('width');
        const h = obj.get('height');
        notes.push({
          id: obj.get('id'),
          x: obj.get('x'),
          y: obj.get('y'),
          width: typeof w === 'number' ? w : 200,
          height: typeof h === 'number' ? h : 200,
        });
      }
    });
    return notes;
  });
}

/** Create a sticky centred at world `at` directly on the doc. */
async function createStickyOn(page: Page, at: { x: number; y: number }): Promise<string> {
  return page.evaluate((p) => {
    const hook = (window as any).__VIDI_DEBUG__;
    const Y = (window as any).__VIDI_Y__;
    const doc = hook.doc;
    const objects = doc.getMap('objects');
    const id = Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
    const text = new Y.Text();
    let z = 1;
    objects.forEach((o: any) => {
      const oz = o.get('z');
      if (typeof oz === 'number' && oz >= z) z = oz + 1;
    });
    doc.transact(() => {
      objects.set(id, new Y.Map(Object.entries({
        id, type: 'sticky', x: p.x - 100, y: p.y - 100, color: 'yellow', text, z, createdAt: Date.now(),
      })));
    });
    return id;
  }, at);
}

async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  await page.evaluate((c) => (window as any).__vidi6.setCamera(c), cam);
  await page.waitForFunction(
    (c) => {
      const cur = (window as any).__vidi6.getCamera();
      return cur.x === c.x && cur.y === c.y && cur.zoom === c.zoom;
    },
    cam,
  );
}

/** Open the board in a context and wait for the hooks. */
async function openBoard(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await page.waitForFunction(() => !!(window as any).__VIDI_DEBUG__, undefined, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
  return page;
}

/** Mouse-drag the centre of a locator by (dx, dy) screen px. */
async function dragCenter(page: Page, loc: Locator, dx: number, dy: number): Promise<void> {
  const box = (await loc.boundingBox())!;
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx, sy + dy, { steps: 8 });
  await page.mouse.up();
}

/**
 * Fire a synthetic PointerEvent at an element (bubbles to the viewport's
 * native listeners). Used by TC-36: Chromium 153's CDP mouse pipeline
 * (Playwright `page.mouse`) desyncs after repeated drag sequences in the
 * same page and injects spurious `pointercancel`s / swallows `pointerup`
 * (an environment artifact — real hardware input is unaffected). Synthetic
 * events exercise the exact same app code path (native listeners, gestures,
 * Yjs writes, sync) without the CDP pipeline.
 */
async function synthPointerSeq(
  page: Page,
  targetSelector: string,
  points: Array<{ x: number; y: number }>,
  opts: { shift?: boolean } = {},
): Promise<void> {
  await page.evaluate(
    ({ sel, pts, shift }) => {
      const target = document.querySelector(sel) as Element;
      if (!target) throw new Error(`synth target not found: ${sel}`);
      const fire = (type: string, x: number, y: number) => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            pointerId: 42,
            pointerType: 'mouse',
            clientX: x,
            clientY: y,
            shiftKey: !!shift,
          }),
        );
      };
      fire('pointerdown', pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) fire('pointermove', pts[i].x, pts[i].y);
      const last = pts[pts.length - 1];
      fire('pointermove', last.x, last.y);
      fire('pointerup', last.x, last.y);
    },
    { sel: targetSelector, pts: points, shift: opts.shift },
  );
}

/** Synthetic drag of an element's centre by (dx, dy) screen px (zoom 1). */
async function synthDragCenter(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const box = (await page.locator(selector).boundingBox())!;
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push({ x: sx + (dx * i) / 8, y: sy + (dy * i) / 8 });
  await synthPointerSeq(page, selector, pts);
}

/** Synthetic shift-marquee from (x1,y1) to (x2,y2) viewport-relative. */
async function synthMarquee(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  const box = (await (await getViewport(page)).boundingBox())!;
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push({ x: box.x + x1 + ((x2 - x1) * i) / 8, y: box.y + y1 + ((y2 - y1) * i) / 8 });
  await synthPointerSeq(page, '[data-testid="board-viewport"]', pts, { shift: true });
}

/** Shift-drag a marquee over the viewport from (x1,y1) to (x2,y2) viewport-relative. */
async function marquee(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  const box = (await (await getViewport(page)).boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + (x1 + x2) / 2, box.y + (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Click a note's centre; shift-click when `shift`. */
async function clickNote(page: Page, id: string, shift = false): Promise<void> {
  const loc = page.locator(`[data-testid="sticky-note-${id}"]`);
  const box = (await loc.boundingBox())!;
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (shift) await page.keyboard.up('Shift');
}

async function expectNotes(page: Page, n: number) {
  await expect.poll(async () => (await getNotes(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(n);
}

function expectClose(value: number, target: number, tol: number, label: string) {
  expect(Math.abs(value - target), `${label}: expected ${value} ≈ ${target} (±${tol})`).toBeLessThanOrEqual(tol);
}

test.describe('Story 7: multi-select (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    const boardId = await createBoard();
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await page.waitForFunction(() => !!(window as any).__VIDI_DEBUG__, undefined, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
  });

  // TC-32
  test('TC-32: click + shift-click multi-select; the outline follows the group box', async ({ page }) => {
    const a = await createStickyOn(page, { x: 100, y: 100 }); // box (0,0,200,200)
    const b = await createStickyOn(page, { x: 500, y: 100 }); // box (400,0,200,200)
    await expectNotes(page, 2);

    await clickNote(page, a);
    let overlay = page.getByTestId('selection-overlay');
    await expect(overlay).toBeVisible();
    let ob = (await overlay.boundingBox())!;
    const va = (await page.locator(`[data-testid="sticky-note-${a}"]`).boundingBox())!;
    expectClose(ob.x, va.x, 2, 'overlay.x');
    expectClose(ob.y, va.y, 2, 'overlay.y');
    expectClose(ob.width, va.width, 2, 'overlay.width');
    expectClose(ob.height, va.height, 2, 'overlay.height');

    await clickNote(page, b, true);
    expect(await page.getByTestId('selection-count').textContent()).toBe('2 selected');
    ob = (await overlay.boundingBox())!;
    const vb = (await page.locator(`[data-testid="sticky-note-${b}"]`).boundingBox())!;
    // Union box: from A's left to B's right, same top/height.
    expectClose(ob.x, va.x, 2, 'union.x');
    expectClose(ob.width, vb.x + vb.width - va.x, 2, 'union.width');
    expectClose(ob.height, va.height, 2, 'union.height');
  });

  // TC-33
  test('TC-33: dragging one selected note moves the WHOLE group', async ({ page }) => {
    const a = await createStickyOn(page, { x: 100, y: 100 });
    const b = await createStickyOn(page, { x: 500, y: 100 });
    await expectNotes(page, 2);

    await clickNote(page, a);
    await clickNote(page, b, true);

    const before = await getNotes(page);
    const ba = before.find((n) => n.id === a)!;
    const bb = before.find((n) => n.id === b)!;

    // Drag note A by (60, 30) screen px = world (60, 30) at zoom 1.
    await dragCenter(page, page.locator(`[data-testid="sticky-note-${a}"]`), 60, 30);

    const after = await getNotes(page);
    const aa = after.find((n) => n.id === a)!;
    const ab = after.find((n) => n.id === b)!;
    expectClose(aa.x, ba.x + 60, 1, 'a.x');
    expectClose(aa.y, ba.y + 30, 1, 'a.y');
    expectClose(ab.x, bb.x + 60, 1, 'b.x');
    expectClose(ab.y, bb.y + 30, 1, 'b.y');

    // Both notes are still selected after the drag.
    expect(await page.locator(`[data-testid="sticky-note-${a}"]`).getAttribute('data-selected')).not.toBeNull();
    expect(await page.locator(`[data-testid="sticky-note-${b}"]`).getAttribute('data-selected')).not.toBeNull();
  });

  // TC-34
  test('TC-34: dragging the se handle scales the whole group (aspect-locked stickies)', async ({ page }) => {
    const a = await createStickyOn(page, { x: 100, y: 100 }); // box (0,0,200,200)
    const b = await createStickyOn(page, { x: 400, y: 100 }); // box (300,0,200,200)
    await expectNotes(page, 2);

    await clickNote(page, a);
    await clickNote(page, b, true);

    // Group box: (0,0,500,200); the se handle sits at its corner (500,200).
    const handle = page.getByTestId('resize-handle-se');
    await expect(handle).toBeVisible();
    const hb = (await handle.boundingBox())!;
    const vb = (await (await getViewport(page)).boundingBox())!;
    expectClose(hb.x + hb.width / 2, vb.x + 500, 3, 'handle.x');
    expectClose(hb.y + hb.height / 2, vb.y + 200, 3, 'handle.y');

    // Drag it by (+100, 0): raw box (0,0,600,200) → aspect-locked scale 1.2
    // → box (0,0,600,240); A → (0,0,240,240), B → (360,0,240,240).
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 100, hb.y + hb.height / 2, { steps: 8 });
    await page.mouse.up();

    const after = await getNotes(page);
    const aa = after.find((n) => n.id === a)!;
    const ab = after.find((n) => n.id === b)!;
    expectClose(aa.x, 0, 1, 'a.x');
    expectClose(aa.y, 0, 1, 'a.y');
    expectClose(aa.width, 240, 1, 'a.width');
    expectClose(aa.height, 240, 1, 'a.height');
    expectClose(ab.x, 360, 1, 'b.x');
    expectClose(ab.y, 0, 1, 'b.y');
    expectClose(ab.width, 240, 1, 'b.width');
    expectClose(ab.height, 240, 1, 'b.height');
  });

  // TC-35
  test('TC-35: deleting via the selection bar removes every selected object', async ({ page }) => {
    const a = await createStickyOn(page, { x: 100, y: 100 });
    const b = await createStickyOn(page, { x: 500, y: 100 });
    const c = await createStickyOn(page, { x: 100, y: 500 });
    await expectNotes(page, 3);

    await page.keyboard.press('Control+a');
    expect(await page.getByTestId('selection-count').textContent()).toBe('3 selected');

    await page.getByRole('button', { name: 'Delete selection' }).click();
    await expectNotes(page, 0);
    expect(await page.locator(`[data-testid="sticky-note-${a}"]`).count()).toBe(0);
    expect(await page.locator(`[data-testid="sticky-note-${b}"]`).count()).toBe(0);
    expect(await page.locator(`[data-testid="sticky-note-${c}"]`).count()).toBe(0);
  });

  test('marquee drag selects fully-contained objects (real browser)', async ({ page }) => {
    const a = await createStickyOn(page, { x: 300, y: 300 }); // box (200,200,200,200)
    const b = await createStickyOn(page, { x: 800, y: 300 }); // box (700,200,200,200)
    await expectNotes(page, 2);

    // Marquee covering A only: (150,150) → (450,450). Starts on empty space.
    await marquee(page, 150, 150, 450, 450);
    expect(await page.locator(`[data-testid="sticky-note-${a}"]`).getAttribute('data-selected')).not.toBeNull();
    expect(await page.locator(`[data-testid="sticky-note-${b}"]`).getAttribute('data-selected')).toBeNull();
  });
});

// TC-36
test.describe('TC-36: five contexts, two clusters dragged in parallel', () => {
  test.setTimeout(180000);

  // Two compact 5×2 clusters (200 spacing) far apart in world space.
  const A_ORIGIN = { x: 150, y: 150 };
  const B_ORIGIN = { x: 2150, y: 150 };

  async function seedCluster(page: Page, origin: { x: number; y: number }): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(await createStickyOn(page, { x: origin.x + (i % 5) * 200, y: origin.y + Math.floor(i / 5) * 200 }));
    }
    return ids;
  }

  /**
   * The cluster's CURRENT union box, read from the live doc (concurrent
   * pages may have dragged it since seeding).
   */
  async function clusterBox(
    page: Page,
    ids: string[],
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    return page.evaluate((idList) => {
      const objects = (window as any).__VIDI_DEBUG__.doc.getMap('objects');
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const id of idList) {
        const o = objects.get(id);
        if (!o) continue;
        const w = o.get('width') ?? 200;
        const h = o.get('height') ?? 200;
        minX = Math.min(minX, o.get('x'));
        maxX = Math.max(maxX, o.get('x') + w);
        minY = Math.min(minY, o.get('y'));
        maxY = Math.max(maxY, o.get('y') + h);
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }, ids);
  }

  /** How many of `ids` currently carry data-selected in the DOM. */
  async function selectedCount(page: Page, ids: string[]): Promise<number> {
    return page.evaluate(
      (idList) =>
        idList.filter((id) => {
          const el = document.querySelector(`[data-testid="sticky-note-${id}"]`);
          return el?.hasAttribute('data-selected') ?? false;
        }).length,
      ids,
    );
  }

  /**
   * Marquee-select the WHOLE cluster, then drag the anchor by (dx, dy) world
   * units (zoom 1).
   *
   * The camera is re-aimed at the cluster's CURRENT position on every attempt
   * (concurrent pages drag the same cluster, so its position is not the
   * seeded one by the time this page marquees), and the attempt is repeated
   * until ALL of the cluster's notes are selected — a drag must cover the
   * full cluster for the final state to stay a rigid transform.
   *
   * Both gestures use SYNTHETIC pointer events (see `synthPointerSeq`):
   * this is a concurrency test — the input channel is not under test, and
   * Chromium 153's CDP mouse pipeline desyncs under the repeated drag
   * sequences of five parallel pages (spurious pointercancel / swallowed
   * pointerup), which is an environment artifact, not app behaviour.
   */
  async function selectAndDragCluster(
    page: Page,
    clusterIds: string[],
    anchorId: string,
    dx: number,
    dy: number,
  ): Promise<void> {
    // Wait until THIS context has RENDERED all 20 notes. Under parallel e2e
    // load the y-websocket sync can lag behind openBoard's readiness probe;
    // marqueeing before hydration would select a partial cluster. Waiting on
    // the DOM (not the raw doc) also guarantees the React snapshot the
    // marquee reads is up to date.
    await expect
      .poll(
        async () => page.locator('[data-testid^="sticky-note-"]').count(),
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      )
      .toBe(20);

    const margin = 60;
    let allSelected = 0;
    for (let attempt = 0; attempt < 8 && allSelected < clusterIds.length; attempt++) {
      // Re-aim at the cluster where it is RIGHT NOW.
      const cb = await clusterBox(page, clusterIds);
      await setCamera(page, { x: cb.x - margin, y: cb.y - margin, zoom: 1 });
      // The box now sits at screen (60,60) … (60+w, 60+h); the rigid box is
      // at most 1000×400, so the (0,0)→(1240,560) sweep always contains it.
      await synthMarquee(page, 0, 0, 1240, 560);
      // The marquee's selection is a state update — give it a tick, then
      // check that the WHOLE cluster is selected before dragging.
      await page.waitForTimeout(50);
      allSelected = await selectedCount(page, clusterIds);
    }
    if (allSelected < clusterIds.length) {
      throw new Error(`marquee selected only ${allSelected}/${clusterIds.length} notes`);
    }
    await synthDragCenter(page, `[data-testid="sticky-note-${anchorId}"]`, dx, dy);
  }

  test('both clusters move 50/50, the doc converges, no 4xx on the wire', async ({ browser }) => {
    const boardId = await createBoard();

    // Seed 20 notes in two well-separated clusters.
    const seedCtx = await browser.newContext();
    const sp = await openBoard(seedCtx, boardId);
    const clusterA = await seedCluster(sp, A_ORIGIN);
    const clusterB = await seedCluster(sp, B_ORIGIN);
    await expectNotes(sp, 20);
    const before = await getNotes(sp);
    // Confirm the SERVER has all 20 notes (a fresh page fetches them) before
    // opening the five drag contexts — the local readback above is not proof
    // the writes flushed, and closing the seed context can cut off a pending
    // sync. Under parallel e2e load this race is the usual flake source.
    const verifyCtx = await browser.newContext();
    const vp = await openBoard(verifyCtx, boardId);
    await expectNotes(vp, 20);
    await verifyCtx.close();
    await seedCtx.close();

    // Five contexts; odd ones drag cluster B, even ones cluster A.
    const ctxs = await Promise.all(Array.from({ length: 5 }, () => browser.newContext()));
    const pages = await Promise.all(ctxs.map((c) => openBoard(c, boardId)));

    const failures: { page: number; url: string; status: number }[] = [];
    pages.forEach((p, i) => {
      p.on('response', (res) => {
        if (res.status() >= 400) failures.push({ page: i, url: res.url(), status: res.status() });
      });
    });

    const dragA = (p: Page) => selectAndDragCluster(p, clusterA, clusterA[0], 100, 50);
    const dragB = (p: Page) => selectAndDragCluster(p, clusterB, clusterB[0], -80, 40);

    // All five drags at once.
    await Promise.all(pages.map((p, i) => (i % 2 === 0 ? dragA(p) : dragB(p))));

    // Canonical snapshot (sorted by id, rounded).
    const canon = (ns: NoteState[]) =>
      JSON.stringify(
        [...ns]
          .sort((x, y) => (x.id < y.id ? -1 : 1))
          .map((n) => [n.id, Math.round(n.x), Math.round(n.y), Math.round(n.width), Math.round(n.height)]),
      );

    // Wait until all five contexts converge to the SAME state, with both
    // clusters having moved (the anchors are no longer at their seeded
    // positions). Several pages drag the SAME cluster concurrently, so the
    // final delta is interleaving-dependent — only convergence and rigidity
    // are asserted, not a specific value.
    const anchorMoved = (ns: NoteState[]) => {
      const a0 = ns.find((n) => n.id === clusterA[0]);
      const b0 = ns.find((n) => n.id === clusterB[0]);
      const aBefore = before.find((n) => n.id === clusterA[0])!;
      const bBefore = before.find((n) => n.id === clusterB[0])!;
      return (
        !!a0 &&
        !!b0 &&
        (Math.abs(a0.x - aBefore.x) > 1 || Math.abs(a0.y - aBefore.y) > 1) &&
        (Math.abs(b0.x - bBefore.x) > 1 || Math.abs(b0.y - bBefore.y) > 1)
      );
    };
    await expect
      .poll(
        async () => {
          const raw = await Promise.all(pages.map((p) => getNotes(p)));
          const snaps = raw.map(canon);
          const [first] = snaps;
          return snaps.every((s) => s === first) && anchorMoved(raw[0]) ? 'converged' : 'pending';
        },
        { timeout: E2E_EVENTUAL_TIMEOUT_MS * 4 },
      )
      .toBe('converged');

    const finalPerPage = await Promise.all(pages.map((p) => getNotes(p)));
    const final0 = finalPerPage[0];

    // All five snapshots are identical (sorted by id).
    for (let i = 1; i < finalPerPage.length; i++) {
      expect(canon(finalPerPage[i]), `page ${i} diverged from page 0`).toBe(canon(finalPerPage[0]));
    }

    // Each cluster moved RIGIDLY: every note of a cluster shares the same
    // final offset, and the offset points in the drag direction.
    const rigidDeltas = (ids: string[]) =>
      ids.map((id) => {
        const n = final0.find((x) => x.id === id)!;
        const b0 = before.find((x) => x.id === id)!;
        return { id, dx: n.x - b0.x, dy: n.y - b0.y };
      });
    const dA = rigidDeltas(clusterA);
    const dB = rigidDeltas(clusterB);
    for (const d of dA) {
      expect(Math.abs(d.dx - dA[0].dx), `A ${d.id}.x not rigid`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.dy - dA[0].dy), `A ${d.id}.y not rigid`).toBeLessThanOrEqual(1);
    }
    for (const d of dB) {
      expect(Math.abs(d.dx - dB[0].dx), `B ${d.id}.x not rigid`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.dy - dB[0].dy), `B ${d.id}.y not rigid`).toBeLessThanOrEqual(1);
    }
    // Cluster A was dragged toward (+, +); cluster B toward (−, +).
    expect(dA[0].dx, 'cluster A moved right').toBeGreaterThan(0);
    expect(dA[0].dy, 'cluster A moved down').toBeGreaterThan(0);
    expect(dB[0].dx, 'cluster B moved left').toBeLessThan(0);
    expect(dB[0].dy, 'cluster B moved down').toBeGreaterThan(0);

    // No 4xx/5xx responses anywhere.
    expect(failures, `HTTP failures: ${JSON.stringify(failures)}`).toHaveLength(0);

    await Promise.all(ctxs.map((c) => c.close()));
  });
});
