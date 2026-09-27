// The dot grid must look attached to the board: spacing scales with zoom, and the
// tile offset follows the camera in both directions (PRD "Behaviour").
import type { CSSProperties } from "react";

import { describe, expect, it } from "vitest";

import {
  GRID_SPACING_WORLD,
  WHEEL_DELTA_MODE_LINE,
  WHEEL_DELTA_MODE_PAGE,
  WHEEL_LINE_PX,
  WHEEL_PAGE_PX,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../../src/shared/config";
import {
  gridBackgroundStyle,
  mod,
  wheelDeltaToPixels,
} from "../../src/client/canvas/BoardViewport";
import { panBy, type Camera } from "../../src/client/canvas/camera";

function spacing(style: CSSProperties): number {
  const match = /([\d.]+)px/.exec(String(style.backgroundSize ?? ""));
  if (!match)
    throw new Error(`unexpected background-size: ${style.backgroundSize}`);
  return Number(match[1]);
}

function offset(style: CSSProperties): { x: number; y: number } {
  const [x = "0", y = "0"] = String(style.backgroundPosition ?? "").split(" ");
  return { x: Number.parseFloat(x), y: Number.parseFloat(y) };
}

describe("grid background", () => {
  it("spaces dots by GRID_SPACING_WORLD * zoom", () => {
    for (const zoom of [ZOOM_MIN, 1, 2.5, ZOOM_MAX]) {
      const cam: Camera = { x: 0, y: 0, zoom };
      expect(spacing(gridBackgroundStyle(cam))).toBeCloseTo(
        GRID_SPACING_WORLD * zoom,
        6,
      );
    }
  });

  it("shifts the dots by the pan distance in screen pixels", () => {
    const cam: Camera = { x: 0, y: 0, zoom: 2 };
    const before = gridBackgroundStyle(cam);
    const panned = gridBackgroundStyle(panBy(cam, 100, 60));
    // panBy(+100 screen px) must move the visible pattern by exactly +100 px.
    const a = offset(before);
    const b = offset(panned);
    const period = GRID_SPACING_WORLD * cam.zoom;
    expect(mod(b.x - a.x, period)).toBeCloseTo(mod(100, period), 6);
    expect(mod(b.y - a.y, period)).toBeCloseTo(mod(60, period), 6);
  });

  it("keeps the tile offset inside one tile so the pattern never jumps", () => {
    for (const camera of [
      { x: 0, y: 0, zoom: 1 },
      { x: -12_345.5, y: 987.25, zoom: 0.5 },
      { x: 1_000_000, y: -1_000_000, zoom: 1 },
    ]) {
      const { x, y } = offset(gridBackgroundStyle(camera));
      const period = GRID_SPACING_WORLD * camera.zoom;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(period);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(period);
    }
  });
});

describe("wheel delta modes", () => {
  it("converts LINE and PAGE deltas to pixels", () => {
    expect(wheelDeltaToPixels(3, WHEEL_DELTA_MODE_LINE)).toBe(
      3 * WHEEL_LINE_PX,
    );
    expect(wheelDeltaToPixels(2, WHEEL_DELTA_MODE_PAGE)).toBe(
      2 * WHEEL_PAGE_PX,
    );
    expect(wheelDeltaToPixels(37, 0)).toBe(37);
  });
});
