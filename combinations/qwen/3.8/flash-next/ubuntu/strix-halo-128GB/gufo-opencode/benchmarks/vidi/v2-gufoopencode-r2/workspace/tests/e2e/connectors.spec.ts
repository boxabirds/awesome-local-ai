// Story 10 e2e (TC-25…TC-27): arrows follow remote moves and switch sides,
// survive remote deletes by releasing their end to the last anchor, and an
// end dragged onto an object while that object is deleted renders safely.

import { test, expect, type Page } from '@playwright/test';
import { getConnectors, getShapes, gotoBoard, setCamera } from './helpers/board';
import {
  closeParticipants,
  eventually,
  openParticipants,
} from './helpers/participants';

async function dragFromTo(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

async function drawShape(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.keyboard.press('s');
  await expect(page.getByTestId('shape-tool-catcher')).toBeVisible();
  await dragFromTo(page, from, to);
}

async function drawConnector(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.keyboard.press('l');
  await expect(page.getByTestId('connector-tool-catcher')).toBeVisible();
  await dragFromTo(page, from, to);
}

// World x of the arrow's "to" end: the line's x2 is local to the connector
// svg, which sits at the snapshot bbox origin.
async function toEndWorldX(page: Page): Promise<number> {
  const raw = await page.getByTestId('connector-line').getAttribute('x2');
  if (raw === null) throw new Error('connector-line has no x2');
  const [conn] = await getConnectors(page);
  if (!conn) throw new Error('no connector yet');
  return conn.x + Number(raw);
}

// A: world rect (100,100,160,100), centre (180,150). B: (500,100,160,100), centre (580,150).
async function seedTwoShapes(page: Page): Promise<void> {
  await drawShape(page, [100, 100], [260, 200]);
  await drawShape(page, [500, 100], [660, 200]);
}

test('TC-25: an arrow stays attached and switches side when the target is dragged past the source, on both screens', async ({
  browser,
}) => {
  const [dana, sam] = await openParticipants(browser, ['Dana', 'Sam']);
  try {
    await setCamera(dana.page, { x: 0, y: 0, zoom: 1 });
    await setCamera(sam.page, { x: 0, y: 0, zoom: 1 });
    await seedTwoShapes(dana.page);
    await eventually(
      'TC-25 shapes reach Sam',
      async () => (await getShapes(sam.page)).length,
      2,
    );

    await drawConnector(dana.page, [180, 150], [580, 150]);
    const created = await getConnectors(dana.page);
    expect(created).toHaveLength(1);
    expect(created[0].to.kind).toBe('attached');
    const bId = (await getShapes(dana.page)).find((s) => s.x > 400)!.id;
    expect(created[0].to.objectId).toBe(bId);
    // The end anchors on B's left side while B sits to the right of A.
    expect(Math.abs((await toEndWorldX(dana.page)) - 500)).toBeLessThanOrEqual(1);

    await eventually(
      'TC-25 arrow reaches Sam',
      async () => (await getConnectors(sam.page)).length,
      1,
    );
    expect((await getConnectors(sam.page))[0].to.objectId).toBe(bId);

    // Dana drags B past A; the attached end switches to B's right side.
    await dragFromTo(dana.page, [580, 150], [120, 150]);
    await eventually(
      'TC-25 side flip on Dana',
      async () => Math.abs((await toEndWorldX(dana.page)) - 200) <= 1,
      true,
    );
    await eventually(
      'TC-25 side flip on Sam',
      async () => {
        const cons = await getConnectors(sam.page);
        return cons.length === 1 && cons[0].to.kind === 'attached' && cons[0].to.objectId === bId
          ? Math.abs((await toEndWorldX(sam.page)) - 200) <= 1
          : false;
      },
      true,
    );
  } finally {
    await closeParticipants([dana, sam]);
  }
});

test('TC-26: deleting the target frees the arrow end at its last anchor, on both screens', async ({
  browser,
}) => {
  const [dana, sam] = await openParticipants(browser, ['Dana', 'Sam']);
  try {
    await setCamera(dana.page, { x: 0, y: 0, zoom: 1 });
    await setCamera(sam.page, { x: 0, y: 0, zoom: 1 });
    await seedTwoShapes(dana.page);
    await eventually('TC-26 shapes reach Sam', async () => (await getShapes(sam.page)).length, 2);
    await drawConnector(dana.page, [180, 150], [580, 150]);
    await eventually('TC-26 arrow reaches Sam', async () => (await getConnectors(sam.page)).length, 1);

    // Sam deletes B.
    await sam.page.mouse.click(580, 150);
    await sam.page.keyboard.press('Delete');

    const freedOn = async (page: Page): Promise<boolean> => {
      const cons = await getConnectors(page);
      if (cons.length !== 1) return false;
      const end = cons[0].to;
      return end.kind === 'free' && Math.abs((end.x ?? 0) - 500) <= 1 && Math.abs((end.y ?? 0) - 150) <= 1;
    };
    await eventually('TC-26 end freed on Sam', () => freedOn(sam.page), true);
    await eventually('TC-26 end freed on Dana', () => freedOn(dana.page), true);
    await expect(dana.page.getByTestId('connector-object')).toHaveCount(1);
    await expect(sam.page.getByTestId('connector-object')).toHaveCount(1);
  } finally {
    await closeParticipants([dana, sam]);
  }
});

test('TC-27: dragging an arrow onto a target that a peer deletes mid-drag renders safely with no console errors', async ({
  browser,
}) => {
  const [dana, sam] = await openParticipants(browser, ['Dana', 'Sam']);
  const errors: string[] = [];
  for (const p of [dana, sam]) {
    p.page.on('pageerror', (err) => errors.push(`${p.name} pageerror: ${String(err)}`));
    p.page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`${p.name} console: ${msg.text()}`);
    });
  }
  try {
    await setCamera(dana.page, { x: 0, y: 0, zoom: 1 });
    await setCamera(sam.page, { x: 0, y: 0, zoom: 1 });
    await seedTwoShapes(dana.page);
    await eventually('TC-27 shapes reach Sam', async () => (await getShapes(sam.page)).length, 2);
    await drawConnector(dana.page, [180, 150], [580, 150]);
    await eventually('TC-27 first arrow reaches Sam', async () => (await getConnectors(sam.page)).length, 1);

    // Overlap: Sam deletes B while Dana drags a new arrow from A onto B.
    // (page.route cannot delay the Hocuspocus WebSocket, so this forces the
    // race by issuing both actions back-to-back; see NOTES.md.)
    await sam.page.mouse.click(580, 150);
    await sam.page.keyboard.press('Delete');
    await drawConnector(dana.page, [180, 150], [580, 150]);

    // The new arrow exists on Dana's screen and renders; whichever of
    // "attached to the just-deleted B" (rendered at its fallback anchor) or
    // "released free" wins the merge, every endpoint must resolve to a
    // finite point and attached ids must exist.
    await eventually(
      'TC-27 second arrow on Dana',
      async () => (await getConnectors(dana.page)).length,
      2,
    );
    const check = async (page: Page): Promise<boolean> => {
      const shapes = new Set((await getShapes(page)).map((s) => s.id));
      const cons = await getConnectors(page);
      if (cons.length < 1) return false;
      for (const c of cons) {
        for (const end of [c.from, c.to]) {
          if (end.kind === 'attached' && (!end.objectId || !shapes.has(end.objectId))) {
            // Orphaned attach: the renderer must still show a finite point.
            if (!end.fallback || !Number.isFinite(end.fallback.x) || !Number.isFinite(end.fallback.y)) {
              return false;
            }
          } else if (end.kind === 'free' && !(Number.isFinite(end.x) && Number.isFinite(end.y))) {
            return false;
          }
        }
      }
      return true;
    };
    expect(await check(dana.page)).toBe(true);
    await eventually('TC-27 safe state on Sam', () => check(sam.page), true);
    await expect(dana.page.getByTestId('connector-object')).toHaveCount(2);
    expect(errors).toEqual([]);
  } finally {
    await closeParticipants([dana, sam]);
  }
});
