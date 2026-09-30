// Story 11 — sketch freehand with a pen (workflows "Annotate a cluster",
// TC-17 → TC-19, "Shared sketch", TC-18, and "Tidy up", TC-20).
import { expect, test, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { createSticky, initDoc } from '../../src/shared/board-model';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS, PEN_THICKNESS_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';
import { getCamera, setCamera, viewport } from './helpers/board';
import { noteState } from './helpers/notes';
import { closeAll, openParticipants, printLatencyReport, recordLatency, type Participant } from './helpers/participants';
import { seedBoard } from './helpers/seed';
import { createBoardId } from './helpers/server';

const CAMERA = { x: 0, y: 0, zoom: 1 };

interface StrokeState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  thickness: string;
}

async function strokeStates(page: Page): Promise<StrokeState[]> {
  return page.evaluate(() => {
    const out: StrokeState[] = [];
    window.__vidi6!.doc.getMap('objects').forEach((value, id) => {
      const m = value as unknown as { get(k: string): unknown };
      if (m.get('type') !== 'stroke') return;
      out.push({
        id,
        x: m.get('x') as number,
        y: m.get('y') as number,
        width: m.get('width') as number,
        height: m.get('height') as number,
        color: m.get('color') as string,
        thickness: m.get('thickness') as string,
      });
    });
    return out;
  });
}

function strokeEls(page: Page) {
  return page.locator('[data-stroke-id]');
}

async function ready(page: Page) {
  await setCamera(page, CAMERA);
}

/** Board point (world, camera at CAMERA) → page coordinates. */
async function toPage(page: Page, p: Point): Promise<Point> {
  const vp = (await viewport(page).boundingBox())!;
  const cam = await getCamera(page);
  return { x: vp.x + (p.x - cam.x) * cam.zoom, y: vp.y + (p.y - cam.y) * cam.zoom };
}

/** Presses at the first point, moves through the rest; the caller releases. */
async function trace(page: Page, pts: readonly Point[]) {
  const vp = (await viewport(page).boundingBox())!;
  const cam = await getCamera(page);
  const at = (p: Point) => ({ x: vp.x + (p.x - cam.x) * cam.zoom, y: vp.y + (p.y - cam.y) * cam.zoom });
  const first = at(pts[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    const q = at(p);
    await page.mouse.move(q.x, q.y);
  }
}

async function seededBoard(baseURL: string, notes: Point[]): Promise<string> {
  const boardId = await createBoardId(baseURL);
  const doc = new Y.Doc();
  initDoc(doc);
  for (const c of notes) createSticky(doc, c);
  await seedBoard(baseURL, boardId, doc);
  return boardId;
}

let participants: Participant[] = [];
test.afterEach(async () => {
  await closeAll(participants);
  participants = [];
});
test.afterAll(() => printLatencyReport('story 11 pen'));

test.describe('Workflow: annotate a cluster', () => {
  test('TC-17 a real drag replaying a handwritten loop previews every frame and leaves a stroke', async ({ browser, baseURL }) => {
    // Replaying ~400 real pointer moves takes a while (each move is a round trip to the browser).
    test.setTimeout(120_000);
    participants = await openParticipants(browser, ['priya'], await seededBoard(baseURL!, []));
    const { page } = participants[0];
    await ready(page);
    await page.keyboard.press('p');
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('toolbar', { name: 'Pen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Black pen' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');

    // Sample the preview path on every animation frame while drawing.
    await page.evaluate(() => {
      const w = window as unknown as { __penFrames: (string | null)[]; __penStop: boolean };
      w.__penFrames = [];
      w.__penStop = false;
      const tick = () => {
        if (w.__penStop) return;
        w.__penFrames.push(document.querySelector('[data-testid="pen-preview"]')?.getAttribute('d') ?? null);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const loop = handwrittenLoop({ x: 500, y: 380 }, 150);
    await trace(page, loop);
    await expect(page.getByTestId('pen-preview')).toBeVisible();
    // Nothing is committed while drawing.
    expect(await strokeStates(page)).toHaveLength(0);
    const frames = await page.evaluate(() => {
      const w = window as unknown as { __penFrames: (string | null)[]; __penStop: boolean };
      w.__penStop = true;
      return w.__penFrames;
    });
    const drawing = frames.slice(frames.findIndex((f) => f !== null));
    expect(drawing.length).toBeGreaterThan(10);
    expect(drawing.every((f) => f !== null)).toBe(true);
    let changedOnNextFrame = 0;
    for (let i = 1; i < drawing.length; i++) if (drawing[i] !== drawing[i - 1]) changedOnNextFrame++;
    expect(changedOnNextFrame).toBeGreaterThan(10);
    // The preview grows with the pointer.
    expect(new Set(drawing).size).toBeGreaterThan(10);

    await page.mouse.up();
    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    await expect(strokeEls(page)).toHaveCount(1);
    const [s] = await strokeStates(page);
    expect(s).toMatchObject({ color: 'black', thickness: 'medium' });
    // The stroke covers the loop (bbox of the drawn points ± thickness/2).
    const xs = loop.map((p) => p.x);
    const ys = loop.map((p) => p.y);
    const half = PEN_THICKNESS_WORLD.medium / 2;
    expect(Math.abs(s.x - (Math.min(...xs) - half))).toBeLessThanOrEqual(1);
    expect(Math.abs(s.y - (Math.min(...ys) - half))).toBeLessThanOrEqual(1);
    expect(Math.abs(s.x + s.width - (Math.max(...xs) + half))).toBeLessThanOrEqual(1);
    await expect(page.getByRole('group', { name: 'Drawing' })).toHaveCount(1);
    // The Pen stays active.
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    // Persisted: still there after a reload.
    await page.reload();
    await page.waitForFunction(() => window.__vidi6 !== undefined);
    await expect(strokeEls(page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });

  test('TC-19 wheel pans while the Pen is active; a Pen drag starting on a sticky neither pans nor moves it', async ({
    browser,
    baseURL,
  }) => {
    participants = await openParticipants(browser, ['priya'], await seededBoard(baseURL!, [{ x: 400, y: 300 }]));
    const { page } = participants[0];
    await ready(page);
    const noteId = await page.locator('[data-note-id]').first().getAttribute('data-note-id');
    const before = await noteState(page, noteId!);
    await page.keyboard.press('p');
    const centre = await toPage(page, { x: 640, y: 400 });
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await getCamera(page)).y).toBeGreaterThan(CAMERA.y);
    const cam = await getCamera(page);
    expect(cam.zoom).toBe(1);
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');

    // Drag starting on the note (world (400, 300) is its centre).
    await page.getByRole('button', { name: 'Red pen' }).click();
    await page.getByRole('button', { name: 'Thick' }).click();
    const line = underline({ x: 400, y: 300 }, 250, 40);
    await trace(page, line);
    await page.mouse.up();
    await expect(strokeEls(page)).toHaveCount(1);
    const [s] = await strokeStates(page);
    expect(s).toMatchObject({ color: 'red', thickness: 'thick' });
    expect(await getCamera(page)).toEqual(cam);
    const after = await noteState(page, noteId!);
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    await expect(page.locator(`[data-note-id="${noteId}"]`)).toHaveAttribute('data-selected', 'false');
    // A click draws a dot the size of the thickness.
    const dotAt = await toPage(page, { x: 900, y: 600 });
    await page.mouse.click(dotAt.x, dotAt.y);
    await expect(strokeEls(page)).toHaveCount(2);
    const dot = (await strokeStates(page)).find((x) => x.id !== s.id)!;
    expect(dot.width).toBe(PEN_THICKNESS_WORLD.thick);
    expect(dot.height).toBe(PEN_THICKNESS_WORLD.thick);
    // Escape leaves the Pen.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('Workflow: shared sketch', () => {
  test('TC-18 Sam sees nothing while Priya draws and the finished stroke after she releases', async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    participants = await openParticipants(browser, ['priya', 'sam'], await seededBoard(baseURL!, []));
    const [priya, sam] = participants;
    await ready(priya.page);
    await ready(sam.page);
    await priya.page.keyboard.press('p');
    const loop = handwrittenLoop({ x: 500, y: 380 }, 120, 200);
    await trace(priya.page, loop);
    // Long enough for any update to have arrived: nothing is shared mid-drag.
    await priya.page.waitForTimeout(1500);
    expect(await strokeStates(sam.page)).toHaveLength(0);
    await expect(strokeEls(sam.page)).toHaveCount(0);
    await priya.page.mouse.up();
    const t0 = Date.now();
    await expect(strokeEls(priya.page)).toHaveCount(1);
    await expect(strokeEls(sam.page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const ms = Date.now() - t0;
    recordLatency('TC-18 finished stroke reaches Sam', ms);
    console.log(`TC-18 stroke delivered to Sam in ${ms} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms, not asserted)`);
    const [onPriya] = await strokeStates(priya.page);
    const [onSam] = await strokeStates(sam.page);
    expect(onSam).toEqual(onPriya);
    const d = (p: Page) => p.locator('[data-testid="stroke-line"]').getAttribute('d');
    expect(await d(sam.page)).toBe(await d(priya.page));
  });
});

test.describe('Workflow: tidy up', () => {
  test('TC-20 select by the line, resize in proportion, move and delete on both screens', async ({ browser, baseURL }) => {
    participants = await openParticipants(browser, ['priya', 'sam'], await seededBoard(baseURL!, []));
    const [priya, sam] = participants;
    await ready(priya.page);
    await ready(sam.page);
    const { page } = priya;
    await page.keyboard.press('p');
    // An L-shaped sketch: (300,200) → (300,400) → (600,400).
    const pts: Point[] = [];
    for (let i = 0; i <= 40; i++) pts.push({ x: 300, y: 200 + i * 5 });
    for (let i = 1; i <= 60; i++) pts.push({ x: 300 + i * 5, y: 400 });
    await trace(page, pts);
    await page.mouse.up();
    await expect(strokeEls(page)).toHaveCount(1);
    const [s0] = await strokeStates(page);
    const el = strokeEls(page).first();

    await page.keyboard.press('v');
    // Inside the box but far from the line: nothing selected.
    const empty = await toPage(page, { x: 500, y: 250 });
    await page.mouse.click(empty.x, empty.y);
    await expect(el).toHaveAttribute('data-selected', 'false');
    // On the line (4 px away): selected.
    const onLine = await toPage(page, { x: 304, y: 300 });
    await page.mouse.click(onLine.x, onLine.y);
    await expect(el).toHaveAttribute('data-selected', 'true');

    // Resize from the bottom-right handle: wider only, but the ratio is kept.
    const handle = (await page.getByRole('button', { name: 'Resize bottom-right' }).boundingBox())!;
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 100, hy + 20, { steps: 6 });
    await page.mouse.move(hx + 150, hy + 20, { steps: 6 });
    await page.mouse.up();
    const [s1] = await strokeStates(page);
    expect(s1.width).toBeGreaterThan(s0.width * 1.2);
    const ratio0 = s0.width / s0.height;
    const ratio1 = s1.width / s1.height;
    expect(Math.abs(ratio1 / ratio0 - 1)).toBeLessThanOrEqual(0.01);
    expect(s1.thickness).toBe(s0.thickness);
    await expect(el.locator('[data-testid="stroke-line"]')).toHaveAttribute('stroke-width', String(PEN_THICKNESS_WORLD.medium));

    // Move by dragging the line: the horizontal part (drawn at y = 400), away from the edge handles.
    const grab = await toPage(page, { x: s1.x + s1.width * 0.3, y: s1.y + (s1.height * (400 - s0.y)) / s0.height });
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 40, grab.y + 30, { steps: 6 });
    await page.mouse.move(grab.x + 80, grab.y + 60, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await strokeStates(page))[0].y - s1.y).toBeCloseTo(60, 0);
    const [s2] = await strokeStates(page);
    expect(s2.x - s1.x).toBeCloseTo(80, 0);
    expect(s2.y - s1.y).toBeCloseTo(60, 0);
    expect(s2.width).toBeCloseTo(s1.width, 6);
    await expect.poll(async () => (await strokeStates(sam.page))[0]?.x, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBeCloseTo(s2.x, 6);

    // Delete: gone on both screens.
    await expect(el).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(strokeEls(page)).toHaveCount(0);
    await expect(strokeEls(sam.page)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });
});
