// Story 7 — the board's keyboard commands (design TC-27 to TC-31).
//
// The listener lives on `window`, so the tests dispatch real KeyboardEvents there
// and check `defaultPrevented`: a consumed key must not scroll the page, pan the
// board or select the page's text (TC-29, sel.keyboard).

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { App } from '../../src/client/App';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import {
  fire,
  flushFrame,
  pressKey,
  seed,
  rows,
  row,
  objectEl,
  clickObject,
  shiftClickObject,
  selectionIds,
  cameraState,
} from './harness';

const bar = () => document.querySelector('[data-testid="selection-bar"]');
const setHas = (ids: string[]) => expect([...selectionIds()].sort()).toEqual([...ids].sort());

/** Double-click an object the way a user does (the way text editing starts). */
function doubleClick(id: string): void {
  const el = objectEl(id);
  const r = row(id);
  const at = { x: r.x + 10, y: r.y + 10 };
  fire(el, new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }));
}

describe('TC-27 Ctrl/Cmd+A selects everything on the board', () => {
  it('selects every object and consumes the key (no page text selection)', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(400, 100);
    const c = seed(700, 100);

    expect(pressKey('a', window, { ctrlKey: true })).toBe(true); // preventDefault
    setHas([a, b, c]);
    expect(bar()!.textContent).toContain('3 selected');

    // Cmd on macOS behaves the same.
    pressKey('Escape');
    setHas([]);
    expect(pressKey('a', window, { metaKey: true })).toBe(true);
    setHas([a, b, c]);

    // An uppercase A (Shift held) is the same command.
    pressKey('Escape');
    expect(pressKey('A', window, { ctrlKey: true })).toBe(true);
    setHas([a, b, c]);
  });

  it('a plain "a" is not the command', () => {
    render(<App />);
    seed(100, 100);
    expect(pressKey('a')).toBe(false);
    setHas([]);
    expect(rows()).toHaveLength(1);
  });
});

describe('TC-28 Select All on an empty board is a no-op, not an error', () => {
  it('nothing on the board → nothing selected', () => {
    render(<App />);
    expect(rows()).toHaveLength(0);

    expect(pressKey('a', window, { ctrlKey: true })).toBe(true);
    expect(selectionIds()).toEqual([]);
    expect(bar()).toBeNull();

    // And the board still works afterwards.
    const a = seed(100, 100);
    clickObject(a);
    setHas([a]);
  });

  it('deleting the last selected object leaves an empty selection', () => {
    render(<App />);
    const a = seed(100, 100);
    clickObject(a);
    pressKey('a', window, { ctrlKey: true });
    setHas([a]);

    pressKey('Delete');

    expect(rows()).toHaveLength(0);
    expect(selectionIds()).toEqual([]);
    expect(bar()).toBeNull();
    // Nothing selected → the next Delete does nothing at all.
    expect(pressKey('Delete')).toBe(false);
  });
});

describe('TC-29 arrow keys nudge the selection', () => {
  it('ArrowRight is one world unit, Shift+ArrowUp is ten, and neither pans or scrolls', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(400, 100);
    const c = seed(700, 700);
    clickObject(a);
    shiftClickObject(b);
    shiftClickObject(c);
    const before = { a: row(a), b: row(b), c: row(c) };
    const cam0 = cameraState();

    expect(pressKey('ArrowRight')).toBe(true);
    expect(row(a).x).toBeCloseTo(before.a.x + NUDGE_STEP_WORLD, 6);
    expect(row(b).x).toBeCloseTo(before.b.x + NUDGE_STEP_WORLD, 6);
    expect(row(c).x).toBeCloseTo(before.c.x + NUDGE_STEP_WORLD, 6);
    expect(row(a).y).toBeCloseTo(before.a.y, 6);

    expect(pressKey('ArrowUp', window, { shiftKey: true })).toBe(true);
    expect(row(a).y).toBeCloseTo(before.a.y - NUDGE_LARGE_STEP_WORLD, 6);
    expect(row(b).y).toBeCloseTo(before.b.y - NUDGE_LARGE_STEP_WORLD, 6);

    expect(pressKey('ArrowLeft')).toBe(true);
    expect(pressKey('ArrowDown')).toBe(true);
    expect(row(c).x).toBeCloseTo(before.c.x, 6);
    expect(row(c).y).toBeCloseTo(before.c.y - NUDGE_LARGE_STEP_WORLD + NUDGE_STEP_WORLD, 6);

    // The camera never moved: nudging is not a pan.
    expect(cameraState()).toEqual(cam0);
    // Nudging never changes the selection either.
    setHas([a, b, c]);
  });

  it('arrows without a selection are left to the browser', () => {
    render(<App />);
    seed(100, 100);
    const before = rows()[0];

    expect(pressKey('ArrowRight')).toBe(false); // not consumed → the page may scroll
    expect(row(before.id).x).toBe(before.x);
  });

  it('an unselected object is not nudged', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(400, 100);
    clickObject(a);
    const before = row(b);

    expect(pressKey('ArrowRight')).toBe(true);
    expect(row(b).x).toBe(before.x);
  });
});

describe('TC-30 typing wins: while editing, the keys belong to the text', () => {
  it('Backspace while editing edits the text and keeps the object', () => {
    render(<App />);
    const a = seed(100, 100);
    clickObject(a);
    doubleClick(a); // start editing, the way a user does
    flushFrame();

    // Focus sits in the editor; the board's delete must not run.
    expect(document.activeElement?.tagName).toBe('TEXTAREA');

    expect(pressKey('Backspace', window)).toBe(false);
    expect(pressKey('Delete', window)).toBe(false);
    expect(rows()).toHaveLength(1);
    setHas([a]);

    expect(pressKey('ArrowRight', window)).toBe(false);
    expect(rows()).toHaveLength(1);
  });

  it('Delete with focus in a page text field is not the board command', () => {
    render(<App />);
    const a = seed(100, 100);
    clickObject(a);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    try {
      expect(pressKey('Delete', window)).toBe(false);
      expect(pressKey('a', window, { ctrlKey: true })).toBe(false);
      expect(rows()).toHaveLength(1);
    } finally {
      input.remove();
    }
    setHas([a]);
  });
});

describe('TC-31 Delete removes the whole selection', () => {
  it('Delete clears every selected object and the selection itself', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(400, 100);
    const keeper = seed(900, 900);
    clickObject(a);
    shiftClickObject(b);

    expect(pressKey('Delete')).toBe(true);

    expect(rows().map((r) => r.id)).toEqual([keeper]);
    expect(selectionIds()).toEqual([]);
    expect(bar()).toBeNull();
  });

  it('Backspace is the same command', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(400, 100);
    clickObject(a);
    shiftClickObject(b);

    expect(pressKey('Backspace')).toBe(true);

    expect(rows()).toHaveLength(0);
    expect(selectionIds()).toEqual([]);
  });

  it('Enter edits only a single text-bearing selection', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(400, 100);
    clickObject(a);
    shiftClickObject(b);

    // Two objects selected: Enter does nothing (there is nothing to start editing).
    expect(pressKey('Enter')).toBe(false);
    expect(document.activeElement?.tagName).not.toBe('TEXTAREA');

    // A single object selected: Enter opens its text editor.
    pressKey('Escape');
    setHas([]);
    clickObject(a);
    expect(pressKey('Enter')).toBe(true);
    flushFrame();
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    expect(row(b).id).toBe(b);
  });
});
