// Story 11 end-to-end, the Pen: a drag with the Pen open draws a line on the real
// board, in a real browser, against the real room - and the board underneath a pen
// that is open keeps doing what the board does.
//
// TC-17 and TC-19 of the design, plus the settings a stroke is drawn with. The half of
// the story that is about two people (TC-18) and the half that is about tidying a
// sketch up (TC-20) need a second screen, so they live in `pen-collaboration.spec.ts`
// and run under the nightly config, as story 10's connectors did.
//
// Everything is measured the way a person sees it: screen pixels for the pointer, the
// stroke's own rendered box for the result, read back in world units through the live
// camera. A stroke is always found by the id it carries, never by a DOM position -
// drawing a second stroke changes the paint order.
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  gotoBoard,
  getCamera,
  createNoteAt,
  notes,
  noteWorldTopLeft,
  type Cam,
} from './helpers/sticky.ts';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config.ts';

interface Point {
  x: number;
  y: number;
}

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  thickness: string;
  points: number;
}

// screen = (world - camera) * zoom, through the camera the board is actually using.
const screenOf = (cam: Cam, p: Point): Point => ({
  x: (p.x - cam.x) * cam.zoom,
  y: (p.y - cam.y) * cam.zoom,
});

/**
 * The stroke elements. Only the root of each one carries both the `stroke-` test id
 * and the object id: the clickable band, the drawn line and the selection glow are
 * separate elements below it, and a selector that caught those would count one
 * drawing several times.
 */
const strokeEls = (page: Page): Locator => page.locator('[data-testid^="stroke-"][data-object-id]');
const previewPath = (page: Page): Locator => page.locator('[data-testid="pen-preview-path"]');

/** Every console complaint, so the end of a test can refuse them. */
function watchForErrors(page: Page, who: string): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${who}: pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who}: console ${m.text()}`);
  });
  return errors;
}

/** The boxes the board holds for each stroke, in world units. */
async function strokeBoxes(page: Page): Promise<Box[]> {
  return strokeEls(page).evaluateAll((els) =>
    els.map((e) => {
      const el = e as HTMLElement;
      return {
        id: el.dataset.objectId ?? '',
        x: parseFloat(el.dataset.worldX ?? ''),
        y: parseFloat(el.dataset.worldY ?? ''),
        width: parseFloat(el.dataset.worldWidth ?? ''),
        height: parseFloat(el.dataset.worldHeight ?? ''),
        color: el.dataset.color ?? '',
        thickness: el.dataset.thickness ?? '',
        points: parseInt(el.dataset.points ?? '', 10),
      };
    }),
  );
}

function pathBBox(path: readonly Point[]): { x: number; y: number; width: number; height: number } {
  const xs = path.map((p) => p.x);
  const ys = path.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Press the Pen in the toolbar, the way a person does. */
async function openPen(page: Page): Promise<void> {
  await page.click('[data-testid="tool-pen"]');
  await page.waitForSelector('[data-testid="pen-tool"]');
}

/**
 * A drag with the pen, along a path given in WORLD units, with the screen points
 * worked out through the live camera. `onMove` runs with the pointer still held down,
 * which is the only window in which a half-drawn stroke can be observed at all.
 */
async function penDrag(
  page: Page,
  path: readonly Point[],
  onMove?: (step: number) => Promise<void>,
): Promise<void> {
  const cam = await getCamera(page);
  const pts = path.map((p) => screenOf(cam, p));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    await page.mouse.move(pts[i].x, pts[i].y); // one pointer move per point of the path
    if (onMove) await onMove(i);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}

// A loop, drawn as a hand draws one: around, ending where it began, with the shake a
// pen line has in it - which is what the smoothing has something to do.
function loopPath(cx: number, cy: number, rx: number, ry: number, steps = 40): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 * 1.04;
    const jitter = Math.sin(i * 12.9898) * 3 + Math.cos(i * 4.1) * 2;
    out.push({ x: cx + Math.cos(a) * (rx + jitter), y: cy + Math.sin(a) * (ry + jitter) });
  }
  return out;
}

// TC-17: the pen draws. While the pointer travels there is a line on the screen and
// nothing on the board; when it lifts there is one stroke, and the pen is still the
// tool, because a person who drew one line is not finished.
test('TC-17 a drag with the pen draws a line, then becomes one stroke', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchForErrors(page, 'drawer');
  await gotoBoard(page);

  await openPen(page);
  await expect(page.locator('[data-testid="pen-toolbar"]')).toBeVisible();
  await expect(page.locator('[data-testid="tool-pen"]')).toHaveAttribute('aria-pressed', 'true');

  const path = loopPath(120, 40, 180, 120);
  const seen: string[] = [];
  let strokesDuring = -1;
  let previewDuring = false;

  await penDrag(page, path, async () => {
    // The line is on the screen while the hand moves...
    const d = await previewPath(page).getAttribute('d');
    if (d !== null) {
      previewDuring = true;
      if (!seen.includes(d)) seen.push(d);
    }
    // ...and it is the only thing that is: nothing has been written yet.
    strokesDuring = await strokeEls(page).count();
  });

  expect(previewDuring).toBe(true); // a pen that shows nothing while it draws is not drawing
  // The line is redrawn as the hand moves, not once at the end. How many distinct lines
  // a drag produces is the browser's frame rate, so the count is set low - but the last
  // line is also LONGER than the first, which is the part that does not depend on frames:
  // a preview that only appears when the pointer lifts, or that is drawn once and left,
  // cannot grow.
  const pairs = (d: string): number => d.match(/-?\d+(?:\.\d+)?/g)?.length ?? 0;
  expect(seen.length).toBeGreaterThanOrEqual(3);
  expect(pairs(seen[seen.length - 1])).toBeGreaterThan(pairs(seen[0]));
  expect(strokesDuring).toBe(0); // not one stroke while the pointer is down

  await expect(previewPath(page)).toHaveCount(0); // the preview belongs to the drag
  await expect(strokeEls(page)).toHaveCount(1); // exactly one stroke for one drag

  const [stroke] = await strokeBoxes(page);
  const box = pathBBox(path);
  const pad = PEN_THICKNESS_WORLD.medium / 2;
  // What is on the board is the line that was drawn: the same extent, within the
  // round end the pen adds and the shake a hand has.
  expect(stroke.x).toBeCloseTo(box.x - pad, -1);
  expect(stroke.y).toBeCloseTo(box.y - pad, -1);
  expect(stroke.width).toBeGreaterThan(box.width * 0.9);
  expect(stroke.height).toBeGreaterThan(box.height * 0.9);
  expect(stroke.width).toBeLessThan(box.width + 40);
  expect(stroke.thickness).toBe('medium');
  // The drawing is the line rather than a transcript of the pointer: at most every
  // recorded point is on the board, and the board's own smoothing (TC-01..TC-03) is
  // what decides how many of them are needed.
  expect(stroke.points).toBeGreaterThan(1);
  expect(stroke.points).toBeLessThanOrEqual(path.length);

  // The pen is still open and the drawing is not selected: the next drag draws too.
  await expect(page.locator('[data-testid="tool-pen"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="pen-tool"]')).toBeVisible();
  await expect(page.locator('[data-testid="selection-box"]')).toHaveCount(0);

  // A second drag is a second stroke, and the first is still there.
  await penDrag(page, [
    { x: -220, y: 240 },
    { x: -60, y: 250 },
    { x: 120, y: 236 },
  ]);
  await expect(strokeEls(page)).toHaveCount(2);

  // And it is the board's own drawing: a reload brings both lines back.
  await page.reload();
  await page.waitForSelector('[data-testid="viewport"]');
  await expect(strokeEls(page)).toHaveCount(2);

  expect(errors).toEqual([]);
});

// The settings the pen offers are the settings the stroke is drawn with, and they are
// the pen's own: chosen for the pen's session, never written back onto a drawing.
test('the colour and weight that were picked are the ones the stroke is drawn with', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchForErrors(page, 'drawer');
  await gotoBoard(page);

  await openPen(page);
  await expect(page.locator('[data-testid="pen-color-red"]')).toBeVisible();
  await page.click('[data-testid="pen-color-red"]');
  await page.click('[data-testid="pen-thickness-thick"]');
  await expect(page.locator('[data-testid="pen-color-red"]')).toHaveAttribute('aria-pressed', 'true');

  await penDrag(page, [
    { x: -160, y: -60 },
    { x: -40, y: -110 },
    { x: 90, y: -50 },
    { x: 210, y: -120 },
  ]);

  const [stroke] = await strokeBoxes(page);
  expect(stroke.color).toBe('red');
  expect(stroke.thickness).toBe('thick');
  // The line is drawn as thick as it was told to be, in world units - so it grows
  // with the board, not with the picture.
  const drawn = await page.locator(`[data-testid="stroke-path-${stroke.id}"]`).getAttribute('stroke-width');
  expect(Number(drawn)).toBe(PEN_THICKNESS_WORLD.thick);

  // Choosing something else leaves that drawing alone: it keeps what it was drawn
  // with, and the next stroke is what changes.
  await page.click('[data-testid="pen-color-blue"]');
  await penDrag(page, [
    { x: -160, y: 40 },
    { x: 210, y: 40 },
  ]);
  const boxes = await strokeBoxes(page);
  expect(boxes).toHaveLength(2);
  expect(boxes.find((b) => b.id === stroke.id)?.color).toBe('red');
  expect(boxes.find((b) => b.id !== stroke.id)?.color).toBe('blue');

  // Escape gives the pen back, and the pen's settings go with it.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="pen-tool"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="pen-toolbar"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="tool-select"]')).toHaveAttribute('aria-pressed', 'true');

  expect(errors).toEqual([]);
});

// TC-19: the pen is open ON the board, not instead of it. A wheel between strokes
// pans; a drag that starts on a sticky note draws over it instead of dragging the
// note out of the way; and what the drag ends up making is a stroke.
test('TC-19 the board still answers the wheel and the pointer while the pen is open', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchForErrors(page, 'drawer');
  await gotoBoard(page);

  // A note, made the way a person makes one, and left where it was.
  await createNoteAt(page, 760, 300);
  await page.keyboard.type('pinned');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const note = notes(page).first();
  await expect(note).toBeVisible();
  const noteBefore = await noteWorldTopLeft(note);

  await openPen(page);
  const cam = await getCamera(page);
  expect(cam.zoom).toBeGreaterThan(0);

  // A wheel over the pen pans the board: the pen holds presses, never the wheel. The
  // direction is the board's own - scrolling down takes the camera further down the
  // world, which is what the story 1 tests established.
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(150);
  const panned = await getCamera(page);
  expect(panned.y).toBeCloseTo(cam.y + 200 / cam.zoom, 1);
  expect(panned.x).toBeCloseTo(cam.x, 1);
  expect(panned.zoom).toBeCloseTo(cam.zoom, 6);
  // Panning with the pen in the way drew nothing and did not take the note.
  await expect(strokeEls(page)).toHaveCount(0);
  expect(await noteWorldTopLeft(note)).toEqual(noteBefore);

  // A drag that STARTS ON THE NOTE draws over it. The note is where it was afterwards
  // because it was never the note's drag.
  const over = await note.boundingBox();
  if (!over) throw new Error('the note is not on screen');
  const cx = over.x + over.width / 2;
  const cy = over.y + over.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(cx - i * 10, cy + i * 6);
  await page.mouse.up();
  await page.waitForTimeout(200);

  await expect(strokeEls(page)).toHaveCount(1);
  expect(await noteWorldTopLeft(note)).toEqual(noteBefore);
  await expect(notes(page)).toHaveCount(1); // the note is still the only note
  expect((await strokeBoxes(page))[0].points).toBeGreaterThan(1);

  // Ctrl/Cmd+wheel still zooms, because it is still the board's own wheel handler.
  // Chromium takes a real ctrl+wheel as page zoom of its own, which is why the board's
  // wheel tests dispatch the event themselves (see dispatchCtrlWheel in the helpers);
  // this one is dispatched at the PEN SURFACE, which is the thing under test - a wheel
  // over the pen still reaches the board's listener, and the listener still stops it.
  const prevented = await page.evaluate(
    ({ x, y }) => {
      const el = document.querySelector('[data-testid="pen-tool"]') as HTMLElement;
      const e = new WheelEvent('wheel', {
        deltaY: -240,
        ctrlKey: true,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    },
    { x: cx, y: cy },
  );
  await page.waitForTimeout(150);
  const zoomed = await getCamera(page);
  expect(prevented).toBe(true); // the board took the wheel back from the browser
  expect(zoomed.zoom).toBeGreaterThan(cam.zoom);
  await expect(strokeEls(page)).toHaveCount(1); // a wheel that zooms is still not a stroke
  expect(await noteWorldTopLeft(note)).toEqual(noteBefore);

  // A double-click is two pen presses, never the board's "new note": it leaves two
  // dots on the board and no note at all.
  await page.mouse.dblclick(300, 620);
  await page.waitForTimeout(200);
  await expect(notes(page)).toHaveCount(1);
  await expect(strokeEls(page)).toHaveCount(3);

  // Giving the pen back returns the board to its usual self: the same double-click on
  // clear space makes a note, and the pen is out of the way of it.
  await page.keyboard.press('v');
  await expect(page.locator('[data-testid="pen-tool"]')).toHaveCount(0);
  await page.mouse.dblclick(240, 700);
  await page.waitForSelector('textarea.sticky-editor');
  await page.keyboard.press('Escape');
  await expect(notes(page)).toHaveCount(2);

  expect(errors).toEqual([]);
});

// The ends of the recording: a press that never moved is still a stroke with a box of
// its own, and a drag with more points in it than one stroke may hold is continued
// rather than lost.
test('a press that never moved is a dot, and a drag past the point limit is continued', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page, 'drawer');
  await gotoBoard(page);
  await openPen(page);

  // A dot: pressed, released, nothing worth smoothing - and still an object.
  await page.mouse.move(500, 260);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  await expect(strokeEls(page)).toHaveCount(1);
  const [dot] = await strokeBoxes(page);
  expect(dot.width).toBeCloseTo(PEN_THICKNESS_WORLD.medium, 1);
  expect(dot.height).toBeCloseTo(PEN_THICKNESS_WORLD.medium, 1);
  // Big enough to find again: a click on it selects it.
  await page.keyboard.press('Escape');
  await page.mouse.click(500, 260);
  await expect(page.locator('[data-testid="selection-box"]')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // The limit itself needs five thousand pointer moves, which is more than a scripted
  // mouse can hand over in reasonable time, so this one recording is handed to the pen
  // surface as events instead - with the pen opened again, because the Escape above
  // gave it back. The shape of what is asserted does not depend on that: a drag with
  // more points in it than STROKE_MAX_POINTS must not stop drawing, and must not put
  // more than a stroke's worth into one object.
  await openPen(page);
  const moves = STROKE_MAX_POINTS + 60;
  const screen: Point[] = [];
  for (let i = 0; i < moves; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = 6 + i * 0.05;
    screen.push({ x: 640 + Math.cos(a) * r, y: 380 + Math.sin(a) * r });
  }
  await page.evaluate((pts) => {
    const el = document.querySelector('[data-testid="pen-tool"]') as HTMLElement;
    const fire = (type: string, p: { x: number; y: number }): void => {
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: p.x,
          clientY: p.y,
          pointerId: 7,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
        }),
      );
    };
    fire('pointerdown', pts[0]);
    for (let i = 1; i < pts.length; i++) fire('pointermove', pts[i]);
    fire('pointerup', pts[pts.length - 1]);
  }, screen);
  await page.waitForTimeout(400);

  const strokes = (await strokeBoxes(page)).filter((s) => s.id !== dot.id);
  expect(strokes.length).toBeGreaterThanOrEqual(2); // the long drag is more than one stroke
  const counts = strokes.map((s) => s.points).sort((a, b) => b - a);
  expect(counts[0]).toBeLessThanOrEqual(STROKE_MAX_POINTS); // none holds more than one may

  // The parts join. The long one is the part that was put down first - it carries the
  // bulk of the recording - and the short one is what came after the limit, so the two
  // ends that meet are the first part's last point and the second part's first. They
  // are read off what the board DRAWS, which is where a gap would actually show.
  expect(counts.length).toBeGreaterThan(1);
  const first = strokes.reduce((a, b) => (a.points >= b.points ? a : b));
  const second = strokes.reduce((a, b) => (a.points <= b.points ? a : b));
  expect(second.id).not.toBe(first.id);
  const ends = async (id: string): Promise<{ start: Point; end: Point }> => {
    const d = await page.locator(`[data-testid="stroke-path-${id}"]`).getAttribute('d');
    if (d === null) throw new Error(`stroke ${id} draws nothing`);
    const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    expect(nums.length).toBeGreaterThanOrEqual(4);
    return {
      start: { x: nums[0], y: nums[1] },
      end: { x: nums[nums.length - 2], y: nums[nums.length - 1] },
    };
  };
  const endOfFirst = await ends(first.id);
  const startOfSecond = await ends(second.id);
  expect(startOfSecond.start.x).toBeCloseTo(endOfFirst.end.x, 1);
  expect(startOfSecond.start.y).toBeCloseTo(endOfFirst.end.y, 1);

  expect(errors).toEqual([]);
});
