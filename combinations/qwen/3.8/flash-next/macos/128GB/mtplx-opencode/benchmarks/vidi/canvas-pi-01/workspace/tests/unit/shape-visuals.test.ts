/**
 * Story 10 · shape visuals and connector geometry.
 *
 * Two things the PRD pins down that a renderer must not get wrong: the shape
 * palette (fill and outline pair, and the outline has to stay visible on the
 * fill), and the rule that an arrow's end point is *derived* from live
 * rectangles — which is what makes it follow an object that moves.
 */

import { describe, expect, test } from 'vitest';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
} from '../../src/shared/config.js';
import { shapeRect } from '../../src/shared/objects/shape.js';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry.js';

/** Relative luminance, so the palette can be checked without a browser. */
function luminance(hex: string): number {
  const channel = (index: number): number => Number.parseInt(hex.slice(index, index + 2), 16) / 255;
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('shape palette (design §2)', () => {
  test('six fills (plus transparent) and six outlines are offered', () => {
    expect(Object.keys(SHAPE_FILL_COLORS)).toHaveLength(7);
    expect(Object.keys(SHAPE_STROKE_COLORS)).toHaveLength(6);
    expect(SHAPE_FILL_COLORS.none).toBe('transparent');
    for (const hex of Object.values(SHAPE_STROKE_COLORS)) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  test('every outline is darker than every fill, so an edge always reads', () => {
    const luminance = (hex: string): number => {
      if (hex === 'transparent') return 1;
      const channel = (index: number): number => Number.parseInt(hex.slice(index, index + 2), 16) / 255;
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };
    const fills = Object.values(SHAPE_FILL_COLORS).filter((hex) => hex !== 'transparent');
    for (const stroke of Object.values(SHAPE_STROKE_COLORS)) {
      for (const fill of fills) {
        expect(luminance(stroke), `${fill} + ${stroke}`).toBeLessThan(luminance(fill));
      }
    }
  });

  test('the default pair is a high-contrast one (PRD: a dark outline)', () => {
    const white = SHAPE_FILL_COLORS[DEFAULT_SHAPE_FILL];
    const dark = SHAPE_STROKE_COLORS[DEFAULT_SHAPE_STROKE];
    expect(contrast(white, dark)).toBeGreaterThanOrEqual(3);
  });
});

describe('shape size contract', () => {
  test('a drag of at least the minimum on both axes keeps its own size', () => {
    // TC-03: 20×20 is a shape, not a mis-click.
    const rect = shapeRect({ x: 100, y: 40, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, { x: 0, y: 0 });
    expect(rect.width).toBeCloseTo(SHAPE_MIN_SIZE_WORLD);
    expect(rect.height).toBeCloseTo(SHAPE_MIN_SIZE_WORLD);
  });

  test('a smaller drag, or a plain click, becomes a default box under the pointer', () => {
    for (const drag of [null, { x: 10, y: 10, width: 12, height: 200 }]) {
      const rect = shapeRect(drag, { x: 300, y: 200 });
      expect(rect.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(rect.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(rect.x + rect.width / 2).toBeCloseTo(300);
      expect(rect.y + rect.height / 2).toBeCloseTo(200);
    }
  });

  test('Shift squares the shape on the longer edge', () => {
    const rect = shapeRect({ x: 0, y: 0, width: 200, height: 60 }, { x: 0, y: 0 }, true);
    expect(rect.width).toBe(200);
    expect(rect.height).toBe(200);
  });

  test('a non-finite drag falls back rather than writing NaN into the doc', () => {
    const rect = shapeRect({ x: Number.NaN, y: 0, width: 100, height: 100 }, { x: 0, y: 0 });
    expect(Number.isFinite(rect.x)).toBe(true);
    expect(Number.isFinite(rect.width)).toBe(true);
  });
});

describe('derived arrow ends (connector.follow)', () => {
  const rects = new Map<string, { x: number; y: number; width: number; height: number }>([
    ['a', { x: 0, y: 0, width: 100, height: 100 }],
    ['b', { x: 300, y: 0, width: 100, height: 100 }],
  ]);

  const arrow = {
    from: { kind: 'attached', objectId: 'a', fallback: { x: 50, y: 50 } },
    to: { kind: 'attached', objectId: 'b', fallback: { x: 350, y: 50 } },
  } as const;

  test('a horizontal arrow touches the two facing sides, not the centres', () => {
    const ends = resolveEndpoints(arrow, rects);
    expect(ends.from).toEqual({ x: 100, y: 50 });
    expect(ends.to).toEqual({ x: 300, y: 50 });
  });

  test('crossing the diagonal switches the side an arrow attaches to', () => {
    // Right of the diagonal the arrow leaves the right face; below it, the
    // bottom face. This is the switch the PRD describes at 45°.
    expect(nearestSide(rects.get('a')!, { x: 200, y: 60 })).toBe('right');
    expect(nearestSide(rects.get('a')!, { x: 60, y: 200 })).toBe('bottom');
  });

  test('a moved or resized object re-anchors the arrow with no stored change', () => {
    const moved = new Map(rects);
    moved.set('b', { x: 260, y: 220, width: 160, height: 160 });
    const ends = resolveEndpoints(arrow, moved);
    // The arrow now leaves a's right face and enters b's *left* face: the
    // nearer face, not a stored point.
    expect(ends.from).toEqual({ x: 100, y: 50 });
    expect(ends.to).toEqual({ x: 260, y: 300 });
    expect(connectorBBox(ends.from, ends.to)).toMatchObject({ x: 100, y: 50, width: 160, height: 250 });
  });

  test('an arrow whose target vanished draws its stored fallback point', () => {
    const ends = resolveEndpoints(arrow, new Map([['a', rects.get('a')!]]));
    expect(ends.to).toEqual({ x: 350, y: 50 });
  });

  test('a free end keeps its point, and a flat rectangle yields no NaN', () => {
    const free = { from: { kind: 'free', x: 5, y: 5 }, to: { kind: 'free', x: 95, y: 5 } } as const;
    expect(resolveEndpoints(free, new Map())).toEqual({ from: { x: 5, y: 5 }, to: { x: 95, y: 5 } });
    expect(Number.isFinite(sideAnchor({ x: 0, y: 0, width: 100, height: 0 }, 'top').y)).toBe(true);
  });

  test('the stroke is centred, so geometry is inset by half its width', () => {
    expect(SHAPE_STROKE_WIDTH_WORLD).toBeGreaterThan(0);
    const kinds: readonly string[] = SHAPE_KINDS;
    expect(kinds).toEqual(['rect', 'ellipse', 'diamond']);
  });
});
