import { expect, type Page } from "@playwright/test";
import * as Y from "yjs";
import { snapshot, type ObjectSnapshot } from "../../../src/shared/board-model";
import { E2E_PORT } from "./api";
import { boardBox, renderedCamera } from "./board";
import { settle } from "./notes";
import { screenOf } from "./selection";
import { openSyncClient } from "./sync-client";

/**
 * Shapes and arrows, read from the rendered board (story 10).
 *
 * Board state is read from the room through the sync protocol (`roomObjects`),
 * and geometry from what the browser actually painted (`shapes`, `connectors`) —
 * both in board units, converted through the camera the board is really rendered
 * with. A gesture helper takes **board** points and moves the mouse to the pixels
 * those points appear at, so a test says "draw from here to there" and never has
 * to know where the board happens to be.
 */

export interface XY {
  x: number;
  y: number;
}

export interface ShapeDom {
  id: string;
  kind: string;
  label: string;
  /** Board units. */
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  selected: boolean;
  /** Line boxes the browser laid the label out into. */
  labelLines: number;
  /** Board units: one entry per line box the label was laid out into. */
  labelRects: { x: number; y: number; width: number; height: number; centreX: number }[];
  /** Board units: where the label's words actually sit, or null when empty. */
  labelBox: { x: number; y: number; width: number; height: number } | null;
}

export interface ConnectorDom {
  id: string;
  /** Board units: the ends the arrow is actually drawn between. */
  from: XY;
  to: XY;
  selected: boolean;
}

async function cameraOf(page: Page): Promise<{ area: { x: number; y: number }; camera: { x: number; y: number; zoom: number } }> {
  return { area: await boardBox(page), camera: await renderedCamera(page) };
}

function toWorld(point: XY, area: { x: number; y: number }, camera: { x: number; y: number; zoom: number }): XY {
  return { x: (point.x - area.x) / camera.zoom + camera.x, y: (point.y - area.y) / camera.zoom + camera.y };
}

/** Every shape on screen, in board units. */
export async function shapes(page: Page): Promise<ShapeDom[]> {
  const { area, camera } = await cameraOf(page);
  const raw = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="shape-object"]')).map((element) => {
      const box = element.getBoundingClientRect();
      const label = element.querySelector<HTMLElement>('[data-testid="shape-label"]');
      let lines = 0;
      let text: { left: number; top: number; right: number; bottom: number } | null = null;
      let perLine: { left: number; top: number; width: number; height: number; centreX: number }[] = [];
      if (label && label.firstChild) {
        // One line box per distinct top: a wrapped label is the number of lines
        // the browser really laid it out into, and their union is where the words
        // actually sit.
        const range = document.createRange();
        range.selectNodeContents(label);
        const rects = Array.from(range.getClientRects());
        // One entry per *line*: Chrome reports a wrapped line as the run of words
        // plus a separate rect for the space that hangs at its end, so the rects
        // are grouped by the top they share and the widest one in a group is the
        // line's own run of words.
        const groups = new Map<number, DOMRect[]>();
        for (const rect of rects) {
          const key = Math.round(rect.top);
          const list = groups.get(key) ?? [];
          list.push(rect);
          groups.set(key, list);
        }
        const widest = [...groups.values()].map(
          (group) => group.reduce((a, b) => (a.width >= b.width ? a : b)),
        );
        lines = widest.length;
        if (widest.length > 0) {
          text = {
            left: Math.min(...widest.map((rect) => rect.left)),
            top: Math.min(...widest.map((rect) => rect.top)),
            right: Math.max(...widest.map((rect) => rect.right)),
            bottom: Math.max(...widest.map((rect) => rect.bottom)),
          };
          perLine = widest.map((rect) => ({
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            centreX: rect.left + rect.width / 2,
          }));
        }
      }
      return {
        id: element.getAttribute("data-note-id") ?? "",
        kind: element.getAttribute("data-shape-kind") ?? "",
        label: label ? label.textContent ?? "" : "",
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
        fill: element.getAttribute("data-fill") ?? "",
        stroke: element.getAttribute("data-stroke") ?? "",
        selected: element.getAttribute("data-selected") === "true",
        labelLines: lines,
        perLine,
        text,
      };
    }),
  );

  return raw.map((entry) => {
    const at = toWorld({ x: entry.x, y: entry.y }, area, camera);
    const text = entry.text;
    return {
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      fill: entry.fill,
      stroke: entry.stroke,
      selected: entry.selected,
      labelLines: entry.labelLines,
      labelRects: entry.perLine.map((rect) => ({
        x: (rect.left - area.x) / camera.zoom + camera.x,
        y: (rect.top - area.y) / camera.zoom + camera.y,
        width: rect.width / camera.zoom,
        height: rect.height / camera.zoom,
        centreX: (rect.centreX - area.x) / camera.zoom + camera.x,
      })),
      labelBox: text
        ? {
            x: (text.left - area.x) / camera.zoom + camera.x,
            y: (text.top - area.y) / camera.zoom + camera.y,
            width: (text.right - text.left) / camera.zoom,
            height: (text.bottom - text.top) / camera.zoom,
          }
        : null,
      x: at.x,
      y: at.y,
      width: entry.width / camera.zoom,
      height: entry.height / camera.zoom,
    };
  });
}

export async function shapeById(page: Page, id: string): Promise<ShapeDom> {
  const found = (await shapes(page)).find((shape) => shape.id === id);
  if (!found) throw new Error(`no shape ${id} on screen`);
  return found;
}

/** Every arrow on screen, in board units, read from the line the browser drew. */
export async function connectors(page: Page): Promise<ConnectorDom[]> {
  const { area, camera } = await cameraOf(page);
  const raw = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="connector-object"]')).map((element) => {
      const svg = element.querySelector("svg");
      const line = element.querySelector("line");
      if (!svg || !line) throw new Error("connector object has no line");
      const box = svg.getBoundingClientRect();
      const view = (svg.getAttribute("viewBox") ?? "0 0 1 1").split(/\s+/).map(Number);
      // The viewBox is in board units and the element is drawn at zoom, so this
      // is the scale the line's own coordinates are drawn at.
      const scale = box.width / (view[2] || 1);
      return {
        id: element.getAttribute("data-note-id") ?? "",
        selected: element.getAttribute("data-selected") === "true",
        from: { x: box.left + Number(line.getAttribute("x1")) * scale, y: box.top + Number(line.getAttribute("y1")) * scale },
        to: { x: box.left + Number(line.getAttribute("x2")) * scale, y: box.top + Number(line.getAttribute("y2")) * scale },
      };
    }),
  );

  return raw.map((entry) => ({
    ...entry,
    from: toWorld(entry.from, area, camera),
    to: toWorld(entry.to, area, camera),
  }));
}

export async function connectorById(page: Page, id: string): Promise<ConnectorDom> {
  const found = (await connectors(page)).find((connector) => connector.id === id);
  if (!found) throw new Error(`no connector ${id} on screen`);
  return found;
}

export async function shapeCount(page: Page): Promise<number> {
  return page.locator('[data-testid="shape-object"]').count();
}

export async function connectorCount(page: Page): Promise<number> {
  return page.locator('[data-testid="connector-object"]').count();
}

/** Arms one of story 10's tools and waits for the board to say it is armed. */
export async function armTool(page: Page, key: "s" | "l"): Promise<void> {
  await page.keyboard.press(key);
  await settle(page);
  await expect(page.getByTestId("board-viewport")).toHaveAttribute("data-tool", key === "s" ? "shape" : "connector");
}

export async function pressWorld(page: Page, at: XY): Promise<XY> {
  const point = await screenOf(page, at);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  return point;
}

export async function moveWorld(page: Page, at: XY, steps = 6): Promise<void> {
  const target = await screenOf(page, at);
  const current = await screenOf(page, { x: 0, y: 0 });
  void current;
  await page.mouse.move(target.x, target.y, { steps });
}

export async function releaseWorld(page: Page, at: XY): Promise<XY> {
  const point = await screenOf(page, at);
  await page.mouse.move(point.x, point.y);
  await page.mouse.up();
  await settle(page);
  return point;
}

/** Press, drag and release between two board points. */
export async function dragWorld(
  page: Page,
  from: XY,
  to: XY,
  options: { steps?: number; shift?: boolean } = {},
): Promise<void> {
  const start = await screenOf(page, from);
  const end = await screenOf(page, to);
  const steps = options.steps ?? 10;
  if (options.shift) await page.keyboard.down("Shift");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(start.x + ((end.x - start.x) * step) / steps, start.y + ((end.y - start.y) * step) / steps);
  }
  await page.mouse.up();
  if (options.shift) await page.keyboard.up("Shift");
  await settle(page);
}

/** The Shape tool's gesture: press, drag, release. */
export async function drawShape(page: Page, from: XY, to: XY, options: { shift?: boolean } = {}): Promise<void> {
  await armTool(page, "s");
  await dragWorld(page, from, to, { shift: options.shift });
  await expect(page.getByTestId("board-viewport")).toHaveAttribute("data-tool", "select");
}

/** The Connector tool's gesture, as two halves so a test can hold it open. */
export async function beginArrow(page: Page, from: XY, mid?: XY): Promise<void> {
  await armTool(page, "l");
  await pressWorld(page, from);
  if (mid) await moveWorld(page, mid);
}

export async function finishArrow(page: Page, to: XY): Promise<void> {
  await releaseWorld(page, to);
  await expect(page.getByTestId("board-viewport")).toHaveAttribute("data-tool", "select");
}

/** A click with the Shape tool: the standard shape, centred on the point. */
export async function clickShape(page: Page, at: XY): Promise<void> {
  await armTool(page, "s");
  const point = await screenOf(page, at);
  await page.mouse.click(point.x, point.y);
  await settle(page);
}

/**
 * Writes a board into a live room with the real model calls, from Node.
 *
 * The fixture is applied to the document the room already has, and only the
 * updates this call produced are sent — the same frames the browser client sends.
 */
export async function writeBoard(boardId: string, build: (doc: Y.Doc) => void): Promise<void> {
  const client = await openSyncClient(E2E_PORT, boardId);
  client.requestSync();
  await new Promise((resolve) => setTimeout(resolve, 150));

  const updates: Uint8Array[] = [];
  const observer = (update: Uint8Array, origin: unknown): void => {
    if (origin !== "remote") updates.push(update);
  };
  client.doc.on("update", observer);
  Y.transact(client.doc, () => build(client.doc));
  client.doc.off("update", observer);

  for (const update of updates) client.sendUpdate(update);
  await new Promise((resolve) => setTimeout(resolve, 150));
  client.close();
}

/** The board as the room has it. */
export async function roomObjects(boardId: string, atLeast: number): Promise<readonly ObjectSnapshot[]> {
  const client = await openSyncClient(E2E_PORT, boardId);
  client.requestSync();
  let objects: readonly ObjectSnapshot[] = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    objects = snapshot(client.doc);
    if (objects.length >= atLeast) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  client.close();
  return objects;
}

export async function roomConnector(boardId: string, id: string): Promise<ObjectSnapshot | undefined> {
  return (await roomObjects(boardId, 1)).find((entry) => entry.id === id);
}
