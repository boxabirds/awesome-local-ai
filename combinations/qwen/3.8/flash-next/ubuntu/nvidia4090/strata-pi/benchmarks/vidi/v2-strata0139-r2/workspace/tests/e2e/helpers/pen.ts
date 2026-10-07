import { expect, type Page } from "@playwright/test";
import { boardBox, renderedCamera, type XY } from "./board";
import { settle } from "./notes";
import { screenOf } from "./selection";

/**
 * Story 11 e2e helpers: the pen's gesture, and a stroke as the browser really draws
 * it.
 *
 * A stroke's box and its line are read out of the rendered SVG and converted to
 * **board units** through the camera the board is rendered with, so an assertion can
 * say "the line is 4 board units wide" and "its box kept its proportions" whatever
 * the zoom happens to be. Pen drags take board points, like every other gesture
 * helper in this suite.
 */

export interface StrokeDom {
  id: string;
  /** Board units. */
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  thickness: string;
  /** How many points the stroke's path holds. */
  points: number;
  selected: boolean;
  /** Board units: the width the line is actually drawn at. */
  lineWidth: number;
  /** The `d` of the drawn path, in the stroke's own board-unit coordinates. */
  pathD: string;
  /** Board units: the extremes of the drawn path. */
  pathBox: { x: number; y: number; width: number; height: number } | null;
}

async function cameraOf(page: Page): Promise<{ area: { x: number; y: number }; camera: { x: number; y: number; zoom: number } }> {
  return { area: await boardBox(page), camera: await renderedCamera(page) };
}

function toWorld(point: XY, area: { x: number; y: number }, camera: { x: number; y: number; zoom: number }): XY {
  return { x: (point.x - area.x) / camera.zoom + camera.x, y: (point.y - area.y) / camera.zoom + camera.y };
}

/** Arms the Pen and waits for the board to say it is armed. */
export async function armPen(page: Page): Promise<void> {
  await page.keyboard.press("p");
  await settle(page);
  await expect(page.getByTestId("board-viewport")).toHaveAttribute("data-tool", "pen");
}

export async function leavePen(page: Page): Promise<void> {
  await page.keyboard.press("v");
  await settle(page);
  await expect(page.getByTestId("board-viewport")).toHaveAttribute("data-tool", "select");
}

export async function penToolbarVisible(page: Page): Promise<boolean> {
  return (await page.getByTestId("pen-toolbar").count()) === 1;
}

/** Selects a pen colour or thickness from the board's own controls. */
export async function choosePen(page: Page, option: { color?: string; thickness?: string }): Promise<void> {
  if (option.color) await page.getByTestId(`pen-color-${option.color}`).click();
  if (option.thickness) await page.getByTestId(`pen-thickness-${option.thickness}`).click();
  await settle(page);
}

/** Every stroke on screen, in board units, read from what the browser painted. */
export async function strokes(page: Page): Promise<StrokeDom[]> {
  const { area, camera } = await cameraOf(page);
  const raw = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="stroke-object"]')).map((element) => {
      const box = element.getBoundingClientRect();
      const path = element.querySelector<SVGElement>('[data-testid="stroke-path"]');
      const dot = element.querySelector<SVGCircleElement>('[data-testid="stroke-dot"]');
      const drawn = path ?? dot;
      let pathBox: { left: number; top: number; right: number; bottom: number } | null = null;
      if (drawn) {
        // The browser's own idea of the drawn line's extent, in CSS pixels.
        const bounds = (drawn as SVGElement).getBoundingClientRect();
        pathBox = { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
      }
      return {
        id: element.getAttribute("data-note-id") ?? "",
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
        color: element.getAttribute("data-pen-color") ?? "",
        thickness: element.getAttribute("data-pen-thickness") ?? "",
        points: Number(element.getAttribute("data-stroke-points") ?? "0"),
        selected: element.getAttribute("data-selected") === "true",
        lineWidth: path
          ? Number(path.getAttribute("stroke-width") ?? "0")
          : Number(dot?.getAttribute("r") ?? "0") * 2,
        pathD: path?.getAttribute("d") ?? "",
        pathBox,
      };
    }),
  );

  return raw.map((entry) => {
    const at = toWorld({ x: entry.x, y: entry.y }, area, camera);
    const box = entry.pathBox;
    return {
      id: entry.id,
      color: entry.color,
      thickness: entry.thickness,
      points: entry.points,
      selected: entry.selected,
      lineWidth: entry.lineWidth,
      pathD: entry.pathD,
      x: at.x,
      y: at.y,
      width: entry.width / camera.zoom,
      height: entry.height / camera.zoom,
      pathBox: box
        ? {
            x: (box.left - area.x) / camera.zoom + camera.x,
            y: (box.top - area.y) / camera.zoom + camera.y,
            width: (box.right - box.left) / camera.zoom,
            height: (box.bottom - box.top) / camera.zoom,
          }
        : null,
    };
  });
}

export async function strokeCount(page: Page): Promise<number> {
  return page.getByTestId("stroke-object").count();
}

export async function strokeById(page: Page, id: string): Promise<StrokeDom> {
  const found = (await strokes(page)).find((stroke) => stroke.id === id);
  if (!found) throw new Error(`no stroke ${id} on screen`);
  return found;
}

/** The ids of the strokes on screen, in the order the board drew them. */
export async function strokeIds(page: Page): Promise<string[]> {
  return (await strokes(page)).map((stroke) => stroke.id);
}

/**
 * The stroke a gesture just created: the one stroke whose id was not on screen
 * before. DOM order says nothing about which stroke was drawn last, so a test has
 * to compare ids rather than trust the order they are painted in.
 */
export async function newStrokeSince(page: Page, before: readonly string[]): Promise<StrokeDom> {
  await expect
    .poll(async () => (await strokes(page)).filter((stroke) => !before.includes(stroke.id)).length, {
      timeout: 10_000,
    })
    .toBe(1);
  return (await strokes(page)).find((stroke) => !before.includes(stroke.id))!;
}

/**
 * A point that is certainly **on the drawn line**: the first point of the rendered
 * path, converted from the stroke's own coordinates to board coordinates. Grab this
 * when a gesture has to land on the line rather than in the box.
 */
export function pathStart(stroke: StrokeDom): XY {
  const start = stroke.pathD.match(/M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/);
  if (!start) throw new Error(`stroke ${stroke.id} draws no path`);
  return { x: stroke.x + Number(start[1]), y: stroke.y + Number(start[2]) };
}

/** Press at a board point and hold: the drag is open for the caller to continue. */
export async function pressPen(page: Page, at: XY): Promise<XY> {
  const point = await screenOf(page, at);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  return point;
}

export async function movePen(page: Page, at: XY, steps = 4): Promise<void> {
  const point = await screenOf(page, at);
  await page.mouse.move(point.x, point.y, { steps });
}

export async function releasePen(page: Page, at: XY): Promise<void> {
  const point = await screenOf(page, at);
  await page.mouse.move(point.x, point.y, { steps: 2 });
  await page.mouse.up();
  await settle(page);
}

/**
 * Draws a stroke through board points, slowly enough that the pointer really does
 * produce many points: the drag visits every point in order, with `steps` mouse
 * moves between each pair.
 */
export async function drawStroke(
  page: Page,
  worldPoints: readonly XY[],
  options: { steps?: number } = {},
): Promise<void> {
  const steps = options.steps ?? 3;
  if (worldPoints.length === 0) throw new Error("drawStroke needs at least one point");
  const first = await screenOf(page, worldPoints[0]!);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const world of worldPoints.slice(1)) {
    const point = await screenOf(page, world);
    await page.mouse.move(point.x, point.y, { steps });
  }
  const last = worldPoints[worldPoints.length - 1]!;
  await releasePen(page, last);
}

/** A click with the Pen: the dot. */
export async function clickPen(page: Page, at: XY): Promise<void> {
  const point = await screenOf(page, at);
  await page.mouse.click(point.x, point.y);
  await settle(page);
}

/** The preview path's `d`, or null when nothing is being drawn. */
export async function previewD(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const path = document.querySelector('[data-testid="pen-preview"]');
    return path ? path.getAttribute("d") : null;
  });
}

interface PreviewSampler {
  samples: string[];
  running: boolean;
}

declare global {
  interface Window {
    __penPreviewSamples?: PreviewSampler;
  }
}

/**
 * Samples the preview path once per animation frame **in the page**, so a test can
 * say what a person would see: the line the tool draws changes as the frames go by.
 */
export async function startPreviewSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state: PreviewSampler = { samples: [], running: true };
    window.__penPreviewSamples = state;
    const tick = (): void => {
      const path = document.querySelector('[data-testid="pen-preview"]');
      state.samples.push(path ? path.getAttribute("d") ?? "" : "");
      if (!state.running) return;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Stops the sampler and returns one entry per frame it saw. */
export async function stopPreviewSampling(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const state = window.__penPreviewSamples;
    if (!state) return [];
    state.running = false;
    return state.samples;
  });
}

/** How many times consecutive frames show a different preview line. */
export function previewChanges(samples: readonly string[]): number {
  let changes = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index] !== samples[index - 1]) changes += 1;
  }
  return changes;
}

/** How many frames had a preview line at all. */
export function previewFrames(samples: readonly string[]): number {
  return samples.filter((sample) => sample !== "").length;
}
