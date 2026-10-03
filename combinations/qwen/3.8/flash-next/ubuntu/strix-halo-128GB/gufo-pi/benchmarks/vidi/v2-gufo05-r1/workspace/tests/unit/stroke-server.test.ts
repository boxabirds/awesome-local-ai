// Story 11 · Sketch freehand with a pen — the settings and the "no server change" checks.
//
// TC-16 (settings): the numbers and names the Pen is built from are exported and valid.
// TC-21 (no server change): a stroke is an ordinary object in the shared objects map, so the
// realtime layer — the Durable Object that relays Y.Doc updates — needs to know nothing about it.
// The server already syncs any object the client writes (story 3), so a stroke rides the same
// wire as a sticky note. These assertions pin that: the server source names no stroke handling,
// and the room class is the same one every other object relies on.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../src/shared/config';

describe('pen configuration (story 11 · TC-16)', () => {
  it('exports six pen colours', () => {
    expect(Object.keys(PEN_COLORS)).toHaveLength(6);
    for (const hex of Object.values(PEN_COLORS)) expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('exports three pen thicknesses, all positive world units', () => {
    expect(Object.keys(PEN_THICKNESS_WORLD)).toHaveLength(3);
    for (const value of Object.values(PEN_THICKNESS_WORLD)) expect(value).toBeGreaterThan(0);
  });

  it('has defaults that are themselves valid choices', () => {
    expect(DEFAULT_PEN_COLOR in PEN_COLORS).toBe(true);
    expect(DEFAULT_PEN_THICKNESS in PEN_THICKNESS_WORLD).toBe(true);
  });

  it('carries the tuning constants the tool is specified with', () => {
    expect(STROKE_SIMPLIFY_TOLERANCE_PX).toBe(1);
    expect(STROKE_MAX_POINTS).toBe(5000);
    expect(STROKE_HIT_TOLERANCE_PX).toBeGreaterThan(0);
    expect(STROKE_MIN_SIZE_WORLD).toBeGreaterThan(0);
  });
});

describe('no server change is needed for a stroke (story 11 · TC-21)', () => {
  const workerFiles = ['board-room.ts', 'board-store.ts', 'index.ts'];

  it('the realtime server names no stroke-specific handling', () => {
    for (const file of workerFiles) {
      const source = readFileSync(new URL(`../../src/worker/${file}`, import.meta.url), 'utf8');
      // A stroke must not be special-cased on the server; "keystroke" is allowed, "stroke" type is not.
      expect(source).not.toMatch(/['"]stroke['"]/);
      expect(source).not.toContain('STROKE_TYPE');
    }
  });

  it('the board room Durable Object is the shared one, unchanged in name', () => {
    const room = readFileSync(new URL('../../src/worker/board-room.ts', import.meta.url), 'utf8');
    expect(room).toMatch(/export class BoardRoom extends DurableObject/);
  });
});
