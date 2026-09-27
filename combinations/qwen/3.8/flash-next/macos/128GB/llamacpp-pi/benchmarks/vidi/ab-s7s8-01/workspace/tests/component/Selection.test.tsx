// Story 7 — selection: bar, prune, marquee (design TC-16 to TC-22).
//
// The App is rendered for real (no mocks): objects come from the document,
// selection from the selection state, and the camera is identity at the viewport
// origin, so a world point and a client point are the same number.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { App } from '../../src/client/App';
import {
  fire,
  flushFrame,
  pointerEvent,
  seed,
  seedBox,
  rows,
  row,
  objectEl,
  deleteThroughDoc,
  selectionIds,
  viewport,
  cameraState,
  clickObject,
  shiftClickObject,
  clientOf,
} from './harness';

const bar = () => document.querySelector('[data-testid="selection-bar"]');
const status = () => document.querySelector('[data-testid="selection-status"]');
const toolbar = () => document.querySelector('[data-testid="note-toolbar"]');
const handles = () => document.querySelectorAll('[data-testid="resize-handle"]');
const marquee = () => document.querySelector('[data-testid="marquee"]');
const setHas = (ids: string[]) => expect([...selectionIds()].sort()).toEqual([...ids].sort());

describe('TC-16 selection is pruned when its objects go away', () => {
  it('every selected object deleted → selection empty, bar hidden', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(400, 100);
    clickObject(a);
    shiftClickObject(b);
    expect(bar()!.textContent).toContain('2 selected');

    // "Deleted remotely": straight to the document, as a remote update arrives.
    deleteThroughDoc([a, b]);

    setHas([]);
    expect(bar()).toBeNull();
    expect(status()!.textContent).toBe('Nothing selected');
    expect(document.querySelector('[data-testid="selection-outline"]')).toBeNull();
  });

  it('part of the selection deleted → the survivors stay selected', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(400, 100);
    const c = seed(700, 100);
    clickObject(a);
    shiftClickObject(b);
    shiftClickObject(c);

    deleteThroughDoc([b]);

    setHas([a, c]);
    expect(bar()!.textContent).toContain('2 selected');
  });
});

describe('TC-17 the selection bar counts the selection and deletes it', () => {
  it('"2 selected" + Delete selection; the aria-live region announces the count', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(400, 100);
    clickObject(a);
    shiftClickObject(b);

    expect(bar()).not.toBeNull();
    expect(bar()!.textContent).toContain('2 selected');
    const del = bar()!.querySelector('[aria-label="Delete selection"]');
    expect(del).not.toBeNull();

    // Announced for screen readers, and never stealing focus from the board.
    expect(status()).not.toBeNull();
    expect(status()!.getAttribute('aria-live')).toBe('polite');
    expect(status()!.textContent).toContain('2 selected');

    // Eight handles on the group's bounding box (multi-selection is resizable).
    expect(handles()).toHaveLength(8);

    fire(del!, new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(rows()).toHaveLength(0);
    setHas([]);
    expect(bar()).toBeNull();
  });
});

describe('TC-18 one sticky selected shows the note toolbar, not the bar', () => {
  it('a single sticky gets NoteToolbar; the selection bar stays hidden', () => {
    render(<App />);
    const a = seed(100, 100);
    clickObject(a);

    expect(toolbar()).not.toBeNull();
    expect(bar()).toBeNull();
    expect(selectionIds()).toEqual([a]);
    // The single note still has its own delete button (story 2).
    expect(document.querySelector('[data-testid="note-delete"]')).not.toBeNull();
  });
});

describe('TC-19 an empty-space click clears the selection', () => {
  it('press and release on the background with no drag → nothing selected', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(400, 100);
    clickObject(a);
    shiftClickObject(b);
    const cam0 = cameraState();

    const vp = viewport();
    fire(vp, pointerEvent('pointerdown', 1100, 700));
    fire(vp, pointerEvent('pointerup', 1100, 700));

    setHas([]);
    expect(bar()).toBeNull();
    // A click is not a pan.
    expect(cameraState()).toEqual(cam0);
  });
});

describe('TC-20 Shift+drag selects the objects fully inside the box (additive)', () => {
  it('adds the enclosed objects to the existing selection', () => {
    render(<App />);
    // Two notes inside the box, one well outside it.
    const inside1 = seed(100, 100); // rect 0..200
    const inside2 = seed(400, 100); // rect 300..500
    const outside = seed(1000, 1000); // rect 900..1100
    clickObject(outside);
    setHas([outside]);

    // The box is drawn from world corners -20,-20 → 520,220 (both notes lie fully
    // inside it, the third is far outside), converted through the board's camera.
    const a = clientOf(-20, -20);
    const b = clientOf(520, 220);
    const vp = viewport();
    fire(vp, pointerEvent('pointerdown', a.x, a.y, { shiftKey: true }));
    flushFrame(); // the box follows the pointer, one repaint per frame
    expect(marquee()).not.toBeNull();
    fire(window, pointerEvent('pointermove', b.x, b.y));
    flushFrame();
    fire(window, pointerEvent('pointerup', b.x, b.y));
    flushFrame();

    // Additive: the pre-existing selection survives, and the half-outside note is
    // not picked up.
    setHas([outside, inside1, inside2]);
    expect(marquee()).toBeNull();
  });
});

describe('TC-21 a plain drag on the background pans and never draws a marquee', () => {
  it('no Shift → the camera moves, the selection is untouched', () => {
    render(<App />);
    const a = seed(100, 100);
    clickObject(a);
    const cam0 = cameraState();

    // The pan is driven by the viewport's own pointermove (it captures the pointer).
    const vp = viewport();
    fire(vp, pointerEvent('pointerdown', 900, 600));
    fire(vp, pointerEvent('pointermove', 800, 500));
    expect(marquee()).toBeNull();
    fire(vp, pointerEvent('pointerup', 800, 500));

    expect(cameraState()).not.toEqual(cam0);
    // A pan is not a click: the selection stays (and no marquee ever appeared).
    setHas([a]);
  });
});

describe('TC-22 a cancelled marquee leaves the selection alone', () => {
  it('pointercancel mid-drag → no selection change at all', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(400, 100);
    clickObject(a);
    setHas([a]);

    const p0 = clientOf(-20, -20);
    const p1 = clientOf(1200, 1200);
    const vp = viewport();
    fire(vp, pointerEvent('pointerdown', p0.x, p0.y, { shiftKey: true }));
    fire(window, pointerEvent('pointermove', p1.x, p1.y));
    flushFrame();
    expect(marquee()).not.toBeNull();

    fire(window, pointerEvent('pointercancel', p1.x, p1.y));
    flushFrame();

    setHas([a]);
    expect(marquee()).toBeNull();
    expect(row(b).id).toBe(b);
  });

  it('Escape mid-drag → no selection change either', () => {
    render(<App />);
    const a = seed(100, 100);
    seed(400, 100);
    clickObject(a);

    const p0 = clientOf(-20, -20);
    const p1 = clientOf(1200, 1200);
    const vp = viewport();
    fire(vp, pointerEvent('pointerdown', p0.x, p0.y, { shiftKey: true }));
    fire(window, pointerEvent('pointermove', p1.x, p1.y));
    flushFrame();
    fire(window, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushFrame();

    setHas([a]);
    expect(marquee()).toBeNull();
  });
});

describe('selection works for any registered object type', () => {
  it('a testbox is selectable, counted by the bar and resizable', () => {
    render(<App />);
    const sticky = seed(100, 100);
    const box = seedBox({ x: 400, y: 60, width: 240, height: 120 });

    clickObject(sticky);
    shiftClickObject(box);

    setHas([sticky, box]);
    expect(bar()!.textContent).toContain('2 selected');
    expect(handles()).toHaveLength(8);
    // The overlay outlines each selected object, whatever its type.
    expect(document.querySelector('[data-testid="selection-outline"][data-obj-id="x"]')).toBeNull();
    expect(document.querySelector(`[data-testid="selection-outline"][data-obj-id="${box}"]`)).not.toBeNull();
  });

  it('the last member leaves the selection by Shift+click', () => {
    render(<App />);
    const a = seed(100, 100);
    clickObject(a);
    setHas([a]);
    shiftClickObject(a);
    setHas([]);
    expect(bar()).toBeNull();
    expect(objectEl(a)).not.toBeNull();
  });
});
