/**
 * Story 7 component tests — sel.transform (TC-23 to TC-26, TC-25 in
 * transform-locked.test.tsx): the generic transform gesture — group move,
 * unselected-object drag with the click/drag threshold boundary, bounding-box
 * resize handles (edge vs corner, Shift aspect lock) and gesture callbacks.
 *
 * jsdom viewport is 1024×768 with the reset camera: world (0,0) renders at
 * screen (512, 384) and zoom is 1, so screen px == world units offset.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import { createSticky, snapshot } from 'src/shared/board-model';
// Registers the test-only `testbox` type (resizable, NOT aspect-locked).
import '../fixtures/testbox';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

function getHook() {
  return (window as unknown as {
    __vidi6: { doc: Y.Doc; gestureStarts: () => number; gestureEnds: () => number };
  }).__vidi6;
}

async function flushRaf() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

/** Creates a testbox object in the doc (the test-only registry type). */
function createTestBox(id: string, x: number, y: number, width: number, height: number): void {
  const doc = getDoc();
  act(() => {
    const map = new Y.Map();
    map.set('type', 'testbox');
    map.set('x', x);
    map.set('y', y);
    map.set('z', 1);
    map.set('width', width);
    map.set('height', height);
    doc.getMap('objects').set(id, map);
  });
}

/** Direct doc mutations wrapped in act() so the re-render flushes. */
function makeNote(x: number, y: number, color: 'yellow' | 'orange', text: string): string {
  const doc = getDoc();
  let id = '';
  act(() => {
    id = createSticky(doc, { x, y }, color, text)!;
  });
  return id;
}

function dragHandle(handle: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, shift = false) {
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y, shiftKey: shift });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: to.x, clientY: to.y, shiftKey: shift });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: to.x, clientY: to.y, shiftKey: shift });
}

describe('sel.transform (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-23: drag unselected b while {a} selected → selection {b}, only b moves; 2px is a click, 3px drags', async () => {
    const doc = getDoc();
    const aId = makeNote(0, 0, 'yellow', 'a'); // centre screen (512,384)
    const b = makeNote(300, 0, 'orange', 'b'); // centre screen (812,384)
    const [noteA, noteB] = screen.getAllByTestId('sticky-note');

    const user = userEvent.setup();
    await user.click(noteA);
    expect(noteA.hasAttribute('data-selected')).toBe(true);

    // b is centred at at=(300,0) → world x = 200; a at at=(0,0) → world x = -100.
    const bStartX = snapshot(doc).find((o) => o.id === b)!.x; // 200
    const aStartX = snapshot(doc).find((o) => o.id === aId)!.x; // -100

    // 2px (< DRAG_THRESHOLD_PX): a click — selects b, moves nothing.
    fireEvent.pointerDown(noteB, { pointerId: 1, button: 0, clientX: 812, clientY: 384 });
    fireEvent.pointerMove(noteB, { pointerId: 1, clientX: 814, clientY: 384 });
    fireEvent.pointerUp(noteB, { pointerId: 1, clientX: 814, clientY: 384 });
    await flushRaf();
    let s = snapshot(doc);
    expect(s.find((o) => o.id === b)!.x).toBe(bStartX);
    // The click replaced the selection: {b}.
    expect(noteA.hasAttribute('data-selected')).toBe(false);
    expect(noteB.hasAttribute('data-selected')).toBe(true);

    // 3px (== DRAG_THRESHOLD_PX): a drag — b moves by 3 world units, a does not.
    fireEvent.pointerDown(noteB, { pointerId: 1, button: 0, clientX: 812, clientY: 384 });
    fireEvent.pointerMove(noteB, { pointerId: 1, clientX: 815, clientY: 384 });
    await flushRaf();
    fireEvent.pointerUp(noteB, { pointerId: 1, clientX: 815, clientY: 384 });
    await flushRaf();

    s = snapshot(doc);
    expect(s.find((o) => o.id === b)!.x).toBe(bStartX + 3);
    expect(s.find((o) => o.id === aId)!.x).toBe(aStartX);
    expect(noteB.hasAttribute('data-selected')).toBe(true);
  });

  it('TC-24: testbox edge handle changes width only; Shift keeps ratio; handles have "Resize <position>" labels', async () => {
    const doc = getDoc();
    createTestBox('tb1', 0, 0, 100, 60); // screen [512,384]–[612,444]
    const box = screen.getByTestId('testbox');

    const user = userEvent.setup();
    await user.click(box);

    // All 8 handles are present and labelled (sel.a11y).
    for (const label of [
      'Resize top',
      'Resize top-right',
      'Resize right',
      'Resize bottom-right',
      'Resize bottom',
      'Resize bottom-left',
      'Resize left',
      'Resize top-left',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }

    // 'right' (e) handle: width only. Drag +100px (== 100 world units).
    const right = screen.getByRole('button', { name: 'Resize right' });
    dragHandle(right, { x: 612, y: 414 }, { x: 712, y: 414 });
    await flushRaf();
    let obj = doc.getMap('objects').get('tb1') as Y.Map<Record<string, unknown>>;
    expect(obj.get('width')).toBe(200);
    expect(obj.get('height')).toBe(60);
    expect(obj.get('x')).toBe(0);
    expect(obj.get('y')).toBe(0);

    // Shift + 'bottom-right' (se) corner: ratio kept. Box is 200×60 →
    // +50 width drives scale 1.25 → 250×75.
    const se = screen.getByRole('button', { name: 'Resize bottom-right' });
    dragHandle(se, { x: 712, y: 444 }, { x: 762, y: 474 }, true);
    await flushRaf();
    obj = doc.getMap('objects').get('tb1') as Y.Map<Record<string, unknown>>;
    expect(obj.get('width')).toBe(250);
    expect(obj.get('height')).toBe(75);
    // Top-left stays anchored at (0, 0).
    expect(obj.get('x')).toBe(0);
    expect(obj.get('y')).toBe(0);
  });

  it('TC-26: onGestureStart/onGestureEnd called exactly once per drag; pointercancel keeps last applied positions', async () => {
    const doc = getDoc();
    makeNote(0, 0, 'yellow', 'a');
    const [note] = screen.getAllByTestId('sticky-note');
    const hook = getHook();

    const startX = snapshot(doc)[0].x; // -100 (centred on at=(0,0))

    // A complete drag: start once, end once.
    fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 512, clientY: 384 });
    fireEvent.pointerMove(note, { pointerId: 1, clientX: 542, clientY: 384 });
    await flushRaf();
    expect(hook.gestureStarts()).toBe(1);
    fireEvent.pointerUp(note, { pointerId: 1, clientX: 542, clientY: 384 });
    await flushRaf();
    expect(hook.gestureStarts()).toBe(1);
    expect(hook.gestureEnds()).toBe(1);
    expect(snapshot(doc)[0].x).toBe(startX + 30);

    // A drag cancelled mid-way: end is still called exactly once, and the
    // last applied position (10 world units) is kept.
    fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 542, clientY: 384 });
    fireEvent.pointerMove(note, { pointerId: 1, clientX: 552, clientY: 384 });
    await flushRaf();
    fireEvent.pointerCancel(note, { pointerId: 1, clientX: 552, clientY: 384 });
    await flushRaf();
    expect(hook.gestureStarts()).toBe(2);
    expect(hook.gestureEnds()).toBe(2);
    expect(snapshot(doc)[0].x).toBe(startX + 40);

    // A plain click (under threshold) starts no gesture.
    fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 552, clientY: 384 });
    fireEvent.pointerMove(note, { pointerId: 1, clientX: 554, clientY: 384 });
    fireEvent.pointerUp(note, { pointerId: 1, clientX: 554, clientY: 384 });
    await flushRaf();
    expect(hook.gestureStarts()).toBe(2);
    expect(hook.gestureEnds()).toBe(2);
  });
});
