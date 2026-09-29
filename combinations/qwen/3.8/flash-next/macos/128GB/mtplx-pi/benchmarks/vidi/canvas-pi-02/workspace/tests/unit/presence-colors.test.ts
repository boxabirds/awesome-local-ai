import { describe, expect, it } from 'vitest';

import { MAX_CONCURRENT_EDITORS, PRESENCE_COLORS } from '../../src/shared/config';
import { inPalette } from '../../src/client/presence/colors';
import { distinguish, type Person } from '../../src/client/presence/people';

/**
 * Colours: the palette, and how a crowd is drawn from it (story 6, TC-12 to TC-15).
 *
 * Two separate things live here, and the split matters. Which colour a person is
 * *drawn in* is settled by one pass over the whole board (`distinguish`); what is
 * in the palette, and how a colour string maps back to a palette slot, is
 * `colors.ts`. The interesting cases are not "does the first person get red" —
 * they are a crowd arriving at once, where several boards pick before any of them
 * has seen another, and a crowd bigger than the palette, where a colour has to be
 * repeated rather than a person left blank.
 *
 * ## Why these tests run against the pass rather than against a per-browser rule
 *
 * The first version of this story asked each browser to notice a clash and
 * re-publish itself, and this file spent its space simulating that: five blinds
 * pick red, all see red taken, all move to green, together, for as long as anybody
 * moves a mouse. That simulation is what proved the idea wrong, and it is why the
 * shape of the test survived even though the thing under test no longer exists: a
 * rule has to be checked against a crowd that decides at once, and against a crowd
 * bigger than the palette, or it looks fine in a two-tab test and fails in a room.
 */

/** A small deterministic generator, so a failure can be replayed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // mulberry32: four mixes, one division, and the same order on every machine.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A crowd that knows nothing about each other: everyone wants the same thing. */
function crowd(size: number, wantedIndex: number): Person[] {
  return Array.from({ length: size }, (_, index) => ({
    clientId: index + 1,
    name: 'Ada',
    color: PRESENCE_COLORS[wantedIndex % PRESENCE_COLORS.length]!,
    id: `p${index + 1}`,
    x: null as number | null,
    y: null as number | null,
    selection: [],
    lastActive: 0,
    sentAt: 0,
  }));
}

describe('a crowd drawn from the palette (TC-12, TC-13)', () => {
  it('lands a full board on five distinct colours, whatever order they arrive in', () => {
    const rng = seeded(20260925);
    const failures: string[] = [];

    for (let run = 0; run < 500; run += 1) {
      // Five clients — the configured capacity — with ids and preferences drawn
      // at random, so both the "all wanted red" crowd and the "all different"
      // one are covered, including the ones where a random id collides with the
      // palette slot somebody else wanted.
      const ids: number[] = [];
      while (ids.length < MAX_CONCURRENT_EDITORS) {
        const candidate = Math.floor(rng() * 4_000_000_000);
        if (!ids.includes(candidate)) ids.push(candidate);
      }
      const people = ids.map((id) => ({
        clientId: id,
        name: 'Ada',
        color: PRESENCE_COLORS[Math.floor(rng() * PRESENCE_COLORS.length)]!,
        id: `p${id}`,
        x: null as number | null,
        y: null as number | null,
        selection: [],
        lastActive: 0,
        sentAt: 0,
      }));
      const shuffled = [...people].sort(() => rng() - 0.5);

      const board = distinguish(shuffled);
      const colours = board.map((person) => person.color);
      if (new Set(colours).size !== colours.length) {
        failures.push(`run ${run}: ${colours.join(',')}`);
      }
      // And the answer does not depend on the order the list happened to arrive
      // in, which is the only way two screens can be expected to agree.
      if (JSON.stringify(distinguish(people)) !== JSON.stringify(board)) {
        failures.push(`run ${run}: order changed the answer`);
      }
    }

    expect(failures.slice(0, 5), `${failures.length} runs did not converge`).toEqual([]);
  });

  it('gives one more person than the board was designed for a colour of their own', () => {
    // Capacity plus one, while the palette still has room: the extra person is
    // not a reason to repeat a colour.
    const board = distinguish(crowd(MAX_CONCURRENT_EDITORS + 1, 0));
    const colours = board.map((person) => person.color);
    expect(new Set(colours).size, colours.join(',')).toBe(board.length);
  });

  it('repeats a colour rather than leaving anybody without one', () => {
    // Two more people than the palette has colours: repetition is the designed
    // answer, and the way it repeats still has to tell people apart.
    const size = PRESENCE_COLORS.length + 2;
    const board = distinguish(crowd(size, 0));
    const colours = board.map((person) => person.color);
    expect(new Set(colours).size, 'some colours repeat').toBeLessThan(size);
    // Nobody is drawn in a colour that is not in the palette, and nobody is
    // dropped: the count is still one dot per person.
    for (const color of colours) expect(inPalette(color)).toBe(true);
    // And the people who had to share are the ones further down the id order,
    // not the first five: the stack still has a colour per person while there
    // are colours left.
    expect(new Set(colours.slice(0, PRESENCE_COLORS.length)).size).toBe(PRESENCE_COLORS.length);
  });

  it('settles the first time it is asked, and stays settled', () => {
    // The property the old simulation was really about. A pass over a set cannot
    // oscillate — but only if running it again on its own result changes nothing,
    // because a repaint that renames people every 100 ms is what the clock does.
    const rng = seeded(7);
    for (let run = 0; run < 200; run += 1) {
      const size = 1 + Math.floor(rng() * 12);
      const people = Array.from({ length: size }, (_, index) => ({
        clientId: Math.floor(rng() * 4_000_000_000),
        name: 'Ada',
        color: PRESENCE_COLORS[Math.floor(rng() * (PRESENCE_COLORS.length + 1)) % PRESENCE_COLORS.length]!,
        id: `p${index}`,
        x: null as number | null,
        y: null as number | null,
        selection: [],
        lastActive: 0,
        sentAt: 0,
      }));
      const once = distinguish(people);
      expect(distinguish(once)).toEqual(once);
    }
  });
});

describe('the palette itself', () => {
  it('recognises its own colours and no others', () => {
    for (const color of PRESENCE_COLORS) expect(inPalette(color)).toBe(true);
    // A colour from somewhere else — the neutral slate, a transparent nothing —
    // is not a claim on a slot, so it never takes one away from anybody.
    expect(inPalette('#123456')).toBe(false);
    expect(inPalette('')).toBe(false);
    expect(inPalette('#e53935')).toBe(false);
  });

  it('is big enough for the board (TC-15)', () => {
    expect(PRESENCE_COLORS.length).toBeGreaterThanOrEqual(MAX_CONCURRENT_EDITORS);
  });

  it('holds nothing but plain six-digit colours, which is what the canvas needs', () => {
    for (const color of PRESENCE_COLORS) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(new Set(PRESENCE_COLORS).size).toBe(PRESENCE_COLORS.length);
  });
});
