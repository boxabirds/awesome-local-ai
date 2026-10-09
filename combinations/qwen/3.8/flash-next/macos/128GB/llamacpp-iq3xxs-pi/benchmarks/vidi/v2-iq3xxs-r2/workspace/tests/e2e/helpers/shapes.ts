import { expect, type Page } from '@playwright/test';
import { PIXEL_TOLERANCE, dragPointer, settle, type Rect } from './board';

/**
 * Shapes and arrows in real browsers (story 10).
 *
 * Two readings, as the other suites do: the document each browser is holding (`boardDoc()`),
 * which is what another person would see, and the DOM, which is what this person sees. A shape
 * has the same numbers in both, and an arrow has more in the DOM than the document stores,
 * because where its ends are is worked out from where its objects are.
 */

export const SHAPE_TOOL_LABEL = 'Shape (S)';
export const CONNECTOR_TOOL_LABEL = 'Connector (L)';

export type ShapeKind = 'rect' | 'ellipse' | 'diamond';

/** Any object in this browser's document, with the fields story 10's types carry. */
export interface BoardObjectRecord {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: string;
  readonly text: string;
  readonly createdAt: number;
  readonly kind: string;
  readonly fill: string;
  readonly stroke: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly from: EndRecord | null;
  readonly to: EndRecord | null;
}

export interface ShapeRecord extends BoardObjectRecord {
  readonly kind: string;
  readonly fill: string;
  readonly stroke: string;
  readonly label: string;
}

/** One endpoint of an arrow, as the document holds it. */
export interface EndRecord {
  readonly kind: string;
  readonly objectId?: string;
  readonly x?: number;
  readonly y?: number;
}

export interface ConnectorRecord {
  readonly id: string;
  readonly type: string;
  readonly from: EndRecord;
  readonly to: EndRecord;
  /** Where the ends are drawn, in board units — the resolved answer, read from the DOM. */
  readonly ends: { readonly from: XY; readonly to: XY };
  /** Which side of its object each end sits on, or '' when the end is free or orphaned. */
  readonly sides: { readonly from: string; readonly to: string };
  readonly orphaned: boolean;
}

export interface XY {
  readonly x: number;
  readonly y: number;
}

/** Every object in this browser's document, with the fields story 10's types carry. */
export async function objectsIn(page: Page): Promise<BoardObjectRecord[]> {
  return page.evaluate(() => {
    const doc = window.__vidi6?.boardDoc?.();
    if (!doc) throw new Error('test hook window.__vidi6.boardDoc() is missing');
    const objects = doc.getMap('objects').toJSON() as Record<string, Record<string, unknown>>;
    return Object.entries(objects).map(([id, value]) => ({
      id,
      type: String(value.type ?? ''),
      x: Number(value.x),
      y: Number(value.y),
      z: Number(value.z),
      color: String(value.color ?? ''),
      text: String(value.text ?? value.label ?? ''),
      createdAt: Number(value.createdAt),
      kind: String(value.kind ?? ''),
      fill: String(value.fill ?? ''),
      stroke: String(value.stroke ?? ''),
      label: String(value.label ?? ''),
      width: Number(value.width),
      height: Number(value.height),
      from: (value.from ?? null) as EndRecord | null,
      to: (value.to ?? null) as EndRecord | null,
    }));
  });
}

export async function shapesOn(page: Page): Promise<ShapeRecord[]> {
  const objects = await objectsIn(page);
  return objects
    .filter((object) => object.type === 'shape')
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The arrows this browser can see, with their ends read from the DOM it drew. */
export async function connectorsOn(page: Page): Promise<ConnectorRecord[]> {
  const stored = (await objectsIn(page)).filter((object) => object.type === 'connector');
  const drawn = await page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="connector-object"]')).map(
      (element) => ({
        id: element.dataset.noteId ?? '',
        fromX: Number(element.dataset.connectorFromX),
        fromY: Number(element.dataset.connectorFromY),
        toX: Number(element.dataset.connectorToX),
        toY: Number(element.dataset.connectorToY),
        fromSide: element.dataset.connectorFromSide ?? '',
        toSide: element.dataset.connectorToSide ?? '',
        fromKind: element.dataset.connectorFromKind ?? '',
        toKind: element.dataset.connectorToKind ?? '',
        fromObject: element.dataset.connectorFromObject ?? '',
        toObject: element.dataset.connectorToObject ?? '',
        orphaned: element.dataset.connectorOrphaned === 'true',
      }),
    );
  });
  return stored
    .map((object) => {
      const element = drawn.find((entry) => entry.id === object.id);
      if (!element) throw new Error(`arrow ${object.id} is in the document but not on screen`);
      return {
        id: object.id,
        type: object.type,
        from: object.from ?? { kind: element.fromKind },
        to: object.to ?? { kind: element.toKind },
        ends: { from: { x: element.fromX, y: element.fromY }, to: { x: element.toX, y: element.toY } },
        sides: { from: element.fromSide, to: element.toSide },
        orphaned: element.orphaned,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function waitForShapes(page: Page, count: number): Promise<ShapeRecord[]> {
  let shapes: ShapeRecord[] = [];
  await expect
    .poll(async () => (await shapesOn(page)).length, { timeout: 15_000 })
    .toBe(count);
  shapes = await shapesOn(page);
  return shapes;
}

export async function waitForConnectors(page: Page, count: number): Promise<ConnectorRecord[]> {
  let connectors: ConnectorRecord[] = [];
  await expect
    .poll(async () => (await connectorsOn(page)).length, { timeout: 15_000 })
    .toBe(count);
  connectors = await connectorsOn(page);
  return connectors;
}

/* ---------------------------------------------------------------------------
 * The tools.
 * ------------------------------------------------------------------------ */

export async function clickShapeTool(page: Page): Promise<void> {
  await page.locator(`button[aria-label="${SHAPE_TOOL_LABEL}"]`).click();
  await settle(page);
}

export async function clickConnectorTool(page: Page): Promise<void> {
  await page.locator(`button[aria-label="${CONNECTOR_TOOL_LABEL}"]`).click();
  await settle(page);
}

export async function clickShapeKind(page: Page, kind: ShapeKind): Promise<void> {
  await page.locator(`[data-testid="shape-kind-${kind}"]`).click();
  await settle(page);
}

export async function shapeKindPressed(page: Page, kind: ShapeKind): Promise<boolean> {
  return (
    (await page.locator(`[data-testid="shape-kind-${kind}"]`).getAttribute('aria-pressed')) === 'true'
  );
}

export async function toolPressed(page: Page, testId: string): Promise<boolean> {
  return (await page.locator(`[data-testid="${testId}"]`).getAttribute('aria-pressed')) === 'true';
}

/** Draw a shape by dragging, or by a single click when `to` is left out. */
export async function drawShape(page: Page, from: XY, to?: XY): Promise<void> {
  if (to) await dragPointer(page, from, to);
  else {
    await page.mouse.click(Math.round(from.x), Math.round(from.y));
    await settle(page);
  }
}

/** Drag an arrow from one object to another (or to empty board). */
export async function drawConnector(page: Page, from: XY, to: XY, steps = 8): Promise<void> {
  await dragPointer(page, from, to, steps);
}

/** The middle of a shape, on screen: where a click lands on it. */
export async function shapeCentre(page: Page, id: string): Promise<XY> {
  const box = await page.locator(`[data-testid="shape-object"][data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`shape ${id} has no bounding box (is it on screen?)`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A shape's box on screen, in CSS pixels. */
export async function shapeScreenRect(page: Page, id: string): Promise<Rect> {
  const box = await page.locator(`[data-testid="shape-object"][data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`shape ${id} has no bounding box (is it on screen?)`);
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
  };
}

/**
 * The label as it is drawn: how many lines it took, and whether it is centred in the shape.
 *
 * `lines` counts rendered line boxes by measuring the label's own height against its line
 * height, which is the thing the PRD claims — that a label longer than the shape wraps rather
 * than runs out of it, and that a resize re-wraps it rather than moving it aside.
 */
export async function shapeLabelMetrics(page: Page, id: string): Promise<{
  lines: number;
  labelCentreX: number;
  shapeCentreX: number;
  labelCentreY: number;
  shapeCentreY: number;
  text: string;
}> {
  return page.evaluate((shapeId) => {
    const shape = document.querySelector<HTMLElement>(
      `[data-testid="shape-object"][data-note-id="${shapeId}"]`,
    );
    if (!shape) throw new Error(`no shape element for id ${shapeId}`);
    const label = shape.querySelector<HTMLElement>('[data-testid="shape-label"]');
    if (!label) throw new Error(`shape ${shapeId} has no label layer`);
    const shapeBox = shape.getBoundingClientRect();
    const labelBox = label.getBoundingClientRect();
    // The honest count of the lines the browser painted, not an arithmetic guess.
    const range = document.createRange();
    range.selectNodeContents(label);
    const rects = range.getClientRects();
    return {
      lines: rects.length > 0 ? rects.length : 1,
      labelCentreX: labelBox.x + labelBox.width / 2,
      shapeCentreX: shapeBox.x + shapeBox.width / 2,
      labelCentreY: labelBox.y + labelBox.height / 2,
      shapeCentreY: shapeBox.y + shapeBox.height / 2,
      text: label.textContent ?? '',
    };
  }, id);
}

/**
 * Draw a shape with the tool and hand back its id: a drag when `to` is given, a click when it
 * is not. The tool goes back to Select afterwards, which is what the PRD asks for and what
 * makes the next action in a test a normal one.
 */
export async function createShapeOnBoard(page: Page, from: XY, to?: XY): Promise<string> {
  const before = (await shapesOn(page)).map((shape) => shape.id);
  await clickShapeTool(page);
  await drawShape(page, from, to);
  const created = (await shapesOn(page)).find((shape) => !before.includes(shape.id));
  if (!created) throw new Error(`the Shape tool created no shape at ${JSON.stringify(from)}`);
  return created.id;
}

/** Click the middle of a shape: it becomes this browser's selection. */
export async function selectShape(page: Page, id: string): Promise<void> {
  const centre = await shapeCentre(page, id);
  await page.mouse.click(Math.round(centre.x), Math.round(centre.y));
  await settle(page);
}

/**
 * Delete what is selected, with the key the PRD names. (The selection bar only appears for a
 * single text object or for two or more things, so a lone shape is deleted by keyboard.)
 */
export async function deleteSelectionOnBoard(page: Page): Promise<void> {
  await page.keyboard.press('Delete');
  await settle(page);
}

/** Click a fill or outline swatch in the shape toolbar, by the label the PRD gives it. */
export async function clickShapeSwatch(page: Page, label: string): Promise<void> {
  await page.locator(`button[aria-label="${label}"]`).click();
  await settle(page);
}

/** Type into the shape's label editor, once it is being edited. */
export async function typeShapeLabel(page: Page, text: string): Promise<void> {
  const editor = page.locator('[data-testid="shape-editor"]');
  await editor.waitFor();
  await page.keyboard.type(text);
  await settle(page);
}

/** Double-click a shape to edit its label. */
export async function editShapeLabel(page: Page, id: string): Promise<void> {
  const centre = await shapeCentre(page, id);
  await page.mouse.dblclick(Math.round(centre.x), Math.round(centre.y));
  await settle(page);
}

/** End editing: Escape keeps the shape selected, as it does for every other type. */
export async function endShapeEdit(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await settle(page);
}

export async function selectedShapeIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="shape-object"][data-selected="true"]'),
    ).map((element) => element.dataset.noteId ?? ''),
  );
}

export async function selectedConnectorIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="connector-object"][data-selected="true"]'),
    ).map((element) => element.dataset.noteId ?? ''),
  );
}

/** Drag one of an arrow's end handles, by which end it is. */
export async function dragConnectorHandle(
  page: Page,
  id: string,
  end: 'from' | 'to',
  to: XY,
  steps = 6,
): Promise<void> {
  const handle = page.locator(
    `[data-testid="connector-object"][data-note-id="${id}"] [data-testid="connector-handle-${end}"]`,
  );
  const box = await handle.boundingBox();
  if (!box) throw new Error(`arrow ${id} has no ${end} handle on screen`);
  await dragPointer(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    to,
    steps,
  );
}

/** The four connection dots the Connector tool shows for the object under the pointer. */
export async function connectionDots(
  page: Page,
): Promise<Array<{ side: string; x: number; y: number; highlighted: boolean }>> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="connector-dot"]')).map((dot) => {
      const box = dot.getBoundingClientRect();
      return {
        side: dot.dataset.connectorSide ?? '',
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        // Playwright cannot read a dataset through the map above, so the highlight is a class.
        highlighted: dot.dataset.highlighted === 'true',
      } as { side: string; x: number; y: number; highlighted: boolean };
    }),
  );
}

export const SHAPE_TOLERANCE = PIXEL_TOLERANCE;
