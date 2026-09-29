// Story 10 end-to-end, connectors under two people: an arrow being drawn while
// somebody else deletes the shape it is pointing at.
//
// TC-27 of the design, and the plain collaboration check that belongs with it -
// shapes and arrows drawn by one person appear in the other's board.
//
// This is a nightly spec (the file name is what playwright.nightly.config.ts
// matches): it opens a browser context per person and waits for both of them to
// agree, which is slower and less certain to land on the same frame than the rest
// of the suite, and it is retried for that reason.
//
// The race is the point. The colleague begins an arrow on a shape, drags towards
// another shape and HOLDS the pointer down; meanwhile the shape is deleted from the
// other browser. Then the pointer is released, over a shape that is no longer there.
// Whatever order the two updates arrive in, the board must end in one of the two
// states that make sense - an arrow that points at the board where the shape was -
// and must not throw on the way there.
import { test, expect, type Page } from '@playwright/test';
import { ensureBoard } from './helpers/board.ts';
import { openBoard, newCollaborator } from './helpers/room.ts';
import { getCamera, type Cam } from './helpers/sticky.ts';
import { newBoardId } from '../../src/shared/board-id.ts';

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Ends {
  from: { x: number; y: number };
  to: { x: number; y: number };
  fromKind: string;
  toKind: string;
}

const screenOf = (cam: Cam, p: { x: number; y: number }) => ({
  x: (p.x - cam.x) * cam.zoom,
  y: (p.y - cam.y) * cam.zoom,
});

const shapeEls = (page: Page) => page.locator('[data-testid^="shape-"][data-shape-kind]');
const connectorEls = (page: Page) => page.locator('[data-testid^="connector-"][data-object-id]');

/** Every console complaint a page makes, so the end of a test can refuse them. */
function watchForErrors(page: Page, who: string): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${who}: pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who}: console ${m.text()}`);
  });
  return errors;
}

async function shapeBoxes(page: Page): Promise<Box[]> {
  return shapeEls(page).evaluateAll((els) =>
    els.map((e) => ({
      id: (e as HTMLElement).dataset.objectId ?? '',
      x: parseFloat((e as HTMLElement).style.left),
      y: parseFloat((e as HTMLElement).style.top),
      width: parseFloat((e as HTMLElement).style.width),
      height: parseFloat((e as HTMLElement).style.height),
    })),
  );
}

async function endsOf(page: Page, nth = 0): Promise<Ends> {
  return connectorEls(page).nth(nth).evaluate((e) => {
    const line = e.querySelector('[data-testid^="connector-line-"]') as HTMLElement;
    return {
      from: { x: parseFloat(line.dataset.fromX ?? ''), y: parseFloat(line.dataset.fromY ?? '') },
      to: { x: parseFloat(line.dataset.toX ?? ''), y: parseFloat(line.dataset.toY ?? '') },
      fromKind: (e as HTMLElement).dataset.fromEnd ?? '',
      toKind: (e as HTMLElement).dataset.toEnd ?? '',
    };
  });
}

async function drawShape(page: Page, fromWorld: { x: number; y: number }, toWorld: { x: number; y: number }): Promise<void> {
  const cam = await getCamera(page);
  const a = screenOf(cam, fromWorld);
  const b = screenOf(cam, toWorld);
  await page.keyboard.press('s');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  }
  await page.mouse.up();
  await page.waitForTimeout(80);
}

/** A drag that is left held down: press, travel, and nothing else. */
async function holdDrag(page: Page, fromWorld: { x: number; y: number }, toWorld: { x: number; y: number }): Promise<void> {
  const cam = await getCamera(page);
  const a = screenOf(cam, fromWorld);
  const b = screenOf(cam, toWorld);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  }
}

/** Release wherever the pointer stands. */
async function release(page: Page, atWorld: { x: number; y: number }): Promise<void> {
  const cam = await getCamera(page);
  const p = screenOf(cam, atWorld);
  await page.mouse.move(p.x, p.y);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

// The plain half of the requirement, with two people: what one draws, the other
// sees - shapes by the shape tool, arrows by the connector tool.
test('a shape and an arrow drawn by one person appear in another board', async ({ browser }) => {
  const boardId = newBoardId();
  await ensureBoard(boardId);
  const author = await newCollaborator(browser);
  const other = await newCollaborator(browser);
  const errors = [...watchForErrors(author, 'author'), ...watchForErrors(other, 'other')];
  try {
    await openBoard(author, boardId);
    await openBoard(other, boardId);

    await drawShape(author, { x: 0, y: 0 }, { x: 200, y: 200 });
    await author.keyboard.press('Escape');
    await drawShape(author, { x: 400, y: 0 }, { x: 600, y: 200 });
    await author.keyboard.press('Escape');
    await expect(shapeEls(other)).toHaveCount(2);

    await author.keyboard.press('l');
    const cam = await getCamera(author);
    const a = screenOf(cam, { x: 100, y: 100 });
    const b = screenOf(cam, { x: 500, y: 100 });
    await author.mouse.move(a.x, a.y);
    await author.mouse.down();
    await author.mouse.move(b.x, b.y);
    await author.mouse.up();
    await expect(connectorEls(other)).toHaveCount(1);
    await expect(async () => {
      const seen = await endsOf(other);
      expect(seen.fromKind).toBe('attached');
      expect(seen.toKind).toBe('attached');
    }).toPass();

    expect(errors).toEqual([]);
  } finally {
    await author.close();
    await other.close();
  }
});

// TC-27: the shape an arrow is being dragged onto is deleted from another browser
// while the pointer is still down. The arrow that comes out of it must be an arrow
// the board can live with, and nothing may throw.
test('TC-27 draws an arrow onto a shape that is deleted mid-drag', async ({ browser }) => {
  const boardId = newBoardId();
  await ensureBoard(boardId);
  const owner = await newCollaborator(browser);
  const drawer = await newCollaborator(browser);
  const errors = [...watchForErrors(owner, 'owner'), ...watchForErrors(drawer, 'drawer')];
  try {
    await openBoard(owner, boardId);
    await openBoard(drawer, boardId);

    // Two shapes, made by the owner, seen by the drawer.
    await drawShape(owner, { x: 0, y: 0 }, { x: 200, y: 200 });
    await owner.keyboard.press('Escape');
    await drawShape(owner, { x: 400, y: 0 }, { x: 600, y: 200 });
    await owner.keyboard.press('Escape');
    await expect(shapeEls(drawer)).toHaveCount(2);

    // The drawer begins an arrow on the first shape and drags onto the second...
    await drawer.keyboard.press('l');
    await holdDrag(drawer, { x: 100, y: 100 }, { x: 500, y: 100 });

    // ...and holds it there while the owner deletes the shape it is pointing at.
    const target = await shapeBoxes(owner).then((boxes) => boxes[1]);
    await owner.mouse.click(screenOf(await getCamera(owner), { x: target.x + target.width / 2, y: target.y + target.height / 2 }).x, screenOf(await getCamera(owner), { x: target.x + target.width / 2, y: target.y + target.height / 2 }).y);
    await owner.keyboard.press('Delete');
    await expect(shapeEls(drawer)).toHaveCount(1);
    // Let the news arrive and settle, with the pointer still held down.
    await drawer.waitForTimeout(400);

    // The drawer releases, over the place where that shape was.
    await release(drawer, { x: 500, y: 100 });

    // An arrow is visible - or none was created at all, which is the other answer
    // that makes sense. What must not happen is an arrow that belongs to a shape
    // that is gone, or an arrow drawn to nowhere.
    await expect(async () => {
      const count = await connectorEls(drawer).count();
      expect(count).toBeLessThanOrEqual(1);
      if (count === 1) {
        const drawn = await endsOf(drawer);
        expect(drawn.toKind).toBe('free');
        expect(Number.isFinite(drawn.to.x)).toBe(true);
        expect(Number.isFinite(drawn.to.y)).toBe(true);
        await expect(drawer.locator('[data-testid^="connector-arrow-"]')).toHaveCount(1);
      }
    }).toPass();

    // Both boards agree, which is the only way the two of them can be shown to have
    // ended in the same state.
    await expect(connectorEls(owner)).toHaveCount(await connectorEls(drawer).count());

    // And nobody complained on the way.
    expect(errors).toEqual([]);
  } finally {
    await owner.close();
    await drawer.close();
  }
});
