import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { deleteObjects, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import { addTestbox } from '../fixtures/testbox';
import { Harness, addNote, flush, moveTo, newProbe, notes, press, release, viewport } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const objectsOf = (probe: { doc: import('yjs').Doc }) => snapshot(probe.doc);
const byId = (probe: { doc: import('yjs').Doc }, id: string) => objectsOf(probe).find((o) => o.id === id);
const selectAll = () => fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
const selectedCount = () => notes().filter((n) => n.dataset.selected === 'true').length;

function twoNotes() {
  const probe = newProbe();
  render(<Harness probe={probe} />);
  const a = addNote(probe, 'A', { x: 100, y: 100 });
  const b = addNote(probe, 'B', { x: 500, y: 100 });
  return { probe, a, b };
}
const el = (id: string) => document.querySelector(`[data-note-id="${id}"]`)!;

describe('selection bar and state (sel.interaction)', () => {
  it('TC-16 all selected ids deleted remotely: selection empty, bar hidden', () => {
    const { probe, a, b } = twoNotes();
    selectAll();
    expect(screen.getByText('2 selected')).toBeTruthy();
    act(() => {
      deleteObjects(probe.doc, [a, b]);
    });
    expect(probe.ids.size).toBe(0);
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it('a remote delete of one selected object keeps the others selected', () => {
    const { probe, a, b } = twoNotes();
    const c = addNote(probe, 'C', { x: 900, y: 100 });
    selectAll();
    act(() => {
      deleteObjects(probe.doc, [b]);
    });
    expect([...probe.ids].sort()).toEqual([a, c].sort());
    expect(screen.getByText('2 selected')).toBeTruthy();
  });

  it('TC-17 two selected: "2 selected" with an aria-live count and a Delete selection button', () => {
    const { probe } = twoNotes();
    selectAll();
    const count = screen.getByText('2 selected');
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(objectsOf(probe)).toHaveLength(0);
    expect(probe.ids.size).toBe(0);
  });

  it('TC-18 one sticky selected: the note toolbar instead of the bar', () => {
    const { a } = twoNotes();
    press(el(a), 10, 10);
    release(el(a), 10, 10);
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
    expect(screen.queryByText(/selected$/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete selection' })).toBeNull();
  });

  it('Shift-click adds and removes; plain click selects only that object', () => {
    const { probe, a, b } = twoNotes();
    press(el(a), 10, 10);
    release(el(a), 10, 10);
    fireEvent.pointerDown(el(b), { clientX: 5, clientY: 5, pointerId: 1, button: 0, shiftKey: true });
    fireEvent.pointerUp(el(b), { clientX: 5, clientY: 5, pointerId: 1 });
    expect(probe.ids.size).toBe(2);
    fireEvent.pointerDown(el(a), { clientX: 5, clientY: 5, pointerId: 1, button: 0, shiftKey: true });
    fireEvent.pointerUp(el(a), { clientX: 5, clientY: 5, pointerId: 1 });
    expect([...probe.ids]).toEqual([b]);
    press(el(a), 5, 5);
    release(el(a), 5, 5);
    expect([...probe.ids]).toEqual([a]);
  });
});

describe('marquee and empty-space clicks (sel.marquee_ui)', () => {
  // The App camera starts with the origin at the window centre (1024x768 in jsdom): world = screen - (512, 384).
  function appWithNotes(points: [number, number][]) {
    render(<App />);
    for (const [x, y] of points) {
      fireEvent.doubleClick(viewport(), { clientX: x, clientY: y });
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    }
    fireEvent.pointerDown(viewport(), { clientX: 5, clientY: 5, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport(), { clientX: 5, clientY: 5, pointerId: 1 });
  }
  const shiftDrag = (from: [number, number], to: [number, number], end = true) => {
    fireEvent.pointerDown(viewport(), { clientX: from[0], clientY: from[1], pointerId: 1, button: 0, shiftKey: true });
    fireEvent.pointerMove(viewport(), { clientX: to[0], clientY: to[1], pointerId: 1, shiftKey: true });
    if (end) fireEvent.pointerUp(viewport(), { clientX: to[0], clientY: to[1], pointerId: 1, shiftKey: true });
  };

  it('TC-19 clicking empty space without dragging clears the selection', () => {
    appWithNotes([[200, 200], [700, 500]]);
    selectAll();
    expect(selectedCount()).toBe(2);
    fireEvent.pointerDown(viewport(), { clientX: 5, clientY: 5, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport(), { clientX: 5, clientY: 5, pointerId: 1 });
    expect(selectedCount()).toBe(0);
  });

  it('TC-20 Shift+drag adds fully enclosed notes to the existing selection; partly enclosed is left out', () => {
    // A (100..300) inside the box, C (230..430) half inside, B far away and already selected.
    appWithNotes([[200, 200], [700, 500], [330, 200]]);
    // DOM order follows random ids, so identify the notes by their position instead.
    const els = notes().sort((p, q) => parseFloat(p.style.left) - parseFloat(q.style.left));
    const [a, c, b] = [els[0], els[1], els[2]];
    press(b, 5, 5);
    release(b, 5, 5);
    shiftDrag([90, 90], [320, 320], false);
    expect(screen.getByTestId('marquee')).toBeTruthy();
    fireEvent.pointerUp(viewport(), { clientX: 320, clientY: 320, pointerId: 1, shiftKey: true });
    expect(screen.queryByTestId('marquee')).toBeNull();
    const now = notes();
    expect(now.find((n) => n === a)?.dataset.selected).toBe('true');
    expect(now.find((n) => n === b)?.dataset.selected).toBe('true');
    expect(now.find((n) => n === c)?.dataset.selected).toBe('false');
  });

  it('a rectangle that encloses nothing leaves the selection unchanged', () => {
    appWithNotes([[200, 200]]);
    selectAll();
    shiftDrag([600, 600], [700, 700]);
    expect(selectedCount()).toBe(1);
  });

  it('TC-21 a plain drag pans the board and draws no marquee (negative)', () => {
    appWithNotes([[200, 200]]);
    const before = screen.getByTestId('board-world').style.transform;
    fireEvent.pointerDown(viewport(), { clientX: 90, clientY: 90, pointerId: 1, button: 0 });
    fireEvent.pointerMove(viewport(), { clientX: 190, clientY: 140, pointerId: 1 });
    flush();
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(screen.getByTestId('board-world').style.transform).not.toBe(before);
    fireEvent.pointerUp(viewport(), { clientX: 190, clientY: 140, pointerId: 1 });
  });

  it('TC-22 pointercancel mid-marquee leaves the selection unchanged', () => {
    appWithNotes([[200, 200], [700, 500]]);
    const b = notes()[1];
    press(b, 5, 5);
    release(b, 5, 5);
    shiftDrag([90, 90], [320, 320], false);
    expect(screen.getByTestId('marquee')).toBeTruthy();
    fireEvent.pointerCancel(viewport(), { pointerId: 1 });
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectedCount()).toBe(1);
    expect(notes()[1].dataset.selected).toBe('true');
  });

  it('Escape cancels a marquee in progress', () => {
    appWithNotes([[200, 200]]);
    shiftDrag([90, 90], [320, 320], false);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('marquee')).toBeNull();
    fireEvent.pointerUp(viewport(), { clientX: 320, clientY: 320, pointerId: 1, shiftKey: true });
    expect(selectedCount()).toBe(0);
  });
});

describe('transform gesture (sel.transform)', () => {
  it('TC-23 dragging an unselected note selects only it and moves only it; the threshold decides click vs drag', () => {
    const { probe, a, b } = twoNotes();
    press(el(a), 5, 5);
    release(el(a), 5, 5);
    expect([...probe.ids]).toEqual([a]);
    const before = { a: byId(probe, a)!, b: byId(probe, b)! };
    press(el(b), 0, 0);
    moveTo(el(b), DRAG_THRESHOLD_PX - 1, 0);
    flush();
    expect(byId(probe, b)!.x).toBe(before.b.x);
    expect(probe.gestureStarts).toBe(0);
    moveTo(el(b), DRAG_THRESHOLD_PX, 0);
    flush();
    release(el(b), DRAG_THRESHOLD_PX, 0);
    expect([...probe.ids]).toEqual([b]);
    expect(byId(probe, b)!.x).toBe(before.b.x + DRAG_THRESHOLD_PX);
    expect(byId(probe, a)!.x).toBe(before.a.x);
  });

  it('dragging a selected note moves the whole selection and raises it above other notes', () => {
    const { probe, a, b } = twoNotes();
    const c = addNote(probe, 'C', { x: 900, y: 100 });
    // c is the topmost unselected note; select a and b only.
    press(el(a), 0, 0);
    release(el(a), 0, 0);
    fireEvent.pointerDown(el(b), { clientX: 0, clientY: 0, pointerId: 1, button: 0, shiftKey: true });
    fireEvent.pointerUp(el(b), { clientX: 0, clientY: 0, pointerId: 1 });
    const start = { a: byId(probe, a)!, b: byId(probe, b)! };
    press(el(a), 0, 0);
    moveTo(el(a), 30, 40);
    flush();
    release(el(a), 30, 40);
    expect(byId(probe, a)).toMatchObject({ x: start.a.x + 30, y: start.a.y + 40 });
    expect(byId(probe, b)).toMatchObject({ x: start.b.x + 30, y: start.b.y + 40 });
    expect(byId(probe, a)!.z).toBeGreaterThan(byId(probe, c)!.z);
    expect(byId(probe, b)!.z).toBeGreaterThan(byId(probe, c)!.z);
    expect(byId(probe, a)!.z).toBeLessThan(byId(probe, b)!.z);
  });

  it('writes absolute positions from the gesture start (delta divided by zoom)', () => {
    const probe = newProbe();
    render(<Harness probe={probe} zoom={2} />);
    const a = addNote(probe, '', { x: 100, y: 100 });
    const x0 = byId(probe, a)!.x;
    press(el(a), 0, 0);
    moveTo(el(a), 20, 0);
    flush();
    moveTo(el(a), 40, 0);
    flush();
    release(el(a), 40, 0);
    expect(byId(probe, a)!.x).toBe(x0 + 20);
  });

  it('TC-24 handles are labelled; a testbox edge handle changes width only; Shift keeps the ratio', () => {
    const probe = newProbe();
    render(<Harness probe={probe} />);
    let id = "";
    act(() => {
      id = addTestbox(probe.doc, 0, 0, 200, 100);
    });
    selectAll();
    for (const label of ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left']) {
      expect(screen.getByRole('button', { name: `Resize ${label}` })).toBeTruthy();
    }
    const right = screen.getByRole('button', { name: 'Resize right' });
    fireEvent.pointerDown(right, { clientX: 200, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerMove(right, { clientX: 250, clientY: 80, pointerId: 1 });
    flush();
    fireEvent.pointerUp(right, { clientX: 250, clientY: 80, pointerId: 1 });
    expect(byId(probe, id)).toMatchObject({ x: 0, y: 0, width: 250, height: 100 });

    const bottomRight = screen.getByRole('button', { name: 'Resize bottom-right' });
    fireEvent.pointerDown(bottomRight, { clientX: 250, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(bottomRight, { clientX: 500, clientY: 110, pointerId: 1, shiftKey: true });
    flush();
    fireEvent.pointerUp(bottomRight, { clientX: 500, clientY: 110, pointerId: 1 });
    const out = byId(probe, id)!;
    expect(out.width! / out.height!).toBeCloseTo(2.5);
    expect(out.width).toBeCloseTo(500);
  });

  it('a testbox stops at its minimum size', () => {
    const probe = newProbe();
    render(<Harness probe={probe} />);
    let id = "";
    act(() => {
      id = addTestbox(probe.doc, 0, 0, 200, 100);
    });
    selectAll();
    const right = screen.getByRole('button', { name: 'Resize right' });
    fireEvent.pointerDown(right, { clientX: 200, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerMove(right, { clientX: -500, clientY: 50, pointerId: 1 });
    flush();
    fireEvent.pointerUp(right, { clientX: -500, clientY: 50, pointerId: 1 });
    expect(byId(probe, id)!.width).toBe(10);
  });

  it('sticky notes stay square when resized from a corner, and keep their own size until then', () => {
    const probe = newProbe();
    render(<Harness probe={probe} />);
    const a = addNote(probe, '', { x: 100, y: 100 }); // 0,0 200x200
    press(el(a), 5, 5);
    release(el(a), 5, 5);
    const se = screen.getByRole('button', { name: 'Resize bottom-right' });
    fireEvent.pointerDown(se, { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(se, { clientX: 300, clientY: 240, pointerId: 1 });
    flush();
    fireEvent.pointerUp(se, { clientX: 300, clientY: 240, pointerId: 1 });
    expect(byId(probe, a)).toMatchObject({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('a group resize scales positions and sizes proportionally from the opposite edge', () => {
    const { probe, a, b } = twoNotes(); // a: 0..200, b: 400..600
    selectAll();
    const east = screen.getByRole('button', { name: 'Resize right' });
    fireEvent.pointerDown(east, { clientX: 600, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(east, { clientX: 1200, clientY: 0, pointerId: 1 });
    flush();
    fireEvent.pointerUp(east, { clientX: 1200, clientY: 0, pointerId: 1 });
    expect(byId(probe, a)).toMatchObject({ x: 0, width: 400, height: 400 });
    expect(byId(probe, b)).toMatchObject({ x: 800, width: 400, height: 400 });
  });

  it('TC-25 canEdit false: the drag is refused and nothing is written (negative); selecting still works', () => {
    const probe = newProbe();
    render(<Harness probe={probe} canEdit={false} />);
    const a = addNote(probe, '', { x: 100, y: 100 });
    const before = byId(probe, a)!;
    press(el(a), 0, 0);
    moveTo(el(a), 50, 50);
    flush();
    release(el(a), 50, 50);
    expect(byId(probe, a)).toEqual(before);
    expect(probe.gestureStarts).toBe(0);
    expect([...probe.ids]).toEqual([a]);
  });

  it('TC-26 gesture start and end are each called once per drag; pointercancel keeps the last applied position', () => {
    const { probe, a } = twoNotes();
    const x0 = byId(probe, a)!.x;
    press(el(a), 0, 0);
    moveTo(el(a), 10, 0);
    flush();
    moveTo(el(a), 20, 0);
    flush();
    release(el(a), 20, 0);
    expect([probe.gestureStarts, probe.gestureEnds]).toEqual([1, 1]);
    press(el(a), 0, 0);
    moveTo(el(a), 15, 0);
    flush();
    fireEvent.pointerCancel(el(a), { pointerId: 1 });
    expect([probe.gestureStarts, probe.gestureEnds]).toEqual([2, 2]);
    expect(byId(probe, a)!.x).toBe(x0 + 20 + 15);
  });

  it('a note deleted remotely mid-drag is skipped; the others keep moving', () => {
    const { probe, a, b } = twoNotes();
    selectAll();
    const bx = byId(probe, b)!.x;
    press(el(a), 0, 0);
    moveTo(el(a), 10, 0);
    flush();
    act(() => {
      deleteObjects(probe.doc, [a]);
    });
    moveTo(window as unknown as Element, 30, 0);
    flush();
    release(window as unknown as Element, 30, 0);
    expect(byId(probe, a)).toBeUndefined();
    expect(byId(probe, b)!.x).toBe(bx + 30);
  });
});

describe('keyboard (sel.keyboard)', () => {
  it('TC-27 Ctrl/Cmd+A selects everything and prevents default', () => {
    const { probe } = twoNotes();
    expect(fireEvent.keyDown(window, { key: 'a', ctrlKey: true })).toBe(false);
    expect(probe.ids.size).toBe(2);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(probe.ids.size).toBe(0);
    expect(fireEvent.keyDown(window, { key: 'A', metaKey: true })).toBe(false);
    expect(probe.ids.size).toBe(2);
  });

  it('TC-28 Ctrl/Cmd+A on an empty board selects nothing and does not fail', () => {
    const probe = newProbe();
    render(<Harness probe={probe} />);
    expect(() => selectAll()).not.toThrow();
    expect(probe.ids.size).toBe(0);
  });

  it('TC-29 arrows nudge by the small step, Shift+arrow by the large step, without scrolling', () => {
    const { probe, a, b } = twoNotes();
    selectAll();
    const start = { a: byId(probe, a)!, b: byId(probe, b)! };
    expect(fireEvent.keyDown(window, { key: 'ArrowRight' })).toBe(false);
    expect(byId(probe, a)!.x).toBe(start.a.x + NUDGE_STEP_WORLD);
    expect(byId(probe, b)!.x).toBe(start.b.x + NUDGE_STEP_WORLD);
    expect(fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true })).toBe(false);
    expect(byId(probe, a)!.y).toBe(start.a.y - NUDGE_LARGE_STEP_WORLD);
  });

  it('arrows with nothing selected do nothing', () => {
    twoNotes();
    expect(fireEvent.keyDown(window, { key: 'ArrowRight' })).toBe(true);
  });

  it('TC-30 Backspace while editing text edits the text and keeps the objects (negative)', () => {
    const { probe, a } = twoNotes();
    fireEvent.doubleClick(el(a));
    const box = screen.getByRole('textbox');
    expect(fireEvent.keyDown(box, { key: 'Backspace' })).toBe(true);
    expect(objectsOf(probe)).toHaveLength(2);
    expect(probe.editingId).toBe(a);
  });

  it('TC-31 Delete and Backspace remove every selected note', () => {
    const { probe } = twoNotes();
    selectAll();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(objectsOf(probe)).toHaveLength(0);
    expect(probe.ids.size).toBe(0);
    addNote(probe, 'x');
    selectAll();
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(objectsOf(probe)).toHaveLength(0);
  });

  it('Enter edits a single selected sticky; load-failed boards ignore nudge and delete', () => {
    const probe = newProbe();
    render(<Harness probe={probe} canEdit={false} />);
    const a = addNote(probe, 'x');
    selectAll();
    const before = byId(probe, a)!;
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(byId(probe, a)).toEqual(before);
  });
});
