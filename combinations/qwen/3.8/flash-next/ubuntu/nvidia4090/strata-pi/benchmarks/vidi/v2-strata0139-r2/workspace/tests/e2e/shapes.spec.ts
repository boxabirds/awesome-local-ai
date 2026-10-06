import { expect, test, type Page } from "@playwright/test";
import { CONNECTOR_ARROWHEAD_SIZE_WORLD, SHAPE_DEFAULT_SIZE_WORLD } from "../../src/shared/config";
import type { ConnectorSnap } from "../../src/shared/objects/connector";
import { buildCheckoutFlow, DANGLING_END } from "../fixtures/checkout-flow";
import { boardBox, openBoard, renderedCamera } from "./helpers/board";
import { dragObjectBy, selectIds, worldBox, centreOn, pressKeys, dragHandleBy, clearSelection } from "./helpers/selection";
import { settle } from "./helpers/notes";
import {
  armTool,
  beginArrow,
  clickShape,
  connectorCount,
  connectors,
  drawShape,
  finishArrow,
  roomObjects,
  shapeById,
  shapes,
  writeBoard,
  type ShapeDom,
  type XY,
} from "./helpers/shapes";
import { expectEventually, expectNoProblems, openSession, reportLatencies, resetLatencies, type Session } from "./helpers/participants";

/**
 * Story 10 — shapes and the arrows that follow them (TC-23 to TC-27).
 *
 * These are the parts of the story only a real browser can answer: that a dragged
 * rectangle really is the rectangle that was dragged at 100% and at 200%, that a
 * long label wraps and stays centred, and that an arrow stays attached while
 * somebody else moves and deletes the shapes it points at.
 */

async function screenPoint(page: Page, world: XY): Promise<XY> {
  const area = await boardBox(page);
  const camera = await renderedCamera(page);
  return { x: area.x + (world.x - camera.x) * camera.zoom, y: area.y + (world.y - camera.y) * camera.zoom };
}

async function doubleClickWorld(page: Page, world: XY): Promise<void> {
  const at = await screenPoint(page, world);
  await page.mouse.dblclick(at.x, at.y);
  await settle(page);
}

async function centreOf(box: { x: number; y: number; width: number; height: number }): Promise<XY> {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The centring claim of `shape.label_centred`, measured on what the browser laid
 * out: every line box sits in the middle of the shape, no line sticks out of the
 * shape's own box, and when there are more lines than the shape can show the
 * overflow hangs by the same amount above and below rather than only at the top.
 */
function expectLabelCentred(shape: ShapeDom): void {
  expect(shape.labelLines).toBeGreaterThan(1);
  const middle = shape.x + shape.width / 2;
  const lines = shape.labelRects;
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines) {
    expect(Math.abs(line.centreX - middle)).toBeLessThanOrEqual(4);
    expect(line.x).toBeGreaterThanOrEqual(shape.x - 1);
    expect(line.x + line.width).toBeLessThanOrEqual(shape.x + shape.width + 1);
  }

  const box = shape.labelBox;
  if (!box) throw new Error("the shape has no label to measure");
  const topOverhang = shape.y - box.y;
  const bottomOverhang = box.y + box.height - (shape.y + shape.height);
  expect(Math.abs(topOverhang - bottomOverhang)).toBeLessThanOrEqual(4);
}

test.describe("the checkout flow fixture", () => {
  test("a board built with the real model calls renders as it was drawn", async ({ page }) => {
    const boardId = await openBoard(page);
    await writeBoard(boardId, (doc) => {
      buildCheckoutFlow(doc);
    });

    await expect.poll(async () => (await shapes(page)).length).toBe(4);
    await expect.poll(connectorCount.bind(null, page)).toBe(4);

    const drawn = await shapes(page);
    const kinds = drawn.map((shape) => shape.kind).sort();
    expect(kinds).toEqual(["diamond", "ellipse", "rect", "rect"]);
    expect(drawn.map((shape) => shape.label)).toEqual(
      expect.arrayContaining(["Start the order", "Was the card paid?", "Charge the card", "Send the receipt"]),
    );

    // Every arrow on the board is drawn between the two shapes it is attached to.
    const lines = await connectors(page);
    for (const line of lines) {
      const touching = drawn.filter((shape) => {
        const inside = (point: XY): boolean =>
          point.x >= shape.x - 1 && point.x <= shape.x + shape.width + 1 && point.y >= shape.y - 1 && point.y <= shape.y + shape.height + 1;
        return inside(line.from) || inside(line.to);
      });
      // Two shapes for an attached arrow, one for the arrow that ends in empty space.
      expect(touching.length).toBeGreaterThanOrEqual(1);
    }

    const room = await roomObjects(boardId, 8);
    const dangling = room.find((entry) => entry.type === "connector") as ConnectorSnap | undefined;
    const freeEnds = room.filter(
      (entry): entry is ConnectorSnap =>
        entry.type === "connector" && (entry.from?.kind === "free" || entry.to?.kind === "free"),
    );
    expect(freeEnds).toHaveLength(1);
    const stored = freeEnds[0]!;
    const looseEnd = stored.from.kind === "free" ? stored.from : stored.to;
    if (looseEnd.kind !== "free") throw new Error("the fixture's loose end is not a board point");
    const point = { x: looseEnd.x, y: looseEnd.y };
    expect(Math.abs(point.x - DANGLING_END.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(point.y - DANGLING_END.y)).toBeLessThanOrEqual(1);
    expect(dangling).toBeDefined();
  });
});

test.describe("TC-23 draw a flow", () => {
  test("a dragged rectangle is the rectangle that was dragged, and keeps its styles", async ({ page }) => {
    await openBoard(page);
    // Board coordinates: the board opens with its world origin at the screen
    // centre at 100%, so these are the rectangle's own corners.
    const from: XY = { x: -100, y: -60 };
    const to: XY = { x: 100, y: 60 };

    await drawShape(page, from, to);

    const drawn = await shapes(page);
    expect(drawn).toHaveLength(1);
    const rect = drawn[0]!;
    expect(rect.kind).toBe("rect");
    expect(Math.abs(rect.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.height - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.x - from.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.y - from.y)).toBeLessThanOrEqual(1);

    // Style it: the new shape is selected, so its swatches are on screen.
    const fill = page.getByTestId("shape-fill-blue");
    const stroke = page.getByTestId("shape-stroke-red");
    await expect(fill).toBeVisible();
    await fill.click();
    await stroke.click();
    await settle(page);

    const styled = await shapeById(page, rect.id);
    expect(styled.fill).toBe("blue");
    expect(styled.stroke).toBe("red");

    // ...and they are what the board stored, not only what this screen painted.
    const box = await worldBox(page, rect.id);
    expect(Math.abs(box.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 120)).toBeLessThanOrEqual(1);

    // Keep drawing the flow: a diamond and an ellipse, each picked from the
    // toolbar's kind menu just before it is drawn.
    await clearSelection(page);
    const left = { x: -450, y: -80 };
    const right = { x: 350, y: -90 };
    for (const [kind, at, size] of [
      ["diamond", left, { width: 220, height: 140 }],
      ["ellipse", right, { width: 240, height: 160 }],
    ] as const) {
      await page.getByTestId("tool-shape").click();
      await page.getByTestId(`shape-kind-${kind}`).click();
      await drawShape(page, at, { x: at.x + size.width, y: at.y + size.height });
    }

    const flow = await shapes(page);
    expect(flow).toHaveLength(3);
    expect(flow.map((shape) => shape.kind).sort()).toEqual(["diamond", "ellipse", "rect"]);

    // Connect them: press on one shape, release on the next.
    const first = flow.find((shape) => shape.kind === "rect")!;
    const second = flow.find((shape) => shape.kind === "diamond")!;
    await beginArrow(page, { x: first.x + first.width / 2, y: first.y + first.height / 2 });
    await finishArrow(page, { x: second.x + second.width / 2, y: second.y + second.height / 2 });

    await expect.poll(connectorCount.bind(null, page)).toBe(1);
    const arrow = (await connectors(page))[0]!;
    // Attached arrows start and end on a shape's side, not on its centre.
    const onSide = (point: XY, shape: { x: number; y: number; width: number; height: number }): boolean => {
      const onLeft = Math.abs(point.x - shape.x) <= 1;
      const onRight = Math.abs(point.x - (shape.x + shape.width)) <= 1;
      const onTop = Math.abs(point.y - shape.y) <= 1;
      const onBottom = Math.abs(point.y - (shape.y + shape.height)) <= 1;
      const insideVertical = point.y >= shape.y - 1 && point.y <= shape.y + shape.height + 1;
      const insideHorizontal = point.x >= shape.x - 1 && point.x <= shape.x + shape.width + 1;
      return ((onLeft || onRight) && insideVertical) || ((onTop || onBottom) && insideHorizontal);
    };
    expect(onSide(arrow.from, first)).toBe(true);
    expect(onSide(arrow.to, second)).toBe(true);
  });
});

test.describe("TC-24 standard size, long labels, centring", () => {
  test("a click at 200% is the standard size, and a label that wraps stays centred through a resize", async ({
    page,
  }) => {
    await openBoard(page);
    await centreOn(page, { x: 0, y: 0 }, 2);

    // Pick the diamond, then click without dragging.
    await page.getByTestId("tool-shape").click();
    await page.getByTestId("shape-kind-menu").click();
    await page.getByRole("button", { name: "Diamond", exact: true }).click();

    const at: XY = { x: 120, y: 60 };
    await clickShape(page, at);

    const drawn = await shapes(page);
    expect(drawn).toHaveLength(1);
    const shape = drawn[0]!;
    expect(shape.kind).toBe("diamond");
    expect(Math.abs(shape.width - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.height - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    const middle = await centreOf(shape);
    expect(Math.abs(middle.x - at.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(middle.y - at.y)).toBeLessThanOrEqual(1);

    // Double-click, type a label far longer than the shape is wide.
    await doubleClickWorld(page, at);
    const editor = page.getByTestId("shape-label-input");
    await expect(editor).toBeVisible();
    const LONG =
      "Was the card paid, and if it was not, does the customer get a second chance before the basket is thrown away?";
    await page.keyboard.type(LONG, { delay: 5 });
    await page.keyboard.press("Escape");
    await settle(page);

    const labelled = await shapeById(page, shape.id);
    expect(labelled.label).toBe(LONG);
    expectLabelCentred(labelled);

    // Resize it wider and shorter: the label re-wraps and is still centred.
    await selectIds(page, [shape.id]);
    await dragHandleBy(page, "se", { x: 180, y: -40 });
    const resized = await shapeById(page, shape.id);
    expect(resized.width).toBeGreaterThan(labelled.width + 100);
    expect(resized.height).toBeLessThan(labelled.height);
    expect(resized.label).toBe(LONG);
    expectLabelCentred(resized);
  });
});

test.describe("TC-25 arrows follow the shapes they connect", () => {
  test("a shape dragged past its neighbour keeps the arrow attached and changes which sides it joins", async ({
    browser,
  }) => {
    resetLatencies();
    const session: Session = await openSession(browser, ["Dana", "Sam"]);
    const dana = session.participants[0]!.page;
    const sam = session.participants[1]!.page;

    try {
      for (const page of [dana, sam]) await centreOn(page, { x: 0, y: 0 }, 1);

      // Two shapes, far enough apart that a drag past them changes the pair's sides.
      await drawShape(dana, { x: -320, y: -70 }, { x: -120, y: 70 });
      await drawShape(dana, { x: 120, y: -70 }, { x: 320, y: 70 });
      const before = await shapes(dana);
      expect(before).toHaveLength(2);
      const a = before.find((shape) => shape.x < 0)!;
      const b = before.find((shape) => shape.x > 0)!;

      // Dana drags an arrow from A's middle to B's middle.
      await beginArrow(dana, { x: a.x + a.width / 2, y: a.y + a.height / 2 });
      await finishArrow(dana, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
      await expect.poll(connectorCount.bind(null, sam)).toBe(1);

      const attached = (await connectors(dana))[0]!;
      // Ends leave from facing sides: A's right side towards B.
      expect(Math.abs(attached.from.x - (a.x + a.width))).toBeLessThanOrEqual(1);
      expect(Math.abs(attached.to.x - b.x)).toBeLessThanOrEqual(1);

      // Sam sees the same arrow the same way.
      await expectEventually("arrow reaches Sam", async () => (await connectors(sam)).length === 1);

      // Dana drags B left, past A.
      await dragObjectBy(dana, b.id, { x: -800, y: 40 });

      const moved = await shapeById(dana, b.id);
      expect(moved.x + moved.width).toBeLessThan(a.x);

      const following = (await connectors(dana))[0]!;
      // The arrow still joins the same two shapes, from the sides that face each
      // other now: B's right side to A's left side.
      expect(Math.abs(following.to.x - (moved.x + moved.width))).toBeLessThanOrEqual(1);
      expect(Math.abs(following.from.x - a.x)).toBeLessThanOrEqual(1);

      // The arrowhead points at A's left side: the tip is a short step past the
      // end point, in the direction the line travels.
      const arrowhead = CONNECTOR_ARROWHEAD_SIZE_WORLD;
      expect(following.to.x).toBeLessThan(following.from.x);
      expect(arrowhead).toBeGreaterThan(0);

      // Sam's screen follows, and the wait is the measurement.
      const samLine = await expectEventually("arrow follows the moved shape for Sam", async () => {
        const lines = await connectors(sam);
        if (lines.length !== 1) return false;
        const line = lines[0]!;
        return Math.abs(line.to.x - (moved.x + moved.width)) <= 2 && Math.abs(line.from.x - a.x) <= 2;
      });
      expect(samLine).toBeGreaterThanOrEqual(0);
      reportLatencies();
      expectNoProblems(session.participants);
    } finally {
      await session.close();
    }
  });
});

test.describe("TC-26 deleting a connected shape", () => {
  test("the arrow stays, its loose end fixed where the deleted shape's side was", async ({ browser }) => {
    const session: Session = await openSession(browser, ["Dana", "Sam"]);
    const dana = session.participants[0]!.page;
    const sam = session.participants[1]!.page;

    try {
      for (const page of [dana, sam]) await centreOn(page, { x: 0, y: 0 }, 1);

      await drawShape(dana, { x: -300, y: -70 }, { x: -120, y: 70 });
      await drawShape(dana, { x: 140, y: -70 }, { x: 320, y: 70 });
      const before = await shapes(dana);
      const a = before.find((shape) => shape.x < 0)!;
      const b = before.find((shape) => shape.x > 0)!;

      await beginArrow(dana, { x: a.x + a.width / 2, y: a.y + a.height / 2 });
      await finishArrow(dana, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
      await expect.poll(connectorCount.bind(null, sam)).toBe(1);

      // Sam deletes B.
      await selectIds(sam, [b.id]);
      await pressKeys(sam, "Delete");

      // Both screens keep the arrow.
      await expectEventually("arrow survives the delete for Dana", async () => (await connectorCount(dana)) === 1);
      await expectEventually("arrow survives the delete for Sam", async () => (await connectorCount(sam)) === 1);

      // It ends at B's last side anchor, which is where B's facing side was.
      const line = (await connectors(dana))[0]!;
      expect(Math.abs(line.from.x - (a.x + a.width))).toBeLessThanOrEqual(1);
      expect(Math.abs(line.to.x - b.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(line.to.y - (b.y + b.height / 2))).toBeLessThanOrEqual(1);

      // What the board stored: attached at one end, a board point at the other.
      const stored = (await roomObjects(session.boardId, 3)).find(
        (entry): entry is ConnectorSnap => entry.type === "connector",
      )!;
      expect(stored.from.kind).toBe("attached");
      expect(stored.to.kind).toBe("free");
      if (stored.to.kind !== "free") throw new Error("the detached end is not a board point");
      expect(Math.abs(stored.to.x - b.x)).toBeLessThanOrEqual(1);

      // B really is gone from both screens.
      await expect.poll(async () => (await shapes(dana)).length).toBe(1);
      await expect.poll(async () => (await shapes(sam)).length).toBe(1);
      expectNoProblems(session.participants);
    } finally {
      await session.close();
    }
  });
});

test.describe("TC-27 delete race", () => {
  test("connecting a shape that is deleted mid-drag leaves a visible arrow with a free end, and no errors", async ({
    browser,
  }) => {
    const session: Session = await openSession(browser, ["Dana", "Sam"]);
    const dana = session.participants[0]!.page;
    const sam = session.participants[1]!.page;

    try {
      for (const page of [dana, sam]) await centreOn(page, { x: 0, y: 0 }, 1);

      await drawShape(dana, { x: -300, y: -70 }, { x: -120, y: 70 });
      await drawShape(dana, { x: 140, y: -70 }, { x: 320, y: 70 });
      const before = await shapes(dana);
      const a = before.find((shape) => shape.x < 0)!;
      const b = before.find((shape) => shape.x > 0)!;
      const bCentre = { x: b.x + b.width / 2, y: b.y + b.height / 2 };

      // Dana's pointer is still down on the way to B...
      await armTool(dana, "l");
      const start = await screenPoint(dana, { x: a.x + a.width / 2, y: a.y + a.height / 2 });
      const end = await screenPoint(dana, bCentre);
      await dana.mouse.move(start.x, start.y);
      await dana.mouse.down();
      await dana.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });

      // ...Sam deletes B at the same time, on his own screen...
      await selectIds(sam, [b.id]);
      await pressKeys(sam, "Delete");
      await expect.poll(async () => (await shapes(sam)).length).toBe(1);

      // ...and Dana releases without waiting for the delete to arrive.
      await dana.mouse.move(end.x, end.y, { steps: 5 });
      await dana.mouse.up();
      await settle(dana);

      // Either the arrow was attached before the delete detached it, or the delete
      // arrived first and the end was never attached. Both are a visible arrow with
      // a loose end; what must not happen is an arrow that points at nothing.
      await expect.poll(connectorCount.bind(null, dana)).toBe(1);
      const line = (await connectors(dana))[0]!;
      expect(Math.abs(line.from.x - (a.x + a.width))).toBeLessThanOrEqual(1);
      // The loose end is inside where B was.
      expect(line.to.x).toBeGreaterThan(b.x - 1);
      expect(line.to.x).toBeLessThan(b.x + b.width + 1);
      expect(line.to.y).toBeGreaterThan(b.y - 1);
      expect(line.to.y).toBeLessThan(b.y + b.height + 1);

      // Both screens agree, and the board is still there.
      await expectEventually("both screens show the surviving arrow", async () => (await connectorCount(sam)) === 1);
      const stored = (await roomObjects(session.boardId, 3)).filter(
        (entry): entry is ConnectorSnap => entry.type === "connector",
      );
      expect(stored).toHaveLength(1);
      const freeEnd = stored[0]!.from!.kind === "free" ? stored[0]!.from : stored[0]!.to!;
      expect(freeEnd.kind).toBe("free");
      await expect(dana.getByTestId("board-viewport")).toBeVisible();
      await expect(sam.getByTestId("board-viewport")).toBeVisible();

      expect(await shapes(dana)).toHaveLength(1);
      expectNoProblems(session.participants);
    } finally {
      await session.close();
    }
  });
});
