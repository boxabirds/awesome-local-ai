/**
 * Multi-select component tests (TC-16 to TC-31).
 * Exercises the full app: multi-select, marquee, group move/resize, keyboard, selection bar.
 */
import { act, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, expect, test } from 'vitest';
import type * as Y from 'yjs';
import { renderBoard, dispatchKey, getCamera, runFrames } from './helpers';
import {
  createSticky,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  DRAG_THRESHOLD_PX,
  STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config';

const pointer = (clientX: number, clientY: number, opts?: Record<string, unknown>) => ({
  pointerId: 7,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX,
  clientY,
  ...opts,
});

function doc(): Y.Doc {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook window.__vidi6 is not registered');
  return hooks.getDoc();
}

function notes(): readonly StickySnapshot[] {
  return window.__vidi6?.getNotes() ?? [];
}

function note(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!element) throw new Error(`note ${id} is not rendered`);
  return element;
}

async function addNote(x = 0, y = 0): Promise<string> {
  let id = '';
  await act(() => { id = createSticky(doc(), { x, y }); });
  return id;
}

async function clickNote(id: string, x = 300, y = 300): Promise<void> {
  const el = note(id);
  fireEvent.pointerDown(el, pointer(x, y));
  fireEvent.pointerUp(el, pointer(x, y));
  await runFrames();
}

async function shiftClickNote(id: string, x = 300, y = 300): Promise<void> {
  const el = note(id);
  fireEvent.pointerDown(el, pointer(x, y, { shiftKey: true }));
  fireEvent.pointerUp(el, pointer(x, y, { shiftKey: true }));
  await runFrames();
}

function viewport(): HTMLElement {
  const vp = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
  if (!vp) throw new Error('viewport not found');
  return vp;
}

/** Reset camera to origin (screen = world at zoom 1). */
async function originCamera(): Promise<void> {
  window.__vidi6!.setCamera({ x: 0, y: 0, zoom: 1 });
  await runFrames();
  await runFrames();
}

describe('multi-select', () => {
  test('TC-16 shift-click builds a multi-selection; clicking an unselected object replaces it', async () => {
    renderBoard();
    const a = await addNote(0, 0);
    const b = await addNote(200, 0);
    const c = await addNote(400, 0);

    await clickNote(a);
    expect(note(a)).toHaveAttribute('data-selected', 'true');
    expect(note(b)).not.toHaveAttribute('data-selected');

    await shiftClickNote(b);
    expect(note(a)).toHaveAttribute('data-selected', 'true');
    expect(note(b)).toHaveAttribute('data-selected', 'true');

    // Clicking unselected object replaces selection
    await clickNote(c);
    expect(note(a)).not.toHaveAttribute('data-selected');
    expect(note(b)).not.toHaveAttribute('data-selected');
    expect(note(c)).toHaveAttribute('data-selected', 'true');
  });

  test('TC-17 shift-click a selected object removes it from selection', async () => {
    renderBoard();
    const a = await addNote(0, 0);
    const b = await addNote(200, 0);

    await clickNote(a);
    await shiftClickNote(b);
    expect(note(a)).toHaveAttribute('data-selected');
    expect(note(b)).toHaveAttribute('data-selected');

    await shiftClickNote(a);
    expect(note(a)).not.toHaveAttribute('data-selected');
    expect(note(b)).toHaveAttribute('data-selected');
  });

  test('TC-19 marquee selects objects it covers', async () => {
    renderBoard();
    await originCamera();

    const a = await addNote(150, 150);
    const b = await addNote(800, 800);
    await runFrames();

    const vp = viewport();

    // Marquee: shift+drag on background from (50,50) to (300,300)
    // world rect = (50, 50, 250, 250). Note at createSticky(150,150) → stored pos (125,125), bounds (125,125,50,50) — inside.
    // Note at createSticky(800,800) → stored pos (775,775) — outside.
    fireEvent.pointerDown(vp, pointer(50, 50, { shiftKey: true }));
    await runFrames();
    fireEvent.pointerMove(vp, pointer(300, 300, { shiftKey: true }));
    await runFrames();
    expect(document.querySelector('[data-testid="marquee-rect"]')).not.toBeNull();
    fireEvent.pointerUp(vp, pointer(300, 300, { shiftKey: true }));
    await runFrames();

    expect(note(a)).toHaveAttribute('data-selected', 'true');
    expect(note(b)).not.toHaveAttribute('data-selected');
  });

  test('TC-20 Ctrl+A selects all, Escape deselects', async () => {
    renderBoard();
    await addNote(0, 0);
    await addNote(200, 0);
    await addNote(400, 0);

    dispatchKey(window, { key: 'a', ctrlKey: true });
    await runFrames();

    expect(screen.getByText('3 selected')).toBeInTheDocument();

    dispatchKey(window, { key: 'Escape' });
    await runFrames();

    expect(screen.queryByText('3 selected')).toBeNull();
  });

  test('TC-23 group move: dragging any selected member moves all by the same world delta', async () => {
    renderBoard();
    const a = await addNote(0, 0);
    const b = await addNote(200, 0);

    await clickNote(a);
    await shiftClickNote(b);

    const before = notes();
    const beforeA = before.find((n) => n.id === a)!;
    const beforeB = before.find((n) => n.id === b)!;

    // Drag a by DRAG_THRESHOLD_PX
    const el = note(a);
    fireEvent.pointerDown(el, pointer(300, 300));
    fireEvent.pointerMove(el, pointer(300 + DRAG_THRESHOLD_PX, 300));
    await runFrames();

    const after = notes();
    const afterA = after.find((n) => n.id === a)!;
    const afterB = after.find((n) => n.id === b)!;
    const cam = getCamera();
    const expectedDx = DRAG_THRESHOLD_PX / cam.zoom;

    expect(afterA.x).toBeCloseTo(beforeA.x + expectedDx, 4);
    expect(afterB.x).toBeCloseTo(beforeB.x + expectedDx, 4);
  });

  test('TC-24 group delete deletes every selected object', async () => {
    renderBoard();
    const a = await addNote(0, 0);
    const b = await addNote(200, 0);
    const c = await addNote(400, 0);

    await clickNote(a);
    await shiftClickNote(b);

    const deleteBtn = screen.getByLabelText('Delete selection');
    fireEvent.click(deleteBtn);
    await runFrames();

    expect(notes().find((n) => n.id === a)).toBeUndefined();
    expect(notes().find((n) => n.id === b)).toBeUndefined();
    expect(notes().find((n) => n.id === c)).toBeDefined();
  });

  test('TC-25 arrow nudges all selected objects, Shift = larger step', async () => {
    renderBoard();
    const a = await addNote(0, 0);
    const b = await addNote(200, 0);

    await clickNote(a);
    await shiftClickNote(b);

    const before = notes();

    dispatchKey(window, { key: 'ArrowRight' });
    await runFrames();

    let after = notes();
    expect(after.find((n) => n.id === a)!.x).toBeCloseTo(
      before.find((n) => n.id === a)!.x + NUDGE_STEP_WORLD, 6,
    );
    expect(after.find((n) => n.id === b)!.x).toBeCloseTo(
      before.find((n) => n.id === b)!.x + NUDGE_STEP_WORLD, 6,
    );

    dispatchKey(window, { key: 'ArrowUp', shiftKey: true });
    await runFrames();

    after = notes();
    expect(after.find((n) => n.id === a)!.y).toBeCloseTo(
      before.find((n) => n.id === a)!.y - NUDGE_LARGE_STEP_WORLD, 6,
    );
    expect(after.find((n) => n.id === b)!.y).toBeCloseTo(
      before.find((n) => n.id === b)!.y - NUDGE_LARGE_STEP_WORLD, 6,
    );
  });

  test('TC-26 Delete/Backspace deletes the selection', async () => {
    renderBoard();
    const a = await addNote(0, 0);
    const b = await addNote(200, 0);

    await clickNote(a);
    await shiftClickNote(b);

    dispatchKey(window, { key: 'Delete' });
    await runFrames();

    expect(notes().length).toBe(0);
  });

  test('TC-27 resize scales every selected object proportionally', async () => {
    renderBoard();
    const a = await addNote(0, 0);
    const b = await addNote(100, 0);

    await clickNote(a);
    await shiftClickNote(b);
    await runFrames();

    // Find SE handle
    const seHandle = screen.getByLabelText('Resize bottom-right');

    // Drag the handle outward
    fireEvent.pointerDown(seHandle, pointer(400, 400));
    await runFrames();
    fireEvent.pointerMove(seHandle, pointer(500, 500));
    await runFrames();
    fireEvent.pointerUp(seHandle, pointer(500, 500));
    await runFrames();

    const after = notes();
    const noteA = after.find((n) => n.id === a)!;
    const noteB = after.find((n) => n.id === b)!;
    // Both notes should be wider than original (50)
    expect(noteA.width!).toBeGreaterThan(50);
    expect(noteB.width!).toBeGreaterThan(50);
  });

  test('TC-28 resize clamps to minimum total scale', async () => {
    renderBoard();
    const a = await addNote(0, 0);

    await clickNote(a);
    await runFrames();
    const seHandle = screen.getByLabelText('Resize bottom-right');

    // Drag the handle far inward
    fireEvent.pointerDown(seHandle, pointer(400, 400));
    await runFrames();
    fireEvent.pointerMove(seHandle, pointer(200, 200));
    await runFrames();
    fireEvent.pointerUp(seHandle, pointer(200, 200));
    await runFrames();

    const noteA = notes().find((n) => n.id === a)!;
    expect(noteA.width!).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
    expect(noteA.height!).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
  });

  test('TC-29 selection bar appears for 2+, disappears for 1', async () => {
    renderBoard();
    const a = await addNote(0, 0);
    const b = await addNote(200, 0);

    await clickNote(a);
    expect(screen.queryByText('1 selected')).toBeNull();

    await shiftClickNote(b);
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    // Escape deselects all
    dispatchKey(window, { key: 'Escape' });
    await runFrames();
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  test('TC-30 editing is blocked while a group is selected', async () => {
    renderBoard();
    const a = await addNote(0, 0);
    const b = await addNote(200, 0);

    await clickNote(a);
    await shiftClickNote(b);

    // Try to enter edit mode with Enter
    dispatchKey(window, { key: 'Enter' });
    await runFrames();

    // Should NOT be editing (Enter edit only works for single selection)
    expect(screen.queryByTestId('sticky-note-input')).toBeNull();
  });

  test('TC-31 group resize maintains aspect for a single locked object', async () => {
    renderBoard();
    const a = await addNote(0, 0);

    await clickNote(a);
    await runFrames();

    const seHandle = screen.getByLabelText('Resize bottom-right');
    const before = notes().find((n) => n.id === a)!;
    const beforeW = before.width ?? 50;
    const beforeH = before.height ?? 50;

    // Drag SE outward in x only
    fireEvent.pointerDown(seHandle, pointer(400, 400));
    await runFrames();
    fireEvent.pointerMove(seHandle, pointer(500, 400));
    await runFrames();
    fireEvent.pointerUp(seHandle, pointer(500, 400));
    await runFrames();

    const after = notes().find((n) => n.id === a)!;
    // Aspect-locked: width and height scale by the same factor
    const scaleW = after.width! / beforeW;
    const scaleH = after.height! / beforeH;
    expect(scaleW).toBeCloseTo(scaleH, 4);
  });
});
