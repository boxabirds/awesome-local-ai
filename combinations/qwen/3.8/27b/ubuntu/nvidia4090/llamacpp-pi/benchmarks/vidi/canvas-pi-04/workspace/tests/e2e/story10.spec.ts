// Story 10, e2e (TC-23..TC-27): draw a flow, collaborative rearrange,
// delete race. Runs against `wrangler dev`; all browsers (TC-23..TC-24 are
// the single-browser ones, TC-25..TC-27 use two participants).

import { expect, test } from '@playwright/test';
import {
  newBoard,
  openParticipant,
  openParticipantWith,
  closeParticipant,
  expectWithin,
  type Participant,
} from './participants';
import { setCamera } from './helpers/board';
import {
  SHAPE,
  CONNECTOR,
  seedFlow,
  flowCount,
  waitForViewport,
  dragShapeDraw,
  clickShape,
  dragConnector,
  shapeCount,
  connectorCount,
  selectedShapeId,
  selectedConnectorId,
  shapeWorld,
  connectorEnds,
  dragShape,
  editShapeLabel,
  labelLayout,
} from './helpers/story10';
import type { BrowserContext } from '@playwright/test';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';

// Camera with the origin at the viewport origin (world = screen).
const ZOOM1 = { x: 0, y: 0, zoom: 1 };
const ZOOM2 = { x: 0, y: 0, zoom: 2 };

/**
 * TC-27's "route delay on Sam's WebSocket traffic": buffer Sam's OUTBOUND
 * websocket frames client-side until the test flushes them. Inbound frames
 * (the room's broadcasts) are unaffected, so Sam still receives Dana's
 * create before his delete is let through — the exact overlap the race
 * needs, deterministically.
 */
function installWsSendHold(context: BrowserContext): void {
  void context.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__holdWsSend = false;
    const Orig = window.WebSocket;
    const tracked: { ws: WebSocket; frames: unknown[] }[] = [];
    const WS = function (this: unknown, ...args: unknown[]) {
      const ws = new (Orig as new (...a: unknown[]) => WebSocket)(...args);
      const origSend = ws.send.bind(ws);
      const frames: unknown[] = [];
      tracked.push({ ws, frames });
      ws.send = (data: unknown) => {
        if (w.__holdWsSend === true) {
          frames.push(data);
          return;
        }
        origSend(data as BlobPart);
      };
      return ws;
    };
    (WS as unknown as { prototype: WebSocket }).prototype = Orig.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const) {
      (WS as unknown as Record<string, unknown>)[k] = (Orig as unknown as Record<string, unknown>)[k];
    }
    window.WebSocket = WS as unknown as typeof WebSocket;
    w.__flushWsSend = () => {
      w.__holdWsSend = false;
      for (const { ws, frames } of tracked) {
        for (const frame of frames.splice(0)) {
          ws.send(frame as BlobPart);
        }
      }
    };
  });
}

/** Collect page errors and console errors on both participants. */
function captureErrors(dana: Participant, sam: Participant): Record<'dana' | 'sam', string[]> {
  const errors: Record<'dana' | 'sam', string[]> = { dana: [], sam: [] };
  const track = (who: 'dana' | 'sam', page: Participant['page']): void => {
    page.on('pageerror', (err) => {
      errors[who].push(`pageerror: ${err.message}`);
    });
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' && !text.includes('Failed to load resource')) {
        errors[who].push(text);
      }
    });
  };
  track('dana', dana.page);
  track('sam', sam.page);
  return errors;
}

/** Wait until both participants render the seeded flow (4 shapes, 4 arrows). */
async function waitForFlowOnBoth(dana: Participant, sam: Participant): Promise<void> {
  for (const p of [dana.page, sam.page]) {
    await waitForViewport(p);
    await expect(p.locator(SHAPE)).toHaveCount(4, { timeout: 15_000 });
    await expect(p.locator(CONNECTOR)).toHaveCount(4, { timeout: 15_000 });
  }
  await setCamera(dana.page, ZOOM1);
  await setCamera(sam.page, ZOOM1);
}

test.describe('story 10 e2e (TC-23..TC-27)', () => {
  test('TC-23: S-tool drag draws a 200x120 shape at the dragged position', async ({ page, baseURL }) => {
    test.slow();
    const boardId = await newBoard(baseURL!);
    await page.goto(`/b/${boardId}`);
    await setCamera(page, ZOOM1);
    await waitForViewport(page);

    await dragShapeDraw(page, ZOOM1, 100, 100, 300, 220);
    await expect(page.locator(SHAPE)).toHaveCount(1, { timeout: 10_000 });
    const id = await selectedShapeId(page);
    expect(id).not.toBeNull();

    const w = await shapeWorld(page, id!);
    expect(w.x).toBeGreaterThanOrEqual(99);
    expect(w.x).toBeLessThanOrEqual(101);
    expect(w.y).toBeGreaterThanOrEqual(99);
    expect(w.y).toBeLessThanOrEqual(101);
    expect(w.w).toBeGreaterThanOrEqual(199);
    expect(w.w).toBeLessThanOrEqual(201);
    expect(w.h).toBeGreaterThanOrEqual(119);
    expect(w.h).toBeLessThanOrEqual(121);
    expect(w.kind).toBe('rect');

    // Creation returned the tool to Select.
    await expect(page.locator('[data-testid="board-viewport"].is-drawing-tool')).toHaveCount(0);
  });

  test('TC-24: 200%-zoom Diamond click is 160x160 centred; long label wraps, stays centred after resize', async ({ page, baseURL }) => {
    test.slow();
    const boardId = await newBoard(baseURL!);
    await page.goto(`/b/${boardId}`);
    await setCamera(page, ZOOM2);
    await waitForViewport(page);

    await clickShape(page, ZOOM2, 'Diamond', 100, 75);
    await expect(page.locator(SHAPE)).toHaveCount(1, { timeout: 10_000 });
    const id = await selectedShapeId(page);
    expect(id).not.toBeNull();

    // 160x160 centred on the click (world 100,75).
    const w = await shapeWorld(page, id!);
    expect(w.kind).toBe('diamond');
    expect(w.w).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 0);
    expect(w.h).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 0);
    expect(w.x + w.w / 2).toBeCloseTo(100, 0);
    expect(w.y + w.h / 2).toBeCloseTo(75, 0);

    // A label longer than the shape width wraps to several lines, centred.
    await editShapeLabel(page, id!, 'Authorisation and payment capture');
    await expect
      .poll(
        async () => (await labelLayout(page, id!)).lines,
        { timeout: 10_000, message: 'the long label wraps to more than one line' },
      )
      .toBeGreaterThanOrEqual(2);
    let layout = await labelLayout(page, id!);
    expect(Math.abs(layout.midX - layout.shapeMidX)).toBeLessThanOrEqual(2);
    expect(Math.abs(layout.midY - layout.shapeMidY)).toBeLessThanOrEqual(2);

    // Resize via the SE handle (narrower + shorter); the label stays
    // centred on the (new) shape.
    const handle = page.locator('[aria-label="Resize se"]');
    const hb = await handle.boundingBox();
    if (hb === null) throw new Error('SE handle has no bounding box');
    const hx = hb.x + hb.width / 2;
    const hy = hb.y + hb.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx - 40 * ZOOM2.zoom, hy - 30 * ZOOM2.zoom, { steps: 12 });
    await page.mouse.up();
    const after = await shapeWorld(page, id!);
    expect(after.w).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD - 40, 0);
    expect(after.h).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD - 30, 0);

    layout = await labelLayout(page, id!);
    expect(layout.lines).toBeGreaterThanOrEqual(2);
    expect(Math.abs(layout.midX - layout.shapeMidX)).toBeLessThanOrEqual(2);
    expect(Math.abs(layout.midY - layout.shapeMidY)).toBeLessThanOrEqual(2);
  });

  test('TC-25 + TC-26: the arrow follows a remote move, then survives a remote delete', async ({ browser, baseURL }) => {
    test.slow();
    const boardId = await newBoard(baseURL!);
    const dana = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      const seeded = await seedFlow(baseURL!, boardId);
      const A = seeded.shapes.checkout;
      const B = seeded.shapes.auth;
      const [cCheckoutToAuth, cAuthToPayment, cPaymentToConfirm, cFree] = seeded.connectors;
      await waitForFlowOnBoth(dana, sam);

      // TC-25: Dana connects checkout -> authorize (a second arrow between
      // the pair) and drags authorize PAST checkout (its centre crosses
      // to the left of checkout's centre).
      await dragConnector(dana.page, ZOOM1, 260, 160, 400, 160);
      await expect(dana.page.locator(CONNECTOR)).toHaveCount(5);
      const arrow = await selectedConnectorId(dana.page);
      expect(arrow).not.toBeNull();
      await expectWithin(
        () => connectorCount(sam.page),
        5,
      );

      await dragShape(dana.page, B, -400, 0, ZOOM1.zoom);
      // Authorize is now at (0,100,160,120); the arrow re-anchors on the
      // switched sides: checkout left (100,160) -> authorize right (160,160).
      await expectWithin(
        async () => connectorEnds(dana.page, arrow!),
        { x1: 100, y1: 160, x2: 160, y2: 160 },
      );
      await expectWithin(
        async () => connectorEnds(sam.page, arrow!),
        { x1: 100, y1: 160, x2: 160, y2: 160 },
      );

      // TC-26: Sam deletes authorize. Both arrows that touched it survive
      // with a FREE end where authorize's side was; the other arrows are
      // untouched.
      await sam.page.locator(`${SHAPE}[data-shape-id="${B}"]`).click();
      await sam.page.keyboard.press('Delete');
      await expect(sam.page.locator(`${SHAPE}[data-shape-id="${B}"]`)).toHaveCount(0);
      await expectWithin(
        () => shapeCount(dana.page),
        3,
      );
      for (const p of [dana.page, sam.page]) {
        await expect(p.locator(CONNECTOR)).toHaveCount(5);
      }

      // Dana moves checkout: her arrow's free end stays put while the
      // attached end follows — proof the delete left a free end (an
      // orphaned attached end would render at the attach-time fallback
      // (400,160) instead of following the move's geometry).
      await dragShape(dana.page, A, 300, 0, ZOOM1.zoom);
      const expected = {
        danaArrow: { x1: 400, y1: 160, x2: 160, y2: 160 }, // A left -> free (160,160)
        c0: { x1: 400, y1: 160, x2: 160, y2: 160 }, // checkout -> free (auth's side)
        c1: { x1: 160, y1: 160, x2: 700, y2: 160 }, // free (auth's right side at delete time) -> payment
        c2: { x1: 780, y1: 220, x2: 480, y2: 400 }, // payment -> confirm (untouched)
        c3: { x1: 940, y1: 460, x2: 560, y2: 460 }, // free -> confirm (untouched)
      };
      for (const p of [dana.page, sam.page]) {
        await expectWithin(async () => connectorEnds(p, arrow!), expected.danaArrow);
        await expectWithin(async () => connectorEnds(p, cCheckoutToAuth), expected.c0);
        await expectWithin(async () => connectorEnds(p, cAuthToPayment), expected.c1);
        await expectWithin(async () => connectorEnds(p, cPaymentToConfirm), expected.c2);
        await expectWithin(async () => connectorEnds(p, cFree), expected.c3);
      }

      const flow = await flowCount(baseURL!, boardId);
      expect(flow).toEqual({ shapes: 3, connectors: 5, other: 0 });
    } finally {
      await closeParticipant(dana);
      await closeParticipant(sam);
    }
  });

  test('TC-27: Dana connects to B while Sam deletes B — the arrow survives at the fallback, no errors', async ({ browser, baseURL }) => {
    test.slow();
    const boardId = await newBoard(baseURL!);
    const dana = await openParticipant(browser, boardId);
    const sam = await openParticipantWith(browser, boardId, (context) => {
      installWsSendHold(context);
    });
    try {
      const errors = captureErrors(dana, sam);
      const seeded = await seedFlow(baseURL!, boardId);
      const A = seeded.shapes.checkout;
      const B = seeded.shapes.auth;
      await waitForFlowOnBoth(dana, sam);

      // Hold Sam's outbound frames: his delete will apply locally but stay
      // buffered until the test releases it.
      await sam.page.evaluate(() => {
        (window as unknown as { __holdWsSend: boolean }).__holdWsSend = true;
      });

      // Dana drags a new arrow from checkout's right anchor onto
      // authorize's left anchor.
      await dragConnector(dana.page, ZOOM1, 260, 160, 400, 160);
      await expect(dana.page.locator(CONNECTOR)).toHaveCount(5);
      const arrow = await selectedConnectorId(dana.page);
      expect(arrow).not.toBeNull();
      // The room applied the create: Sam's screen shows the new arrow.
      await expect(sam.page.locator(CONNECTOR)).toHaveCount(5, { timeout: 15_000 });
      const danaArrowBefore = await connectorEnds(dana.page, arrow!);
      expect(danaArrowBefore).toEqual({ x1: 260, y1: 160, x2: 400, y2: 160 });

      // Sam deletes authorize: locally it is gone (and his local detach ran),
      // but the update is still buffered — Dana still sees the arrow attached.
      await sam.page.locator(`${SHAPE}[data-shape-id="${B}"]`).click();
      await sam.page.keyboard.press('Delete');
      await expect(sam.page.locator(`${SHAPE}[data-shape-id="${B}"]`)).toHaveCount(0);
      await expect(dana.page.locator(`${SHAPE}[data-shape-id="${B}"]`)).toHaveCount(1);
      expect(await connectorEnds(dana.page, arrow!)).toEqual({ x1: 260, y1: 160, x2: 400, y2: 160 });

      // Release Sam's delete: the room applies it (delete + detach in one
      // transaction) and relays it to Dana.
      await sam.page.evaluate(() => {
        (window as unknown as { __flushWsSend: () => void }).__flushWsSend();
      });
      await expectWithin(() => shapeCount(dana.page), 3);
      for (const p of [dana.page, sam.page]) {
        await expect(p.locator(`${SHAPE}[data-shape-id="${B}"]`)).toHaveCount(0);
        await expect(p.locator(CONNECTOR)).toHaveCount(5);
      }
      // Dana's arrow is visible, with its end at the attach-time fallback
      // (400,160) — exactly where it was drawn.
      await expectWithin(
        async () => connectorEnds(dana.page, arrow!),
        { x1: 260, y1: 160, x2: 400, y2: 160 },
      );
      await expectWithin(
        async () => connectorEnds(sam.page, arrow!),
        { x1: 260, y1: 160, x2: 400, y2: 160 },
      );

      expect(errors.dana, `Dana's console: ${errors.dana.join(' | ')}`).toEqual([]);
      expect(errors.sam, `Sam's console: ${errors.sam.join(' | ')}`).toEqual([]);

      const flow = await flowCount(baseURL!, boardId);
      expect(flow).toEqual({ shapes: 3, connectors: 5, other: 0 });
    } finally {
      await closeParticipant(dana);
      await closeParticipant(sam);
    }
  });
});
