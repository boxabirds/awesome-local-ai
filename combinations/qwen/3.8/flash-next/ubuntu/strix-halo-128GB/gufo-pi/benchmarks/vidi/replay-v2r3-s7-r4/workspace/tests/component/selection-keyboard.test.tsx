import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import type * as Y from 'yjs';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { createSticky, snapshot } from '../../src/shared/board-model';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
} from '../../src/shared/config';
import { pointer, frames } from './pointerUtils';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(readOnly = false) {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} readOnly={readOnly} />);
  const handle = handleRef.current!;
  return {
    handle,
    doc: handle.doc,
    create: (x: number, y: number) => {
      let id = '';
      act(() => {
        id = createSticky(handle.doc, { x, y });
      });
      return id;
    },
    surface: () => document.querySelector<HTMLElement>('[data-grid-layer="true"]')!,
  };
}

const noteEls = () => screen.getAllByTestId('sticky-note');
function clickEl(el: HTMLElement, x = 640, y = 400): void {
  pointer(el, 'pointerdown', x, y);
  pointer(window, 'pointerup', x, y);
  frames();
}
function key(k: string, init: KeyboardEventInit = {}): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...init }));
  });
  frames();
}
const xOf = (doc: Y.Doc, id: string) => snapshot(doc).find((n) => n.id === id)!.x;
function doubleClick(el: HTMLElement): void {
  fireEvent.doubleClick(el, { clientX: 640, clientY: 400 });
}

describe('selection keyboard commands', () => {
  it('TC-28: arrow nudges a single object by one step; shift nudges by the large step', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();
    clickEl(noteEls()[0]);
    const x0 = snapshot(doc)[0].x;
    const y0 = snapshot(doc)[0].y;

    key('ArrowRight');
    expect(xOf(doc, id)).toBeCloseTo(x0 + NUDGE_STEP_WORLD, 6);

    key('ArrowRight', { shiftKey: true });
    expect(xOf(doc, id)).toBeCloseTo(x0 + NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD, 6);

    key('ArrowUp');
    expect(snapshot(doc)[0].y).toBeCloseTo(y0 - NUDGE_STEP_WORLD, 6);
  });

  it('TC-28: arrows and delete apply to the whole multi-selection', () => {
    const { handle, doc, create } = setup();
    create(0, 0);
    create(400, 0);
    frames();
    pointer(noteEls()[0], 'pointerdown', 640, 400, { shiftKey: true });
    pointer(window, 'pointerup', 640, 400, { shiftKey: true });
    frames();
    pointer(noteEls()[1], 'pointerdown', 640, 400, { shiftKey: true });
    pointer(window, 'pointerup', 640, 400, { shiftKey: true });
    frames();
    expect(handle.getSelectedIds()).toHaveLength(2);

    const xs = snapshot(doc).map((n) => n.x);
    key('ArrowRight');
    const after = snapshot(doc);
    expect(after[0].x).toBeCloseTo(xs[0] + NUDGE_STEP_WORLD, 6);
    expect(after[1].x).toBeCloseTo(xs[1] + NUDGE_STEP_WORLD, 6);

    key('Delete');
    expect(snapshot(doc)).toHaveLength(0);
    expect(handle.getSelectedIds()).toHaveLength(0);
  });

  it('TC-28: Escape clears the selection and does not move the camera', () => {
    const { handle, create } = setup();
    create(0, 0);
    frames();
    const camBefore = handle.getCamera();
    clickEl(noteEls()[0]);
    expect(handle.getSelectedIds()).toHaveLength(1);

    key('Escape');
    expect(handle.getSelectedIds()).toHaveLength(0);
    expect(handle.getCamera()).toEqual(camBefore);
  });

  it('TC-28: Ctrl+A selects all', () => {
    const { handle, create } = setup();
    create(0, 0);
    create(300, 0);
    create(600, 0);
    frames();
    key('a', { ctrlKey: true });
    expect(handle.getSelectedIds()).toHaveLength(3);
  });

  it('TC-28 boundary: arrows with nothing selected do not move anything', () => {
    const { doc, create } = setup();
    create(0, 0);
    frames();
    const x = snapshot(doc)[0].x;
    key('ArrowRight');
    expect(snapshot(doc)[0].x).toBe(x);
  });

  it('TC-28 boundary: Ctrl+A on an empty board selects nothing and does not error', () => {
    const { handle } = setup();
    frames();
    expect(() => key('a', { ctrlKey: true })).not.toThrow();
    expect(handle.getSelectedIds()).toHaveLength(0);
  });

  it('TC-28 read-only: delete and nudge are ignored', () => {
    const { handle, doc, create } = setup(true);
    const id = create(0, 0);
    frames();
    clickEl(noteEls()[0]);

    key('Delete');
    expect(snapshot(doc)).toHaveLength(1);

    key('ArrowRight');
    expect(xOf(doc, id)).toBe(snapshot(doc)[0].x);
    expect(handle.getSelectedIds()).toHaveLength(1); // selection itself still works
  });

  it('TC-29: Ctrl+A keeps select-all text behaviour while editing (no board select-all)', () => {
    const { handle, doc, create } = setup();
    create(0, 0);
    create(300, 0);
    frames();
    const note = noteEls()[0];
    clickEl(note);
    doubleClick(note);
    frames();
    expect(handle.getEditingId()).not.toBeNull();

    const editor = screen.getByTestId('sticky-note-editor');
    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
      );
    });
    frames();
    // The board did NOT select both notes.
    expect(handle.getSelectedIds()).toHaveLength(1);
  });

  it('TC-29: arrows do not nudge and Enter does not create while editing', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();
    const note = noteEls()[0];
    clickEl(note);
    doubleClick(note);
    frames();
    const x = snapshot(doc)[0].x;

    key('ArrowRight');
    expect(snapshot(doc)[0].x).toBe(x);
    key('Enter');
    expect(snapshot(doc)).toHaveLength(1);
    key('ArrowLeft');
    expect(snapshot(doc)[0].x).toBe(x);
    expect(handle.getEditingId()).toBe(id);
  });

  it('TC-29: Ctrl+A and arrows keep the camera unchanged', () => {
    const { handle, create } = setup();
    create(0, 0);
    frames();
    clickEl(noteEls()[0]);
    const cam = handle.getCamera();
    key('a', { ctrlKey: true });
    key('ArrowRight');
    expect(handle.getCamera()).toEqual(cam);
  });
});
